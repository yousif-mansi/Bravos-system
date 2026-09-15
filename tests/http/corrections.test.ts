import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const ORIGIN = "http://127.0.0.1:5173";
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => { cluster = await startPostgresCluster({ port: 55451 }); }, 120_000);
afterAll(async () => { if (built) await built.close(); await cluster.stop(); });
beforeEach(async () => {
  if (built) await built.close();
  const database = `bravos_corrections_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test", databaseUrl: cluster.connectionString(database), authSecret: "corrections-secret-corrections-32",
    authBaseUrl: "http://127.0.0.1:3010", internalOrigin: ORIGIN, publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [ORIGIN, "http://127.0.0.1:3010"], secureCookies: false,
    ownerRecoveryAdapter: "local-outbox", ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-correction-outbox-")),
    businessClock: () => new Date("2026-09-15T12:00:00.000Z"),
  });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='abshway'")).rows[0]!.id;
  await ensureOwner(built.services, { loginName: "owner", displayName: "مدير التصحيح", password: "owner-pass-1" });
});

test("manager corrects a duplicate cash-sale record using explicit goods and cash facts without changing the immutable sale", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  await receive(manager, variantId, 3, 11000);
  const original = await sale(manager, variantId, 2);
  const originalDetail = (await api(manager, "GET", `/api/internal/sales/${original.id}`)).body;

  const initial = await api(manager, "GET", `/api/internal/corrections/sales/${original.id}`);
  expect(initial.status).toBe(200);
  expect(initial.body).toMatchObject({ revision: 0, status: "active", original: { finalTotalPiasters: 60000 }, effective: { finalTotalPiasters: 60000 } });
  const line = initial.body.original.lines[0];

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.no.corrections", displayName: "موظف", password: "staff-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.no.corrections", "staff-pass-1");
  expect((await api(cashier, "GET", `/api/internal/corrections/sales/${original.id}`)).status).toBe(403);

  const operationId = crypto.randomUUID();
  const correction = {
    operationId, expectedRevision: 0, type: "correction", reason: "تسجيل الوحدة الثانية بالخطأ ولم تغادر المحل",
    effective: { finalTotalPiasters: 30000, lines: [{ lineId: line.saleLineId, quantity: 1, paidPiasters: 30000 }] },
    merchandise: [{ lineId: line.saleLineId, quantityDelta: 1 }], cash: null,
  };
  const changed = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, correction);
  expect(changed.status).toBe(201);
  expect(changed.body).toMatchObject({
    revision: 1, status: "active", original: { finalTotalPiasters: 60000, lines: [{ quantity: 2 }] },
    effective: { finalTotalPiasters: 30000, lines: [{ quantity: 1 }] },
    actual: { originalCashReceivedPiasters: 60000, netCashReceivedPiasters: 60000, merchandiseRestoredQuantity: 1 },
    changes: [{ reason: correction.reason, cash: null, merchandise: [{ direction: "restore", quantity: 1 }] }],
  });
  expect((await batches(manager))[0].remainingQuantity).toBe(2);
  expect((await api(manager, "GET", `/api/internal/sales/${original.id}`)).body).toEqual(originalDetail);

  const replay = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, correction);
  expect(replay.status).toBe(200);
  expect(replay.body.revision).toBe(1);
  expect((await batches(manager))[0].remainingQuantity).toBe(2);
  expect((await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, { ...correction, reason: "محتوى مختلف" })).status).toBe(409);

  const cancel = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "cancellation", reason: "السجل مكرر بالكامل",
    effective: null, merchandise: [], cash: null,
  });
  expect(cancel.status).toBe(201);
  expect(cancel.body).toMatchObject({ status: "cancelled", revision: 2, effective: null, actual: { netCashReceivedPiasters: 60000, merchandiseRestoredQuantity: 1 } });
  expect((await batches(manager))[0].remainingQuantity).toBe(2);
  const sources = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`);
  expect(sources.status).toBe(200);
  expect(sources.body).toEqual([]);
});

test("posted return correction preserves paid history, requires explicit stock and cash movement, and keeps later eligibility consistent", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  await receive(manager, variantId, 2, 12000);
  const original = await sale(manager, variantId, 2);
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 30000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, { receivedAndInspected: true, expectedRevision: draft.body.revision });
  await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, { operationId: crypto.randomUUID(), status: "paid", amountPiasters: 30000 });
  const detail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const line = detail.body.original.lines[0];

  const invalid = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "تغيير الفحص",
    effective: { authorizedRefundPiasters: 20000, lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 0 }] },
    merchandise: [], cash: null,
  });
  expect(invalid.status).toBe(400);
  expect((await batches(manager))[0].remainingQuantity).toBe(1);

  const stockCorrection = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "اتضح أن القطعة غير قابلة للبيع",
    effective: { authorizedRefundPiasters: 20000, lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 0 }] },
    merchandise: [{ lineId: line.returnLineId, quantityDelta: -1 }], cash: null,
  });
  expect(stockCorrection.status).toBe(201);
  expect(stockCorrection.body).toMatchObject({
    original: { authorizedRefundPiasters: 30000, paidPiasters: 30000 },
    effective: { authorizedRefundPiasters: 20000, paidPiasters: 30000, lines: [{ sellableQuantity: 0 }] },
    actual: { originalRefundPaidPiasters: 30000, netRefundPaidPiasters: 30000, merchandiseDeductedQuantity: 1 },
  });
  expect((await batches(manager))[0].remainingQuantity).toBe(0);
  const overpaid = await api(manager, "GET", `/api/internal/returns/${draft.body.id}`);
  expect(overpaid.body).toMatchObject({
    originalAuthorizedRefundPiasters: 30000,
    authorizedRefundPiasters: 20000,
    correctionRevision: 1,
    refund: { status: "overpaid", paidPiasters: 30000, overpaidPiasters: 10000, owedPiasters: 0 },
  });
  expect((await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, {
    operationId: crypto.randomUUID(), status: "paid", amountPiasters: 10000,
  })).status).toBe(409);

  const recovered = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "correction", reason: "استرد العميل فرق المبلغ المدفوع",
    effective: { authorizedRefundPiasters: 20000, lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 0 }] },
    merchandise: [], cash: { direction: "recovered", amountPiasters: 10000 },
  });
  expect(recovered.status).toBe(201);
  expect(recovered.body).toMatchObject({ effective: { paidPiasters: 20000 }, actual: { netRefundPaidPiasters: 20000, correctionCashRecoveredPiasters: 10000 } });
  expect((await api(manager, "GET", `/api/internal/returns/${draft.body.id}`)).body.refund).toMatchObject({
    status: "paid", paidPiasters: 20000, owedPiasters: 0, overpaidPiasters: 0,
  });

  const refreshed = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`);
  expect(refreshed.body[0].lines[0]).toMatchObject({ purchasedQuantity: 2, returnedQuantity: 1, remainingQuantity: 1 });
  const sourceSale = await api(manager, "GET", `/api/internal/corrections/sales/${original.id}`);
  expect(sourceSale.body).toMatchObject({
    relationships: { returns: [{ id: draft.body.id, refundPaidPiasters: 20000 }] },
    actual: {
      originalCashReceivedPiasters: 60000,
      correctionCashPaidOutPiasters: 30000,
      correctionCashRecoveredPiasters: 10000,
      netCashReceivedPiasters: 40000,
    },
  });
  expect(posted.body.refund.owedPiasters).toBe(30000);
});

test("sale cancellation proceeds after its posted Return is explicitly cancelled without losing actual stock or cash facts", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  await receive(manager, variantId, 1, 12000);
  const original = await sale(manager, variantId, 1);
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 30000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, { receivedAndInspected: true, expectedRevision: draft.body.revision });
  await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, { operationId: crypto.randomUUID(), status: "paid", amountPiasters: 30000 });
  const returnDetail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const returnLine = returnDetail.body.original.lines[0];

  const cancelledReturn = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "سجل الإرجاع أُنشئ بالخطأ",
    effective: null,
    merchandise: [{ lineId: returnLine.returnLineId, quantityDelta: -1 }],
    cash: { direction: "recovered", amountPiasters: 30000 },
  });
  expect(cancelledReturn.status).toBe(201);
  expect(cancelledReturn.body).toMatchObject({
    status: "cancelled",
    effective: null,
    original: { authorizedRefundPiasters: 30000, paidPiasters: 30000 },
    actual: { netRefundPaidPiasters: 0, merchandiseDeductedQuantity: 1, correctionCashRecoveredPiasters: 30000 },
  });

  const cancelledSale = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "بيع مكرر لم يغادر بسببه صنف أو نقد",
    effective: null, merchandise: [], cash: null,
  });
  expect(cancelledSale.status).toBe(201);
  expect(cancelledSale.body).toMatchObject({
    status: "cancelled",
    effective: null,
    relationships: { returns: [{ id: draft.body.id, effectiveStatus: "cancelled", refundPaidPiasters: 0 }] },
    actual: {
      originalCashReceivedPiasters: 30000,
      correctionCashPaidOutPiasters: 30000,
      correctionCashRecoveredPiasters: 30000,
      netCashReceivedPiasters: 30000,
    },
  });
  expect(await remainingTotal(manager)).toBe(0);
  expect((await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`)).body).toMatchObject({
    status: "cancelled",
    changes: [{ reason: "سجل الإرجاع أُنشئ بالخطأ" }],
    actual: { netRefundPaidPiasters: 0, merchandiseDeductedQuantity: 1 },
  });
});

test("stale and invalid correction attempts are atomic, and an undercount retry consumes FIFO then supports a partial Return", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  const firstReceipt = await receive(manager, variantId, 1, 10000);
  const secondReceipt = await receive(manager, variantId, 2, 20000);
  const firstBatchId = firstReceipt.lines[0].batchId as string;
  const secondBatchId = secondReceipt.lines[0].batchId as string;
  await built.pool.query("UPDATE inventory_batch SET recorded_at = CASE WHEN id=$1 THEN $3::timestamptz ELSE $4::timestamptz END WHERE id = ANY($2::uuid[])", [
    firstBatchId, [firstBatchId, secondBatchId], "2026-09-01T08:00:00.000Z", "2026-09-02T08:00:00.000Z",
  ]);
  const original = await sale(manager, variantId, 1);
  const detail = await api(manager, "GET", `/api/internal/corrections/sales/${original.id}`);
  const line = detail.body.original.lines[0];
  const operationId = crypto.randomUUID();
  const undercount = {
    operationId,
    expectedRevision: 0,
    type: "correction",
    reason: "كانت الكمية المسجلة أقل من الكمية التي استلمها العميل ودفع قيمتها",
    effective: { finalTotalPiasters: 50000, lines: [{ lineId: line.saleLineId, quantity: 2, paidPiasters: 50000 }] },
    merchandise: [{ lineId: line.saleLineId, quantityDelta: -1 }],
    cash: null,
  };

  const stale = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, { ...undercount, expectedRevision: 7 });
  expect(stale.status).toBe(409);
  expect(await remainingTotal(manager)).toBe(2);

  const corrected = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, undercount);
  expect(corrected.status).toBe(201);
  expect(corrected.body).toMatchObject({
    original: { finalTotalPiasters: 30000, lines: [{ quantity: 1, paidPiasters: 30000 }] },
    effective: { finalTotalPiasters: 50000, lines: [{ quantity: 2, paidPiasters: 50000, paidRanges: [{ quantity: 2, paidUnitPiasters: 25000 }] }] },
    changes: [{ merchandise: [{
      direction: "deduct",
      quantity: 1,
      batches: [{
        batchId: secondBatchId,
        quantity: 1,
        unitCostPiasters: 20000,
        effectiveUnitCostPiasters: 20000,
      }],
    }] }],
  });
  expect(await remainingTotal(manager)).toBe(1);

  const invalidOperationId = crypto.randomUUID();
  const invalid = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, {
    operationId: invalidOperationId, expectedRevision: 1, type: "correction", reason: "زيادة لا يغطيها المخزون الفعلي",
    effective: { finalTotalPiasters: 100000, lines: [{ lineId: line.saleLineId, quantity: 4, paidPiasters: 100000 }] },
    merchandise: [{ lineId: line.saleLineId, quantityDelta: -2 }], cash: null,
  });
  expect(invalid.status).toBe(400);
  expect(await remainingTotal(manager)).toBe(1);
  const validRetry = await api(manager, "POST", `/api/internal/corrections/sales/${original.id}`, {
    operationId: invalidOperationId, expectedRevision: 1, type: "correction", reason: "تأكيد القيم الصحيحة بعد مراجعة السطر",
    effective: { finalTotalPiasters: 50000, lines: [{ lineId: line.saleLineId, quantity: 2, paidPiasters: 50000 }] },
    merchandise: [], cash: null,
  });
  expect(validRetry.status).toBe(201);
  expect(validRetry.body.revision).toBe(2);

  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  expect(source.lines[0]).toMatchObject({
    purchasedQuantity: 2, remainingQuantity: 2, paidPiasters: 50000,
    availablePaidRanges: [{ quantity: 2, paidUnitPiasters: 25000 }],
  });
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 25000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.body.suggestedRefundPiasters).toBe(25000);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, { receivedAndInspected: true, expectedRevision: draft.body.revision });
  expect(posted.status).toBe(201);
  expect(posted.body.restorations).toContainEqual(expect.objectContaining({ batchId: firstBatchId, quantity: 1, unitCostPiasters: 10000 }));
  const afterReturn = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  expect(afterReturn.lines[0]).toMatchObject({ purchasedQuantity: 2, returnedQuantity: 1, remainingQuantity: 1 });
});

test("ordinary Returns payment uses the corrected outstanding refund and preserves the original authorization", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  await receive(manager, variantId, 1, 12000);
  const original = await sale(manager, variantId, 1);
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 10000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, { receivedAndInspected: true, expectedRevision: draft.body.revision });
  const correctionDetail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const line = correctionDetail.body.original.lines[0];
  const corrected = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "القيمة المعتمدة الصحيحة ثمانون جنيهاً",
    effective: { authorizedRefundPiasters: 8000, lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 0 }] },
    merchandise: [], cash: null,
  });
  expect(corrected.status).toBe(201);

  const beforePayment = await api(manager, "GET", `/api/internal/returns/${draft.body.id}`);
  expect(beforePayment.body).toMatchObject({
    originalAuthorizedRefundPiasters: 10000,
    authorizedRefundPiasters: 8000,
    correctionRevision: 1,
    refund: { status: "owed", owedPiasters: 8000, paidPiasters: 0 },
  });
  expect((await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, {
    operationId: crypto.randomUUID(), status: "paid", amountPiasters: 10000,
  })).status).toBe(400);

  const paymentOperationId = crypto.randomUUID();
  const payment = { operationId: paymentOperationId, status: "paid", amountPiasters: 8000 };
  const paid = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, payment);
  expect(paid.status).toBe(201);
  expect(paid.body).toMatchObject({
    originalAuthorizedRefundPiasters: 10000,
    authorizedRefundPiasters: 8000,
    refund: { status: "paid", paidPiasters: 8000, owedPiasters: 0, overpaidPiasters: 0 },
  });
  const replay = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/refund`, payment);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({
    originalAuthorizedRefundPiasters: 10000,
    authorizedRefundPiasters: 8000,
    refund: {
      status: "paid",
      paidPiasters: 8000,
      events: [{ operationId: paymentOperationId, amountPiasters: 8000 }],
    },
  });
  expect(replay.body.refund.events).toHaveLength(1);
  const correctionAfterPayment = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  expect(correctionAfterPayment.body).toMatchObject({
    revision: 1,
    original: { authorizedRefundPiasters: 10000, paidPiasters: 8000 },
    effective: { authorizedRefundPiasters: 8000, paidPiasters: 8000 },
    changes: [{ reason: "القيمة المعتمدة الصحيحة ثمانون جنيهاً" }],
  });
});

test("changing inspection restores the exact batch of that Return and reuses it after lowering then increasing", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  const firstReceipt = await receive(manager, variantId, 1, 10000);
  const secondReceipt = await receive(manager, variantId, 1, 20000);
  const firstBatchId = firstReceipt.lines[0].batchId as string;
  const secondBatchId = secondReceipt.lines[0].batchId as string;
  await built.pool.query("UPDATE inventory_batch SET recorded_at = CASE WHEN id=$1 THEN $3::timestamptz ELSE $4::timestamptz END WHERE id = ANY($2::uuid[])", [
    firstBatchId, [firstBatchId, secondBatchId], "2026-09-01T08:00:00.000Z", "2026-09-02T08:00:00.000Z",
  ]);
  const original = await sale(manager, variantId, 2);
  let source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];

  const firstDraft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 30000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await api(manager, "POST", `/api/internal/returns/${firstDraft.body.id}/post`, { receivedAndInspected: true, expectedRevision: firstDraft.body.revision });
  source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  const secondDraft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.id, handlingBranchId: branchId,
    authorizedRefundPiasters: 30000, lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await api(manager, "POST", `/api/internal/returns/${secondDraft.body.id}/post`, { receivedAndInspected: true, expectedRevision: secondDraft.body.revision });
  const originalCorrection = await api(manager, "GET", `/api/internal/corrections/returns/${secondDraft.body.id}`);
  const line = originalCorrection.body.original.lines[0];
  const effective = (sellableQuantity: number) => ({
    authorizedRefundPiasters: 30000,
    lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity }],
  });

  const restored = await api(manager, "POST", `/api/internal/corrections/returns/${secondDraft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "القطعة الثانية سليمة وقابلة للبيع",
    effective: effective(1), merchandise: [{ lineId: line.returnLineId, quantityDelta: 1 }], cash: null,
  });
  expect(restored.status).toBe(201);
  expect(restored.body.changes[0].merchandise).toEqual([
    expect.objectContaining({
      direction: "restore",
      quantity: 1,
      batches: [{
        batchId: secondBatchId,
        quantity: 1,
        unitCostPiasters: 20000,
        effectiveUnitCostPiasters: 20000,
      }],
    }),
  ]);
  expect(await batchRemainders(manager)).toMatchObject({ [firstBatchId]: 0, [secondBatchId]: 1 });

  const lowered = await api(manager, "POST", `/api/internal/corrections/returns/${secondDraft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "correction", reason: "إعادة الفحص أثبت أن القطعة غير قابلة للبيع",
    effective: effective(0), merchandise: [{ lineId: line.returnLineId, quantityDelta: -1 }], cash: null,
  });
  expect(lowered.status).toBe(201);
  expect(lowered.body.changes[1].merchandise[0].batches[0]).toMatchObject({ batchId: secondBatchId, unitCostPiasters: 20000 });
  expect(await batchRemainders(manager)).toMatchObject({ [firstBatchId]: 0, [secondBatchId]: 0 });

  const restoredAgain = await api(manager, "POST", `/api/internal/corrections/returns/${secondDraft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 2, type: "correction", reason: "الفحص النهائي أكد صلاحية القطعة",
    effective: effective(1), merchandise: [{ lineId: line.returnLineId, quantityDelta: 1 }], cash: null,
  });
  expect(restoredAgain.status).toBe(201);
  expect(restoredAgain.body.changes[2].merchandise[0].batches[0]).toMatchObject({ batchId: secondBatchId, unitCostPiasters: 20000 });
  expect(await batchRemainders(manager)).toMatchObject({ [firstBatchId]: 0, [secondBatchId]: 1 });
});

test("posted unsellable Return inspection exposes original and corrected effective batch cost", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const { variantId } = await seedProduct(manager);
  const receipt = await receive(manager, variantId, 1, 10000);
  const original = await sale(manager, variantId, 1);
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: original.id,
    handlingBranchId: branchId,
    authorizedRefundPiasters: 30000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  expect(draft.status).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status).toBe(201);

  const receivingCorrection = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      reason: "تصحيح فاتورة المورد إلى مائة وأربعين",
      lines: [{ lineId: receipt.lines[0].id, quantity: 1, unitCostPiasters: 14000 }],
    },
  );
  expect(receivingCorrection.status).toBe(201);

  const detail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const line = detail.body.original.lines[0];
  const inspectedSellable = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "correction",
    reason: "الفحص النهائي أكد صلاحية القطعة",
    effective: {
      authorizedRefundPiasters: 30000,
      lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 1 }],
    },
    merchandise: [{ lineId: line.returnLineId, quantityDelta: 1 }],
    cash: null,
  });
  expect(inspectedSellable.status).toBe(201);
  expect(inspectedSellable.body.changes[0].merchandise[0].batches).toEqual([{
    batchId: receipt.lines[0].batchId,
    quantity: 1,
    unitCostPiasters: 10000,
    effectiveUnitCostPiasters: 14000,
  }]);

  const laterReceivingCorrection = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      reason: "تصحيح لاحق إلى مائة وخمسين",
      lines: [{ lineId: receipt.lines[0].id, quantity: 1, unitCostPiasters: 15000 }],
    },
  );
  expect(laterReceivingCorrection.status).toBe(201);
  const refreshedInspection = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  expect(refreshedInspection.body.changes[0].merchandise[0].batches[0]).toEqual({
    batchId: receipt.lines[0].batchId,
    quantity: 1,
    unitCostPiasters: 10000,
    effectiveUnitCostPiasters: 15000,
  });
});

async function seedProduct(session: Session) {
  const category = await api(session, "POST", "/api/internal/catalog/categories", { nameAr: "تصحيحات" });
  const size = await api(session, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تصحيح" });
  const color = await api(session, "POST", "/api/internal/catalog/colors", { nameAr: "لون تصحيح" });
  const product = await api(session, "POST", "/api/internal/catalog/products", {
    code: `COR-${crypto.randomUUID().slice(0, 6)}`, nameAr: "قميص تصحيح", descriptionAr: "اختبار", categoryId: category.body.id,
    defaultSellingPricePiasters: 30000, publication: "hidden", imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  return { variantId: product.body.variants[0].id as string };
}
async function receive(session: Session, variantId: string, quantity: number, unitCostPiasters: number) { const response = await api(session, "POST", "/api/internal/receiving/receipts", { operationId: crypto.randomUUID(), receiptDate: "2026-09-01", lines: [{ variantId, quantity, unitCostPiasters }] }); expect(response.status).toBe(201); return response.body; }
async function sale(session: Session, variantId: string, quantity: number) { const response = await api(session, "POST", "/api/internal/sales", { saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true, occurredAt: "2026-09-10T12:00:00.000Z", employeeDiscountPiasters: 0, lines: [{ variantId, quantity }] }); expect(response.status).toBe(201); return response.body; }
async function batches(session: Session) { return (await api(session, "GET", "/api/internal/inventory/batches")).body; }
async function remainingTotal(session: Session) {
  return (await batches(session)).reduce((sum: number, batch: { remainingQuantity: number }) => sum + batch.remainingQuantity, 0);
}
async function batchRemainders(session: Session) {
  const rows = await batches(session);
  return Object.fromEntries(rows.map((row: { id: string; remainingQuantity: number }) => [row.id, row.remainingQuantity]));
}
type Session = { cookie: string };
async function signIn(username: string, password: string): Promise<Session> { const response = await built.app.inject({ method: "POST", url: "/api/auth/sign-in/username", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: { username, password } }); expect(response.statusCode).toBe(200); const raw = response.headers["set-cookie"]; const values = Array.isArray(raw) ? raw : raw ? [raw] : []; return { cookie: values.map((value) => value.split(";")[0]).join("; ") }; }
async function api(session: Session | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) { const response = await built.app.inject({ method, url, headers: { origin: ORIGIN, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) }, payload }); return { status: response.statusCode, body: JSON.parse(response.body) }; }
