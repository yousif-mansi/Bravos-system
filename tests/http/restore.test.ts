import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { createNodeBackupCrypto, decodeBackupArchive } from "@bravos/backup/node";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { applyMigrations, revertLastMigration } from "@bravos/persistence";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const ARCHIVE_PASSWORD = "restore-archive-password-1";
const CHECKPOINT_PASSWORD = "restore-checkpoint-password-1";

let cluster: PostgresCluster;
let built: BuiltApp;
let outboxDir = "";
let branchId = "";

type CookieSession = { cookie: string };

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55467 });
}, 120_000);

beforeEach(async () => {
  await startApp(`bravos_restore_${crypto.randomUUID().replaceAll("-", "")}`, "مالك برافوس", "owner-pass-1");
});

afterEach(async () => {
  if (built) await built.close();
});

afterAll(async () => {
  if (cluster) await cluster.stop();
});

test("stages, pauses and activates twice, keeps a paid old-generation sale for one manager recovery, then restores into an independent database", async () => {
  let manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const employee = await api(manager, "POST", "/api/internal/staff", {
    loginName: "restore.cashier",
    displayName: "كاشير الاستعادة",
    password: "restore-cashier-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(employee.status).toBe(201);
  const variantId = await seedVariant(manager);
  expect((await receive(manager, variantId, 2)).status).toBe(201);
  const deliveryArea = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: "منطقة استعادة",
    feePiasters: 3000,
    active: true,
  });
  expect(deliveryArea.status).toBe(201);
  const expenseDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const expenseCategory = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "تشغيل الاستعادة" });
  expect(expenseCategory.status).toBe(201);
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 2500,
    expenseDate,
    categoryId: expenseCategory.body.id,
    description: "مصروف داخل النسخة",
  });
  expect(expense.status, JSON.stringify(expense.body)).toBe(201);

  const deviceId = crypto.randomUUID();
  const oldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  expect(oldSnapshot).toMatchObject({ status: 201, body: { restoreGeneration: 0, restorePause: null } });
  const firstArchive = await downloadBackup(manager);
  expect((await decodeBackupArchive(firstArchive, ARCHIVE_PASSWORD)).manifest).toMatchObject({
    schemaVersion: "035_return_reason.sql",
    sourceGeneration: 0,
  });

  const previewOperationId = crypto.randomUUID();
  const concurrentPreviews = await Promise.all([
    createPreview(manager, firstArchive, previewOperationId),
    createPreview(manager, firstArchive, previewOperationId),
  ]);
  const preview = concurrentPreviews.find((candidate) => candidate.status === 201)!;
  const replayedPreview = concurrentPreviews.find((candidate) => candidate.status === 200)!;
  expect(preview, JSON.stringify(concurrentPreviews)).toBeDefined();
  expect(preview.body).toMatchObject({ status: "paused", expectedGeneration: 0, sourceGeneration: 0 });
  expect(preview.body.differences.length).toBeGreaterThan(0);
  expect(replayedPreview.body.id).toBe(preview.body.id);
  expect((await api(manager, "GET", "/api/internal/restore/state")).body).toMatchObject({
    currentGeneration: 0,
    pause: { previewId: preview.body.id, generation: 0 },
  });

  expect(await receive(manager, variantId, 1)).toMatchObject({ status: 409, body: { error: { code: "RESTORE_PAUSED" } } });

  const saleId = crypto.randomUUID();
  const saleOperationId = crypto.randomUUID();
  const retained = await api(manager, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId: saleOperationId,
    deviceId,
    snapshotId: oldSnapshot.body.snapshotId,
    restoreGeneration: 0,
    occurredAt: new Date().toISOString(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    pendingOperationIds: [saleOperationId],
    lines: [{ variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(retained).toMatchObject({ status: 409, body: { error: { code: "SALE_RETAINED_FOR_RESTORE" } } });
  expect((await built.pool.query("SELECT id FROM sales_sale WHERE id = $1", [saleId])).rowCount).toBe(0);
  expect((await built.pool.query("SELECT 1 FROM sales_restore_deferred_completion WHERE operation_id = $1", [saleOperationId])).rowCount).toBe(1);

  const unknownSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [saleOperationId, crypto.randomUUID()],
  });
  expect((await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/acknowledgements`, {
    deviceId,
    snapshotId: unknownSnapshot.body.snapshotId,
  })).body).toMatchObject({ error: { code: "RESTORE_STALE" } });

  const custodySnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [saleOperationId] });
  expect(custodySnapshot.body.includedOperations).toEqual([]);
  expect(custodySnapshot.body.deferredCompletionProofs).toEqual([
    expect.objectContaining({ operationId: saleOperationId, saleId, contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }),
  ]);
  expect(custodySnapshot.body.restorePause).toMatchObject({ previewId: preview.body.id, generation: 0 });
  const acknowledged = await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/acknowledgements`, {
    deviceId,
    snapshotId: custodySnapshot.body.snapshotId,
  });
  expect(acknowledged.status, JSON.stringify(acknowledged.body)).toBe(200);
  expect(acknowledged.body.devices).toEqual([expect.objectContaining({
    deviceId,
    pendingOperationIds: [saleOperationId],
    custodiedOperationIds: [saleOperationId],
    acknowledgedSnapshotId: custodySnapshot.body.snapshotId,
  })]);
  expect(acknowledged.body.status).toBe("paused");

  const ready = await acknowledgeCheckpoint(manager, preview.body.id);
  expect(ready.body.status).toBe("ready");
  // A later snapshot from the same till after its acknowledgement does not block activation.
  expect((await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [saleOperationId] })).status).toBe(201);
  expect((await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, {
    operationId: crypto.randomUUID(),
    previewFingerprint: "0".repeat(64),
  })).body).toMatchObject({ error: { code: "RESTORE_STALE" } });
  const activationOperationId = crypto.randomUUID();
  const activated = await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, {
    operationId: activationOperationId,
    previewFingerprint: ready.body.previewFingerprint,
  });
  expect(activated, JSON.stringify(activated.body)).toMatchObject({ status: 201, body: { status: "activated", expectedGeneration: 0 } });
  expect((await api(manager, "GET", "/api/internal/workspace")).status).toBe(401);
  expect((await built.pool.query<{ count: string }>("SELECT count(*)::text FROM session")).rows[0]!.count).toBe("0");
  expect((await built.pool.query<{ generation: string }>("SELECT current_generation::text AS generation FROM restore_runtime")).rows[0]!.generation).toBe("1");
  expect((await built.pool.query<{ restore_generation: string; synchronization_complete: boolean }>(
    "SELECT restore_generation::text, synchronization_complete FROM inventory_known_till WHERE device_id = $1",
    [deviceId],
  )).rows[0]).toEqual({ restore_generation: "1", synchronization_complete: false });

  // Existing credentials survive; the old session does not.
  manager = await signIn("owner", "owner-pass-1");
  expect((await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, {
    operationId: activationOperationId,
    previewFingerprint: ready.body.previewFingerprint,
  })).body).toMatchObject({ id: preview.body.id, status: "activated" });
  manager = await recoverOwner("owner-pass-2");
  expect((await api(manager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const deferred = await api(manager, "GET", "/api/internal/sales/restore-deferred");
  const retainedSale = deferred.body.find((row: { operationId: string }) => row.operationId === saleOperationId);
  expect(retainedSale).toMatchObject({ saleId, sourceGeneration: 0, currentGeneration: 1, status: "pending" });
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", retainedSale.recoveryPayload);
  expect(recovered, JSON.stringify(recovered.body)).toMatchObject({ status: 201, body: { id: saleId, operationId: saleOperationId, physicallyCompleted: true } });
  expect(await api(manager, "POST", "/api/internal/sales/recover", retainedSale.recoveryPayload)).toMatchObject({ status: 200, body: { id: saleId } });
  expect((await built.pool.query<{ remaining_quantity: number }>("SELECT remaining_quantity FROM inventory_batch_balance")).rows[0]!.remaining_quantity).toBe(1);
  expect((await api(manager, "GET", "/api/internal/sales/restore-deferred")).body).toEqual([
    expect.objectContaining({ operationId: saleOperationId, status: "reconciled" }),
  ]);

  const appliedSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [saleOperationId] });
  expect(appliedSnapshot.body.includedOperations).toEqual([expect.objectContaining({ operationId: saleOperationId, saleId })]);
  expect(appliedSnapshot.body.restoreGeneration).toBe(1);

  const secondArchive = await downloadBackup(manager);
  const secondPreview = await createPreview(manager, secondArchive);
  expect(secondPreview.status, JSON.stringify(secondPreview.body)).toBe(201);
  const secondPauseSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  expect((await api(manager, "POST", `/api/internal/restore/previews/${secondPreview.body.id}/acknowledgements`, {
    deviceId,
    snapshotId: secondPauseSnapshot.body.snapshotId,
  })).status).toBe(200);
  const secondReady = await acknowledgeCheckpoint(manager, secondPreview.body.id);
  expect(secondReady.body.status).toBe("ready");
  expect((await api(manager, "POST", `/api/internal/restore/previews/${secondPreview.body.id}/activate`, {
    operationId: crypto.randomUUID(),
    previewFingerprint: secondReady.body.previewFingerprint,
  })).status).toBe(201);
  expect((await built.pool.query<{ sale: string; deferred: string; till: string; runtime: string }>(
    `SELECT sale.source_restore_generation::text AS sale, deferred.source_generation::text AS deferred,
            till.restore_generation::text AS till, runtime.current_generation::text AS runtime
     FROM sales_sale sale
     JOIN sales_restore_deferred_completion deferred ON deferred.operation_id = sale.operation_id
     JOIN inventory_known_till till ON till.device_id = $2
     CROSS JOIN restore_runtime runtime
     WHERE sale.id = $1`,
    [saleId, deviceId],
  )).rows[0]).toEqual({ sale: "0", deferred: "0", till: "2", runtime: "2" });

  const employeeId = (await built.pool.query<{ id: string }>(`SELECT id FROM "user" WHERE username = 'restore.cashier'`)).rows[0]!.id;
  manager = await signIn("owner", "owner-pass-2");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  expect((await api(manager, "POST", `/api/internal/staff/${employeeId}/reset-password`, { password: "restore-cashier-pass-2" })).status).toBe(200);
  const cashier = await signIn("restore.cashier", "restore-cashier-pass-2");
  expect((await api(cashier, "GET", "/api/internal/workspace")).body.staff).toMatchObject({ id: employeeId, role: "employee" });

  // Real independent-database restore drill.
  const sourceOwnerId = (await built.pool.query<{ id: string }>(`SELECT id FROM "user" WHERE username = 'owner'`)).rows[0]!.id;
  await built.pool.query("SELECT setval('online_order_reference_number_seq', 50, TRUE)");
  expect((await receive(manager, variantId, 3)).status).toBe(201);
  // A restored reference at the six-digit boundary must outrank even a stale archived sequence.
  await built.pool.query("SELECT setval('sales_sale_reference_number_seq', 999998, TRUE)");
  const boundarySourceSale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: new Date().toISOString(), employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(boundarySourceSale, JSON.stringify(boundarySourceSale.body)).toMatchObject({
    status: 201, body: { reference: "POS-999999" },
  });
  await built.pool.query("SELECT setval('returns_return_reference_number_seq', 999999, TRUE)");
  const sourceCounts = await businessCounts(built.pool);
  const sourceMaxSaleReference = (await built.pool.query<{ max_number: string }>(
    "SELECT MAX(substring(reference FROM '^POS-([0-9]+)$')::bigint)::text AS max_number FROM sales_sale",
  )).rows[0]!.max_number;
  expect(Number(sourceMaxSaleReference)).toBeGreaterThan(0);
  const archiveWithStaleSaleSequence = await decodeBackupArchive(await downloadBackup(manager), ARCHIVE_PASSWORD);
  archiveWithStaleSaleSequence.manifest.salesSaleReferenceSequence = { lastValue: "0", isCalled: false };
  const generationTwoArchive = Buffer.from(await createNodeBackupCrypto().protect(archiveWithStaleSaleSequence, ARCHIVE_PASSWORD));
  await built.close();
  await startApp(`bravos_restore_fresh_${crypto.randomUUID().replaceAll("-", "")}`, "مالك جهاز الاستعادة", "fresh-owner-pass-1");
  const bootstrapOwnerId = (await built.pool.query<{ id: string }>(`SELECT id FROM "user" WHERE username = 'owner'`)).rows[0]!.id;
  expect(bootstrapOwnerId).not.toBe(sourceOwnerId);
  const replacementManager = await signIn("owner", "fresh-owner-pass-1");
  const disasterPreview = await createPreview(replacementManager, generationTwoArchive);
  expect(disasterPreview, JSON.stringify(disasterPreview.body)).toMatchObject({
    status: 201,
    body: { status: "paused", sourceGeneration: 2, expectedGeneration: 0, devices: [] },
  });
  const disasterReady = await acknowledgeCheckpoint(replacementManager, disasterPreview.body.id);
  expect(disasterReady.body.status, JSON.stringify(disasterReady.body)).toBe("ready");
  expect((await api(replacementManager, "POST", `/api/internal/restore/previews/${disasterPreview.body.id}/activate`, {
    operationId: crypto.randomUUID(),
    previewFingerprint: disasterReady.body.previewFingerprint,
  })).status).toBe(201);
  expect((await built.pool.query<{ generation: string }>("SELECT current_generation::text AS generation FROM restore_runtime")).rows[0]!.generation).toBe("3");
  expect(sourceMaxSaleReference).toBe("999999");
  expect((await built.pool.query<{ id: string }>(`SELECT id FROM "user" WHERE username = 'owner'`)).rows[0]!.id).toBe(sourceOwnerId);
  expect(await businessCounts(built.pool)).toEqual(sourceCounts);
  expect((await built.pool.query<{ count: string }>("SELECT count(*)::text FROM account")).rows[0]!.count).toBe("0");
  const restoredManager = await recoverOwner("fresh-owner-pass-2");
  expect((await api(restoredManager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const continuedSale = await api(restoredManager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: new Date().toISOString(), employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(continuedSale, JSON.stringify(continuedSale.body)).toMatchObject({
    status: 201, body: { reference: "POS-1000000" },
  });
  const returnSources = await api(restoredManager, "GET", `/api/internal/returns/sources?reference=${continuedSale.body.reference}`);
  expect(returnSources.status, JSON.stringify(returnSources.body)).toBe(200);
  const returnDraft = await api(restoredManager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: continuedSale.body.id,
    handlingBranchId: branchId, authorizedRefundPiasters: 25000,
    lines: [{ sourceSaleLineId: returnSources.body[0].lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  expect(returnDraft, JSON.stringify(returnDraft.body)).toMatchObject({
    status: 201, body: { reference: "RET-1000000" },
  });
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: deliveryArea.body.id,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submitted = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId: deliveryArea.body.id,
    lines: [{ variantId, quantity: 1 }],
    customerName: "عميل ما بعد الاستعادة",
    primaryPhone: "01012345678",
    detailedAddress: "عنوان واضح بعد الاستعادة",
  });
  expect(submitted, JSON.stringify(submitted.body)).toMatchObject({ status: 201, body: { reference: "BRV-000051", status: "pending" } });
}, 240_000);

test("wrong passwords, damaged files, invalid links, unsupported schemas and unauthorized callers leave the valid database unchanged", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const variantId = await seedVariant(manager);
  expect((await receive(manager, variantId, 3)).status).toBe(201);
  const archive = await downloadBackup(manager);
  const before = await businessCounts(built.pool);

  expect(await createPreview(manager, archive, crypto.randomUUID(), "wrong-archive-password-1"))
    .toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });
  const damaged = Buffer.from(archive);
  damaged[damaged.length - 20] = damaged[damaged.length - 20]! ^ 0x01;
  expect(await createPreview(manager, damaged)).toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });
  await expectUnpaused();
  expect((await built.pool.query("SELECT 1 FROM restore_preview")).rowCount).toBe(0);

  // A correctly encrypted archive whose sale line points at a variant that does not exist.
  const decoded = await decodeBackupArchive(archive, ARCHIVE_PASSWORD);
  const brokenSaleId = crypto.randomUUID();
  const line = {
    id: crypto.randomUUID(), sale_id: brokenSaleId, variant_id: crypto.randomUUID(), quantity: 1,
    listed_unit_price_piasters: 100, original_piasters: 100, discount_piasters: 0, paid_piasters: 100,
    allocated_quantity: 1, unallocated_quantity: 0, line_index: 0, automatic_offer_discount_piasters: 0,
    employee_discount_piasters: 0, coupon_discount_piasters: 0,
  };
  decoded.data.sales.sales_sale_line = [...decoded.data.sales.sales_sale_line!, line];
  resealSection(decoded, "sales");
  const invalidLinks = await createNodeBackupCrypto().protect(decoded, ARCHIVE_PASSWORD);
  const invalidPreview = await createPreview(manager, Buffer.from(invalidLinks));
  expect(invalidPreview).toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });
  await expectUnpaused();
  expect(await businessCounts(built.pool)).toEqual(before);
  expect((await built.pool.query<{ status: string }>("SELECT status FROM restore_preview")).rows).toEqual([{ status: "cancelled" }]);
  const invalidStage = (await built.pool.query<{ name: string }>("SELECT staging_database_name AS name FROM restore_preview")).rows[0]!.name;
  expect((await built.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [invalidStage])).rowCount).toBe(0);
  expect((await receive(manager, variantId, 1)).status).toBe(201);

  const fromFuture = await decodeBackupArchive(archive, ARCHIVE_PASSWORD);
  fromFuture.manifest.schemaVersion = "035_future.sql";
  expect(await createPreview(manager, Buffer.from(await createNodeBackupCrypto().protect(fromFuture, ARCHIVE_PASSWORD))))
    .toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });
  await expectUnpaused();

  // Authenticated data from an older schema must fail with a compatibility error before staging.
  const legacy = await decodeBackupArchive(archive, ARCHIVE_PASSWORD);
  legacy.manifest.schemaVersion = "033_human_references.sql";
  const legacyPreview = await createPreview(manager, Buffer.from(await createNodeBackupCrypto().protect(legacy, ARCHIVE_PASSWORD)));
  expect(legacyPreview, JSON.stringify(legacyPreview.body)).toMatchObject({
    status: 400,
    body: { error: { code: "VALIDATION", messageAr: expect.stringContaining("إصدار مخطط النسخة") } },
  });
  await expectUnpaused();

  const employee = await api(manager, "POST", "/api/internal/staff", {
    loginName: "restore.denied",
    displayName: "موظف بلا صلاحية",
    password: "restore-denied-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(employee.status).toBe(201);
  const cashier = await signIn("restore.denied", "restore-denied-pass-1");
  expect((await api(cashier, "GET", "/api/internal/restore/state")).status).toBe(403);
  expect((await api(cashier, "GET", "/api/internal/restore/previews")).status).toBe(403);
  expect((await api(cashier, "GET", "/api/internal/sales/restore-deferred")).status).toBe(403);
  expect((await createPreview(cashier, archive)).status).toBe(403);
  expect((await api(undefined, "GET", "/api/internal/restore/state")).status).toBe(401);
  expect((await createPreview(undefined, archive)).status).toBe(401);
  await expectUnpaused();
}, 180_000);

test("a failed activation rolls back completely, keeps the pause and sessions, and cancelling resumes writes", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const variantId = await seedVariant(manager);
  expect((await receive(manager, variantId, 2)).status).toBe(201);
  const archive = await downloadBackup(manager);
  expect((await receive(manager, variantId, 5)).status).toBe(201);
  const before = await businessCounts(built.pool);

  const preview = await createPreview(manager, archive);
  expect(preview.status, JSON.stringify(preview.body)).toBe(201);
  // The live receipt made after the archive is newer work; it is carried into the preview.
  expect(preview.body.differences).toEqual(expect.arrayContaining([
    expect.objectContaining({
      section: "receiving",
      archivedRecordCount: 2,
      liveRecordCount: 4,
      restoredRecordCount: 4,
      liveOnlyRecordCount: 2,
      conflictingRecordCount: 0,
      difference: 2,
    }),
  ]));
  const ready = await acknowledgeCheckpoint(manager, preview.body.id);
  expect(ready.body.status).toBe("ready");

  // Break the staged data after review so activation fails part-way through loading.
  const stagingName = (await built.pool.query<{ name: string }>(
    "SELECT staging_database_name AS name FROM restore_preview WHERE id = $1",
    [preview.body.id],
  )).rows[0]!.name;
  const stage = new Pool({ connectionString: cluster.connectionString(stagingName), max: 1 });
  try {
    await stage.query("DELETE FROM online_order_settings");
  } finally {
    await stage.end();
  }
  const failed = await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, {
    operationId: crypto.randomUUID(),
    previewFingerprint: ready.body.previewFingerprint,
  });
  expect(failed).toMatchObject({ status: 400, body: { error: { code: "VALIDATION" } } });
  expect(await businessCounts(built.pool)).toEqual(before);
  expect((await api(manager, "GET", "/api/internal/workspace")).status).toBe(200);
  expect((await api(manager, "GET", "/api/internal/restore/state")).body).toMatchObject({
    currentGeneration: 0,
    pause: { previewId: preview.body.id },
  });
  expect((await built.pool.query("SELECT 1 FROM restore_activation")).rowCount).toBe(0);
  expect((await receive(manager, variantId, 1)).status).toBe(409);

  const cancelled = await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/cancel`);
  expect(cancelled).toMatchObject({ status: 200, body: { status: "cancelled" } });
  await expectUnpaused();
  expect((await receive(manager, variantId, 1)).status).toBe(201);
  expect((await built.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [stagingName])).rowCount).toBe(0);
}, 180_000);

test("newer additions survive activation while a changed record blocks the preview instead of being replaced silently", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const variantId = await seedVariant(manager);
  expect((await receive(manager, variantId, 2)).status).toBe(201);
  const archive = await downloadBackup(manager);
  expect((await receive(manager, variantId, 3)).status).toBe(201);

  const preview = await createPreview(manager, archive);
  expect(preview.status, JSON.stringify(preview.body)).toBe(201);
  expect(preview.body.blockingReasons).toEqual([]);
  const ready = await acknowledgeCheckpoint(manager, preview.body.id);
  expect(ready.body.status).toBe("ready");
  const activated = await api(manager, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, {
    operationId: crypto.randomUUID(),
    previewFingerprint: ready.body.previewFingerprint,
  });
  expect(activated.status, JSON.stringify(activated.body)).toBe(201);
  expect((await built.pool.query<{ receipts: string; remaining: string }>(
    "SELECT (SELECT count(*) FROM receiving_receipt)::text AS receipts, (SELECT sum(remaining_quantity) FROM inventory_batch_balance)::text AS remaining",
  )).rows[0]).toEqual({ receipts: "2", remaining: "5" });

  const again = await signIn("owner", "owner-pass-1");
  await api(again, "POST", "/api/internal/active-branch", { branchId });
  const secondArchive = await downloadBackup(again);
  const categoryId = (await built.pool.query<{ id: string }>("SELECT category_id AS id FROM catalog_product LIMIT 1")).rows[0]!.id;
  expect((await api(again, "PATCH", `/api/internal/catalog/categories/${categoryId}`, { nameAr: "تصنيف معدل بعد النسخة" })).status).toBe(200);
  const blocked = await createPreview(again, secondArchive);
  expect(blocked.status, JSON.stringify(blocked.body)).toBe(201);
  expect(blocked.body.blockingReasons).toEqual([expect.stringContaining("catalog")]);
  expect(blocked.body.differences).toEqual(expect.arrayContaining([
    expect.objectContaining({ section: "catalog", conflictingRecordCount: 1 }),
  ]));
  expect((await acknowledgeCheckpoint(again, blocked.body.id)).body.status).toBe("paused");
  expect((await api(again, "POST", `/api/internal/restore/previews/${blocked.body.id}/cancel`)).status).toBe(200);
  await expectUnpaused("1");
  expect((await built.pool.query<{ name_ar: string }>("SELECT name_ar FROM catalog_category WHERE id = $1", [categoryId])).rows[0]!.name_ar)
    .toBe("تصنيف معدل بعد النسخة");
}, 180_000);

test.each(["035", "034"])("restores an authentic %s return profile with readable references and reason compatibility", async (profile) => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const variantId = await seedVariant(manager);
  expect((await receive(manager, variantId, 1)).status).toBe(201);
  const original = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: new Date().toISOString(), employeeDiscountPiasters: 0, lines: [{ variantId, quantity: 1 }],
  });
  expect(original.status, JSON.stringify(original.body)).toBe(201);
  const source = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.reference}`);
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: branchId, authorizedRefundPiasters: 25000,
    ...(profile === "035" ? { reason: "المقاس غير مناسب" } : {}),
    lines: [{ sourceSaleLineId: source.body[0].lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  // Generate an actual old-schema archive, rather than relabeling current rows.
  if (profile === "034") expect(await revertLastMigration(built.pool)).toBe("035_return_reason.sql");
  const bytes = await downloadBackup(manager);
  const decoded = await decodeBackupArchive(bytes, ARCHIVE_PASSWORD);
  expect(decoded.manifest.schemaVersion).toBe(profile === "034" ? "034_order_recognition_branch.sql" : "035_return_reason.sql");
  const archived = decoded.data.returns.returns_return![0]!;
  if (profile === "034") expect(archived).not.toHaveProperty("reason");
  else expect(archived.reason).toBe("المقاس غير مناسب");
  if (profile === "034") await applyMigrations(built.pool);

  // Reject malformed old-profile rows before pausing any writes.
  if (profile === "034") {
    for (const malformed of ["extra", "missing"] as const) {
      const bad = structuredClone(decoded);
      if (malformed === "extra") bad.data.returns.returns_return![0]!.reason = null;
      else delete bad.data.returns.returns_return![0]!.reference;
      resealSection(bad, "returns");
      const invalid = Buffer.from(await createNodeBackupCrypto().protect(bad, ARCHIVE_PASSWORD));
      const rejected = await createPreview(manager, invalid);
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(400);
      expect((await api(manager, "GET", "/api/internal/restore/state")).body.pause).toBeNull();
    }
  }
  // Remove only this isolated, unposted fixture to verify archive-only data is
  // restored. Keeping the same actor lets activation replay test the same identity.
  await built.pool.query("DELETE FROM returns_return_line WHERE return_id=$1", [draft.body.id]);
  await built.pool.query("DELETE FROM returns_return WHERE id=$1", [draft.body.id]);
  const target = manager;
  const operationId = crypto.randomUUID();
  const preview = await createPreview(target, bytes, operationId);
  expect(preview.status, JSON.stringify(preview.body)).toBe(201);
  expect(preview.body.archiveSchemaVersion).toBe(decoded.manifest.schemaVersion);
  expect((await built.pool.query<{ archive_sha256: string }>("SELECT archive_sha256 FROM restore_preview WHERE id=$1", [preview.body.id])).rows[0]!.archive_sha256)
    .toBe(createHash("sha256").update(bytes).digest("hex"));
  const replay = await createPreview(target, bytes, operationId);
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  expect(replay.body.id).toBe(preview.body.id);
  const ready = await acknowledgeCheckpoint(target, preview.body.id);
  expect(ready.body.status, JSON.stringify(ready.body)).toBe("ready");
  const activation = { operationId: crypto.randomUUID(), previewFingerprint: ready.body.previewFingerprint };
  const activated = await api(target, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, activation);
  expect(activated.status, JSON.stringify(activated.body)).toBe(201);
  const restored = await built.pool.query<{ reference: string; reason: string | null }>("SELECT reference,reason FROM returns_return WHERE id=$1", [draft.body.id]);
  expect(restored.rows[0]).toEqual({ reference: draft.body.reference, reason: profile === "034" ? null : "المقاس غير مناسب" });
  const recovered = await recoverOwner("reason-restored-owner-pass-1");
  const activationReplay = await api(recovered, "POST", `/api/internal/restore/previews/${preview.body.id}/activate`, activation);
  expect(activationReplay.status, JSON.stringify(activationReplay.body)).toBe(200);
  expect((await api(recovered, "GET", `/api/internal/returns/${draft.body.id}`)).body.reason).toBe(profile === "034" ? null : "المقاس غير مناسب");
}, 180_000);

async function startApp(databaseName: string, displayName: string, password: string) {
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-restore-outbox-"));
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
    ownerRecoveryOutboxDir: outboxDir,
  });
  await ensureOwner(built.services, { loginName: "owner", displayName, password });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code = 'abshway'")).rows[0]!.id;
}

async function expectUnpaused(generation = "0") {
  expect((await built.pool.query<{ generation: string; paused: string | null }>(
    "SELECT current_generation::text AS generation, paused_preview_id AS paused FROM restore_runtime",
  )).rows).toEqual([{ generation, paused: null }]);
}

async function businessCounts(pool: Pool) {
  const result = await pool.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM "user")::text AS users,
            (SELECT count(*) FROM staff_profile)::text AS staff,
            (SELECT count(*) FROM catalog_product_variant)::text AS variants,
            (SELECT count(*) FROM receiving_receipt)::text AS receipts,
            (SELECT count(*) FROM inventory_batch)::text AS batches,
            (SELECT COALESCE(sum(remaining_quantity), 0) FROM inventory_batch_balance)::text AS remaining,
            (SELECT count(*) FROM sales_sale)::text AS sales,
            (SELECT COALESCE(sum(final_total_piasters), 0) FROM sales_sale WHERE physically_completed)::text AS sales_total,
            (SELECT COALESCE(sum(quantity), 0) FROM inventory_allocation)::text AS allocated,
            (SELECT COALESCE(sum(unit_cost_piasters::bigint * quantity), 0) FROM inventory_allocation)::text AS allocated_cost,
            (SELECT count(*) FROM delivery_area)::text AS delivery_areas,
            (SELECT count(*) FROM expense_operation)::text AS expense_operations,
            (SELECT COALESCE(sum(amount_piasters), 0) FROM expense_record)::text AS expense_total`,
  );
  return result.rows[0];
}

function resealSection(archive: Awaited<ReturnType<typeof decodeBackupArchive>>, sectionName: "sales" | "returns") {
  const section = archive.data[sectionName];
  const manifest = archive.manifest.sections.find((candidate) => candidate.name === sectionName)!;
  const count = Object.values(section).reduce((sum, rows) => sum + rows.length, 0);
  archive.manifest.totalRecordCount += count - manifest.recordCount;
  manifest.recordCount = count;
  manifest.tables = Object.entries(section).map(([name, rows]) => ({ name, recordCount: rows.length }));
  manifest.sha256 = createHash("sha256").update(canonicalJson(section), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function createPreview(
  manager: CookieSession | undefined,
  archive: Buffer,
  operationId = crypto.randomUUID(),
  archivePassword = ARCHIVE_PASSWORD,
) {
  return api(manager, "POST", "/api/internal/restore/previews", {
    operationId,
    archiveBase64: archive.toString("base64"),
    archivePassword,
    preRestoreBackupPassword: CHECKPOINT_PASSWORD,
  });
}

async function acknowledgeCheckpoint(manager: CookieSession, previewId: string) {
  const response = await built.app.inject({
    method: "GET",
    url: `/api/internal/restore/previews/${previewId}/pre-restore-backup`,
    headers: { origin: INTERNAL_ORIGIN, cookie: manager.cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  const archiveSha256 = String(response.headers["x-bravos-backup-sha256"]);
  expect(createHash("sha256").update(response.rawPayload).digest("hex")).toBe(archiveSha256);
  expect((await decodeBackupArchive(response.rawPayload, CHECKPOINT_PASSWORD)).manifest.schemaVersion).toBe("035_return_reason.sql");
  return api(manager, "POST", `/api/internal/restore/previews/${previewId}/pre-restore-backup/acknowledgement`, { archiveSha256 });
}

async function downloadBackup(manager: CookieSession): Promise<Buffer> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/internal/backups",
    headers: { origin: INTERNAL_ORIGIN, cookie: manager.cookie, "content-type": "application/json" },
    payload: { password: ARCHIVE_PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.rawPayload;
}

async function recoverOwner(password: string): Promise<CookieSession> {
  expect((await api(undefined, "POST", "/api/internal/owner-recovery/request", { loginName: "owner" })).status).toBe(200);
  const delivered = JSON.parse(await readFile(path.join(outboxDir, "latest.json"), "utf8")) as { token: string };
  expect((await api(undefined, "POST", "/api/internal/owner-recovery/complete", { token: delivered.token, password })).status).toBe(200);
  return signIn("owner", password);
}

async function seedVariant(manager: CookieSession): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `استعادة ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${suffix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `RST-${suffix}`,
    nameAr: "منتج اختبار الاستعادة",
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "available",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  return product.body.variants[0].id;
}

function receive(manager: CookieSession, variantId: string, quantity: number) {
  return api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    lines: [{ variantId, quantity, unitCostPiasters: 10000 }],
  });
}

async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : response.headers["set-cookie"] ? [response.headers["set-cookie"]] : [];
  return { cookie: values.map((value) => value.split(";")[0]).filter(Boolean).join("; ") };
}

async function api(session: CookieSession | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      ...(session ? { cookie: session.cookie } : {}),
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: payload as never,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

async function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin: "http://127.0.0.1:3000", ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    payload: payload as never,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}
