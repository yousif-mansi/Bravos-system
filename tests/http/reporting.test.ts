import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { parseReportingPeriod } from "../../packages/reporting/src/domain/period.ts";
import { checkedAdd, checkedMultiply } from "../../packages/reporting/src/domain/arithmetic.ts";
import { ReportingExportLimitError, ReportingValidationError } from "@bravos/reporting";

const ORIGIN = "http://127.0.0.1:5173";
const NOW = new Date("2026-09-16T12:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => { cluster = await startPostgresCluster({ port: 55464 }); }, 120_000);
afterAll(async () => { if (built) await built.close(); await cluster.stop(); });
beforeEach(async () => {
  if (built) await built.close();
  const database = `bravos_reporting_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(database),
    authSecret: "reporting-secret-reporting-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-reporting-outbox-")),
    businessClock: () => NOW,
  });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='abshway'"))
    .rows[0]!.id;
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مدير التقارير",
    password: "owner-pass-1",
  });
});

test("manager report composes effective revenue, retained batch costs, returns and corrected expenses once", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const employee = await createEmployee(manager, "report.cashier");
  const cashier = await signIn("report.cashier", "staff-pass-23");
  await expectOk(await api(cashier, "POST", "/api/internal/active-branch", { branchId }));
  const variants = await seedProduct(manager);

  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: "2026-09-16",
    lines: [
      { variantId: variants.first, quantity: 1, unitCostPiasters: 14000 },
      { variantId: variants.second, quantity: 1, unitCostPiasters: 9000 },
    ],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const correctedReceipt = await api(manager, "POST", `/api/internal/receiving/receipts/${receipt.body.id}/corrections`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    reason: "تصحيح تكلفة الدفعة الأولى",
    lines: [
      { lineId: receipt.body.lines[0].id, quantity: 1, unitCostPiasters: 15000 },
      { lineId: receipt.body.lines[1].id, quantity: 1, unitCostPiasters: 9000 },
    ],
  });
  expect(correctedReceipt.status, JSON.stringify(correctedReceipt.body)).toBe(201);

  const saleId = crypto.randomUUID();
  const sale = await api(cashier, "POST", "/api/internal/sales", {
    saleId,
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: "2026-09-16T09:00:00.000Z",
    employeeDiscountPiasters: 5000,
    lines: [{ variantId: variants.first, quantity: 1 }, { variantId: variants.second, quantity: 1 }],
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  expect(sale.body).toMatchObject({
    id: saleId,
    originalTotalPiasters: 50000,
    employeeDiscountPiasters: 5000,
    finalTotalPiasters: 45000,
  });
  expect(sale.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((left: number, right: number) => left - right))
    .toEqual([17500, 27500]);

  const source = await api(manager, "GET", `/api/internal/returns/sources?reference=${saleId}`);
  expect(source.status, JSON.stringify(source.body)).toBe(200);
  const firstSourceLine = source.body[0].lines.find((line: { variantId: string }) => line.variantId === variants.first);
  const returnId = crypto.randomUUID();
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId,
    operationId: crypto.randomUUID(),
    sourceSaleId: saleId,
    handlingBranchId: branchId,
    authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: firstSourceLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  const paid = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: crypto.randomUUID(),
    status: "paid",
    amountPiasters: 28000,
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);

  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "تشغيل التقرير" });
  expect(category.status).toBe(201);
  const expense = await api(cashier, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 2500,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: "مصروف الفرع",
  });
  expect(expense.status, JSON.stringify(expense.body)).toBe(201);
  const correctedExpense = await api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "correction",
    reason: "تصحيح قيمة المصروف",
    amountPiasters: 2000,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: "مصروف الفرع",
  });
  expect(correctedExpense.status, JSON.stringify(correctedExpense.body)).toBe(201);
  const cancelledExpense = await api(cashier, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 3000,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: "مصروف ملغى يبقى في سجل التدقيق",
  });
  expect(cancelledExpense.status, JSON.stringify(cancelledExpense.body)).toBe(201);
  const cancelledExpenseChange = await api(manager, "POST", `/api/internal/expenses/${cancelledExpense.body.id}/changes`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "لم يحدث المصروف",
  });
  expect(cancelledExpenseChange.status, JSON.stringify(cancelledExpenseChange.body)).toBe(201);

  const unauthorized = await api(cashier, "GET", "/api/internal/reports/management?period=today");
  expect(unauthorized.status).toBe(403);
  expect(unauthorized.body.error.code).toBe("FORBIDDEN");

  const report = await api(
    manager,
    "GET",
    `/api/internal/reports/management?period=month&month=2026-09&branchId=${branchId}&employeeId=${employee.id}&detailPage=1&detailPageSize=10`,
  );
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body).toMatchObject({
    period: { kind: "month", fromCairoDate: "2026-09-01", toCairoDateInclusive: "2026-09-30" },
    filters: { branchId, channel: "all", employeeId: employee.id },
    pageInfo: {
      page: 1,
      pageSize: 10,
      totalCompletedSales: 1,
      totalRefunds: 1,
      totalPurchases: 1,
      totalExpenses: 2,
      hasMore: false,
    },
    summary: {
      completedCount: 1,
      grossFinalSalesPiasters: 45000,
      grossMerchandiseSalesPiasters: 45000,
      deliveryChargesPiasters: 0,
      merchandiseRefundPiasters: 28000,
      checkoutChargeRefundPiasters: 0,
      netFinalSalesPiasters: 17000,
      netMerchandiseSalesPiasters: 17000,
      knownNetMerchandiseCostPiasters: 9000,
      merchandiseGrossProfitPiasters: 8000,
      effectiveExpensesPiasters: 2000,
      operatingProfitPiasters: 6000,
      purchaseCostPiasters: 24000,
      costsIncomplete: false,
      unresolvedCostQuantity: 0,
    },
    inventory: {
      availableQuantity: 1,
      availableValuePiasters: 15000,
      protectedQuantity: 0,
      protectedValuePiasters: 0,
      unresolvedCostQuantity: 0,
      costsIncomplete: false,
    },
  });
  expect(report.body.completedSales[0]).toMatchObject({
    source: { kind: "physical_sale", id: saleId },
    employee: { staffId: employee.id },
    accepted: { originalPiasters: 50000, employeeDiscountPiasters: 5000 },
    effectiveMerchandisePiasters: 45000,
    knownCostPiasters: 24000,
  });
  expect(report.body.refunds[0]).toMatchObject({
    returnId,
    source: { kind: "physical_sale", id: saleId },
    originalBranchId: branchId,
    handlingBranchId: branchId,
    authorizedRefund: { merchandisePiasters: 28000, checkoutChargePiasters: 0, totalPiasters: 28000 },
    sellableRestoredCostPiasters: 15000,
    actualRefundPaidPiasters: 28000,
    cashRefundStatus: "paid",
    cashRefundOwedPiasters: 0,
    refundCashEvents: [expect.objectContaining({ direction: "paid_out", amountPiasters: 28000 })],
  });
  expect(report.body.purchases.receipts[0]).toMatchObject({
    effectiveQuantity: 2,
    effectiveCostPiasters: 24000,
    corrections: [{ revision: 1, reason: "تصحيح تكلفة الدفعة الأولى", changedByDisplayName: "مدير التقارير" }],
  });
  expect(report.body.expenses.items.find((item: { expenseId: string }) => item.expenseId === expense.body.id)).toMatchObject({
    expenseId: expense.body.id,
    createdByStaffId: employee.id,
    amountPiasters: 2000,
    effectiveStatus: "active",
    correctionRevision: 1,
    corrections: [{ revision: 1, reason: "تصحيح قيمة المصروف" }],
  });
  expect(report.body.expenses.items.find((item: { expenseId: string }) => item.expenseId === cancelledExpense.body.id)).toMatchObject({
    expenseId: cancelledExpense.body.id,
    amountPiasters: 0,
    effectiveStatus: "cancelled",
    correctionRevision: 1,
    corrections: [{ type: "cancellation", revision: 1, reason: "لم يحدث المصروف" }],
  });
  expect(report.body.bestSellers).toEqual([
    expect.objectContaining({ grossEffectiveSoldQuantity: 2, returnedQuantity: 1 }),
  ]);
  expect(report.body.byEmployee).toEqual([
    expect.objectContaining({
      staffId: employee.id,
      completedCount: 1,
      grossMerchandiseSalesPiasters: 45000,
      employeeDiscountPiasters: 5000,
      merchandiseRefundPiasters: 28000,
      effectiveExpensesPiasters: 2000,
    }),
  ]);
});

test("Cairo day boundaries use occurred time and invalid or unauthenticated report requests fail", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const { first } = await seedProduct(manager);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: "2026-09-15",
    lines: [{ variantId: first, quantity: 3, unitCostPiasters: 10000 }],
  });
  expect(received.status).toBe(201);
  await completeSale(manager, first, "2026-09-15T20:59:59.999Z");
  await completeSale(manager, first, "2026-09-15T21:00:00.000Z");
  const cancelledSale = await completeSale(manager, first, "2026-09-15T22:00:00.000Z");
  const correctionSource = await api(manager, "GET", `/api/internal/corrections/sales/${cancelledSale.id}`);
  const cancelled = await api(manager, "POST", `/api/internal/corrections/sales/${cancelledSale.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "سجل مكرر لا يدخل إجماليات التقرير",
    effective: null,
    merchandise: [{ lineId: correctionSource.body.original.lines[0].saleLineId, quantityDelta: 1 }],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);

  const previous = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-15");
  const current = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-16");
  const month = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-09");
  expect(previous.status, JSON.stringify(previous.body)).toBe(200);
  expect(current.status, JSON.stringify(current.body)).toBe(200);
  expect(previous.body.summary.completedCount).toBe(1);
  expect(current.body.summary.completedCount).toBe(1);
  expect(month.status, JSON.stringify(month.body)).toBe(200);
  expect(month.body.summary.completedCount).toBe(2);
  expect(previous.body.completedSales[0].occurredAt).toBe("2026-09-15T20:59:59.999Z");
  expect(current.body.completedSales.find((sale: { effectiveStatus: string }) => sale.effectiveStatus === "active").occurredAt)
    .toBe("2026-09-15T21:00:00.000Z");
  expect(current.body.pageInfo.totalCompletedSales).toBe(2);
  expect(current.body.completedSales).toContainEqual(expect.objectContaining({
    source: expect.objectContaining({ id: cancelledSale.id }),
    effectiveStatus: "cancelled",
    effectiveMerchandisePiasters: 0,
    effectiveFinalPiasters: 0,
    knownCostPiasters: 0,
    correctionRevision: 1,
    corrections: [expect.objectContaining({ reason: "سجل مكرر لا يدخل إجماليات التقرير" })],
  }));

  const firstPage = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-16&detailPage=1&detailPageSize=1");
  const secondPage = await api(manager, "GET", "/api/internal/reports/management?period=day&date=2026-09-16&detailPage=2&detailPageSize=1");
  expect(firstPage.status).toBe(200);
  expect(secondPage.status).toBe(200);
  expect(firstPage.body.pageInfo.hasMore).toBe(true);
  expect(secondPage.body.pageInfo.hasMore).toBe(false);
  expect(new Set([firstPage.body.completedSales[0].source.id, secondPage.body.completedSales[0].source.id]))
    .toEqual(new Set(current.body.completedSales.map((sale: { source: { id: string } }) => sale.source.id)));

  const invalid = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-13");
  expect(invalid.status).toBe(400);
  expect(invalid.body.error.code).toBe("VALIDATION");
  const unauthenticated = await api(undefined, "GET", "/api/internal/reports/management?period=today");
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
  const unsafePage = await api(manager, "GET",
    `/api/internal/reports/management?period=today&detailPage=${Number.MAX_SAFE_INTEGER}&detailPageSize=100`);
  expect(unsafePage.status).toBe(400);
  expect(unsafePage.body.error.code).toBe("VALIDATION");
});

test("Cairo period boundaries remain exact across the 2026 midnight DST gap and overlap", () => {
  const spring = parseReportingPeriod({ period: "day", date: "2026-04-24" }, NOW);
  expect(spring.from.toISOString()).toBe("2026-04-23T22:00:00.000Z");
  expect(spring.to.toISOString()).toBe("2026-04-24T21:00:00.000Z");
  expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * 60 * 60 * 1_000);

  const autumn = parseReportingPeriod({ period: "day", date: "2026-10-29" }, NOW);
  expect(autumn.from.toISOString()).toBe("2026-10-28T21:00:00.000Z");
  expect(autumn.to.toISOString()).toBe("2026-10-29T22:00:00.000Z");
  expect(autumn.to.getTime() - autumn.from.getTime()).toBe(25 * 60 * 60 * 1_000);
});

test("report arithmetic rejects unsafe money and quantity totals", () => {
  expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow(ReportingValidationError);
  expect(() => checkedMultiply(Number.MAX_SAFE_INTEGER, 2)).toThrow(ReportingValidationError);
});

test("export rejects a real matching oversized detail set through the public reporting service", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectManagerBranch(manager);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "حد تصدير التقرير" });
  expect(category.status, JSON.stringify(category.body)).toBe(201);
  const fixture = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 1, expenseDate: "2026-09-16",
    categoryId: category.body.id, description: "سجل حقيقي أساس لاختبار الحد",
  });
  expect(fixture.status, JSON.stringify(fixture.body)).toBe(201);
  const client = await built.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE reporting_export_volume ON COMMIT DROP AS
       SELECT gen_random_uuid() AS expense_id,gen_random_uuid() AS operation_id
       FROM generate_series(1,25000)`,
    );
    await client.query(
      `INSERT INTO expense_operation (
       operation_id,payload_fingerprint,actor_staff_id,operation_type,expense_id,result_revision,recorded_at
     ) SELECT volume.operation_id,'report-export-volume',source.created_by_staff_id,'create',NULL,NULL,source.recorded_at
       FROM reporting_export_volume volume CROSS JOIN expense_record source WHERE source.id=$1`,
      [fixture.body.id],
    );
    await client.query(
      `INSERT INTO expense_record (
       id,operation_id,payload_fingerprint,branch_id,created_by_staff_id,amount_piasters,expense_date,
       category_id,category_name_ar,description,recorded_at
     ) SELECT volume.expense_id,volume.operation_id,'report-export-volume',source.branch_id,
              source.created_by_staff_id,source.amount_piasters,source.expense_date,source.category_id,
              source.category_name_ar,source.description,source.recorded_at
       FROM reporting_export_volume volume CROSS JOIN expense_record source WHERE source.id=$1`,
      [fixture.body.id],
    );
    await client.query(
      `UPDATE expense_operation operation SET expense_id=volume.expense_id,result_revision=0
       FROM reporting_export_volume volume WHERE operation.operation_id=volume.operation_id`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const auth = await built.identity.getVerifiedAuth(manager.cookie);
  expect(auth).not.toBeNull();
  await expect(built.reporting.getManagementReportExportSnapshot(auth,
    { period: "day", date: "2026-09-16" })).rejects.toBeInstanceOf(ReportingExportLimitError);
});

test("confirmed online orders contribute merchandise and delivery once while pending operations stay outside revenue", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectManagerBranch(manager);
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `متجر ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس متجر ${suffix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون متجر ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `ONLINE-${suffix}`,
    nameAr: "منتج أونلاين",
    descriptionAr: "اختبار تسليم التقرير",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 45000,
    publication: "available",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const variantId = product.body.variants[0].id as string;
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: "2026-09-16",
    lines: [{ variantId, quantity: 2, unitCostPiasters: 10000 }],
  });
  expect(receipt.status).toBe(201);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${suffix}`,
    feePiasters: 5000,
    active: true,
  });
  expect(area.status).toBe(201);
  const deliveredOrder = await submitOnlineOrder(area.body.id, variantId, suffix);
  await submitOnlineOrder(area.body.id, variantId, `${suffix}-pending`);
  const review = await api(manager, "POST", `/api/internal/online-orders/${deliveredOrder.orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${deliveredOrder.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${deliveredOrder.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    fulfillmentBranchId: branchId,
    itemsLocatedAndSetAside: true,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  const confirmedReport = await api(manager, "GET", "/api/internal/reports/management?period=today&channel=online");
  expect(confirmedReport.status, JSON.stringify(confirmedReport.body)).toBe(200);
  expect(confirmedReport.body.summary).toMatchObject({
    completedCount: 1, grossFinalSalesPiasters: 50000, grossMerchandiseSalesPiasters: 45000,
    knownNetMerchandiseCostPiasters: 10000,
  });
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${deliveredOrder.orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  const delivered = await api(manager, "POST", `/api/internal/online-orders/${deliveredOrder.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: shipped.body.result.shippedAt,
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);

  const report = await api(manager, "GET", "/api/internal/reports/management?period=today&channel=online");
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary).toMatchObject({
    completedCount: 1,
    grossFinalSalesPiasters: 50000,
    grossMerchandiseSalesPiasters: 45000,
    deliveryChargesPiasters: 5000,
    merchandiseRefundPiasters: 0,
    knownNetMerchandiseCostPiasters: 10000,
    merchandiseGrossProfitPiasters: 35000,
  });
  expect(report.body.completedSales).toEqual([
    expect.objectContaining({
      source: { kind: "delivered_online_order", id: deliveredOrder.orderId, reference: deliveredOrder.reference },
      channel: "online",
      branch: expect.objectContaining({ id: branchId }),
      employee: null,
      effectiveMerchandisePiasters: 45000,
      deliveryChargePiasters: 5000,
      effectiveFinalPiasters: 50000,
      knownCostPiasters: 10000,
    }),
  ]);
  expect(report.body.onlineOrderOperations).toEqual({
    pendingCount: 1,
    confirmedCount: 0,
    shippedCount: 0,
    deliveryFailedCount: 0,
  });
  expect(report.body.inventory).toMatchObject({ availableQuantity: 1, availableValuePiasters: 10000, protectedQuantity: 0 });
  const branchReport = await api(manager, "GET", `/api/internal/reports/management?period=today&channel=online&branchId=${branchId}`);
  expect(branchReport.status, JSON.stringify(branchReport.body)).toBe(200);
  expect(branchReport.body.summary).toMatchObject({ completedCount: 1, grossFinalSalesPiasters: 50000 });
  expect(branchReport.body.byBranch.find((row: { branch: { id: string } }) => row.branch.id === branchId))
    .toMatchObject({ completedCount: 1, grossFinalSalesPiasters: 50000 });
});

test("protected confirmed and in-transit stock stays out of available value while a delivered online return reports its charge refund", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectManagerBranch(manager);
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `محمي ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس محمي ${suffix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون محمي ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `PROTECTED-${suffix}`,
    nameAr: "منتج محمي",
    descriptionAr: "اختبار قيمة المخزون المحمي",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 45000,
    publication: "available",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const variantId = product.body.variants[0].id as string;
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: "2026-09-16",
    lines: [{ variantId, quantity: 3, unitCostPiasters: 10000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة محمية ${suffix}`,
    feePiasters: 5000,
    active: true,
  });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const delivered = await submitOnlineOrder(area.body.id, variantId, `${suffix}-delivered`);
  const confirmedOnly = await submitOnlineOrder(area.body.id, variantId, `${suffix}-confirmed`);
  const inTransit = await submitOnlineOrder(area.body.id, variantId, `${suffix}-shipped`);
  await advanceOnlineOrder(manager, delivered.orderId, variantId, "delivered");
  await advanceOnlineOrder(manager, confirmedOnly.orderId, variantId, "confirmed");
  await advanceOnlineOrder(manager, inTransit.orderId, variantId, "shipped");

  const sources = await api(manager, "GET", `/api/internal/returns/sources?reference=${delivered.orderId}`);
  expect(sources.status, JSON.stringify(sources.body)).toBe(200);
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    source: sources.body[0].source,
    handlingBranchId: branchId,
    authorizedRefund: { merchandisePiasters: 45000, checkoutChargePiasters: 5000 },
    lines: [{ sourceLineId: sources.body[0].lines[0].sourceLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    expectedRevision: draft.body.revision,
    receivedAndInspected: true,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);

  const report = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-09&channel=online");
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary).toMatchObject({
    completedCount: 3,
    grossFinalSalesPiasters: 150000,
    grossMerchandiseSalesPiasters: 135000,
    deliveryChargesPiasters: 15000,
    merchandiseRefundPiasters: 45000,
    checkoutChargeRefundPiasters: 5000,
    netFinalSalesPiasters: 100000,
    netMerchandiseSalesPiasters: 90000,
    knownNetMerchandiseCostPiasters: 20000,
    merchandiseGrossProfitPiasters: 70000,
    costsIncomplete: false,
  });
  expect(report.body.refunds).toEqual([
    expect.objectContaining({
      returnId: draft.body.id,
      channel: "online",
      originalBranchId: branchId,
      handlingBranchId: branchId,
      source: { kind: "delivered_online_order", id: delivered.orderId },
      authorizedRefund: { merchandisePiasters: 45000, checkoutChargePiasters: 5000, totalPiasters: 50000 },
      sellableRestoredCostPiasters: 10000,
    }),
  ]);
  expect(report.body.onlineOrderOperations).toEqual({
    pendingCount: 0,
    confirmedCount: 1,
    shippedCount: 1,
    deliveryFailedCount: 0,
  });
  expect(report.body.inventory).toMatchObject({
    availableQuantity: 1,
    availableValuePiasters: 10000,
    protectedQuantity: 2,
    protectedValuePiasters: 20000,
    unresolvedCostQuantity: 0,
    costsIncomplete: false,
  });
});

async function advanceOnlineOrder(
  manager: Session,
  orderId: string,
  variantId: string,
  target: "confirmed" | "shipped" | "delivered",
) {
  const review = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    fulfillmentBranchId: branchId,
    itemsLocatedAndSetAside: true,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  if (target === "confirmed") return;
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  if (target === "shipped") return;
  const delivered = await api(manager, "POST", `/api/internal/online-orders/${orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: shipped.body.result.shippedAt,
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
}

async function createEmployee(manager: Session, loginName: string) {
  const response = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "موظف التقرير",
    password: "staff-pass-23",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string };
}

async function selectManagerBranch(manager: Session) {
  const response = await api(manager, "POST", "/api/internal/active-branch", { branchId });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function seedProduct(manager: Session) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تقارير ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const firstColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const secondColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `أبيض ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `REP-${suffix}`,
    nameAr: "منتج التقرير",
    descriptionAr: "اختبار التقرير",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: size.body.id, colorId: firstColor.body.id, sellingPricePiastersOverride: 30000 },
      { sizeId: size.body.id, colorId: secondColor.body.id, sellingPricePiastersOverride: 20000 },
    ],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const first = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 30000);
  const second = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 20000);
  if (!first || !second) throw new Error("Expected both reporting variants.");
  return { first: first.id as string, second: second.id as string };
}

async function completeSale(manager: Session, variantId: string, occurredAt: string) {
  const response = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function submitOnlineOrder(deliveryAreaId: string, variantId: string, suffix: string) {
  const quote = await api(undefined, "POST", "/api/public/checkout/quote", {
    deliveryAreaId,
    lines: [{ variantId, quantity: 1 }],
  }, "http://127.0.0.1:3000");
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submitted = await api(undefined, "POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity: 1 }],
    customerName: `عميل ${suffix}`,
    primaryPhone: "01012345678",
    detailedAddress: `عنوان ${suffix}`,
  }, "http://127.0.0.1:3000");
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return submitted.body as { orderId: string; reference: string };
}

async function expectOk(response: { status: number; body: unknown }) {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
}

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

async function api(
  session: Session | undefined,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  origin = ORIGIN,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}
