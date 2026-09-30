import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { createNodeBackupCrypto, decodeBackupArchive } from "@bravos/backup/node";
import { BACKUP_SECTION_NAMES } from "@bravos/backup";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PASSWORD = "نسخة-برافوس-آمنة-2026";

let cluster: PostgresCluster;
let built: BuiltApp;
let ownerId = "";
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55465 });
}, 120_000);

beforeEach(async () => {
  const databaseName = `bravos_backup_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-backup-outbox-")),
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
  const owner = await built.pool.query<{ id: string }>(`SELECT id FROM "user" WHERE username = 'owner'`);
  ownerId = owner.rows[0]!.id;
  const branch = await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code = 'abshway'");
  branchId = branch.rows[0]!.id;
});

afterEach(async () => {
  if (built) await built.close();
});

afterAll(async () => {
  if (cluster) await cluster.stop();
});

test("manager downloads one authenticated business snapshot with privacy and unsynchronized-till evidence", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const employeeCreate = await jsonApi(manager, "POST", "/api/internal/staff", {
    loginName: "backup.roundtrip",
    displayName: "موظف داخل النسخة",
    password: "backup-roundtrip-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(employeeCreate.status).toBe(201);
  const employeeId = (employeeCreate.body as { id: string }).id;
  const categoryId = crypto.randomUUID();
  const sizeId = crypto.randomUUID();
  const colorId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const pendingOperationId = crypto.randomUUID();
  const acceptedPreviewId = crypto.randomUUID();
  await built.pool.query("INSERT INTO catalog_category (id,name_ar,parent_id,created_at,updated_at) VALUES ($1,'قمصان',NULL,now(),now())", [categoryId]);
  await built.pool.query("INSERT INTO catalog_size (id,name_ar,created_at,updated_at) VALUES ($1,'L',now(),now())", [sizeId]);
  await built.pool.query("INSERT INTO catalog_color (id,name_ar,created_at,updated_at) VALUES ($1,'أسود',now(),now())", [colorId]);
  await built.pool.query(
    `INSERT INTO catalog_product (id,code,name_ar,description_ar,category_id,default_selling_price_piasters,publication,image_refs,size_guide_ar,created_at,updated_at)
     VALUES ($1,'BACKUP-1','قميص نسخة','',$2,50000,'available','["products/photo-1.webp"]'::jsonb,NULL,now(),now())`,
    [productId, categoryId],
  );
  await built.pool.query(
    `INSERT INTO catalog_product_variant (id,product_id,size_id,color_id,selling_price_piasters_override,online_visible,created_at,updated_at)
     VALUES ($1,$2,$3,$4,NULL,FALSE,now(),now())`,
    [variantId, productId, sizeId, colorId],
  );
  await built.pool.query(
    `INSERT INTO sales_pos_snapshot (id,staff_id,branch_id,device_id,issued_at,price_fingerprint,pricing_version)
     VALUES ($1,$2,$3,$4,now(),repeat('e',64),1)`,
    [snapshotId, ownerId, branchId, deviceId],
  );
  await built.pool.query(
    `INSERT INTO inventory_known_till (device_id,staff_id,latest_snapshot_id,latest_snapshot_at,stock_version,pending_operation_ids,included_operation_ids,synchronization_complete)
     VALUES ($1,$2,$3,now(),0,ARRAY[$4]::uuid[],'{}',FALSE)`,
    [deviceId, ownerId, snapshotId, pendingOperationId],
  );
  await built.pool.query(
    `INSERT INTO opening_import_preview (id,operation_id,input_fingerprint,preview_fingerprint,status,plan_json,state_json,response_json,created_by_staff_id,created_at,accepted_by_staff_id,accepted_at)
     VALUES ($1,$2,repeat('a',64),repeat('b',64),'accepted','{"restrictedUnitCostPiasters":12345}','{}','{"status":"accepted"}',$3,now(),$3,now())`,
    [acceptedPreviewId, crypto.randomUUID(), ownerId],
  );
  await built.pool.query(
    `INSERT INTO opening_import_preview (id,operation_id,input_fingerprint,preview_fingerprint,status,plan_json,state_json,response_json,created_by_staff_id,created_at)
     VALUES ($1,$2,repeat('c',64),repeat('d',64),'ready','{"transient":true}','{}','{"status":"ready"}',$3,now())`,
    [crypto.randomUUID(), crypto.randomUUID(), ownerId],
  );

  const readiness = await jsonApi(manager, "GET", "/api/internal/backups/readiness");
  expect(readiness.status).toBe(200);
  expect(readiness.body).toMatchObject({
    knownUnsynchronizedTillCount: 1,
    includesUnsentBrowserRecords: false,
    imageBinariesIncluded: false,
    imageReferencesPreserved: true,
    knownUnsynchronizedTills: [{ deviceId, staffId: ownerId, pendingOperationIds: [pendingOperationId], pendingOperationCount: 1 }],
  });

  const beforeTables = await businessTableCounts();
  const response = await built.app.inject({
    method: "POST",
    url: "/api/internal/backups",
    headers: { origin: INTERNAL_ORIGIN, cookie: manager.cookie, "content-type": "application/json" },
    payload: { password: PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  expect(response.headers["content-type"]).toContain("application/vnd.bravos.backup");
  expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="bravos-business-backup-.+\.bravos-backup"$/);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["x-bravos-backup-format-version"]).toBe("1");
  expect(response.headers["x-bravos-backup-known-unsynchronized-till-count"]).toBe("1");
  expect(response.headers["x-bravos-backup-includes-unsent-browser-records"]).toBe("false");
  expect(response.headers["x-bravos-backup-includes-image-binaries"]).toBe("false");

  const bytes = response.rawPayload;
  expect(response.headers["x-bravos-backup-sha256"]).toBe(createHash("sha256").update(bytes).digest("hex"));
  const sectionCounts = JSON.parse(Buffer.from(String(response.headers["x-bravos-backup-section-counts"]), "base64url").toString("utf8"));
  expect(Object.keys(sectionCounts)).toEqual([...BACKUP_SECTION_NAMES]);
  expect(sectionCounts.catalog).toBeGreaterThanOrEqual(5);
  expect(sectionCounts.opening_import).toBe(1);
  const decoded = await decodeBackupArchive(bytes, PASSWORD);
  expect(decoded.manifest).toMatchObject({
    format: "bravos-business-data",
    formatVersion: 1,
    createdByStaffId: ownerId,
    includesUnsentBrowserRecords: false,
    imageBinariesIncluded: false,
    imageReferencesPreserved: true,
    schemaVersion: "034_order_recognition_branch.sql",
    sourceGeneration: 0,
    salesSaleReferenceSequence: { lastValue: expect.stringMatching(/^\d+$/), isCalled: expect.any(Boolean) },
    returnsReturnReferenceSequence: { lastValue: expect.stringMatching(/^\d+$/), isCalled: expect.any(Boolean) },
    knownUnsynchronizedTills: [{ deviceId, pendingOperationIds: [pendingOperationId] }],
    identityPolicy: { preservesStableIds: true, preservesForeignKeys: true, regeneratesIds: false },
    idProvenance: { source: "database_primary_and_foreign_keys", stableIdsPreserved: true, foreignKeysPreserved: true, idsRegenerated: false },
  });
  expect(decoded.data.inventory.inventory_known_till).toEqual([expect.not.objectContaining({ restore_generation: expect.anything() })]);
  expect(decoded.data.inventory.inventory_batch_balance).toEqual([]);
  expect(decoded.data.catalog.catalog_product_variant).toEqual([expect.objectContaining({ id: variantId, online_visible: false })]);
  expect(decoded.data.sales.sales_restore_deferred_completion).toEqual([]);
  const actors = decoded.data.identity.identity_actor ?? [];
  expect(actors).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: ownerId, username: "owner", role: "manager" }),
    expect.objectContaining({ id: employeeId, username: "backup.roundtrip", role: "employee" }),
  ]));
  expect(actors).toHaveLength(2);
  expect(actors.every((actor) => !("email" in actor) && !("password" in actor))).toBe(true);
  expect(decoded.data.identity).not.toHaveProperty("account");
  expect(decoded.data.identity).not.toHaveProperty("session");
  expect(decoded.data.identity).not.toHaveProperty("verification");
  expect(JSON.stringify(decoded)).not.toContain("owner-pass-1");
  expect(JSON.stringify(decoded)).not.toContain("backup-roundtrip-pass-1");
  expect(decoded.data.catalog.catalog_product).toEqual([
    expect.objectContaining({ id: productId, image_refs: ["products/photo-1.webp"] }),
  ]);
  expect(decoded.data.opening_import.opening_import_preview).toEqual([
    expect.objectContaining({ id: acceptedPreviewId, status: "accepted" }),
  ]);
  expect(await businessTableCounts()).toEqual(beforeTables);

  const archiveInvalid = { code: "BACKUP_ARCHIVE_INVALID", message: "تعذر فتح النسخة الاحتياطية. تحقق من كلمة المرور وسلامة الملف." };
  await expect(decodeBackupArchive(bytes, "كلمة-مرور-خاطئة-تماما")).rejects.toMatchObject(archiveInvalid);
  const magicLength = Buffer.from("BRAVOS-BACKUP\n1\n", "ascii").length;
  const envelope = JSON.parse(bytes.subarray(magicLength).toString("utf8")) as { ciphertext: string };
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  ciphertext[Math.floor(ciphertext.length / 2)] = ciphertext[Math.floor(ciphertext.length / 2)]! ^ 1;
  const tampered = Buffer.concat([
    bytes.subarray(0, magicLength),
    Buffer.from(bytes.subarray(magicLength).toString("utf8").replace(envelope.ciphertext, ciphertext.toString("base64url")), "utf8"),
  ]);
  expect(tampered.byteLength).toBe(bytes.byteLength);
  await expect(decodeBackupArchive(tampered, PASSWORD)).rejects.toMatchObject(archiveInvalid);

  const boundedCrypto = createNodeBackupCrypto({ maxArchiveBytes: 1_024 });
  await expect(boundedCrypto.protect({ padding: "x".repeat(1_024) } as never, PASSWORD))
    .rejects.toThrow("حجم بيانات النسخة الاحتياطية يتجاوز الحد المدعوم");
});

test("business flows created through the application are archived table by table with exact dates, timestamps and counters", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  expect((await jsonApi(manager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const today = cairoDate(new Date());
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await jsonApi(manager, "POST", "/api/internal/catalog/categories", { nameAr: `نسخ ${suffix}` });
  const size = await jsonApi(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await jsonApi(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const product = await jsonApi(manager, "POST", "/api/internal/catalog/products", {
    code: `BACKUP-FLOW-${suffix}`,
    nameAr: "منتج النسخة",
    descriptionAr: "تدفق النسخة الاحتياطية",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 45000,
    publication: "available",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const variantId = product.body.variants[0].id as string;
  const receipt = await jsonApi(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: today,
    lines: [{ variantId, quantity: 4, unitCostPiasters: 10000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const correctedReceipt = await jsonApi(manager, "POST", `/api/internal/receiving/receipts/${receipt.body.id}/corrections`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    reason: "تصحيح تكلفة داخل النسخة",
    lines: [{ lineId: receipt.body.lines[0].id, quantity: 4, unitCostPiasters: 12000 }],
  });
  expect(correctedReceipt.status, JSON.stringify(correctedReceipt.body)).toBe(201);
  const sale = await jsonApi(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: new Date().toISOString(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  const expenseCategory = await jsonApi(manager, "POST", "/api/internal/expense-categories", { nameAr: `تشغيل ${suffix}` });
  expect(expenseCategory.status, JSON.stringify(expenseCategory.body)).toBe(201);
  const expense = await jsonApi(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 2500,
    expenseDate: today,
    categoryId: expenseCategory.body.id,
    description: "مصروف داخل النسخة",
  });
  expect(expense.status, JSON.stringify(expense.body)).toBe(201);
  const correctedExpense = await jsonApi(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "correction",
    reason: "تصحيح المصروف",
    amountPiasters: 2000,
    expenseDate: today,
    categoryId: expenseCategory.body.id,
    description: "مصروف داخل النسخة",
  });
  expect(correctedExpense.status, JSON.stringify(correctedExpense.body)).toBe(201);
  const area = await jsonApi(manager, "POST", "/api/internal/delivery-areas", { nameAr: `منطقة ${suffix}`, feePiasters: 5000, active: true });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const order = await submitOnlineOrder(area.body.id, variantId, suffix);
  const review = await jsonApi(manager, "POST", `/api/internal/online-orders/${order.orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await jsonApi(manager, "POST", `/api/internal/online-orders/${order.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await jsonApi(manager, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    itemsLocatedAndSetAside: true,
    fulfillmentBranchId: branchId,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);

  const response = await built.app.inject({
    method: "POST",
    url: "/api/internal/backups",
    headers: { origin: INTERNAL_ORIGIN, cookie: manager.cookie, "content-type": "application/json" },
    payload: { password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(201);
  const decoded = await decodeBackupArchive(response.rawPayload, PASSWORD);

  for (const section of decoded.manifest.sections) {
    for (const table of section.tables) {
      const rows = (decoded.data[section.name] as Record<string, unknown[]>)[table.name] ?? [];
      expect(rows, table.name).toHaveLength(table.recordCount);
      expect(table.recordCount, table.name).toBe(await liveCount(table.name));
    }
  }
  for (const table of ["receiving_receipt", "receiving_correction", "sales_sale", "sales_sale_unit", "inventory_allocation",
    "expense_record", "expense_change", "online_order", "online_order_confirmation", "inventory_protected_order_allocation"]) {
    expect(await liveCount(table), table).toBeGreaterThan(0);
  }

  expect(decoded.data.receiving.receiving_receipt).toEqual([expect.objectContaining({ id: receipt.body.id, receipt_date: today })]);
  expect(decoded.data.expenses.expense_record).toEqual([expect.objectContaining({ id: expense.body.id, expense_date: today })]);
  const liveRecordedAt = await built.pool.query<{ recorded_at: string }>(
    `SELECT (recorded_at AT TIME ZONE 'UTC')::text || '+00' AS recorded_at FROM expense_record WHERE id = $1`,
    [expense.body.id],
  );
  expect(decoded.data.expenses.expense_record[0]).toMatchObject({ recorded_at: liveRecordedAt.rows[0]!.recorded_at });
  const archivedAllocations = decoded.data.inventory.inventory_allocation as Array<{ batch_id: string }>;
  const archivedBatchIds = new Set((decoded.data.inventory.inventory_batch as Array<{ id: string }>).map((batch) => batch.id));
  expect(archivedAllocations.length).toBeGreaterThan(0);
  expect(archivedAllocations.every((allocation) => archivedBatchIds.has(allocation.batch_id))).toBe(true);
  const clock = await built.pool.query<{ version: string }>("SELECT version::text FROM inventory_stock_clock WHERE id = TRUE");
  const sequence = await built.pool.query<{ last_value: string; is_called: boolean }>(
    "SELECT last_value::text, is_called FROM online_order_reference_number_seq",
  );
  expect(decoded.manifest.stockVersion).toBe(clock.rows[0]!.version);
  expect(decoded.manifest.onlineOrderReferenceSequence).toEqual({
    lastValue: sequence.rows[0]!.last_value,
    isCalled: sequence.rows[0]!.is_called,
  });
  for (const [sequenceName, manifestSequence] of [
    ["sales_sale_reference_number_seq", decoded.manifest.salesSaleReferenceSequence],
    ["returns_return_reference_number_seq", decoded.manifest.returnsReturnReferenceSequence],
  ] as const) {
    const current = await built.pool.query<{ last_value: string; is_called: boolean }>(
      `SELECT last_value::text, is_called FROM ${sequenceName}`,
    );
    expect(manifestSequence).toEqual({ lastValue: current.rows[0]!.last_value, isCalled: current.rows[0]!.is_called });
  }
});

test("backup creation is manager-only and validates the download password", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const create = await jsonApi(manager, "POST", "/api/internal/staff", {
    loginName: "backup.cashier",
    displayName: "موظف النسخ",
    password: "cashier-backup-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(create.status).toBe(201);
  const employee = await signIn("backup.cashier", "cashier-backup-pass-1");
  expect((await jsonApi(employee, "GET", "/api/internal/backups/readiness")).status).toBe(403);
  expect((await jsonApi(employee, "POST", "/api/internal/backups", { password: PASSWORD })).status).toBe(403);
  const invalid = await jsonApi(manager, "POST", "/api/internal/backups", { password: "short" });
  expect(invalid).toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });

  const createBackup = () => built.app.inject({
    method: "POST",
    url: "/api/internal/backups",
    headers: { origin: INTERNAL_ORIGIN, cookie: manager.cookie, "content-type": "application/json" },
    payload: { password: PASSWORD },
  });
  const concurrent = await Promise.all([createBackup(), createBackup()]);
  expect(concurrent.map((result) => result.statusCode).sort()).toEqual([201, 409]);
  expect(JSON.parse(concurrent.find((result) => result.statusCode === 409)!.body)).toMatchObject({ error: { code: "CONFLICT" } });
  expect((await createBackup()).statusCode).toBe(201);
});

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const cookies = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : response.headers["set-cookie"] ? [response.headers["set-cookie"]] : [];
  return { cookie: cookies.map((value) => value.split(";")[0]).filter(Boolean).join("; ") };
}

async function jsonApi(session: CookieSession, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin: INTERNAL_ORIGIN, cookie: session.cookie, ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

async function liveCount(table: string): Promise<number> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Unexpected table name ${table}`);
  const sql = table === "identity_actor"
    ? `SELECT count(*)::int AS count FROM "user" actor INNER JOIN staff_profile profile ON profile.staff_id = actor.id`
    : table === "opening_import_preview"
      ? "SELECT count(*)::int AS count FROM opening_import_preview WHERE status = 'accepted'"
      : `SELECT count(*)::int AS count FROM ${table}`;
  const result = await built.pool.query<{ count: number }>(sql);
  return result.rows[0]!.count;
}

async function submitOnlineOrder(deliveryAreaId: string, variantId: string, suffix: string) {
  const quote = await built.app.inject({
    method: "POST",
    url: "/api/public/checkout/quote",
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    payload: { deliveryAreaId, lines: [{ variantId, quantity: 1 }] },
  });
  expect(quote.statusCode, quote.body).toBe(200);
  const submitted = await built.app.inject({
    method: "POST",
    url: "/api/public/checkout/orders",
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    payload: {
      operationId: crypto.randomUUID(),
      quoteId: JSON.parse(quote.body).quoteId,
      deliveryAreaId,
      lines: [{ variantId, quantity: 1 }],
      customerName: `عميل ${suffix}`,
      primaryPhone: "01012345678",
      detailedAddress: `عنوان ${suffix}`,
    },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  return JSON.parse(submitted.body) as { orderId: string; reference: string };
}

function cairoDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

async function businessTableCounts() {
  const result = await built.pool.query<{ catalog_product: string; opening_import_preview: string }>(
    "SELECT (SELECT count(*) FROM catalog_product)::text AS catalog_product, (SELECT count(*) FROM opening_import_preview)::text AS opening_import_preview",
  );
  return result.rows[0];
}
