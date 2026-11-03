import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { createNodeBackupCrypto, decodeBackupArchive } from "@bravos/backup/node";
import { BACKUP_SECTION_NAMES } from "@bravos/backup";
import { canonicalJson } from "../../packages/backup/src/domain/canonical-json.ts";
import { revertLastMigration } from "@bravos/persistence";
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
    schemaVersion: "037_operational_stock.sql",
    sourceGeneration: 0,
    salesSaleReferenceSequence: { lastValue: expect.stringMatching(/^\d+$/), isCalled: expect.any(Boolean) },
    returnsReturnReferenceSequence: { lastValue: expect.stringMatching(/^\d+$/), isCalled: expect.any(Boolean) },
    knownUnsynchronizedTills: [{ deviceId, pendingOperationIds: [pendingOperationId] }],
    identityPolicy: { preservesStableIds: true, preservesForeignKeys: true, regeneratesIds: false },
    idProvenance: { source: "database_primary_and_foreign_keys", stableIdsPreserved: true, foreignKeysPreserved: true, idsRegenerated: false },
  });
  const prefixSequence = await built.pool.query<{ last_value: string; is_called: boolean }>(
    "SELECT last_value::text AS last_value, is_called FROM sales_receipt_prefix_seq",
  );
  expect(decoded.manifest.salesReceiptPrefixSequence).toEqual({
    lastValue: prefixSequence.rows[0]!.last_value,
    isCalled: prefixSequence.rows[0]!.is_called,
  });
  expect(decoded.data.sales.sales_receipt_registration).toEqual([]);
  expect(decoded.data.inventory.inventory_known_till).toEqual([expect.not.objectContaining({ restore_generation: expect.anything() })]);
  expect(decoded.data.inventory.inventory_batch_balance).toEqual([]);
  expect(decoded.data.catalog.catalog_product_variant).toHaveLength(2);
  expect(decoded.data.catalog.catalog_product_variant).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: variantId, online_visible: false, purpose: "website_option" }),
    expect.objectContaining({
      purpose: "operational",
      online_visible: false,
      size_id: "a0000000-0000-4000-8000-000000000001",
      color_id: "a0000000-0000-4000-8000-000000000002",
    }),
  ]));
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
    ["sales_receipt_prefix_seq", decoded.manifest.salesReceiptPrefixSequence],
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

test("receipt numbering archive keeps an unbounded sequence, registry rows, and rejects mismatched profiles", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  expect((await jsonApi(manager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await jsonApi(manager, "POST", "/api/internal/catalog/categories", { nameAr: `إيصال ${suffix}` });
  const size = await jsonApi(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await jsonApi(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const product = await jsonApi(manager, "POST", "/api/internal/catalog/products", {
    code: `RECEIPT-${suffix}`,
    nameAr: "منتج الإيصال",
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "available",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const variantId = product.body.variants[0].id as string;
  const received = await jsonApi(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: cairoDate(new Date()),
    lines: [{ variantId, quantity: 4, unitCostPiasters: 10000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const saleIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  for (const saleId of saleIds) {
    const sale = await jsonApi(manager, "POST", "/api/internal/sales", {
      saleId,
      operationId: crypto.randomUUID(),
      physicallyCompleted: true,
      occurredAt: new Date().toISOString(),
      employeeDiscountPiasters: 0,
      lines: [{ variantId, quantity: 1 }],
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  }
  const hugeSequence = "9223372036854775808";
  const assignedReference = `BRV-042-${hugeSequence}`;
  const unusedRegistrationId = crypto.randomUUID();
  const assignedRegistrationId = crypto.randomUUID();
  const unusedDeviceId = crypto.randomUUID();
  const assignedDeviceId = crypto.randomUUID();
  const hugePrefix = "9007199254740993";
  await built.pool.query(
    `INSERT INTO sales_receipt_registration (id, device_id, prefix, created_at, created_by_staff_id, restore_generation)
     VALUES ($1,$2,$3,now(),$4,0), ($5,$6,'42',now(),$4,0)`,
    [unusedRegistrationId, unusedDeviceId, hugePrefix, ownerId, assignedRegistrationId, assignedDeviceId],
  );
  await built.pool.query("UPDATE sales_sale SET receipt_identity = $2::jsonb WHERE id = $1", [saleIds[0], JSON.stringify({
    status: "assigned", registrationId: assignedRegistrationId, deviceId: assignedDeviceId,
    prefix: "42", sequence: hugeSequence, reference: assignedReference, staffDiagnostic: "slice-b",
  })]);
  await built.pool.query("UPDATE sales_sale SET receipt_identity = $2::jsonb WHERE id = $1", [
    saleIds[1], JSON.stringify({ status: "conflict", reference: "تعارض-الخزينة" }),
  ]);
  await built.pool.query("SELECT setval('sales_receipt_prefix_seq', $1::bigint, true)", [hugePrefix]);
  const posReference = (await built.pool.query<{ reference: string }>("SELECT reference FROM sales_sale WHERE id = $1", [saleIds[0]])).rows[0]!.reference;

  const decoded = await downloadBackup(manager);
  expect(decoded.manifest.schemaVersion).toBe("037_operational_stock.sql");
  expect(decoded.manifest.salesReceiptPrefixSequence).toEqual({ lastValue: hugePrefix, isCalled: true });
  const salesSection = decoded.manifest.sections.find((section) => section.name === "sales");
  expect(salesSection?.sha256).toBe(createHash("sha256").update(canonicalJson(decoded.data.sales), "utf8").digest("hex"));
  expect(decoded.data.sales.sales_receipt_registration).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: unusedRegistrationId, prefix: hugePrefix, created_by_staff_id: ownerId, restore_generation: "0" }),
    expect.objectContaining({ id: assignedRegistrationId, prefix: "42", created_by_staff_id: ownerId }),
  ]));
  const archivedSales = new Map(decoded.data.sales.sales_sale.map((row) => [String(row.id), row]));
  expect(archivedSales.get(saleIds[0])?.reference).toBe(posReference);
  expect(archivedSales.get(saleIds[0])?.receipt_identity).toMatchObject({
    sequence: hugeSequence, reference: assignedReference, staffDiagnostic: "slice-b", status: "assigned",
  });
  expect(archivedSales.get(saleIds[1])?.receipt_identity).toMatchObject({ status: "conflict", reference: "تعارض-الخزينة" });
  const longConflictReference = `BRV-001-${`9${"0".repeat(80)}`}`;
  const longConflict = structuredClone(decoded);
  const conflictSale = longConflict.data.sales.sales_sale.find((row) => row.id === saleIds[1]);
  (conflictSale!.receipt_identity as Record<string, unknown>).reference = longConflictReference;
  resealSales(longConflict);
  const acceptedConflict = await decodeBackupArchive(await createNodeBackupCrypto().protect(longConflict, PASSWORD), PASSWORD);
  expect(acceptedConflict.data.sales.sales_sale.find((row) => row.id === saleIds[1])?.receipt_identity).toMatchObject({
    status: "conflict",
    reference: longConflictReference,
  });
  expect(archivedSales.get(saleIds[2])?.receipt_identity).toBeNull();
  expect(JSON.stringify(decoded)).not.toContain(PASSWORD);
  expect(JSON.stringify(decoded)).not.toContain("owner-pass-1");

  const current = structuredClone(decoded);
  await expectRejectedReceiptArchive(current, (archive) => {
    delete archive.data.sales.sales_sale[0]!.receipt_identity;
  }, "Receipt numbering sale row is missing receipt_identity.");
  await expectRejectedReceiptArchive(current, (archive) => {
    delete archive.data.sales.sales_receipt_registration;
  }, "Receipt numbering backup is missing sales_receipt_registration.");
  await expectRejectedReceiptArchive(current, (archive) => {
    delete archive.manifest.salesReceiptPrefixSequence;
  }, "Receipt numbering backup is missing the receipt prefix sequence.");
  await expectRejectedReceiptArchive(current, (archive) => {
    archive.data.sales.sales_receipt_registration[0]!.prefix = "01";
  }, "Invalid receipt registration row in backup.");
  await expectRejectedReceiptArchive(current, (archive) => {
    const duplicate = structuredClone(archive.data.sales.sales_receipt_registration[0]!);
    duplicate.id = crypto.randomUUID();
    archive.data.sales.sales_receipt_registration.push(duplicate);
  }, "Invalid receipt registration row in backup.");
  await expectRejectedReceiptArchive(current, (archive) => {
    manifestOf(archive).salesReceiptPrefixSequence = { lastValue: hugePrefix, isCalled: true, extra: true };
  }, "Invalid receipt prefix sequence in backup manifest.");
  await expectRejectedReceiptArchive(current, (archive) => {
    manifestOf(archive).salesReceiptPrefixSequence = { lastValue: "9223372036854775808", isCalled: false };
  }, "Invalid receipt prefix sequence in backup manifest.");
  await expectRejectedReceiptArchive(current, (archive) => {
    archive.manifest.schemaVersion = "037_future.sql";
  }, "Unsupported backup schema version. Use a backup made by a compatible server.");
  await expectRejectedReceiptArchive(current, (archive) => {
    const sale = archive.data.sales.sales_sale.find((row) => row.id === saleIds[1]);
    (sale!.receipt_identity as Record<string, unknown>).reference = "x".repeat(81);
  }, "Invalid receipt identity in backup.");

  expect(await revertLastMigration(built.pool)).toBe("037_operational_stock.sql");
  expect(await revertLastMigration(built.pool)).toBe("036_receipt_numbering.sql");
  const profile035 = await downloadBackup(manager);
  expectHistoricalReceiptProfile(profile035, "035_return_reason.sql");
  expect(await revertLastMigration(built.pool)).toBe("035_return_reason.sql");
  const profile034 = await downloadBackup(manager);
  expectHistoricalReceiptProfile(profile034, "034_order_recognition_branch.sql");
  for (const historical of [profile035, profile034]) {
    await expectRejectedReceiptArchive(historical, (archive) => {
      archive.data.sales.sales_sale[0]!.receipt_identity = null;
    }, "Historical sale row must not contain receipt_identity.");
    await expectRejectedReceiptArchive(historical, (archive) => {
      archive.data.sales.sales_receipt_registration = [];
    }, "Historical backup must not contain sales_receipt_registration.");
    await expectRejectedReceiptArchive(historical, (archive) => {
      manifestOf(archive).salesReceiptPrefixSequence = { lastValue: "1", isCalled: false };
    }, "Historical backup must not contain a receipt prefix sequence.");
  }
});

type CookieSession = { cookie: string };
type BackupArchive = Awaited<ReturnType<typeof decodeBackupArchive>>;

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

async function downloadBackup(session: CookieSession) {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/internal/backups",
    headers: { origin: INTERNAL_ORIGIN, cookie: session.cookie, "content-type": "application/json" },
    payload: { password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(201);
  return decodeBackupArchive(response.rawPayload, PASSWORD);
}

function expectHistoricalReceiptProfile(decoded: BackupArchive, schemaVersion: string) {
  expect(decoded.manifest.schemaVersion).toBe(schemaVersion);
  expect(decoded.manifest).not.toHaveProperty("salesReceiptPrefixSequence");
  expect(decoded.data.sales).not.toHaveProperty("sales_receipt_registration");
  expect(decoded.data.sales.sales_sale.length).toBeGreaterThan(0);
  for (const row of decoded.data.sales.sales_sale) expect(row).not.toHaveProperty("receipt_identity");
}

function manifestOf(archive: BackupArchive): Record<string, unknown> {
  return archive.manifest as unknown as Record<string, unknown>;
}

function resealSales(archive: BackupArchive) {
  const sales = archive.data.sales;
  const names = Object.keys(sales).sort();
  const sorted = Object.fromEntries(names.map((name) => [name, sales[name]!])) as BackupArchive["data"]["sales"];
  archive.data.sales = sorted;
  const manifest = archive.manifest.sections.find((section) => section.name === "sales");
  if (!manifest) throw new Error("Missing sales section.");
  const count = names.reduce((sum, name) => sum + sorted[name]!.length, 0);
  archive.manifest.totalRecordCount += count - manifest.recordCount;
  manifest.recordCount = count;
  manifest.tables = names.map((name) => ({ name, recordCount: sorted[name]!.length }));
  manifest.sha256 = createHash("sha256").update(canonicalJson(sorted), "utf8").digest("hex");
}

async function expectRejectedReceiptArchive(source: BackupArchive, mutate: (archive: BackupArchive) => void, fragment: string) {
  const archive = structuredClone(source);
  mutate(archive);
  resealSales(archive);
  const bytes = await createNodeBackupCrypto().protect(archive, PASSWORD);
  let thrown: unknown;
  try {
    await decodeBackupArchive(bytes, PASSWORD);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    code: "BACKUP_ARCHIVE_INVALID",
    message: "تعذر فتح النسخة الاحتياطية. تحقق من كلمة المرور وسلامة الملف.",
  });
  expect((thrown as { cause?: { message?: string } }).cause?.message ?? "").toContain(fragment);
}

async function businessTableCounts() {
  const result = await built.pool.query<{ catalog_product: string; opening_import_preview: string }>(
    "SELECT (SELECT count(*) FROM catalog_product)::text AS catalog_product, (SELECT count(*) FROM opening_import_preview)::text AS opening_import_preview",
  );
  return result.rows[0];
}
