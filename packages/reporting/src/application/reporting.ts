import type {
  BranchDto, ManagementReportDto, ManagementReportFiltersDto, ReportBestSellerDto,
  ReportBranchBreakdownDto, ReportChannelBreakdownDto, ReportCompletedSaleDto,
  ReportEmployeeBreakdownDto, ReportExpenseDto, ReportPurchaseReceiptDto,
  ReportRefundDto, VariantIdentityDto,
} from "@bravos/contracts";
import type { ReturnCorrectionReportingFact, SaleCorrectionReportingFact } from "@bravos/corrections";
import { ForbiddenError, UnauthenticatedError, isManager } from "@bravos/identity";
import type { BatchRecord, ProtectedOrderAllocationProvenance, ReportingAllocationRecord } from "@bravos/inventory";
import type { ReturnReportingFact, ReturnReportingHeader } from "@bravos/returns";
import type { SaleRecord } from "@bravos/sales";
import { checkedAdd, checkedMultiply, checkedSubtract, checkedSum } from "../domain/arithmetic.ts";
import { ReportingExportLimitError, ReportingPayloadLimitError, ReportingValidationError } from "../domain/errors.ts";
import { parseReportingPeriod } from "../domain/period.ts";
import type { ReportingActorPort, ReportingReadContext, ReportingReadUnitOfWork, ReportingServices, VerifiedAuth } from "./ports.ts";

const HTTP_PAGE_SIZE = 50;
const HTTP_PAGE_SIZE_MAX = 100;
const EXPORT_DETAIL_LIMIT = 25_000;
const READ_PAGE_SIZE = 500;
const HTTP_RETAINED_DETAIL_BYTES = 2 * 1024 * 1024;
const EXPORT_RETAINED_DETAIL_BYTES = 32 * 1024 * 1024;
type DetailPage = { page: number; pageSize: number; exportMode: boolean };
type ComposedReturn = { dto: ReportRefundDto; lines: Array<{ variantId: string; quantity: number }> };
type Period = ReturnType<typeof parseReportingPeriod>;
type SaleAttribution = Awaited<ReturnType<ReportingReadContext["sales"]["getCompletedAttributionsByIds"]>>[number];
type FinancialAccumulator = {
  completedCount: number; grossFinal: number; grossMerchandise: number; deliveryCharges: number;
  merchandiseRefund: number; checkoutRefund: number; knownCost: number; restoredCost: number;
  unresolvedCostQuantity: number; costsIncomplete: boolean;
};
type BuildState = {
  total: FinancialAccumulator;
  channels: Map<"physical" | "online", FinancialAccumulator>;
  branches: Map<string, FinancialAccumulator>;
  branchExpenses: Map<string, number>;
  employees: Map<string, ReportEmployeeBreakdownDto>;
  bestSellers: Map<string, ReportBestSellerDto>;
};

export function createReportingServices(input: {
  actors: ReportingActorPort; uow: ReportingReadUnitOfWork; clock?: { now(): Date };
}): ReportingServices {
  const now = input.clock?.now ?? (() => new Date());
  const execute = async (auth: VerifiedAuth | null, rawQuery: unknown, page: DetailPage) => {
    await requireManager(input.actors, auth);
    const query = object(rawQuery);
    const period = parseReportingPeriod(query, now(), page.exportMode);
    const filters = parseFilters(query);
    const [branches, staff] = await Promise.all([input.actors.listBranches(), input.actors.listStaff()]);
    assertFilterReferences(filters, branches, staff.map((item) => item.id));
    return input.uow.run((context) => buildReport(context, branches, staff, period, filters, page));
  };
  return {
    getManagementReport(auth, rawQuery) {
      const query = object(rawQuery);
      return execute(auth, query, parseDetailPage(query));
    },
    getManagementReportExportSnapshot(auth, rawQuery) {
      return execute(auth, rawQuery, { page: 1, pageSize: EXPORT_DETAIL_LIMIT, exportMode: true });
    },
  };
}

async function buildReport(
  context: ReportingReadContext, branches: BranchDto[], staff: Array<{ id: string; displayName: string }>,
  period: Period, filters: ManagementReportFiltersDto, page: DetailPage,
): Promise<ManagementReportDto> {
  const includePhysical = filters.channel !== "online";
  const includeOnline = filters.channel !== "physical" && !filters.employeeId;
  const expenseInput = { fromDate: period.fromCairoDate, toDateInclusive: period.toCairoDateInclusive,
    branchId: filters.branchId, employeeId: filters.employeeId };
  const [physicalCount, onlineCount, receiptCount, expenseCount, refundCount] = await Promise.all([
    includePhysical ? context.sales.countCompletedFacts({ from: period.from, to: period.to,
      branchId: filters.branchId, employeeId: filters.employeeId }) : Promise.resolve(0),
    includeOnline ? context.orders.countConfirmedFacts({ from: period.from, to: period.to,
      branchId: filters.branchId }) : Promise.resolve(0),
    context.purchases.countReceiptFacts({ fromDate: period.fromCairoDate, toDateInclusive: period.toCairoDateInclusive }),
    filters.channel === "online" ? Promise.resolve(0) : context.expenses.countEffectiveFacts(expenseInput),
    countMatchingReturns(context, period, filters),
  ]);
  const completedCount = checkedAdd(physicalCount, onlineCount);
  assertExportLimit(page, [completedCount, refundCount, receiptCount, expenseCount]);
  const offset = checkedMultiply(page.page - 1, page.pageSize);
  const pageEnd = checkedAdd(offset, page.pageSize);
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const staffById = new Map(staff.map((item) => [item.id, item]));
  const state = createBuildState(branches);
  const completedSales: ReportCompletedSaleDto[] = [];
  const refunds: ReportRefundDto[] = [];
  const purchaseReceipts: ReportPurchaseReceiptDto[] = [];
  const openingReceipts: ReportPurchaseReceiptDto[] = [];
  const expenseItems: ReportExpenseDto[] = [];
  const detailBudget = retainedDetailBudget(page.exportMode ? EXPORT_RETAINED_DETAIL_BYTES : HTTP_RETAINED_DETAIL_BYTES);

  let completedIndex = 0;
  const physical = physicalDetailStream(context, period, filters, branchById, staffById, includePhysical);
  const online = onlineDetailStream(context, period, filters.branchId, branchById, includeOnline);
  for await (const detail of mergeCompleted(physical, online)) {
    if (completedIndex >= offset && completedIndex < pageEnd) { detailBudget.add(detail); completedSales.push(detail); }
    completedIndex = checkedAdd(completedIndex, 1);
    if (detail.effectiveStatus === "active") addSale(state, detail);
    else addCancelledSaleMovementCost(state, detail);
  }
  if (includeOnline) {
    for await (const reversal of onlineRevenueReversalStream(context, period, filters.branchId)) {
      applyOnlineRevenueReversal(state, reversal);
    }
    for await (const restoration of onlineCostRestorationStream(context, period, filters.branchId)) {
      applyOnlineCostRestoration(state, restoration);
    }
  }
  let refundIndex = 0;
  for await (const item of returnDetailStream(context, period, filters, staffById)) {
    if (refundIndex >= offset && refundIndex < pageEnd) { detailBudget.add(item.value.dto); refunds.push(item.value.dto); }
    refundIndex = checkedAdd(refundIndex, 1);
    addReturn(state, item.value, item.sourceSale, item.identities);
  }
  let purchaseIndex = 0;
  let openingIndex = 0;
  let purchaseTotal = 0;
  let openingTotal = 0;
  for await (const item of classifiedReceiptStream(context, period, staffById)) {
    if (item.opening) {
      if (openingIndex >= offset && openingIndex < pageEnd) { detailBudget.add(item.receipt); openingReceipts.push(item.receipt); }
      openingIndex = checkedAdd(openingIndex, 1);
      openingTotal = checkedAdd(openingTotal, item.receipt.effectiveCostPiasters);
    } else {
      if (purchaseIndex >= offset && purchaseIndex < pageEnd) { detailBudget.add(item.receipt); purchaseReceipts.push(item.receipt); }
      purchaseIndex = checkedAdd(purchaseIndex, 1);
      purchaseTotal = checkedAdd(purchaseTotal, item.receipt.effectiveCostPiasters);
    }
  }
  let expenseIndex = 0;
  let expenseTotal = 0;
  if (filters.channel !== "online") {
    for await (const expense of expenseDetailStream(context, expenseInput, branchById, staffById)) {
      if (expenseIndex >= offset && expenseIndex < pageEnd) { detailBudget.add(expense); expenseItems.push(expense); }
      expenseIndex = checkedAdd(expenseIndex, 1);
      if (expense.effectiveStatus === "active") {
        expenseTotal = checkedAdd(expenseTotal, expense.amountPiasters);
        state.branchExpenses.set(expense.branch.id, checkedAdd(state.branchExpenses.get(expense.branch.id) ?? 0, expense.amountPiasters));
        const employee = employeeRow(state, expense.createdByStaffId, expense.createdByDisplayName);
        employee.effectiveExpensesPiasters = checkedAdd(employee.effectiveExpensesPiasters, expense.amountPiasters);
      }
    }
  }
  const [inventory, lowStock, orderStatusCounts] = await Promise.all([
    inventorySnapshot(context), lowStockSnapshot(context, filters.branchId), context.orders.currentStatusCounts(),
  ]);
  const total = state.total;
  const knownNetCost = checkedSubtract(total.knownCost, total.restoredCost);
  const netMerchandise = checkedSubtract(total.grossMerchandise, total.merchandiseRefund);
  const netFinal = checkedSubtract(checkedSubtract(total.grossFinal, total.merchandiseRefund), total.checkoutRefund);
  const grossProfit = total.costsIncomplete ? null : checkedSubtract(netMerchandise, knownNetCost);
  const operatingProfit = grossProfit === null ? null : checkedSubtract(grossProfit, expenseTotal);
  return {
    period: { kind: period.kind, labelAr: period.labelAr, fromCairoDate: period.fromCairoDate,
      toCairoDateInclusive: period.toCairoDateInclusive }, filters,
    pageInfo: { page: page.page, pageSize: page.pageSize, totalCompletedSales: completedCount,
      totalRefunds: refundCount, totalPurchases: purchaseIndex, totalOpeningReceipts: openingIndex,
      totalExpenses: expenseCount,
      hasMore: [completedCount, refundCount, purchaseIndex, openingIndex, expenseCount].some((count) => count > pageEnd) },
    summary: { completedCount: total.completedCount, grossFinalSalesPiasters: total.grossFinal,
      grossMerchandiseSalesPiasters: total.grossMerchandise, deliveryChargesPiasters: total.deliveryCharges,
      merchandiseRefundPiasters: total.merchandiseRefund, checkoutChargeRefundPiasters: total.checkoutRefund,
      netFinalSalesPiasters: netFinal, netMerchandiseSalesPiasters: netMerchandise,
      knownNetMerchandiseCostPiasters: knownNetCost, merchandiseGrossProfitPiasters: grossProfit,
      effectiveExpensesPiasters: expenseTotal, operatingProfitPiasters: operatingProfit,
      purchaseCostPiasters: purchaseTotal, openingStockCostPiasters: openingTotal, costsIncomplete: total.costsIncomplete,
      unresolvedCostQuantity: total.unresolvedCostQuantity },
    byChannel: (["physical", "online"] as const).map((channel) => channelDto(channel,
      required(state.channels.get(channel), "قناة التقرير غير موجودة."))),
    byBranch: branches.filter((branch) => !filters.branchId || branch.id === filters.branchId).map((branch) => branchDto(
      branch, required(state.branches.get(branch.id), "فرع التقرير غير موجود."), state.branchExpenses.get(branch.id) ?? 0)),
    byEmployee: [...state.employees.values()].sort((left, right) => descending(left.grossMerchandiseSalesPiasters, right.grossMerchandiseSalesPiasters)
      || left.displayName.localeCompare(right.displayName, "ar")),
    completedSales, refunds, purchases: { totalPiasters: purchaseTotal, receipts: purchaseReceipts },
    openingStock: { totalPiasters: openingTotal, receipts: openingReceipts },
    expenses: { totalPiasters: expenseTotal, items: expenseItems },
    bestSellers: [...state.bestSellers.values()].sort((left, right) => descending(left.grossEffectiveSoldQuantity, right.grossEffectiveSoldQuantity)
      || left.productNameAr.localeCompare(right.productNameAr, "ar")),
    inventory, onlineOrderOperations: orderStatusCounts, lowStock,
  };
}

async function countMatchingReturns(context: ReportingReadContext, period: Period, filters: ManagementReportFiltersDto): Promise<number> {
  let count = 0;
  let after: { postedAt: Date; id: string } | null = null;
  while (true) {
    const headers = await context.returns.listPostedHeadersPage({ from: period.from, to: period.to,
      limit: READ_PAGE_SIZE, after });
    if (headers.length === 0) return count;
    const sourceIds = headers.flatMap((row) => row.source.kind === "physical_sale" ? [row.source.id] : []);
    const onlineIds = headers.flatMap((row) => row.source.kind === "delivered_online_order" ? [row.source.id] : []);
    const [sales, onlineBranches] = await Promise.all([
      context.sales.getCompletedAttributionsByIds(unique(sourceIds)),
      context.orders.getFulfillmentBranchesByOrderIds(unique(onlineIds)),
    ]);
    const sourceSales = new Map(sales.map((sale) => [sale.id, sale]));
    for (const header of headers) if (matchesReturnHeader(header, filters, sourceSales, onlineBranches)) count = checkedAdd(count, 1);
    const last = headers.at(-1)!;
    after = { postedAt: last.postedAt, id: last.returnId };
  }
}

function matchesReturnHeader(header: ReturnReportingHeader, filters: ManagementReportFiltersDto,
  sales: Map<string, SaleAttribution>, onlineBranches: Map<string, string>) {
  if (filters.channel !== "all" && header.channel !== filters.channel) return false;
  if (header.source.kind === "delivered_online_order") return !filters.employeeId
    && (!filters.branchId || onlineBranches.get(header.source.id) === filters.branchId);
  const source = sales.get(header.source.id);
  return !!source && (!filters.branchId || source.branchId === filters.branchId)
    && (!filters.employeeId || source.soldByStaffId === filters.employeeId);
}

async function* physicalDetailStream(
  context: ReportingReadContext, period: Period, filters: ManagementReportFiltersDto,
  branches: Map<string, BranchDto>, staff: Map<string, { id: string; displayName: string }>, enabled: boolean,
): AsyncGenerator<ReportCompletedSaleDto> {
  if (!enabled) return;
  let after: { occurredAt: Date; id: string } | null = null;
  while (true) {
    const sales = await context.sales.listCompletedFactsPage({ from: period.from, to: period.to,
      branchId: filters.branchId, employeeId: filters.employeeId, limit: READ_PAGE_SIZE, after });
    if (sales.length === 0) return;
    const saleIds = sales.map((sale) => sale.id);
    const [corrections, allocations, discrepancies] = await Promise.all([
      context.saleCorrections.listEffectiveFacts(saleIds),
      context.inventory.listAllocationsForOperations(sales.map((sale) => sale.operationId)),
      context.inventory.listDiscrepanciesForOperations(sales.map((sale) => sale.operationId)),
    ]);
    const correctionById = new Map(corrections.map((fact) => [fact.saleId, fact]));
    const [batchRows, identities] = await Promise.all([
      context.inventory.getBatchStates(unique(corrections.flatMap((fact) => fact.merchandise.map((row) => row.batchId)))),
      context.catalog.getVariants(unique(sales.flatMap((sale) => sale.lines.map((line) => line.variantId)))),
    ]);
    const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));
    const allocationGroups = group(allocations, (row) => row.operationId);
    const discrepancyGroups = group(discrepancies, (row) => row.operationId);
    for (const sale of sales) yield toPhysicalDetail(sale, correctionById.get(sale.id),
      allocationGroups.get(sale.operationId) ?? [], checkedSum(discrepancyGroups.get(sale.operationId) ?? [], (row) => row.unallocatedQuantity),
      branches, staff, identityById, batchById);
    const last = sales.at(-1)!;
    after = { occurredAt: last.occurredAt, id: last.id };
  }
}

async function* onlineDetailStream(context: ReportingReadContext, period: Period, branchId: string | null,
  branches: Map<string, BranchDto>, enabled: boolean): AsyncGenerator<ReportCompletedSaleDto> {
  if (!enabled) return;
  let after: { occurredAt: Date; id: string } | null = null;
  while (true) {
    const orders = await context.orders.listConfirmedFactsPage({ from: period.from, to: period.to,
      branchId, limit: READ_PAGE_SIZE, after });
    if (orders.length === 0) return;
    const [allocations, identities] = await Promise.all([
      context.inventory.listProtectedOrderAllocationProvenance(orders.map((order) => order.orderId)),
      context.catalog.getVariants(unique(orders.flatMap((order) => order.confirmedQuote.lines.map((line) => line.variantId)))),
    ]);
    const allocationGroups = group(allocations, (row) => row.protectedOrderId);
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));
    for (const order of orders) yield toOnlineDetail(order, allocationGroups.get(order.orderId) ?? [], identityById, branches);
    const last = orders.at(-1)!;
    after = { occurredAt: last.occurredAt, id: last.orderId };
  }
}

type OnlineRevenueReversal = {
  quote: Awaited<ReturnType<ReportingReadContext["orders"]["listRevenueReversalsPage"]>>[number]["confirmedQuote"];
  branchId: string | null;
  restoredCostPiasters: number;
  productQuantities: Array<{ productId: string; productCode: string; productNameAr: string; quantity: number }>;
};

type OnlineCostRestoration = { branchId: string | null; restoredCostPiasters: number };

async function* onlineRevenueReversalStream(context: ReportingReadContext, period: Period,
  branchId: string | null): AsyncGenerator<OnlineRevenueReversal> {
  let after: { occurredAt: Date; id: string } | null = null;
  while (true) {
    const events = await context.orders.listRevenueReversalsPage({ from: period.from, to: period.to,
      branchId, limit: READ_PAGE_SIZE, after });
    if (events.length === 0) return;
    const [restoredCosts, identities] = await Promise.all([
      context.inventory.listOrderRestoredCostByOperations(events
        .filter((event) => event.eventType === "cancelled_before_shipment").map((event) => event.operationId)),
      context.catalog.getVariants(unique(events.flatMap((event) => event.confirmedQuote.lines.map((line) => line.variantId)))),
    ]);
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));
    for (const event of events) {
      const restoredCostPiasters = event.eventType === "cancelled_before_shipment"
        ? restoredCosts.get(event.operationId) ?? 0 : 0;
      yield { quote: event.confirmedQuote, branchId: event.fulfillmentBranchId, restoredCostPiasters,
        productQuantities: event.confirmedQuote.lines.map((line) => {
          const identity = required(identityById.get(line.variantId), "بيانات المنتج غير موجودة.");
          return { productId: identity.product.id, productCode: identity.product.code,
            productNameAr: identity.product.nameAr, quantity: line.quantity };
        }) };
    }
    const last = events.at(-1)!;
    after = { occurredAt: last.occurredAt, id: last.eventId };
  }
}

async function* onlineCostRestorationStream(context: ReportingReadContext, period: Period,
  branchId: string | null): AsyncGenerator<OnlineCostRestoration> {
  let after: { occurredAt: Date; id: string } | null = null;
  while (true) {
    const events = await context.orders.listRestorationFactsPage({ from: period.from, to: period.to,
      branchId, limit: READ_PAGE_SIZE, after });
    if (events.length === 0) return;
    const costs = await context.inventory.listOrderRestoredCostByOperations(events.map((event) => event.operationId));
    for (const event of events) yield { branchId: event.fulfillmentBranchId,
      restoredCostPiasters: costs.get(event.operationId) ?? 0 };
    const last = events.at(-1)!;
    after = { occurredAt: last.occurredAt, id: last.eventId };
  }
}

async function* mergeCompleted(
  physical: AsyncGenerator<ReportCompletedSaleDto>, online: AsyncGenerator<ReportCompletedSaleDto>,
): AsyncGenerator<ReportCompletedSaleDto> {
  let left = await physical.next();
  let right = await online.next();
  while (!left.done || !right.done) {
    if (left.done) {
      yield right.value;
      right = await online.next();
    } else if (right.done || detailAfter(left.value, right.value)) {
      yield left.value;
      left = await physical.next();
    } else {
      yield right.value;
      right = await online.next();
    }
  }
}

function detailAfter(left: ReportCompletedSaleDto, right: ReportCompletedSaleDto) {
  return left.occurredAt > right.occurredAt || (left.occurredAt === right.occurredAt && left.source.id > right.source.id);
}

async function* returnDetailStream(
  context: ReportingReadContext, period: Period, filters: ManagementReportFiltersDto,
  staff: Map<string, { id: string; displayName: string }>,
): AsyncGenerator<{ value: ComposedReturn; sourceSale: SaleAttribution | undefined; identities: Map<string, VariantIdentityDto> }> {
  let after: { postedAt: Date; id: string } | null = null;
  while (true) {
    const facts = await context.returns.listPostedFactsPage({ from: period.from, to: period.to,
      limit: READ_PAGE_SIZE, after });
    if (facts.length === 0) return;
    const sourceIds = facts.flatMap((fact) => fact.source.kind === "physical_sale" ? [fact.source.id] : []);
    const replacementIds = facts.flatMap((fact) => fact.exchange ? [fact.exchange.replacementSaleId] : []);
    const onlineIds = facts.flatMap((fact) => fact.source.kind === "delivered_online_order" ? [fact.source.id] : []);
    const [sales, corrections, onlineBranches] = await Promise.all([
      context.sales.getCompletedAttributionsByIds(unique([...sourceIds, ...replacementIds])),
      context.returnCorrections.listEffectiveFacts(facts.map((fact) => fact.returnId)),
      context.orders.getFulfillmentBranchesByOrderIds(unique(onlineIds)),
    ]);
    const saleById = new Map(sales.map((sale) => [sale.id, sale]));
    const correctionById = new Map(corrections.map((fact) => [fact.returnId, fact]));
    const batchIds = unique([
      ...facts.flatMap((fact) => fact.restorations.map((row) => row.batchId)),
      ...corrections.flatMap((fact) => fact.merchandise.map((row) => row.batchId)),
    ]);
    const [batchRows, identities] = await Promise.all([
      context.inventory.getBatchStates(batchIds),
      context.catalog.getVariants(unique(facts.flatMap((fact) => fact.lines.map((line) => line.variantId)))),
    ]);
    const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));
    for (const fact of facts) {
      if (!matchesReturnHeader(fact, filters, saleById, onlineBranches)) continue;
      yield { value: composeReturn(fact, correctionById.get(fact.returnId), saleById, staff, batchById,
        onlineBranches.get(fact.source.id) ?? null),
        sourceSale: fact.source.kind === "physical_sale" ? saleById.get(fact.source.id) : undefined,
        identities: identityById };
    }
    const last = facts.at(-1)!;
    after = { postedAt: last.postedAt, id: last.returnId };
  }
}

async function* classifiedReceiptStream(
  context: ReportingReadContext, period: Period, staff: Map<string, { id: string; displayName: string }>,
): AsyncGenerator<{ opening: boolean; receipt: ReportPurchaseReceiptDto }> {
  let after: { receiptDate: string; id: string } | null = null;
  while (true) {
    const facts = await context.purchases.listReceiptFactsPage({ fromDate: period.fromCairoDate,
      toDateInclusive: period.toCairoDateInclusive, limit: READ_PAGE_SIZE, after });
    if (facts.length === 0) return;
    const [batches, identities, openingOperationIds] = await Promise.all([
      context.inventory.getBatchStates(unique(facts.flatMap((fact) => fact.receipt.lines.map((line) => line.batchId)))),
      context.catalog.getVariants(unique(facts.flatMap((fact) => fact.receipt.lines.map((line) => line.variantId)))),
      context.openingImports.acceptedStockOperationIds(unique(facts.map((fact) => fact.receipt.operationId))),
    ]);
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));
    for (const { receipt, corrections } of facts) {
      const states = receipt.lines.map((line) => required(batchById.get(line.batchId), "دفعة الاستلام غير موجودة."));
      yield { opening: openingOperationIds.has(receipt.operationId), receipt: {
        receiptId: receipt.id, receiptDate: receipt.receiptDate, receivedByStaffId: receipt.receivedByStaffId,
        effectiveQuantity: checkedSum(states, (state) => state.effectiveReceivedQuantity),
        effectiveCostPiasters: checkedSum(states, (state) => checkedMultiply(state.effectiveReceivedQuantity, state.effectiveUnitCostPiasters)),
        lines: receipt.lines.map((line) => {
          const state = required(batchById.get(line.batchId), "دفعة الاستلام غير موجودة.");
          return { lineId: line.id, variant: required(identityById.get(line.variantId), "بيانات المنتج غير موجودة."),
            effectiveQuantity: state.effectiveReceivedQuantity, effectiveUnitCostPiasters: state.effectiveUnitCostPiasters,
            effectiveCostPiasters: checkedMultiply(state.effectiveReceivedQuantity, state.effectiveUnitCostPiasters) };
        }), corrections: corrections.map((change) => ({ ...change,
          changedByDisplayName: staff.get(change.changedByStaffId)?.displayName ?? change.changedByStaffId,
          changedAt: change.changedAt.toISOString() })) } };
    }
    const last = facts.at(-1)!.receipt;
    after = { receiptDate: last.receiptDate, id: last.id };
  }
}

async function* expenseDetailStream(
  context: ReportingReadContext,
  input: { fromDate: string; toDateInclusive: string; branchId: string | null; employeeId: string | null },
  branches: Map<string, BranchDto>, staff: Map<string, { id: string; displayName: string }>,
): AsyncGenerator<ReportExpenseDto> {
  let after: { expenseDate: string; id: string } | null = null;
  while (true) {
    const facts = await context.expenses.listEffectiveFactsPage({ ...input, limit: READ_PAGE_SIZE, after });
    if (facts.length === 0) return;
    for (const expense of facts) yield {
      expenseId: expense.expenseId, branch: required(branches.get(expense.branchId), "فرع المصروف غير موجود."),
      createdByStaffId: expense.createdByStaffId,
      createdByDisplayName: staff.get(expense.createdByStaffId)?.displayName ?? expense.createdByStaffId,
      expenseDate: expense.expenseDate, amountPiasters: expense.amountPiasters,
      categoryNameAr: expense.categoryNameAr, description: expense.description,
      effectiveStatus: expense.effectiveStatus,
      correctionRevision: expense.correctionRevision,
      corrections: expense.corrections.map((change) => ({ ...change,
        changedByDisplayName: staff.get(change.changedByStaffId)?.displayName ?? change.changedByStaffId,
        changedAt: change.changedAt.toISOString() })),
    };
    const last = facts.at(-1)!;
    after = { expenseDate: last.expenseDate, id: last.expenseId };
  }
}

async function inventorySnapshot(context: ReportingReadContext) {
  const [available, unresolved] = await Promise.all([
    context.inventory.summarizeAuthoritativeAvailableInventory(),
    context.inventory.unresolvedDiscrepancyQuantity(),
  ]);
  let protectedQuantity = 0;
  let protectedValuePiasters = 0;
  let afterId: string | null = null;
  while (true) {
    const orderIds = await context.orders.currentProtectedOrderIdsPage({ limit: READ_PAGE_SIZE, afterId });
    if (orderIds.length === 0) break;
    const summary = await context.inventory.summarizeProtectedOrderInventory(orderIds);
    protectedQuantity = checkedAdd(protectedQuantity, summary.quantity);
    protectedValuePiasters = checkedAdd(protectedValuePiasters, summary.valuePiasters);
    afterId = orderIds.at(-1)!;
  }
  return { availableQuantity: available.quantity, availableValuePiasters: available.valuePiasters,
    protectedQuantity, protectedValuePiasters, unresolvedCostQuantity: unresolved, costsIncomplete: unresolved > 0 };
}

async function lowStockSnapshot(context: ReportingReadContext, branchId: string | null) {
  const [variantIds, settings, thresholds] = await Promise.all([
    context.catalog.listVariantIds(), context.inventory.getSettings(), context.inventory.listVariantThresholds(),
  ]);
  const [identities, quantitiesByBranch] = await Promise.all([
    context.catalog.getVariants(variantIds), context.inventory.quantitiesByBranchFor(variantIds),
  ]);
  return identities.flatMap((identity) => [...quantitiesByBranch.entries()]
    .filter(([id]) => !branchId || id === branchId)
    .flatMap(([id, quantities]) => {
      const availableQuantity = quantities.get(identity.id) ?? 0;
      const override = thresholds.get(identity.id);
      const threshold = override ?? settings.lowStockThreshold;
      return availableQuantity <= threshold ? [{ branchId: id, variantId: identity.id,
        availableQuantity, threshold,
        thresholdSource: override === null || override === undefined ? "global" as const : "variant" as const,
        variant: identity }] : [];
    })).sort((left, right) => ascending(left.availableQuantity, right.availableQuantity)
    || left.variant.product.nameAr.localeCompare(right.variant.product.nameAr, "ar")
    || left.branchId.localeCompare(right.branchId));
}

function createBuildState(branches: BranchDto[]): BuildState {
  return { total: emptyFinancial(), channels: new Map<"physical" | "online", FinancialAccumulator>([
      ["physical", emptyFinancial()], ["online", emptyFinancial()],
    ]),
    branches: new Map(branches.map((branch) => [branch.id, emptyFinancial()])), branchExpenses: new Map(),
    employees: new Map(), bestSellers: new Map() };
}

function emptyFinancial(): FinancialAccumulator {
  return { completedCount: 0, grossFinal: 0, grossMerchandise: 0, deliveryCharges: 0,
    merchandiseRefund: 0, checkoutRefund: 0, knownCost: 0, restoredCost: 0,
    unresolvedCostQuantity: 0, costsIncomplete: false };
}

function addSale(state: BuildState, sale: ReportCompletedSaleDto) {
  addSaleFinancial(state.total, sale);
  addSaleFinancial(required(state.channels.get(sale.channel), "قناة التقرير غير موجودة."), sale);
  if (sale.branch) addSaleFinancial(required(state.branches.get(sale.branch.id), "فرع التقرير غير موجود."), sale);
  if (sale.employee) {
    const row = employeeRow(state, sale.employee.staffId, sale.employee.displayName);
    row.completedCount = checkedAdd(row.completedCount, 1);
    row.grossFinalSalesPiasters = checkedAdd(row.grossFinalSalesPiasters, sale.effectiveFinalPiasters);
    row.grossMerchandiseSalesPiasters = checkedAdd(row.grossMerchandiseSalesPiasters, sale.effectiveMerchandisePiasters);
    row.employeeDiscountPiasters = checkedAdd(row.employeeDiscountPiasters, sale.accepted.employeeDiscountPiasters);
  }
  for (const line of sale.lines) {
    const row = state.bestSellers.get(line.productId) ?? { productId: line.productId, productCode: line.productCode,
      productNameAr: line.productNameAr, grossEffectiveSoldQuantity: 0, returnedQuantity: 0 };
    row.grossEffectiveSoldQuantity = checkedAdd(row.grossEffectiveSoldQuantity, line.quantity);
    state.bestSellers.set(row.productId, row);
  }
}

function addCancelledSaleMovementCost(state: BuildState, sale: ReportCompletedSaleDto) {
  const rows = [state.total, required(state.channels.get(sale.channel), "قناة التقرير غير موجودة.")];
  if (sale.branch) rows.push(required(state.branches.get(sale.branch.id), "فرع التقرير غير موجود."));
  for (const row of rows) {
    row.knownCost = checkedAdd(row.knownCost, sale.knownCostPiasters);
    row.unresolvedCostQuantity = checkedAdd(row.unresolvedCostQuantity, sale.unresolvedCostQuantity);
    row.costsIncomplete ||= sale.costsIncomplete;
  }
}

function addSaleFinancial(row: FinancialAccumulator, sale: ReportCompletedSaleDto) {
  row.completedCount = checkedAdd(row.completedCount, 1);
  row.grossFinal = checkedAdd(row.grossFinal, sale.effectiveFinalPiasters);
  row.grossMerchandise = checkedAdd(row.grossMerchandise, sale.effectiveMerchandisePiasters);
  row.deliveryCharges = checkedAdd(row.deliveryCharges, sale.deliveryChargePiasters);
  row.knownCost = checkedAdd(row.knownCost, sale.knownCostPiasters);
  row.unresolvedCostQuantity = checkedAdd(row.unresolvedCostQuantity, sale.unresolvedCostQuantity);
  row.costsIncomplete ||= sale.costsIncomplete;
}

function applyOnlineRevenueReversal(state: BuildState, reversal: OnlineRevenueReversal) {
  const rows = [state.total, required(state.channels.get("online"), "قناة التقرير غير موجودة.")];
  if (reversal.branchId) rows.push(required(state.branches.get(reversal.branchId), "فرع التقرير غير موجود."));
  for (const row of rows) {
    row.grossFinal = checkedSubtract(row.grossFinal, reversal.quote.finalTotalPiasters);
    row.grossMerchandise = checkedSubtract(row.grossMerchandise, reversal.quote.merchandiseTotalPiasters);
    row.deliveryCharges = checkedSubtract(row.deliveryCharges, reversal.quote.deliveryFeePiasters);
    row.knownCost = checkedSubtract(row.knownCost, reversal.restoredCostPiasters);
  }
  for (const line of reversal.productQuantities) {
    const row = state.bestSellers.get(line.productId) ?? { productId: line.productId,
      productCode: line.productCode, productNameAr: line.productNameAr,
      grossEffectiveSoldQuantity: 0, returnedQuantity: 0 };
    row.grossEffectiveSoldQuantity = checkedSubtract(row.grossEffectiveSoldQuantity, line.quantity);
    state.bestSellers.set(row.productId, row);
  }
}

function applyOnlineCostRestoration(state: BuildState, restoration: OnlineCostRestoration) {
  const rows = [state.total, required(state.channels.get("online"), "قناة التقرير غير موجودة.")];
  if (restoration.branchId) rows.push(required(state.branches.get(restoration.branchId), "فرع التقرير غير موجود."));
  for (const row of rows) row.knownCost = checkedSubtract(row.knownCost, restoration.restoredCostPiasters);
}

function addReturn(state: BuildState, value: ComposedReturn, sourceSale: SaleAttribution | undefined,
  identities: Map<string, VariantIdentityDto>) {
  const channel = required(state.channels.get(value.dto.channel), "قناة التقرير غير موجودة.");
  const branch = value.dto.originalBranchId
    ? required(state.branches.get(value.dto.originalBranchId), "فرع التقرير غير موجود.") : null;
  addReturnMovementCost(state.total, value.dto);
  addReturnMovementCost(channel, value.dto);
  if (branch) addReturnMovementCost(branch, value.dto);
  if (value.dto.effectiveStatus === "cancelled") return;
  addReturnRefund(state.total, value.dto);
  addReturnRefund(channel, value.dto);
  if (branch) addReturnRefund(branch, value.dto);
  if (sourceSale) {
    const row = employeeRow(state, sourceSale.soldByStaffId, sourceSale.soldByDisplayName);
    row.merchandiseRefundPiasters = checkedAdd(row.merchandiseRefundPiasters, value.dto.authorizedRefund.merchandisePiasters);
  }
  for (const line of value.lines) {
    const identity = identities.get(line.variantId);
    if (!identity) continue;
    const row = state.bestSellers.get(identity.product.id) ?? { productId: identity.product.id,
      productCode: identity.product.code, productNameAr: identity.product.nameAr,
      grossEffectiveSoldQuantity: 0, returnedQuantity: 0 };
    row.returnedQuantity = checkedAdd(row.returnedQuantity, line.quantity);
    state.bestSellers.set(row.productId, row);
  }
}

function addReturnRefund(row: FinancialAccumulator, refund: ReportRefundDto) {
  row.merchandiseRefund = checkedAdd(row.merchandiseRefund, refund.authorizedRefund.merchandisePiasters);
  row.checkoutRefund = checkedAdd(row.checkoutRefund, refund.authorizedRefund.checkoutChargePiasters);
}

function addReturnMovementCost(row: FinancialAccumulator, refund: ReportRefundDto) {
  row.restoredCost = checkedAdd(row.restoredCost, refund.sellableRestoredCostPiasters);
}

function employeeRow(state: BuildState, staffId: string, displayName: string) {
  const row = state.employees.get(staffId) ?? { staffId, displayName, completedCount: 0,
    grossFinalSalesPiasters: 0, grossMerchandiseSalesPiasters: 0, employeeDiscountPiasters: 0,
    merchandiseRefundPiasters: 0, effectiveExpensesPiasters: 0 };
  state.employees.set(staffId, row);
  return row;
}

function channelDto(channel: "physical" | "online", row: FinancialAccumulator): ReportChannelBreakdownDto {
  const net = checkedSubtract(row.grossMerchandise, row.merchandiseRefund);
  const cost = checkedSubtract(row.knownCost, row.restoredCost);
  return { channel, completedCount: row.completedCount, grossFinalSalesPiasters: row.grossFinal,
    grossMerchandiseSalesPiasters: row.grossMerchandise, merchandiseRefundPiasters: row.merchandiseRefund,
    netMerchandiseSalesPiasters: net, knownNetMerchandiseCostPiasters: cost,
    grossProfitPiasters: row.costsIncomplete ? null : checkedSubtract(net, cost), costsIncomplete: row.costsIncomplete };
}

function branchDto(branch: BranchDto, row: FinancialAccumulator, expenses: number): ReportBranchBreakdownDto {
  const base = channelDto("physical", row);
  return { branch, completedCount: base.completedCount, grossFinalSalesPiasters: base.grossFinalSalesPiasters,
    grossMerchandiseSalesPiasters: base.grossMerchandiseSalesPiasters,
    merchandiseRefundPiasters: base.merchandiseRefundPiasters,
    netMerchandiseSalesPiasters: base.netMerchandiseSalesPiasters,
    knownNetMerchandiseCostPiasters: base.knownNetMerchandiseCostPiasters,
    grossProfitPiasters: base.grossProfitPiasters, costsIncomplete: base.costsIncomplete,
    effectiveExpensesPiasters: expenses,
    operatingProfitPiasters: base.grossProfitPiasters === null ? null : checkedSubtract(base.grossProfitPiasters, expenses) };
}

function toPhysicalDetail(
  sale: SaleRecord, correction: SaleCorrectionReportingFact | undefined,
  allocations: ReportingAllocationRecord[], unresolved: number, branches: Map<string, BranchDto>,
  staff: Map<string, { id: string; displayName: string }>, identities: Map<string, VariantIdentityDto>,
  batches: Map<string, BatchRecord>,
): ReportCompletedSaleDto {
  const cancelled = correction?.status === "cancelled";
  const originalById = new Map(sale.lines.map((line) => [line.id, line]));
  const effectiveLines = correction?.effectiveLines ?? sale.lines.map((line) => ({ saleLineId: line.id,
    quantity: line.quantity, paidPiasters: line.paidPiasters }));
  const lines = (cancelled ? [] : effectiveLines).map((line) => {
    const original = required(originalById.get(line.saleLineId), "سطر البيع غير موجود.");
    const identity = required(identities.get(original.variantId), "بيانات المنتج غير موجودة.");
    return { sourceLineId: original.id, variantId: original.variantId, productId: identity.product.id,
      productCode: identity.product.code, productNameAr: identity.product.nameAr, variant: identity,
      quantity: line.quantity, paidPiasters: line.paidPiasters };
  });
  let knownCost = checkedSum(allocations,
    (allocation) => checkedMultiply(allocation.quantity, allocation.effectiveUnitCostPiasters));
  for (const fact of correction?.merchandise ?? []) {
    const batch = required(batches.get(fact.batchId), "دفعة تكلفة التصحيح غير موجودة.");
    const delta = checkedMultiply(fact.quantity, batch.effectiveUnitCostPiasters);
    knownCost = fact.direction === "deduct" ? checkedAdd(knownCost, delta) : checkedSubtract(knownCost, delta);
  }
  const effectiveTotal = cancelled ? 0 : correction?.effectiveTotalPiasters ?? sale.finalTotalPiasters;
  return {
    source: { kind: "physical_sale", id: sale.id, reference: required(sale.reference, "رقم البيع غير موجود.") }, channel: "physical",
    occurredAt: sale.occurredAt.toISOString(), branch: required(branches.get(sale.branchId), "فرع البيع غير موجود."),
    employee: { staffId: sale.soldByStaffId, displayName: sale.soldByDisplayName },
    effectiveStatus: correction?.status ?? "active", correctionRevision: correction?.revision ?? 0,
    corrections: (correction?.changes ?? []).map((change) => ({ ...change,
      changedByDisplayName: staff.get(change.changedByStaffId)?.displayName ?? change.changedByStaffId,
      changedAt: change.changedAt.toISOString() })),
    accepted: { originalPiasters: sale.originalTotalPiasters,
      automaticOfferDiscountPiasters: sale.automaticOfferDiscountPiasters,
      couponDiscountPiasters: sale.couponDiscountPiasters, employeeDiscountPiasters: sale.employeeDiscountPiasters,
      employeeDiscountedByStaffId: sale.discountedByStaffId, employeeDiscountReason: sale.discountReason },
    effectiveMerchandisePiasters: effectiveTotal, deliveryChargePiasters: 0, effectiveFinalPiasters: effectiveTotal,
    knownCostPiasters: knownCost, unresolvedCostQuantity: unresolved,
    costsIncomplete: sale.costsIncomplete || unresolved > 0, lines,
  };
}

function toOnlineDetail(
  order: Awaited<ReturnType<ReportingReadContext["orders"]["listConfirmedFactsPage"]>>[number],
  allocations: ProtectedOrderAllocationProvenance[], identities: Map<string, VariantIdentityDto>,
  branches: Map<string, BranchDto>,
): ReportCompletedSaleDto {
  const quote = order.confirmedQuote;
  const lineQuantity = checkedSum(quote.lines, (line) => line.quantity);
  const allocatedQuantity = checkedSum(allocations, (allocation) => allocation.quantity);
  const unresolved = Math.max(0, checkedSubtract(lineQuantity, allocatedQuantity));
  return {
    source: { kind: "delivered_online_order", id: order.orderId, reference: order.reference }, channel: "online",
    occurredAt: order.occurredAt.toISOString(), branch: order.fulfillmentBranchId
      ? required(branches.get(order.fulfillmentBranchId), "فرع الطلب غير موجود.") : null,
    employee: null, effectiveStatus: "active", correctionRevision: 0,
    corrections: [], accepted: { originalPiasters: quote.merchandiseOriginalPiasters,
      automaticOfferDiscountPiasters: quote.automaticOfferDiscountPiasters,
      couponDiscountPiasters: quote.couponDiscountPiasters, employeeDiscountPiasters: 0,
      employeeDiscountedByStaffId: null, employeeDiscountReason: null },
    effectiveMerchandisePiasters: quote.merchandiseTotalPiasters, deliveryChargePiasters: quote.deliveryFeePiasters,
    effectiveFinalPiasters: quote.finalTotalPiasters,
    knownCostPiasters: checkedSum(allocations,
      (allocation) => checkedMultiply(allocation.quantity, allocation.effectiveUnitCostPiasters)),
    unresolvedCostQuantity: unresolved, costsIncomplete: unresolved > 0,
    lines: quote.lines.map((line) => {
      const identity = required(identities.get(line.variantId), "بيانات المنتج غير موجودة.");
      return { sourceLineId: line.id, variantId: line.variantId, productId: identity.product.id,
        productCode: identity.product.code, productNameAr: line.productNameAr, variant: identity,
        quantity: line.quantity, paidPiasters: line.merchandiseTotalPiasters };
    }),
  };
}

function composeReturn(
  base: ReturnReportingFact, correction: ReturnCorrectionReportingFact | undefined,
  sales: Map<string, SaleAttribution>, staff: Map<string, { id: string; displayName: string }>,
  batches: Map<string, BatchRecord>, onlineBranchId: string | null,
): ComposedReturn {
  const status = correction?.status ?? "active";
  const authorizedRefund = status === "cancelled"
    ? { merchandisePiasters: 0, checkoutChargePiasters: 0, totalPiasters: 0 }
    : correction?.effectiveRefund ?? base.authorizedRefund;
  const effectiveLineById = new Map((correction?.effectiveLines ?? []).map((line) => [line.returnLineId, line]));
  const lines = status === "cancelled" ? [] : base.lines.map((line) => {
    const effective = effectiveLineById.get(line.returnLineId);
    return { variantId: line.variantId, quantity: effective?.quantity ?? line.quantity };
  });
  const restorationByBatch = new Map<string, { batchId: string; variantId: string; quantity: number }>();
  for (const restoration of base.restorations) restorationByBatch.set(restoration.batchId,
    { batchId: restoration.batchId, variantId: restoration.variantId, quantity: restoration.quantity });
  for (const fact of correction?.merchandise ?? []) {
    const value = restorationByBatch.get(fact.batchId)
      ?? { batchId: fact.batchId, variantId: fact.variantId, quantity: 0 };
    value.quantity = fact.direction === "restore" ? checkedAdd(value.quantity, fact.quantity)
      : checkedSubtract(value.quantity, fact.quantity);
    restorationByBatch.set(fact.batchId, value);
  }
  const restorations = [...restorationByBatch.values()].filter((restoration) => restoration.quantity > 0);
  const correctionCash = checkedSum(correction?.cashEvents ?? [], (event) => event.direction === "paid_out"
    ? event.amountPiasters : checkedSubtract(0, event.amountPiasters));
  const actualRefundPaidPiasters = checkedAdd(base.refundPaidPiasters, correctionCash);
  const sourceSale = base.source.kind === "physical_sale" ? sales.get(base.source.id) : undefined;
  const replacement = base.exchange ? required(sales.get(base.exchange.replacementSaleId), "بيع الاستبدال غير موجود.") : null;
  const creditAppliedPiasters = base.exchange?.creditAppliedPiasters ?? 0;
  const cashRefundOwedPiasters = status === "active"
    ? Math.max(0, checkedSubtract(checkedSubtract(authorizedRefund.totalPiasters,
      creditAppliedPiasters), actualRefundPaidPiasters)) : 0;
  const cashRefundOverpaidPiasters = status === "active"
    ? Math.max(0, checkedSubtract(checkedAdd(creditAppliedPiasters,
      actualRefundPaidPiasters), authorizedRefund.totalPiasters)) : 0;
  const cashRefundStatus: ReportRefundDto["cashRefundStatus"] = status === "cancelled"
    ? "cancelled"
    : cashRefundOwedPiasters > 0
      ? "owed"
      : cashRefundOverpaidPiasters > 0
        ? "overpaid"
        : creditAppliedPiasters > 0 && actualRefundPaidPiasters === 0
          ? "none"
          : "paid";
  return { dto: {
    returnId: base.returnId, reference: base.reference, postedAt: base.postedAt.toISOString(), source: base.source, channel: base.channel,
    originalBranchId: sourceSale?.branchId ?? onlineBranchId, handlingBranchId: base.handlingBranchId,
    effectiveStatus: status, correctionRevision: correction?.revision ?? 0,
    corrections: (correction?.changes ?? []).map((change) => ({ ...change,
      changedByDisplayName: staff.get(change.changedByStaffId)?.displayName ?? change.changedByStaffId,
      changedAt: change.changedAt.toISOString() })), authorizedRefund,
    sellableRestoredCostPiasters: checkedSum(restorations, (restoration) => checkedMultiply(restoration.quantity,
      required(batches.get(restoration.batchId), "دفعة تكلفة المرتجع غير موجودة.").effectiveUnitCostPiasters)),
    actualRefundPaidPiasters, cashRefundStatus, cashRefundOwedPiasters,
    refundCashEvents: [
      ...base.refundCashEvents.map((event) => ({ direction: "paid_out" as const,
        amountPiasters: event.amountPiasters, recordedAt: event.recordedAt.toISOString() })),
      ...(correction?.cashEvents ?? []).map((event) => ({ ...event, recordedAt: event.recordedAt.toISOString() })),
    ],
    exchange: base.exchange && replacement ? { replacementSaleId: base.exchange.replacementSaleId,
      replacementMerchandisePiasters: replacement.finalTotalPiasters,
      creditAppliedPiasters: base.exchange.creditAppliedPiasters,
      cashCollectedPiasters: base.exchange.cashCollectedPiasters,
      cashRefundPaidPiasters: actualRefundPaidPiasters, cashRefundOwedPiasters: cashRefundOwedPiasters } : null,
  }, lines };
}

function parseFilters(query: Record<string, unknown>): ManagementReportFiltersDto {
  const branchId = optional(query.branchId);
  const employeeId = optional(query.employeeId);
  const channel = query.channel ?? "all";
  if (channel !== "all" && channel !== "physical" && channel !== "online") {
    throw new ReportingValidationError("قناة التقرير غير صالحة.");
  }
  if (branchId && !uuid(branchId)) throw new ReportingValidationError("فرع التقرير غير صالح.");
  return { branchId, channel, employeeId };
}

function parseDetailPage(query: Record<string, unknown>): DetailPage {
  const page = positiveInteger(query.detailPage, 1, Number.MAX_SAFE_INTEGER, "صفحة التفاصيل غير صالحة.");
  const pageSize = positiveInteger(query.detailPageSize, HTTP_PAGE_SIZE, HTTP_PAGE_SIZE_MAX, "حجم صفحة التفاصيل غير صالح.");
  checkedMultiply(page - 1, pageSize);
  return { page, pageSize, exportMode: false };
}

function positiveInteger(value: unknown, fallback: number, maximum: number, message: string) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new ReportingValidationError(message);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new ReportingValidationError(message);
  return parsed;
}

function assertFilterReferences(filters: ManagementReportFiltersDto, branches: BranchDto[], staffIds: string[]) {
  if (filters.branchId && !branches.some((branch) => branch.id === filters.branchId)) {
    throw new ReportingValidationError("فرع التقرير غير موجود.");
  }
  if (filters.employeeId && !staffIds.includes(filters.employeeId)) {
    throw new ReportingValidationError("الموظف المحدد غير موجود.");
  }
}

function assertExportLimit(page: DetailPage, counts: number[]) {
  if (!page.exportMode) return;
  const total = checkedSum(counts, (count) => count);
  if (total > EXPORT_DETAIL_LIMIT) throw new ReportingExportLimitError(EXPORT_DETAIL_LIMIT);
}

function retainedDetailBudget(limitBytes: number) {
  let bytes = 0;
  return { add(value: unknown) {
    bytes = checkedAdd(bytes, new TextEncoder().encode(JSON.stringify(value)).byteLength);
    if (bytes > limitBytes) throw new ReportingPayloadLimitError(limitBytes);
  } };
}

async function requireManager(actors: ReportingActorPort, auth: VerifiedAuth | null) {
  if (!auth) throw new UnauthenticatedError();
  const actor = await actors.getStaff(auth.staffId);
  if (!actor || actor.disabled) throw new UnauthenticatedError();
  if (!isManager(actor)) throw new ForbiddenError();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportingValidationError("مرشحات التقرير غير صالحة.");
  }
  return value as Record<string, unknown>;
}

function optional(value: unknown) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") throw new ReportingValidationError("مرشحات التقرير غير صالحة.");
  return value;
}
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function ascending(left: number, right: number) { return left < right ? -1 : left > right ? 1 : 0; }
function descending(left: number, right: number) { return left > right ? -1 : left < right ? 1 : 0; }
function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
function unique(values: string[]) { return [...new Set(values)]; }
function group<T, K>(rows: T[], key: (row: T) => K) {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const values = grouped.get(key(row)) ?? [];
    values.push(row);
    grouped.set(key(row), values);
  }
  return grouped;
}
