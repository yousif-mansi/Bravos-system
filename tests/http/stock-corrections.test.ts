import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55455 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  const databaseName = `bravos_stock_correction_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-stock-correction-outbox-"));
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
  });
  await applyMigrations(built.pool);
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
});

test("manager coordinates a known till and records an exact negative available-quantity correction", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const variantId = await seedVariant(manager);
  await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-15",
    lines: [{ variantId, quantity: 5, unitCostPiasters: 10000 }],
  });

  const deviceId = crypto.randomUUID();
  const known = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [],
  });
  expect(known.status).toBe(201);

  const started = await api(manager, "POST", "/api/internal/inventory/count-coordination", {
    operationId: crypto.randomUUID(),
  });
  expect(started.status).toBe(201);
  expect(started.body).toMatchObject({
    status: "active",
    boundaryStockVersion: 1,
    devices: [{ deviceId, acknowledgedAt: null }],
  });

  const pausedReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-15",
    lines: [{ variantId, quantity: 1, unitCostPiasters: 12000 }],
  });
  expect(pausedReceipt.status).toBe(409);
  expect(pausedReceipt.body.error.code).toBe("STOCK_MUTATION_PAUSED");

  const acknowledgedSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [],
  });
  expect(acknowledgedSnapshot.status).toBe(201);
  expect(acknowledgedSnapshot.body.stockPause).toMatchObject({
    coordinationId: started.body.id,
    boundaryStockVersion: 1,
  });
  const beforeAcknowledgement = await api(manager, "GET", "/api/internal/inventory/count-coordination");
  expect(beforeAcknowledgement.body.devices[0].acknowledgedAt).toBeNull();
  const acknowledgement = await api(
    manager,
    "POST",
    "/api/internal/inventory/count-coordination/acknowledgements",
    {
      coordinationId: started.body.id,
      deviceId,
      snapshotId: acknowledgedSnapshot.body.snapshotId,
    },
  );
  expect(acknowledgement.status).toBe(200);
  const coordinated = await api(manager, "GET", "/api/internal/inventory/count-coordination");
  expect(coordinated.body.devices[0]).toMatchObject({
    deviceId,
    acknowledgedSnapshotId: acknowledgedSnapshot.body.snapshotId,
    acknowledgedStockVersion: 1,
  });
  expect(coordinated.body.devices[0].acknowledgedAt).toEqual(expect.any(String));

  const operationId = crypto.randomUUID();
  const corrected = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId,
    coordinationId: started.body.id,
    branchId: abshwayId,
    variantId,
    previousAvailableQuantity: 5,
    correctedAvailableQuantity: 4,
    reason: "العدد الفعلي أربع قطع",
  });
  expect(corrected.status).toBe(201);
  expect(corrected.body).toMatchObject({
    operationId,
    variantId,
    previousAvailableQuantity: 5,
    correctedAvailableQuantity: 4,
    quantityDelta: -1,
    reason: "العدد الفعلي أربع قطع",
    changedBy: { displayName: "مالك برافوس" },
  });
  expect(corrected.body.coordinationBoundaryAt).toBe(started.body.boundaryAt);
  expect(new Date(corrected.body.boundaryAt).getTime()).toBeGreaterThanOrEqual(new Date(started.body.boundaryAt).getTime());
  expect(corrected.body.devices[0].deviceId).toBe(deviceId);

  const replay = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId,
    coordinationId: started.body.id,
    branchId: abshwayId,
    variantId,
    previousAvailableQuantity: 5,
    correctedAvailableQuantity: 4,
    reason: "العدد الفعلي أربع قطع",
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(corrected.body);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0]).toMatchObject({ variantId, remainingQuantity: 4, unitCostPiasters: 10000 });
});

test("reconciles a pre-count late sale exactly once and rejects a post-count sale", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 1, 10000);
  await receive(manager, variantId, 4, 20000);
  const deviceId = crypto.randomUUID();
  const oldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const { correction } = await coordinateAndCorrect(manager, deviceId, variantId, 5, 4);

  const duringPauseBeforeCount = new Date(Math.floor((
    new Date(correction.coordinationBoundaryAt).getTime() + new Date(correction.boundaryAt).getTime()
  ) / 2)).toISOString();
  const preCountSale = await acceptSnapshotSale(
    manager,
    oldSnapshot.body.snapshotId,
    deviceId,
    variantId,
    duringPauseBeforeCount,
  );
  expect(preCountSale.status).toBe(201);
  expect(preCountSale.body.costsIncomplete).toBe(false);
  expect(await available(manager, variantId)).toBe(3);

  const cases = await api(manager, "GET", "/api/internal/inventory/stock-reconciliation-cases");
  expect(cases.body).toEqual(expect.arrayContaining([expect.objectContaining({
    correctionId: correction.id,
    saleId: preCountSale.body.id,
    timing: "before_count",
    maximumCountedQuantity: 1,
    costsIncomplete: false,
  })]));
  const operationId = crypto.randomUUID();
  const reconciliation = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId,
    correctionId: correction.id,
    saleId: preCountSale.body.id,
    branchId: abshwayId,
    variantId,
    resolution: "included_in_count",
    quantity: 1,
  });
  expect(reconciliation.status).toBe(201);
  expect(reconciliation.body).toMatchObject({
    operationId,
    previousAvailableQuantity: 3,
    resultingAvailableQuantity: 4,
  });
  expect(reconciliation.body.batches).toEqual(expect.arrayContaining([
    expect.objectContaining({ direction: "allocate", quantity: 1, unitCostPiasters: 10000 }),
    expect.objectContaining({ direction: "restore", quantity: 1, unitCostPiasters: 20000 }),
  ]));
  const replay = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId,
    correctionId: correction.id,
    saleId: preCountSale.body.id,
    branchId: abshwayId,
    variantId,
    resolution: "included_in_count",
    quantity: 1,
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(reconciliation.body);
  expect(await available(manager, variantId)).toBe(4);
  const reconciledSale = (await api(manager, "GET", "/api/internal/sales")).body
    .find((sale: { id: string }) => sale.id === preCountSale.body.id);
  expect(reconciledSale.allocations).toEqual([
    expect.objectContaining({ batchId: correction.batches[0].batchId, quantity: 1, unitCostPiasters: 10000 }),
  ]);
  const reconciledBatches = (await api(manager, "GET", "/api/internal/inventory/batches")).body;
  expect(reconciledBatches.find((batch: { unitCostPiasters: number }) => batch.unitCostPiasters === 10000).remainingQuantity).toBe(0);
  expect(reconciledBatches.find((batch: { unitCostPiasters: number }) => batch.unitCostPiasters === 20000).remainingQuantity).toBe(4);

  const postCountSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [],
  });
  const postCountSale = await acceptSnapshotSale(manager, postCountSnapshot.body.snapshotId, deviceId, variantId,
    new Date(new Date(correction.boundaryAt).getTime() - 500).toISOString());
  expect(postCountSale.status).toBe(201);
  expect(await available(manager, variantId)).toBe(3);
  const rejected = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(),
    correctionId: correction.id,
    saleId: postCountSale.body.id,
    branchId: abshwayId,
    variantId,
    resolution: "included_in_count",
    quantity: 1,
  });
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.messageAr).toContain("لقطة مصدره");
  expect(await available(manager, variantId)).toBe(3);
});

test("keeps an uncosted late sale held until a real batch is allocated", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 1, 9000);
  const deviceId = crypto.randomUUID();
  const oldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const { correction } = await coordinateAndCorrect(manager, deviceId, variantId, 1, 0);
  const late = await acceptSnapshotSale(manager, oldSnapshot.body.snapshotId, deviceId, variantId, "2026-09-15T10:00:00.000Z", 2);
  expect(late.status).toBe(201);
  expect(late.body).toMatchObject({ costsIncomplete: true, lines: [{ allocatedQuantity: 0, unallocatedQuantity: 2 }] });
  expect(await available(manager, variantId)).toBe(0);

  const heldCoordination = await api(manager, "POST", "/api/internal/inventory/count-coordination", { operationId: crypto.randomUUID() });
  const heldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  await api(manager, "POST", "/api/internal/inventory/count-coordination/acknowledgements", {
    coordinationId: heldCoordination.body.id, deviceId, snapshotId: heldSnapshot.body.snapshotId,
  });
  const falseAvailability = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId: crypto.randomUUID(), coordinationId: heldCoordination.body.id, branchId: abshwayId, variantId,
    previousAvailableQuantity: 0, correctedAvailableQuantity: 1,
    reason: "لا يجوز تحرير الفرق المحجوز", positiveSourceBatchId: correction.batches[0].batchId,
  });
  expect(falseAvailability.status).toBe(400);
  expect(falseAvailability.body.error.messageAr).toContain("فرق مخزون غير محلول");
  expect(await available(manager, variantId)).toBe(0);
  await api(manager, "POST", "/api/internal/inventory/count-coordination/cancel", {
    operationId: crypto.randomUUID(), coordinationId: heldCoordination.body.id,
  });

  const counted = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: correction.id, saleId: late.body.id, branchId: abshwayId, variantId,
    resolution: "included_in_count", quantity: 1,
  });
  expect(counted.status).toBe(201);
  expect(counted.body).toMatchObject({
    resolution: "included_in_count",
    previousAvailableQuantity: 0,
    resultingAvailableQuantity: 0,
    batches: [{ direction: "allocate", quantity: 1, unitCostPiasters: 9000 }],
  });
  expect(await available(manager, variantId)).toBe(0);

  const fabricated = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: correction.id, saleId: late.body.id, branchId: abshwayId, variantId,
    resolution: "allocate_missing_source", quantity: 1,
  });
  expect(fabricated.status).toBe(400);
  expect(await available(manager, variantId)).toBe(0);

  await receive(manager, variantId, 1, 12000);
  expect(await available(manager, variantId)).toBe(0);
  const allocated = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: correction.id, saleId: late.body.id, branchId: abshwayId, variantId,
    resolution: "allocate_missing_source", quantity: 1,
  });
  expect(allocated.status, JSON.stringify(allocated.body)).toBe(201);
  expect(allocated.body).toMatchObject({
    resolution: "allocate_missing_source",
    previousAvailableQuantity: 0,
    resultingAvailableQuantity: 0,
    batches: [{ direction: "allocate", quantity: 1, unitCostPiasters: 12000 }],
  });
  const sales = await api(manager, "GET", "/api/internal/sales");
  expect(sales.body.find((sale: { id: string }) => sale.id === late.body.id)).toMatchObject({
    costsIncomplete: false,
    lines: [{ allocatedQuantity: 2, unallocatedQuantity: 0 }],
    allocations: expect.arrayContaining([
      expect.objectContaining({ quantity: 1, unitCostPiasters: 9000 }),
      expect.objectContaining({ quantity: 1, unitCostPiasters: 12000 }),
    ]),
  });
});

test("does not presume stale tills paused and preserves completed cash handover during a pause", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 2, 7000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.count",
    displayName: "كاشير العد",
    password: "cashier-pass-16",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.count", "cashier-pass-16");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const sale = salePayload(variantId, new Date().toISOString());
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", sale);
  expect(prepared.status).toBe(201);
  const started = await api(manager, "POST", "/api/internal/inventory/count-coordination", { operationId: crypto.randomUUID() });
  expect(started.body.devices[0]).toMatchObject({ deviceId, acknowledgedAt: null });
  expect((await api(cashier, "GET", "/api/internal/inventory/stock-pause")).body).toMatchObject({ coordinationId: started.body.id });
  expect((await api(cashier, "GET", "/api/internal/inventory/stock-corrections")).status).toBe(403);
  expect((await api(cashier, "POST", "/api/internal/inventory/count-coordination", { operationId: crypto.randomUUID() })).status).toBe(403);

  const blockedNew = await api(manager, "POST", "/api/internal/sales/prepare", salePayload(variantId, new Date().toISOString()));
  expect(blockedNew.status).toBe(409);
  expect(blockedNew.body.error.code).toBe("STOCK_MUTATION_PAUSED");
  const completed = await api(manager, "POST", "/api/internal/sales", { ...sale, physicallyCompleted: true });
  expect(completed.status).toBe(201);
  expect(completed.body.physicallyCompleted).toBe(true);
  expect(await available(manager, variantId)).toBe(1);

  const fresh = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const staleAck = await api(manager, "POST", "/api/internal/inventory/count-coordination/acknowledgements", {
    coordinationId: started.body.id,
    deviceId,
    snapshotId: fresh.body.snapshotId,
  });
  expect(staleAck.status).toBe(409);
  expect(staleAck.body.error.code).toBe("COORDINATION_STALE");
});

test("requires retained batch provenance for a positive correction and replays it without duplication", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 2, 6500);
  const completed = await api(manager, "POST", "/api/internal/sales", {
    ...salePayload(variantId, new Date().toISOString()),
    physicallyCompleted: true,
  });
  expect(completed.status).toBe(201);
  const batchesBefore = await api(manager, "GET", "/api/internal/inventory/batches");
  const sourceBatchId = batchesBefore.body[0].id;
  const deviceId = crypto.randomUUID();
  await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const started = await api(manager, "POST", "/api/internal/inventory/count-coordination", { operationId: crypto.randomUUID() });
  const snapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  await api(manager, "POST", "/api/internal/inventory/count-coordination/acknowledgements", {
    coordinationId: started.body.id, deviceId, snapshotId: snapshot.body.snapshotId,
  });
  const missingSource = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId: crypto.randomUUID(), coordinationId: started.body.id, branchId: abshwayId, variantId,
    previousAvailableQuantity: 1, correctedAvailableQuantity: 2, reason: "قطعة من الدفعة الأصلية",
  });
  expect(missingSource.status).toBe(400);
  const operationId = crypto.randomUUID();
  const corrected = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId, coordinationId: started.body.id, branchId: abshwayId, variantId,
    previousAvailableQuantity: 1, correctedAvailableQuantity: 2,
    reason: "قطعة من الدفعة الأصلية", positiveSourceBatchId: sourceBatchId,
  });
  expect(corrected.status).toBe(201);
  expect(corrected.body.batches).toEqual([
    expect.objectContaining({ batchId: sourceBatchId, direction: "restore", quantity: 1, unitCostPiasters: 6500 }),
  ]);
  const replay = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId, coordinationId: started.body.id, branchId: abshwayId, variantId,
    previousAvailableQuantity: 1, correctedAvailableQuantity: 2,
    reason: "قطعة من الدفعة الأصلية", positiveSourceBatchId: sourceBatchId,
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(corrected.body);
  expect(await available(manager, variantId)).toBe(2);
});

test("cannot count the same late sale again under a second negative correction", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 3, 8000);
  const deviceId = crypto.randomUUID();
  const oldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const first = await coordinateAndCorrect(manager, deviceId, variantId, 3, 2);
  const second = await coordinateAndCorrect(manager, deviceId, variantId, 2, 1);
  const occurredAt = new Date(Math.min(
    new Date(first.correction.boundaryAt).getTime(),
    new Date(second.correction.boundaryAt).getTime(),
  ) - 1_000).toISOString();
  const late = await acceptSnapshotSale(manager, oldSnapshot.body.snapshotId, deviceId, variantId, occurredAt);
  expect(late.status).toBe(201);
  const firstResolution = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: first.correction.id, saleId: late.body.id,
    branchId: abshwayId, variantId, resolution: "included_in_count", quantity: 1,
  });
  expect(firstResolution.status).toBe(201);
  const duplicate = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: second.correction.id, saleId: late.body.id,
    branchId: abshwayId, variantId, resolution: "included_in_count", quantity: 1,
  });
  expect(duplicate.status).toBe(400);
  expect(duplicate.body.error.messageAr).toContain("أثر البيع غير المصالح");
  expect(await available(manager, variantId)).toBe(1);
});

test("rejects cost reassignment after a return already restored the original sale batch", async () => {
  const manager = await managerSession();
  const variantId = await seedVariant(manager);
  await receive(manager, variantId, 1, 10000);
  await receive(manager, variantId, 1, 20000);
  const deviceId = crypto.randomUUID();
  const oldSnapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  const { correction } = await coordinateAndCorrect(manager, deviceId, variantId, 2, 1);
  const late = await acceptSnapshotSale(
    manager,
    oldSnapshot.body.snapshotId,
    deviceId,
    variantId,
    new Date(correction.boundaryAt).toISOString(),
  );
  expect(late.status).toBe(201);
  expect(await available(manager, variantId)).toBe(0);
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: late.body.id,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 25000,
    lines: [{ sourceSaleLineId: late.body.lines[0].id, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status).toBe(201);
  expect(await available(manager, variantId)).toBe(1);
  const rejected = await api(manager, "POST", "/api/internal/inventory/stock-reconciliations", {
    operationId: crypto.randomUUID(), correctionId: correction.id, saleId: late.body.id,
    branchId: abshwayId, variantId, resolution: "included_in_count", quantity: 1,
  });
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.messageAr).toContain("بعد تسجيل إرجاع أو تصحيح مرتبط");
  expect(await available(manager, variantId)).toBe(1);
  const saleAfter = (await api(manager, "GET", "/api/internal/sales")).body
    .find((sale: { id: string }) => sale.id === late.body.id);
  expect(saleAfter.allocations).toEqual([
    expect.objectContaining({ quantity: 1, unitCostPiasters: 20000 }),
  ]);
});

async function seedVariant(manager: CookieSession): Promise<string> {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تصحيح المخزون" });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `STK-${crypto.randomUUID().slice(0, 6)}`,
    nameAr: "قميص للعد",
    descriptionAr: "اختبار تصحيح الكمية",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  return product.body.variants[0].id;
}

async function managerSession() {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  return manager;
}

async function receive(manager: CookieSession, variantId: string, quantity: number, unitCostPiasters: number) {
  return api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-15",
    lines: [{ variantId, quantity, unitCostPiasters }],
  });
}

async function coordinateAndCorrect(
  manager: CookieSession,
  deviceId: string,
  variantId: string,
  previousAvailableQuantity: number,
  correctedAvailableQuantity: number,
) {
  const started = await api(manager, "POST", "/api/internal/inventory/count-coordination", { operationId: crypto.randomUUID() });
  const snapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, pendingOperationIds: [] });
  await api(manager, "POST", "/api/internal/inventory/count-coordination/acknowledgements", {
    coordinationId: started.body.id,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
  });
  const corrected = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId: crypto.randomUUID(),
    coordinationId: started.body.id,
    branchId: abshwayId,
    variantId,
    previousAvailableQuantity,
    correctedAvailableQuantity,
    reason: "مطابقة العدد الفعلي",
  });
  expect(corrected.status).toBe(201);
  return { coordination: started.body, correction: corrected.body };
}

function salePayload(variantId: string, occurredAt: string) {
  return {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  };
}

function acceptSnapshotSale(
  manager: CookieSession,
  snapshotId: string,
  deviceId: string,
  variantId: string,
  occurredAt: string,
  quantity = 1,
) {
  return api(manager, "POST", "/api/internal/sales/accepted", {
    ...salePayload(variantId, occurredAt),
    lines: [{ variantId, quantity, listedUnitPricePiasters: 25000 }],
    deviceId,
    snapshotId,
    physicallyCompleted: true,
  });
}

async function available(manager: CookieSession, variantId: string) {
  void manager;
  return (await built.inventory.quantitiesFor(abshwayId, [variantId])).get(variantId) ?? 0;
}

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

async function api(
  session: CookieSession | undefined,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  return { status: response.statusCode, body: safeJson(response.body) };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

function safeJson(body: string) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
