import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const ORIGIN = "http://127.0.0.1:5173";
let now = new Date("2026-09-16T08:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55469 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  now = new Date("2026-09-16T08:00:00.000Z");
  const database = `bravos_reporting_edge_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(database),
    authSecret: "reporting-edge-secret-reporting-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-reporting-edge-outbox-")),
    businessClock: () => new Date(now),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id,code FROM branch");
  abshwayId = branches.rows.find((branch) => branch.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((branch) => branch.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مدير حواف التقارير",
    password: "owner-pass-1",
  });
});

test("a late paid sale keeps cost incomplete and holds later received stock out of authoritative value", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [25_000], "تعليق المخزون");
  const variantId = variantIds[0]!;

  at("2026-09-16T08:15:00.000Z");
  await receive(manager, variantId, 1, 9_000, "2026-09-16");
  const latePayload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt: "2026-09-16T09:00:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", latePayload);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);

  const competing = await completeSale(manager, [{ variantId, quantity: 1 }], {
    occurredAt: "2026-09-16T09:05:00.000Z",
  });
  expect(competing.body).toMatchObject({ costsIncomplete: false, lines: [{ allocatedQuantity: 1, unallocatedQuantity: 0 }] });

  const late = await api(manager, "POST", "/api/internal/sales", { ...latePayload, physicallyCompleted: true });
  expect(late.status, JSON.stringify(late.body)).toBe(201);
  expect(late.body).toMatchObject({
    id: latePayload.saleId,
    physicallyCompleted: true,
    costsIncomplete: true,
    lines: [{ allocatedQuantity: 0, unallocatedQuantity: 1 }],
    discrepancy: { unallocatedQuantity: 1 },
  });

  at("2026-09-16T10:00:00.000Z");
  await receive(manager, variantId, 2, 14_000, "2026-09-16");
  const report = await managementReport(manager);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary).toMatchObject({
    completedCount: 2,
    grossMerchandiseSalesPiasters: 50_000,
    knownNetMerchandiseCostPiasters: 9_000,
    merchandiseGrossProfitPiasters: null,
    costsIncomplete: true,
    unresolvedCostQuantity: 1,
  });
  expect(report.body.inventory).toEqual({
    availableQuantity: 0,
    availableValuePiasters: 0,
    protectedQuantity: 0,
    protectedValuePiasters: 0,
    unresolvedCostQuantity: 1,
    costsIncomplete: true,
  });
  expect(report.body.completedSales.find((sale: ReportSale) => sale.source.id === latePayload.saleId)).toMatchObject({
    effectiveMerchandisePiasters: 25_000,
    knownCostPiasters: 0,
    unresolvedCostQuantity: 1,
    costsIncomplete: true,
  });
});

test("ordinary refund owed is explicit and cancellation without inventory movement retains restored cost", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [25_000], "مرتجع ملغى مع مخزون مستعاد");
  const variantId = variantIds[0]!;
  await receive(manager, variantId, 1, 11_000, "2026-09-16");
  const sale = await completeSale(manager, [{ variantId, quantity: 1 }], {
    occurredAt: "2026-09-16T09:00:00.000Z",
  });
  const source = await returnSource(manager, sale.body.id);
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 5_000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: drafted.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);

  const owed = await managementReport(manager);
  expect(owed.body.refunds[0]).toMatchObject({
    returnId: drafted.body.id,
    authorizedRefund: { totalPiasters: 5_000 },
    actualRefundPaidPiasters: 0,
    cashRefundStatus: "owed",
    cashRefundOwedPiasters: 5_000,
    sellableRestoredCostPiasters: 11_000,
  });
  expect(owed.body.summary).toMatchObject({
    merchandiseRefundPiasters: 5_000,
    knownNetMerchandiseCostPiasters: 0,
    merchandiseGrossProfitPiasters: 20_000,
  });

  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${drafted.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "إلغاء الأثر المالي فقط مع بقاء القطعة المستلمة في المخزون",
    effective: null,
    merchandise: [],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const afterCancellation = await managementReport(manager);
  expect(afterCancellation.body.refunds[0]).toMatchObject({
    returnId: drafted.body.id,
    effectiveStatus: "cancelled",
    authorizedRefund: { merchandisePiasters: 0, checkoutChargePiasters: 0, totalPiasters: 0 },
    actualRefundPaidPiasters: 0,
    cashRefundStatus: "cancelled",
    cashRefundOwedPiasters: 0,
    sellableRestoredCostPiasters: 11_000,
  });
  expect(afterCancellation.body.summary).toMatchObject({
    merchandiseRefundPiasters: 0,
    knownNetMerchandiseCostPiasters: 0,
    merchandiseGrossProfitPiasters: 25_000,
  });
  expect(afterCancellation.body.inventory).toMatchObject({
    availableQuantity: 1,
    availableValuePiasters: 11_000,
  });
});

test("FIFO return cost, original branch and employee attribution change exactly once through correction and cancellation", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const employee = await createEmployee(manager, `edge.cashier.${crypto.randomUUID().slice(0, 8)}`);
  const cashier = await signIn(employee.loginName, "staff-pass-edge");
  await selectBranch(cashier, abshwayId);
  const { variantIds } = await seedProduct(manager, [50_000], "تكلفة FIFO");
  const variantId = variantIds[0]!;

  at("2026-09-16T08:00:00.000Z");
  const oldest = await receive(manager, variantId, 1, 10_000, "2026-09-14");
  at("2026-09-16T08:30:00.000Z");
  await receive(manager, variantId, 1, 20_000, "2026-09-15");
  const sale = await completeSale(cashier, [{ variantId, quantity: 2 }], {
    occurredAt: "2026-09-16T09:00:00.000Z",
  });
  const source = await returnSource(manager, sale.body.id);

  at("2026-09-16T10:00:00.000Z");
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 50_000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: drafted.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  expect(posted.body.restorations).toEqual([
    expect.objectContaining({ batchId: oldest.body.lines[0].batchId, quantity: 1, unitCostPiasters: 10_000 }),
  ]);
  const paymentOperationId = crypto.randomUUID();
  const paid = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/refund`, {
    operationId: paymentOperationId,
    status: "paid",
    amountPiasters: 50_000,
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);

  const initial = await managementReport(manager);
  expect(initial.body.summary).toMatchObject({
    grossMerchandiseSalesPiasters: 100_000,
    merchandiseRefundPiasters: 50_000,
    netMerchandiseSalesPiasters: 50_000,
    knownNetMerchandiseCostPiasters: 20_000,
    merchandiseGrossProfitPiasters: 30_000,
  });
  expect(initial.body.refunds[0]).toMatchObject({
    returnId: drafted.body.id,
    originalBranchId: abshwayId,
    handlingBranchId: fayoumId,
    authorizedRefund: { merchandisePiasters: 50_000, totalPiasters: 50_000 },
    sellableRestoredCostPiasters: 10_000,
    actualRefundPaidPiasters: 50_000,
    cashRefundStatus: "paid",
    cashRefundOwedPiasters: 0,
  });
  expect(initial.body.byBranch.find((row: ReportBranch) => row.branch.id === abshwayId)).toMatchObject({
    grossMerchandiseSalesPiasters: 100_000,
    merchandiseRefundPiasters: 50_000,
  });
  expect(initial.body.byBranch.find((row: ReportBranch) => row.branch.id === fayoumId)).toMatchObject({
    grossMerchandiseSalesPiasters: 0,
    merchandiseRefundPiasters: 0,
  });
  expect(initial.body.byEmployee).toContainEqual(expect.objectContaining({
    staffId: employee.id,
    grossMerchandiseSalesPiasters: 100_000,
    merchandiseRefundPiasters: 50_000,
  }));

  const handledBranchOnly = await managementReport(manager, `&branchId=${fayoumId}`);
  expect(handledBranchOnly.body.pageInfo).toMatchObject({ totalCompletedSales: 0, totalRefunds: 0 });
  expect(handledBranchOnly.body.refunds).toEqual([]);

  const correctionDetail = await api(manager, "GET", `/api/internal/corrections/returns/${drafted.body.id}`);
  expect(correctionDetail.status, JSON.stringify(correctionDetail.body)).toBe(200);
  const returnLineId = correctionDetail.body.original.lines[0].returnLineId as string;
  const corrected = await api(manager, "POST", `/api/internal/corrections/returns/${drafted.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "correction",
    reason: "الفحص النهائي أثبت أن القطعة غير قابلة للبيع",
    effective: {
      authorizedRefundPiasters: 40_000,
      lines: [{ lineId: returnLineId, quantity: 1, sellableQuantity: 0 }],
    },
    merchandise: [{ lineId: returnLineId, quantityDelta: -1 }],
    cash: { direction: "recovered", amountPiasters: 10_000 },
  });
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(201);

  const afterCorrection = await managementReport(manager);
  expect(afterCorrection.body.summary).toMatchObject({
    merchandiseRefundPiasters: 40_000,
    netMerchandiseSalesPiasters: 60_000,
    knownNetMerchandiseCostPiasters: 30_000,
    merchandiseGrossProfitPiasters: 30_000,
  });
  expect(afterCorrection.body.refunds[0]).toMatchObject({
    correctionRevision: 1,
    authorizedRefund: { merchandisePiasters: 40_000, totalPiasters: 40_000 },
    sellableRestoredCostPiasters: 0,
    actualRefundPaidPiasters: 40_000,
    cashRefundStatus: "paid",
    cashRefundOwedPiasters: 0,
  });

  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${drafted.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    type: "cancellation",
    reason: "إلغاء تسجيل المرتجع الخاطئ",
    effective: null,
    merchandise: [],
    cash: { direction: "recovered", amountPiasters: 40_000 },
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const afterCancellation = await managementReport(manager);
  expect(afterCancellation.body.summary).toMatchObject({
    grossMerchandiseSalesPiasters: 100_000,
    merchandiseRefundPiasters: 0,
    netMerchandiseSalesPiasters: 100_000,
    knownNetMerchandiseCostPiasters: 30_000,
    merchandiseGrossProfitPiasters: 70_000,
  });
  expect(afterCancellation.body.refunds[0]).toMatchObject({
    effectiveStatus: "cancelled",
    correctionRevision: 2,
    authorizedRefund: { merchandisePiasters: 0, checkoutChargePiasters: 0, totalPiasters: 0 },
    sellableRestoredCostPiasters: 0,
    actualRefundPaidPiasters: 0,
    cashRefundStatus: "cancelled",
    cashRefundOwedPiasters: 0,
  });
});

test("exchange reports full replacement revenue while credit and both cash directions remain settlement only", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [28_000, 32_000, 20_000], "تسويات الاستبدال");
  const [originalVariant, dearerVariant, cheaperVariant] = variantIds as [string, string, string];
  await receive(manager, originalVariant, 2, 10_000, "2026-09-14");
  await receive(manager, dearerVariant, 1, 15_000, "2026-09-15");
  await selectBranch(manager, fayoumId);
  await receive(manager, cheaperVariant, 1, 9_000, "2026-09-15", fayoumId);
  await selectBranch(manager, abshwayId);
  const originalSale = await completeSale(manager, [{ variantId: originalVariant, quantity: 2 }], {
    occurredAt: "2026-09-16T09:00:00.000Z",
  });

  const firstSource = await returnSource(manager, originalSale.body.id);
  const dearerDraft = await draftReturn(manager, {
    saleId: originalSale.body.id,
    sourceSaleLineId: firstSource.lines[0].saleLineId,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 28_000,
  });
  const dearerQuote = await exchangeQuote(manager, dearerDraft.body.id, dearerDraft.body.revision, dearerVariant);
  expect(dearerQuote.body).toMatchObject({
    replacementMerchandisePiasters: 32_000,
    creditAppliedPiasters: 28_000,
    cashCollectedPiasters: 4_000,
    cashRefundPiasters: 0,
  });
  const dearerExchange = await completeExchange(manager, dearerDraft, dearerQuote, "owed");
  expect(dearerExchange.body.exchange).toMatchObject({
    replacementSaleId: dearerQuote.body.settlement.replacementSaleId,
    replacementMerchandisePiasters: 32_000,
    creditAppliedPiasters: 28_000,
    cashCollectedPiasters: 4_000,
    cashRefund: { owedPiasters: 0, paidPiasters: 0 },
  });

  const secondSource = await returnSource(manager, originalSale.body.id);
  expect(secondSource.lines[0].remainingQuantity).toBe(1);
  const cheaperDraft = await draftReturn(manager, {
    saleId: originalSale.body.id,
    sourceSaleLineId: secondSource.lines[0].saleLineId,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 28_000,
  });
  const cheaperQuote = await exchangeQuote(manager, cheaperDraft.body.id, cheaperDraft.body.revision, cheaperVariant);
  expect(cheaperQuote.body).toMatchObject({
    replacementMerchandisePiasters: 20_000,
    creditAppliedPiasters: 20_000,
    cashCollectedPiasters: 0,
    cashRefundPiasters: 8_000,
  });
  const cheaperExchange = await completeExchange(manager, cheaperDraft, cheaperQuote, "owed");
  expect(cheaperExchange.body.exchange).toMatchObject({
    replacementSaleId: cheaperQuote.body.settlement.replacementSaleId,
    replacementMerchandisePiasters: 20_000,
    creditAppliedPiasters: 20_000,
    cashCollectedPiasters: 0,
    cashRefund: { status: "owed", owedPiasters: 8_000, paidPiasters: 0 },
  });

  const owedReport = await managementReport(manager);
  expect(owedReport.status, JSON.stringify(owedReport.body)).toBe(200);
  expect(owedReport.body.summary).toMatchObject({
    completedCount: 3,
    grossFinalSalesPiasters: 108_000,
    grossMerchandiseSalesPiasters: 108_000,
    merchandiseRefundPiasters: 56_000,
    netMerchandiseSalesPiasters: 52_000,
    knownNetMerchandiseCostPiasters: 44_000,
    merchandiseGrossProfitPiasters: 8_000,
  });
  expect(owedReport.body.completedSales.find((sale: ReportSale) =>
    sale.source.id === dearerQuote.body.settlement.replacementSaleId)).toMatchObject({
    effectiveMerchandisePiasters: 32_000,
    effectiveFinalPiasters: 32_000,
  });
  expect(owedReport.body.completedSales.find((sale: ReportSale) =>
    sale.source.id === cheaperQuote.body.settlement.replacementSaleId)).toMatchObject({
    effectiveMerchandisePiasters: 20_000,
    effectiveFinalPiasters: 20_000,
  });
  expect(owedReport.body.refunds.find((refund: ReportRefund) => refund.returnId === dearerDraft.body.id)?.exchange).toEqual({
    replacementSaleId: dearerQuote.body.settlement.replacementSaleId,
    replacementMerchandisePiasters: 32_000,
    creditAppliedPiasters: 28_000,
    cashCollectedPiasters: 4_000,
    cashRefundPaidPiasters: 0,
    cashRefundOwedPiasters: 0,
  });
  expect(owedReport.body.refunds.find((refund: ReportRefund) => refund.returnId === cheaperDraft.body.id)?.exchange).toEqual({
    replacementSaleId: cheaperQuote.body.settlement.replacementSaleId,
    replacementMerchandisePiasters: 20_000,
    creditAppliedPiasters: 20_000,
    cashCollectedPiasters: 0,
    cashRefundPaidPiasters: 0,
    cashRefundOwedPiasters: 8_000,
  });
  expect(owedReport.body.refunds.find((refund: ReportRefund) => refund.returnId === cheaperDraft.body.id)).toMatchObject({
    cashRefundStatus: "owed",
    cashRefundOwedPiasters: 8_000,
  });

  const paid = await api(manager, "POST", `/api/internal/returns/${cheaperDraft.body.id}/refund`, {
    operationId: crypto.randomUUID(),
    status: "paid",
    amountPiasters: 8_000,
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  const paidReport = await managementReport(manager);
  expect(paidReport.body.summary).toMatchObject({
    grossMerchandiseSalesPiasters: 108_000,
    merchandiseRefundPiasters: 56_000,
    netMerchandiseSalesPiasters: 52_000,
  });
  expect(paidReport.body.refunds.find((refund: ReportRefund) => refund.returnId === cheaperDraft.body.id)).toMatchObject({
    actualRefundPaidPiasters: 8_000,
    cashRefundStatus: "paid",
    cashRefundOwedPiasters: 0,
    exchange: { cashRefundPaidPiasters: 8_000, cashRefundOwedPiasters: 0 },
  });
});

test("a cancelled discounted sale retains accepted facts while every effective amount and cost is zero", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [30_000], "بيع ملغى");
  const variantId = variantIds[0]!;
  await receive(manager, variantId, 1, 12_000, "2026-09-16");
  const sale = await completeSale(manager, [{ variantId, quantity: 1 }], {
    occurredAt: "2026-09-16T09:00:00.000Z",
    employeeDiscountPiasters: 5_000,
    discountReason: "خصم محفوظ بعد الإلغاء",
  });
  const correctionSource = await api(manager, "GET", `/api/internal/corrections/sales/${sale.body.id}`);
  expect(correctionSource.status, JSON.stringify(correctionSource.body)).toBe(200);
  const cancelled = await api(manager, "POST", `/api/internal/corrections/sales/${sale.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "إلغاء سجل بيع مكرر",
    effective: null,
    merchandise: [{ lineId: correctionSource.body.original.lines[0].saleLineId, quantityDelta: 1 }],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const report = await managementReport(manager);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.pageInfo.totalCompletedSales).toBe(1);
  expect(report.body.summary).toMatchObject({
    completedCount: 0,
    grossFinalSalesPiasters: 0,
    grossMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: 0,
    merchandiseGrossProfitPiasters: 0,
    costsIncomplete: false,
    unresolvedCostQuantity: 0,
  });
  expect(report.body.completedSales).toEqual([
    expect.objectContaining({
      source: expect.objectContaining({ id: sale.body.id }),
      effectiveStatus: "cancelled",
      correctionRevision: 1,
      accepted: expect.objectContaining({
        originalPiasters: 30_000,
        employeeDiscountPiasters: 5_000,
        employeeDiscountReason: "خصم محفوظ بعد الإلغاء",
      }),
      effectiveMerchandisePiasters: 0,
      effectiveFinalPiasters: 0,
      knownCostPiasters: 0,
      unresolvedCostQuantity: 0,
      costsIncomplete: false,
      lines: [],
    }),
  ]);
  expect(report.body.inventory).toMatchObject({
    availableQuantity: 1,
    availableValuePiasters: 12_000,
    unresolvedCostQuantity: 0,
    costsIncomplete: false,
  });
});

test("a sale cancelled without a stock reversal keeps its consumed batch cost while revenue stays zero", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [30_000], "بيع ملغى دون إرجاع مخزون");
  const variantId = variantIds[0]!;
  await receive(manager, variantId, 1, 12_000, "2026-09-16");
  const sale = await completeSale(manager, [{ variantId, quantity: 1 }], {
    occurredAt: "2026-09-16T09:00:00.000Z",
  });
  const cancelled = await api(manager, "POST", `/api/internal/corrections/sales/${sale.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "إلغاء قيمة البيع مع بقاء البضاعة خارج المخزون",
    effective: null,
    merchandise: [],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const report = await managementReport(manager);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary).toMatchObject({
    completedCount: 0,
    grossFinalSalesPiasters: 0,
    grossMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: 12_000,
    merchandiseGrossProfitPiasters: -12_000,
    costsIncomplete: false,
    unresolvedCostQuantity: 0,
  });
  expect(report.body.byChannel.find((row: { channel: string }) => row.channel === "physical")).toMatchObject({
    completedCount: 0,
    knownNetMerchandiseCostPiasters: 12_000,
    grossProfitPiasters: -12_000,
  });
  expect(report.body.byBranch.find((row: { branch: { id: string } }) => row.branch.id === abshwayId)).toMatchObject({
    completedCount: 0,
    knownNetMerchandiseCostPiasters: 12_000,
  });
  expect(report.body.completedSales).toEqual([
    expect.objectContaining({
      source: expect.objectContaining({ id: sale.body.id }),
      effectiveStatus: "cancelled",
      effectiveMerchandisePiasters: 0,
      effectiveFinalPiasters: 0,
      knownCostPiasters: 12_000,
      lines: [],
    }),
  ]);
  expect(report.body.inventory).toMatchObject({ availableQuantity: 0, availableValuePiasters: 0 });
});

test("a late unallocated sale cancelled without a stock reversal keeps its unknown cost visibly incomplete", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [25_000], "إلغاء بيع متأخر");
  const variantId = variantIds[0]!;

  at("2026-09-16T08:15:00.000Z");
  await receive(manager, variantId, 1, 9_000, "2026-09-16");
  const latePayload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt: "2026-09-16T09:00:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", latePayload);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  await completeSale(manager, [{ variantId, quantity: 1 }], { occurredAt: "2026-09-16T09:05:00.000Z" });
  const late = await api(manager, "POST", "/api/internal/sales", { ...latePayload, physicallyCompleted: true });
  expect(late.status, JSON.stringify(late.body)).toBe(201);
  expect(late.body).toMatchObject({ costsIncomplete: true, lines: [{ allocatedQuantity: 0, unallocatedQuantity: 1 }] });

  at("2026-09-16T10:00:00.000Z");
  const cancelled = await api(manager, "POST", `/api/internal/corrections/sales/${latePayload.saleId}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "إلغاء قيمة بيع متأخر دون حركة مخزون",
    effective: null,
    merchandise: [],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const report = await managementReport(manager);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary).toMatchObject({
    completedCount: 1,
    grossMerchandiseSalesPiasters: 25_000,
    knownNetMerchandiseCostPiasters: 9_000,
    merchandiseGrossProfitPiasters: null,
    costsIncomplete: true,
    unresolvedCostQuantity: 1,
  });
  expect(report.body.completedSales.find((sale: ReportSale) => sale.source.id === latePayload.saleId)).toMatchObject({
    effectiveStatus: "cancelled",
    effectiveMerchandisePiasters: 0,
    knownCostPiasters: 0,
    unresolvedCostQuantity: 1,
    costsIncomplete: true,
  });
});

test("online confirmation and each cancellation reversal use their own Cairo day and fulfillment branch", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [30_000], "توقيت طلبات الفروع", "available");
  const variantId = variantIds[0]!;
  await receive(manager, variantId, 1, 12_000, "2026-09-16");
  await selectBranch(manager, fayoumId);
  await receive(manager, variantId, 2, 8_000, "2026-09-16", fayoumId);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${crypto.randomUUID().slice(0, 8)}`, feePiasters: 5_000, active: true,
  });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const cancelledOrder = await submitOnlineOrderForReport(area.body.id, variantId, 1);
  const failedOrder = await submitOnlineOrderForReport(area.body.id, variantId, 2);

  const pending = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-16&channel=online");
  expect(pending.status, JSON.stringify(pending.body)).toBe(200);
  expect(pending.body.summary).toMatchObject({ completedCount: 0, grossFinalSalesPiasters: 0 });

  at("2026-09-16T10:00:00.000Z");
  const firstConfirmed = await confirmOnlineOrderForReport(manager, cancelledOrder.orderId, variantId, 1, abshwayId);
  const secondConfirmed = await confirmOnlineOrderForReport(manager, failedOrder.orderId, variantId, 2, fayoumId);
  const confirmationDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-16&channel=online");
  expect(confirmationDay.status, JSON.stringify(confirmationDay.body)).toBe(200);
  expect(confirmationDay.body.summary).toMatchObject({
    completedCount: 2, grossFinalSalesPiasters: 100_000, grossMerchandiseSalesPiasters: 90_000,
    deliveryChargesPiasters: 10_000, knownNetMerchandiseCostPiasters: 28_000,
  });
  expect(confirmationDay.body.completedSales).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: expect.objectContaining({ id: cancelledOrder.orderId }),
      branch: expect.objectContaining({ id: abshwayId }), occurredAt: "2026-09-16T10:00:00.000Z" }),
    expect.objectContaining({ source: expect.objectContaining({ id: failedOrder.orderId }),
      branch: expect.objectContaining({ id: fayoumId }) }),
  ]));
  expect(confirmationDay.body.lowStock).toEqual(expect.arrayContaining([
    expect.objectContaining({ branchId: abshwayId, variantId, availableQuantity: 0 }),
    expect.objectContaining({ branchId: fayoumId, variantId, availableQuantity: 0 }),
  ]));
  const abshwayConfirmation = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-16&channel=online&branchId=${abshwayId}`);
  expect(abshwayConfirmation.body.summary).toMatchObject({ completedCount: 1, grossFinalSalesPiasters: 35_000 });
  const fayoumConfirmation = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-16&channel=online&branchId=${fayoumId}`);
  expect(fayoumConfirmation.body.summary).toMatchObject({ completedCount: 1, grossFinalSalesPiasters: 65_000 });

  at("2026-09-17T10:00:00.000Z");
  const cancellationPayload = { operationId: crypto.randomUUID(), expectedRevision: firstConfirmed.revision,
    reason: "إلغاء قبل الشحن", itemsReturnedAndInspected: true };
  const cancelled = await api(manager, "POST",
    `/api/internal/online-orders/${cancelledOrder.orderId}/cancel-before-shipment`, cancellationPayload);
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  const cancellationReplay = await api(manager, "POST",
    `/api/internal/online-orders/${cancelledOrder.orderId}/cancel-before-shipment`, cancellationPayload);
  expect(cancellationReplay.status, JSON.stringify(cancellationReplay.body)).toBe(200);
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${failedOrder.orderId}/ship`, {
    operationId: crypto.randomUUID(), expectedRevision: secondConfirmed.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  const failed = await api(manager, "POST", `/api/internal/online-orders/${failedOrder.orderId}/delivery-failure`, {
    operationId: crypto.randomUUID(), expectedRevision: shipped.body.result.revision,
    reason: "لم يستلم العميل الطرد",
  });
  expect(failed.status, JSON.stringify(failed.body)).toBe(201);
  const cancellationDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-17&channel=online");
  expect(cancellationDay.status, JSON.stringify(cancellationDay.body)).toBe(200);
  expect(cancellationDay.body.summary).toMatchObject({
    completedCount: 0, grossFinalSalesPiasters: -100_000, grossMerchandiseSalesPiasters: -90_000,
    deliveryChargesPiasters: -10_000, knownNetMerchandiseCostPiasters: -12_000,
  });
  expect(cancellationDay.body.completedSales).toEqual([]);
  const abshwayCancellation = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-17&channel=online&branchId=${abshwayId}`);
  expect(abshwayCancellation.body.summary.grossFinalSalesPiasters).toBe(-35_000);
  const fayoumShipment = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-17&channel=online&branchId=${fayoumId}`);
  expect(fayoumShipment.body.summary.grossFinalSalesPiasters).toBe(-65_000);

  at("2026-09-18T10:00:00.000Z");
  const drafted = await api(manager, "POST", `/api/internal/online-orders/${failedOrder.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: failed.body.result.revision,
    lines: [{ variantId, receivedQuantity: 2, sellableQuantity: 1 }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const inspectionId = drafted.body.result.failedReturnInspections.find((item: { status: string }) => item.status === "draft")?.id;
  expect(inspectionId).toBeTruthy();
  const posted = await api(manager, "POST",
    `/api/internal/online-orders/${failedOrder.orderId}/failed-return-inspections/${inspectionId}/post`, {
      operationId: crypto.randomUUID(), expectedRevision: drafted.body.result.revision,
      receivingBranchId: fayoumId,
    });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  const inspectionDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-18&channel=online");
  expect(inspectionDay.status, JSON.stringify(inspectionDay.body)).toBe(200);
  expect(inspectionDay.body.summary).toMatchObject({
    completedCount: 0, grossFinalSalesPiasters: 0, grossMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: -8_000,
  });

  at("2026-09-19T10:00:00.000Z");
  const closurePayload = { operationId: crypto.randomUUID(), expectedRevision: posted.body.result.revision,
    reason: "فحص الطرد المرتجع" };
  const closed = await api(manager, "POST",
    `/api/internal/online-orders/${failedOrder.orderId}/close-failed-delivery`, closurePayload);
  expect(closed.status, JSON.stringify(closed.body)).toBe(201);
  const closureReplay = await api(manager, "POST",
    `/api/internal/online-orders/${failedOrder.orderId}/close-failed-delivery`, closurePayload);
  expect(closureReplay.status, JSON.stringify(closureReplay.body)).toBe(200);
  const closureDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-19&channel=online");
  expect(closureDay.status, JSON.stringify(closureDay.body)).toBe(200);
  expect(closureDay.body.summary).toMatchObject({
    completedCount: 0, grossFinalSalesPiasters: 0, grossMerchandiseSalesPiasters: 0,
    deliveryChargesPiasters: 0, knownNetMerchandiseCostPiasters: 0,
  });
  const fayoumClosure = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-19&channel=online&branchId=${fayoumId}`);
  expect(fayoumClosure.body.summary.grossFinalSalesPiasters).toBe(0);
  const abshwayClosure = await api(manager, "GET",
    `/api/internal/reports/management?period=day&date=2026-09-19&channel=online&branchId=${abshwayId}`);
  expect(abshwayClosure.body.summary.grossFinalSalesPiasters).toBe(0);
  const month = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-09&channel=online");
  expect(month.body.summary).toMatchObject({
    completedCount: 2, grossFinalSalesPiasters: 0, grossMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: 8_000, merchandiseGrossProfitPiasters: -8_000,
  });
});

test("cancellation awaiting physical inspection keeps protected cost until sellable stock is received", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const { variantIds } = await seedProduct(manager, [30_000], "فحص إلغاء الطلب", "available");
  const variantId = variantIds[0]!;
  await receive(manager, variantId, 1, 12_000, "2026-09-16");
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${crypto.randomUUID().slice(0, 8)}`, feePiasters: 5_000, active: true,
  });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const order = await submitOnlineOrderForReport(area.body.id, variantId, 1);
  const confirmed = await confirmOnlineOrderForReport(manager, order.orderId, variantId, 1, abshwayId);

  at("2026-09-17T10:00:00.000Z");
  const cancelled = await api(manager, "POST", `/api/internal/online-orders/${order.orderId}/cancel-before-shipment`, {
    operationId: crypto.randomUUID(), expectedRevision: confirmed.revision, reason: "إلغاء مع بقاء القطعة قيد الفحص",
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  expect(cancelled.body.result).toMatchObject({ status: "cancelled_before_shipment",
    preShipmentStockDisposition: "awaiting_inspection" });
  const cancellationDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-17&channel=online");
  expect(cancellationDay.status, JSON.stringify(cancellationDay.body)).toBe(200);
  expect(cancellationDay.body.summary).toMatchObject({
    completedCount: 0, grossFinalSalesPiasters: -35_000, grossMerchandiseSalesPiasters: -30_000,
    knownNetMerchandiseCostPiasters: 0,
  });
  expect(cancellationDay.body.inventory).toMatchObject({
    availableQuantity: 0, protectedQuantity: 1, protectedValuePiasters: 12_000,
  });

  at("2026-09-18T10:00:00.000Z");
  const drafted = await api(manager, "POST", `/api/internal/online-orders/${order.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: cancelled.body.result.revision,
    lines: [{ variantId, receivedQuantity: 1, sellableQuantity: 1 }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const inspectionId = drafted.body.result.failedReturnInspections.find((item: { status: string }) => item.status === "draft")?.id;
  expect(inspectionId).toBeTruthy();
  const posted = await api(manager, "POST",
    `/api/internal/online-orders/${order.orderId}/failed-return-inspections/${inspectionId}/post`, {
      operationId: crypto.randomUUID(), expectedRevision: drafted.body.result.revision,
      receivingBranchId: abshwayId,
    });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  expect(posted.body.result.preShipmentStockDisposition).toBe("released");
  const inspectionDay = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-18&channel=online");
  expect(inspectionDay.status, JSON.stringify(inspectionDay.body)).toBe(200);
  expect(inspectionDay.body.summary).toMatchObject({
    completedCount: 0, grossFinalSalesPiasters: 0, grossMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: -12_000,
  });
  expect(inspectionDay.body.inventory).toMatchObject({
    availableQuantity: 1, protectedQuantity: 0, protectedValuePiasters: 0,
  });
});

async function submitOnlineOrderForReport(deliveryAreaId: string, variantId: string, quantity: number) {
  const quote = await api(undefined, "POST", "/api/public/checkout/quote", {
    deliveryAreaId, lines: [{ variantId, quantity }],
  }, "http://127.0.0.1:3000");
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submitted = await api(undefined, "POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(), quoteId: quote.body.quoteId, deliveryAreaId,
    lines: [{ variantId, quantity }], customerName: "عميل التقرير", primaryPhone: "01012345678",
    detailedAddress: "عنوان التقرير",
  }, "http://127.0.0.1:3000");
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return submitted.body as { orderId: string; reference: string };
}

async function confirmOnlineOrderForReport(manager: Session, orderId: string, variantId: string,
  quantity: number, fulfillmentBranchId: string) {
  const review = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: 1, lines: [{ variantId, quantity }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest, customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(), expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision, fulfillmentBranchId, itemsLocatedAndSetAside: true,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  return confirmed.body;
}

function at(value: string) {
  now = new Date(value);
}

async function managementReport(manager: Session, suffix = "") {
  return api(manager, "GET", `/api/internal/reports/management?period=month&month=2026-09&detailPage=1&detailPageSize=100${suffix}`);
}

async function selectBranch(session: Session, branchId: string) {
  const selected = await api(session, "POST", "/api/internal/active-branch", { branchId });
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);
}

async function createEmployee(manager: Session, loginName: string) {
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "موظف حواف التقارير",
    password: "staff-pass-edge",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { id: created.body.id as string, loginName };
}

async function seedProduct(manager: Session, prices: number[], label: string,
  publication: "available" | "hidden" = "hidden") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `${label} ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  expect(category.status).toBe(201);
  expect(size.status).toBe(201);
  const variants: Array<{ sizeId: string; colorId: string; sellingPricePiastersOverride: number }> = [];
  for (const [index, price] of prices.entries()) {
    const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix} ${index}` });
    expect(color.status).toBe(201);
    variants.push({ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: price });
  }
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `EDGE-${suffix}`,
    nameAr: label,
    descriptionAr: "اختبار حواف التقرير",
    categoryId: category.body.id,
    defaultSellingPricePiasters: prices[0],
    publication,
    imageRefs: [],
    variants,
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  return {
    productId: product.body.id as string,
    variantIds: product.body.variants.map((variant: { id: string }) => variant.id) as string[],
  };
}

async function receive(
  manager: Session,
  variantId: string,
  quantity: number,
  unitCostPiasters: number,
  receiptDate: string,
  branchId = abshwayId,
) {
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate,
    lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  return received;
}

async function completeSale(
  session: Session,
  lines: Array<{ variantId: string; quantity: number }>,
  options: { occurredAt: string; employeeDiscountPiasters?: number; discountReason?: string },
) {
  const completed = await api(session, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: options.occurredAt,
    employeeDiscountPiasters: options.employeeDiscountPiasters ?? 0,
    ...(options.discountReason ? { discountReason: options.discountReason } : {}),
    lines,
  });
  expect(completed.status, JSON.stringify(completed.body)).toBe(201);
  return completed;
}

async function returnSource(manager: Session, saleId: string) {
  const source = await api(manager, "GET", `/api/internal/returns/sources?reference=${saleId}`);
  expect(source.status, JSON.stringify(source.body)).toBe(200);
  expect(source.body).toHaveLength(1);
  return source.body[0];
}

async function draftReturn(manager: Session, input: {
  saleId: string;
  sourceSaleLineId: string;
  handlingBranchId: string;
  authorizedRefundPiasters: number;
}) {
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: input.saleId,
    handlingBranchId: input.handlingBranchId,
    authorizedRefundPiasters: input.authorizedRefundPiasters,
    lines: [{ sourceSaleLineId: input.sourceSaleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  return drafted;
}

async function exchangeQuote(manager: Session, returnId: string, expectedRevision: number, variantId: string) {
  const quoted = await api(manager, "POST", `/api/internal/returns/${returnId}/exchange-quote`, {
    quoteId: crypto.randomUUID(),
    exchangeId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    replacementSaleId: crypto.randomUUID(),
    replacementSaleOperationId: crypto.randomUUID(),
    expectedRevision,
    replacementLines: [{ variantId, quantity: 1 }],
  });
  expect(quoted.status, JSON.stringify(quoted.body)).toBe(201);
  return quoted;
}

async function completeExchange(
  manager: Session,
  drafted: ApiResult,
  quoted: ApiResult,
  cashRefundStatus: "owed" | "paid",
) {
  const exchanged = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, {
    ...quoted.body.settlement,
    quoteId: quoted.body.id,
    receivedAndInspected: true,
    expectedRevision: drafted.body.revision,
    cashRefundStatus,
  });
  expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(201);
  return exchanged;
}

type ReportSale = { source: { id: string } };
type ReportRefund = { returnId: string; exchange: unknown };
type ReportBranch = { branch: { id: string } };
type ApiResult = { status: number; body: any };
type Session = { cookie: string };

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST", url: string, payload?: unknown,
  origin = ORIGIN): Promise<ApiResult> {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}
