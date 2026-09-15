import type { ReturnDto, ReturnExchangeQuoteDto, ReturnRefundBreakdownDto, ReturnSourceDto, ReturnSourceKeyDto } from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
  canUseBranch,
} from "@bravos/identity";
import { OperationConflictError, assertQuantity } from "@bravos/inventory";
import type { ProtectedOrderAllocationProvenance } from "@bravos/inventory";
import type { DeliveredOnlineOrderSource } from "@bravos/online-orders";
import { ReturnWindowExpiredError, ReturnsValidationError } from "../domain/errors.ts";
import { fingerprintExchangePayload, fingerprintExchangeQuotePayload, fingerprintRefundPayment, fingerprintReturnPayload } from "../domain/fingerprint.ts";
import type {
  RefundEventRecord,
  EffectiveReturnState,
  ReturnLineWrite,
  ReturnExchangeRecord,
  ReturnRecord,
  ReturnCorrectionStateReader,
  ReturnReplacementSaleReader,
  ReturnReplacementPricing,
  ReturnRestorationWrite,
  ReturnServices,
  ReturnSourceRecord,
  ReturnUnitWrite,
  ReturnsActorPort,
  ReturnsStore,
  ReturnsUnitOfWork,
  ReturnsTransaction,
  ReturnVariantReader,
  ReturnServiceDependencies,
  SourceSearch,
  VerifiedAuth,
} from "./ports.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_KEYS = new Set(["returnId", "operationId", "source", "sourceSaleId", "handlingBranchId", "authorizedRefund", "authorizedRefundPiasters", "lines"]);
const UPDATE_DRAFT_KEYS = new Set(["expectedRevision", "handlingBranchId", "authorizedRefund", "authorizedRefundPiasters", "lines"]);
const LINE_KEYS = new Set(["sourceLineId", "sourceSaleLineId", "quantity", "sellableQuantity"]);
const POST_KEYS = new Set(["receivedAndInspected", "expectedRevision"]);
const PAY_KEYS = new Set(["operationId", "status", "amountPiasters"]);
const EXCHANGE_KEYS = new Set([
  "exchangeId", "operationId", "replacementSaleId", "replacementSaleOperationId",
  "receivedAndInspected", "expectedRevision", "cashRefundStatus", "quoteId",
]);
const EXCHANGE_QUOTE_KEYS = new Set([
  "quoteId", "expectedRevision", "replacementLines", "exchangeId", "operationId",
  "replacementSaleId", "replacementSaleOperationId",
]);
const EXCHANGE_LINE_KEYS = new Set(["variantId", "quantity"]);

export function createReturnServices(ports: Omit<ReturnServiceDependencies, "clock"> & {
  clock?: { now(): Date };
}): ReturnServices {
  const clock = ports.clock ?? { now: () => new Date() };

  async function requireManager(auth: VerifiedAuth | null) {
    if (!auth) throw new UnauthenticatedError();
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) throw new UnauthenticatedError();
    if (!isManager(staff)) throw new ForbiddenError();
    return staff;
  }

  async function onlineSourceRecord(
    delivered: DeliveredOnlineOrderSource,
    allocations: ProtectedOrderAllocationProvenance[],
    store: ReturnsStore,
  ): Promise<ReturnSourceRecord> {
    const lineIds = delivered.confirmedQuote.lines.map((line) => line.id);
    const usage = await store.getSourceUsage(
      { kind: "delivered_online_order", id: delivered.orderId },
      lineIds,
    );
    return {
      source: { kind: "delivered_online_order", id: delivered.orderId },
      reference: delivered.reference,
      channel: "online",
      branchId: null,
      seller: null,
      receivedAt: delivered.customerReceivedAt,
      returnDeadlineAt: delivered.returnDeadlineAt,
      originalPayment: {
        merchandisePiasters: delivered.confirmedQuote.merchandiseTotalPiasters,
        checkoutChargePiasters: delivered.confirmedQuote.deliveryFeePiasters,
        totalPiasters: delivered.confirmedQuote.finalTotalPiasters,
      },
      availableCheckoutChargePiasters: usage.checkoutChargeAlreadyAuthorized
        ? 0
        : delivered.confirmedQuote.deliveryFeePiasters,
      customerName: delivered.customerName,
      customerPhone: delivered.primaryPhone,
      lines: delivered.confirmedQuote.lines.map((line, lineIndex) => {
        return {
          id: line.id,
          variantId: line.variantId,
          lineIndex,
          quantity: line.quantity,
          paidPiasters: line.merchandiseTotalPiasters,
          acceptedNames: {
            productNameAr: line.productNameAr,
            sizeNameAr: line.sizeNameAr,
            colorNameAr: line.colorNameAr,
          },
          units: line.units.map((unit) => {
            const returnedRanges = usage.returnedRangesByOnlineUnit.get(`${line.id}:${unit.unitIndex}`) ?? [];
            const alreadyReturnedQuantity = returnedRanges.reduce((sum, range) => sum + range.quantity, 0);
            return {
              id: `${line.id}:${unit.unitIndex}`,
              sourceType: "online" as const,
              lineId: line.id,
              variantId: line.variantId,
              unitIndex: unit.unitIndex,
              quantity: unit.quantity,
              paidPiasters: unit.paidPiasters,
              alreadyReturnedQuantity,
              returnedRanges,
            };
          }),
        };
      }),
      allocations: allocations.map((allocation) => ({
        allocationId: allocation.allocationId,
        sourceLineId: allocation.sourceLineId,
        batchId: allocation.batchId,
        variantId: allocation.variantId,
        quantity: allocation.quantity,
        unitCostPiasters: allocation.unitCostPiasters,
        effectiveUnitCostPiasters: allocation.effectiveUnitCostPiasters,
        recordedAt: allocation.allocatedAt,
      })),
    };
  }

  async function getSourceOutside(source: ReturnSourceKeyDto): Promise<ReturnSourceRecord | null> {
    if (source.kind === "physical_sale") return ports.returns.getPhysicalSource(source.id);
    const delivered = await ports.onlineSources.getDeliveredSource(source.id);
    if (!delivered) return null;
    const allocations = await ports.inventoryReads.listProtectedOrderAllocations(source.id);
    return onlineSourceRecord(delivered, allocations, ports.returns);
  }

  async function getSourceInTransaction(
    tx: ReturnsTransaction,
    source: ReturnSourceKeyDto,
  ): Promise<ReturnSourceRecord | null> {
    if (source.kind === "physical_sale") return tx.returns.getPhysicalSource(source.id, true);
    const delivered = await tx.onlineSources.getDeliveredSource(source.id, true);
    if (!delivered) return null;
    const allocations = await tx.inventory.lockProtectedOrderAllocations(source.id);
    return onlineSourceRecord(delivered, allocations, tx.returns);
  }

  async function sourceDto(source: ReturnSourceRecord): Promise<ReturnSourceDto> {
    const [branches, identities] = await Promise.all([
      ports.actors.listBranches(),
      ports.variants.getVariants(source.lines.map((line) => line.variantId)),
    ]);
    const branch = source.branchId ? branches.find((item) => item.id === source.branchId) ?? null : null;
    if (source.channel === "physical" && !branch) throw new ReturnsValidationError("فرع البيع الأصلي غير موجود.");
    const byId = new Map(identities.map((item) => [item.id, item]));
    return {
      source: source.source,
      ...(source.source.kind === "physical_sale" ? { saleId: source.source.id } : {}),
      reference: source.reference,
      channel: source.channel,
      originalBranch: branch,
      seller: source.seller,
      ...(source.seller ? { soldByStaffId: source.seller.staffId, soldByDisplayName: source.seller.displayName } : {}),
      receivedAt: source.receivedAt.toISOString(),
      returnDeadlineAt: source.returnDeadlineAt.toISOString(),
      originalPayment: source.originalPayment,
      availableCheckoutChargePiasters: source.availableCheckoutChargePiasters,
      finalTotalPiasters: source.originalPayment.totalPiasters,
      customerName: source.customerName,
      customerPhone: source.customerPhone,
      lines: source.lines.map((line) => {
        const currentVariant = byId.get(line.variantId);
        if (!currentVariant) throw new ReturnsValidationError("المتغير المحدد غير موجود.");
        const variant = line.acceptedNames ? {
          ...currentVariant,
          product: { ...currentVariant.product, nameAr: line.acceptedNames.productNameAr },
          size: { ...currentVariant.size, nameAr: line.acceptedNames.sizeNameAr },
          color: { ...currentVariant.color, nameAr: line.acceptedNames.colorNameAr },
        } : currentVariant;
        const returnedQuantity = line.units.reduce((sum, unit) => sum + unit.alreadyReturnedQuantity, 0);
        const remainingSuggestedPiasters = line.units.reduce(
          (sum, unit) => sum + (unit.quantity - unit.alreadyReturnedQuantity) * unit.paidPiasters,
          0,
        );
        return {
          sourceLineId: line.id,
          ...(source.source.kind === "physical_sale" ? { saleLineId: line.id } : {}),
          variantId: line.variantId,
          variant,
          purchasedQuantity: line.quantity,
          returnedQuantity,
          remainingQuantity: line.quantity - returnedQuantity,
          paidPiasters: line.paidPiasters,
          remainingSuggestedPiasters,
          availablePaidRanges: line.units
            .map((unit) => ({
              quantity: unit.quantity - unit.alreadyReturnedQuantity,
              paidUnitPiasters: unit.paidPiasters,
            }))
            .filter((range) => range.quantity > 0),
        };
      }),
    };
  }

  async function hydrate(record: ReturnRecord): Promise<ReturnDto> {
    const [source, corrected, exchangeRecord] = await Promise.all([
      getSourceOutside(record.source),
      record.status === "posted" ? ports.corrections.getEffectiveReturn(record.id) : Promise.resolve(null),
      ports.returns.getExchangeByReturnId(record.id),
    ]);
    if (!source) throw new ReturnsValidationError("تعذر العثور على البيع الأصلي.");
    const [sourceValue, branches, identities, refundActor] = await Promise.all([
      sourceDto(source),
      ports.actors.listBranches(),
      ports.variants.getVariants(record.lines.map((line) => line.variantId)),
      record.refundRecordedByStaffId ? ports.actors.getStaff(record.refundRecordedByStaffId) : Promise.resolve(null),
    ]);
    const handlingBranch = branches.find((item) => item.id === record.handlingBranchId);
    if (!handlingBranch) throw new ReturnsValidationError("فرع معالجة الإرجاع غير موجود.");
    const byId = new Map(identities.map((item) => [item.id, item]));
    const refund = projectEffectiveRefund({
      recordStatus: record.status,
      originalAuthorizedPiasters: record.authorizedRefundPiasters,
      originalPaidPiasters: record.refundPaidPiasters,
      exchangeCreditAppliedPiasters: record.exchangeCreditAppliedPiasters,
      corrected,
    });
    const exchange = exchangeRecord ? await hydrateExchange(exchangeRecord, refund) : null;
    const correctedLines = new Map((corrected?.lines ?? []).map((line) => [line.returnLineId, line]));
    return {
      id: record.id,
      operationId: record.operationId,
      status: record.status,
      revision: record.revision,
      source: sourceValue,
      handlingBranch,
      suggestedRefundPiasters: record.suggestedRefundPiasters,
      suggestedRefund: record.suggestedRefund,
      authorizedRefund: corrected?.authorizedRefund ?? record.authorizedRefund,
      originalAuthorizedRefund: record.authorizedRefund,
      authorizedRefundPiasters: refund.authorizedPiasters,
      originalAuthorizedRefundPiasters: record.authorizedRefundPiasters,
      effectiveStatus: refund.effectiveStatus,
      correctionRevision: refund.correctionRevision,
      createdByStaffId: record.createdByStaffId,
      createdAt: record.createdAt.toISOString(),
      updatedByStaffId: record.updatedByStaffId,
      updatedAt: record.updatedAt.toISOString(),
      postedByStaffId: record.postedByStaffId,
      postedAt: record.postedAt?.toISOString() ?? null,
      lines: record.lines.map((line) => {
        const variant = byId.get(line.variantId);
        if (!variant) throw new ReturnsValidationError("المتغير المحدد غير موجود.");
        const effectiveLine = correctedLines.get(line.id);
        const quantity = effectiveLine?.quantity ?? line.quantity;
        const sellableQuantity = effectiveLine?.sellableQuantity ?? line.sellableQuantity;
        return {
          id: line.id,
          sourceLineId: line.sourceLineId,
          ...(record.source.kind === "physical_sale" ? { sourceSaleLineId: line.sourceLineId } : {}),
          variantId: line.variantId,
          variant,
          quantity,
          sellableQuantity,
          unsellableQuantity: quantity - sellableQuantity,
          suggestedRefundPiasters: line.suggestedRefundPiasters,
        };
      }),
      restorations: record.restorations.map((item) => ({
        batchId: item.batchId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitCostPiasters: item.unitCostPiasters,
        effectiveUnitCostPiasters: item.effectiveUnitCostPiasters,
      })),
      exchange,
      refund: {
        status: refund.status,
        owedPiasters: refund.owedPiasters,
        overpaidPiasters: refund.overpaidPiasters,
        paidPiasters: refund.paidPiasters,
        recordedByStaffId: record.refundRecordedByStaffId,
        recordedByDisplayName: refundActor?.displayName ?? null,
        recordedAt: record.refundRecordedAt?.toISOString() ?? null,
        events: record.refundEvents.map(toEventDto),
      },
    };
  }

  async function hydrateExchange(
    record: ReturnExchangeRecord,
    refund: ReturnType<typeof projectEffectiveRefund>,
  ) {
    const sale = await ports.replacementSales.getById(record.replacementSaleId);
    if (!sale) throw new ReturnsValidationError("تعذر العثور على بيع الاستبدال.");
    const allocations = await ports.replacementSales.listAllocations(sale.operationId);
    const completedBy = await ports.actors.getStaff(record.completedByStaffId);
    const cashRefundStatus: "none" | "owed" | "paid" | "cancelled" = refund.effectiveStatus === "cancelled"
      ? "cancelled"
      : refund.status === "owed"
        ? "owed"
        : refund.status === "paid" || refund.status === "overpaid"
          ? "paid"
          : "none";
    return {
      id: record.id,
      operationId: record.operationId,
      replacementSaleId: record.replacementSaleId,
      replacementMerchandisePiasters: sale.finalTotalPiasters,
      creditAppliedPiasters: record.creditAppliedPiasters,
      cashCollectedPiasters: record.cashCollectedPiasters,
      cashRefund: {
        acceptedStatus: record.cashRefundStatus,
        acceptedAmountPiasters: record.cashRefundPiasters,
        status: cashRefundStatus,
        owedPiasters: refund.owedPiasters,
        paidPiasters: refund.paidPiasters,
      },
      allocations: allocations.map((item) => ({
        batchId: item.batchId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitCostPiasters: item.unitCostPiasters,
        effectiveUnitCostPiasters: item.effectiveUnitCostPiasters,
      })),
      completedByStaffId: record.completedByStaffId,
      completedByDisplayName: completedBy?.displayName ?? record.completedByStaffId,
      completedAt: record.completedAt.toISOString(),
    };
  }

  function exchangeQuoteDto(record: import("./ports.ts").ReturnExchangeQuoteRecord): ReturnExchangeQuoteDto {
    const creditAppliedPiasters = Math.min(record.creditAvailablePiasters, record.acceptedQuote.finalTotalPiasters);
    return {
      id: record.id,
      returnId: record.returnId,
      returnRevision: record.returnRevision,
      correctionRevision: record.correctionRevision,
      settlement: record.settlement,
      replacementMerchandisePiasters: record.acceptedQuote.finalTotalPiasters,
      creditAvailablePiasters: record.creditAvailablePiasters,
      creditAppliedPiasters,
      cashCollectedPiasters: record.acceptedQuote.finalTotalPiasters - creditAppliedPiasters,
      cashRefundPiasters: record.creditAvailablePiasters - creditAppliedPiasters,
      appliedAutomaticOffer: record.acceptedQuote.appliedAutomaticOffer,
      lines: record.acceptedQuote.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        listedUnitPricePiasters: line.listedUnitPricePiasters,
        paidPiasters: line.paidPiasters,
      })),
      quotedAt: record.quotedAt.toISOString(),
    };
  }

  return {
    async listSources(auth, input) {
      await requireManager(auth);
      const search = parseSearch(input);
      const physical = search.channel === "online" ? [] : await ports.returns.listPhysicalSources(search);
      const onlineRows = search.channel === "physical" || search.branchId
        ? []
        : await ports.onlineSources.listDeliveredSources(search);
      const online = await Promise.all(onlineRows.map(async (delivered) => onlineSourceRecord(
        delivered,
        await ports.inventoryReads.listProtectedOrderAllocations(delivered.orderId),
        ports.returns,
      )));
      const rows = [...physical, ...online]
        .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime())
        .slice(0, 100);
      return Promise.all(rows.map(sourceDto));
    },

    async createDraft(auth, input) {
      const manager = await requireManager(auth);
      const command = parseDraft(input);
      if (!canUseBranch(manager, command.handlingBranchId)) throw new ForbiddenError();
      const fingerprint = fingerprintReturnPayload({
        source: command.source,
        handlingBranchId: command.handlingBranchId,
        authorizedRefund: command.authorizedRefund,
        lines: command.lines,
      });
      const outcome = await ports.uow.run(async (tx) => {
        await tx.inventory.lockStockClock("update");
        await tx.returns.lockIdentities(command.returnId, command.operationId);
        const byId = await tx.returns.getById(command.returnId);
        const byOperation = await tx.returns.getByOperationId(command.operationId);
        const existing = byId ?? byOperation;
        if (existing) {
          if (existing.id !== command.returnId || existing.operationId !== command.operationId || existing.payloadFingerprint !== fingerprint) {
            throw new OperationConflictError();
          }
          return { record: existing, created: false };
        }
        const source = await getSourceInTransaction(tx, command.source);
        if (!source) throw new NotFoundError("تعذر العثور على المصدر الأصلي.");
        const plan = planReturn(source, command.lines);
        const lines: ReturnLineWrite[] = plan.lines.map((line, lineIndex) => ({
          id: crypto.randomUUID(),
          sourceLineId: line.sourceLineId,
          variantId: line.variantId,
          quantity: line.quantity,
          sellableQuantity: line.sellableQuantity,
          suggestedRefundPiasters: line.suggestedRefundPiasters,
          lineIndex,
        }));
        const inserted = await tx.returns.insertDraft({
          id: command.returnId,
          operationId: command.operationId,
          source: command.source,
          handlingBranchId: command.handlingBranchId,
          status: "draft",
          revision: 1,
          payloadFingerprint: fingerprint,
          draftPayloadFingerprint: fingerprint,
          suggestedRefundPiasters: plan.suggestedRefundPiasters,
          authorizedRefundPiasters: command.authorizedRefund.totalPiasters,
          suggestedRefund: plan.suggestedRefund,
          authorizedRefund: command.authorizedRefund,
          createdByStaffId: manager.id,
          updatedByStaffId: manager.id,
          lines,
        });
        return { record: inserted.record, created: inserted.kind === "created" };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async updateDraft(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const command = parseDraftUpdate(input);
      const record = await ports.uow.run(async (tx) => {
        const sourceKey = await tx.returns.getSourceKey(returnId);
        if (!sourceKey) throw new NotFoundError("الإرجاع غير موجود.");
        await tx.inventory.lockStockClock("update");
        const source = await getSourceInTransaction(tx, sourceKey);
        if (!source) throw new NotFoundError("تعذر العثور على المصدر الأصلي.");
        const existing = await tx.returns.getById(returnId, true);
        if (!existing) throw new NotFoundError("الإرجاع غير موجود.");
        if (existing.source.kind !== sourceKey.kind || existing.source.id !== sourceKey.id) throw new OperationConflictError();
        if (!canUseBranch(manager, command.handlingBranchId)) throw new ForbiddenError();
        const fingerprint = fingerprintReturnPayload({
          source: existing.source,
          handlingBranchId: command.handlingBranchId,
          authorizedRefund: command.authorizedRefund,
          lines: command.lines,
        });
        if (
          existing.status === "draft"
          && existing.revision === command.expectedRevision + 1
          && existing.draftPayloadFingerprint === fingerprint
        ) {
          return existing;
        }
        if (existing.status !== "draft") {
          throw new OperationConflictError("لا يمكن تعديل الإرجاع بعد ترحيله.");
        }
        if (existing.revision !== command.expectedRevision) {
          throw new OperationConflictError("تغيرت المسودة. أعد تحميلها قبل حفظ التعديل.");
        }
        const plan = planReturn(source, command.lines);
        return tx.returns.updateDraft({
          returnId,
          expectedRevision: command.expectedRevision,
          handlingBranchId: command.handlingBranchId,
          draftPayloadFingerprint: fingerprint,
          suggestedRefundPiasters: plan.suggestedRefundPiasters,
          authorizedRefundPiasters: command.authorizedRefund.totalPiasters,
          suggestedRefund: plan.suggestedRefund,
          authorizedRefund: command.authorizedRefund,
          updatedByStaffId: manager.id,
          updatedAt: clock.now(),
          lines: plan.lines.map((line, lineIndex) => ({
            id: crypto.randomUUID(),
            sourceLineId: line.sourceLineId,
            variantId: line.variantId,
            quantity: line.quantity,
            sellableQuantity: line.sellableQuantity,
            suggestedRefundPiasters: line.suggestedRefundPiasters,
            lineIndex,
          })),
        });
      });
      return hydrate(record);
    },

    async post(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const body = expectObject(input, "بيانات استلام الإرجاع غير صالحة.");
      assertAllowedKeys(body, POST_KEYS, "بيانات استلام الإرجاع غير صالحة.");
      if (body.receivedAndInspected !== true) {
        throw new ReturnsValidationError("يجب تأكيد استلام الأصناف وفحصها.");
      }
      const expectedRevision = positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة.");
      const outcome = await ports.uow.run(async (tx) => {
        const sourceKey = await tx.returns.getSourceKey(returnId);
        if (!sourceKey) throw new NotFoundError("الإرجاع غير موجود.");
        await tx.inventory.lockStockClock("update");
        const source = await getSourceInTransaction(tx, sourceKey);
        if (!source) throw new ReturnsValidationError("تعذر العثور على المصدر الأصلي.");
        const record = await tx.returns.getById(returnId, true);
        if (!record) throw new NotFoundError("الإرجاع غير موجود.");
        if (record.source.kind !== sourceKey.kind || record.source.id !== sourceKey.id) throw new OperationConflictError();
        if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
        if (record.revision !== expectedRevision) {
          throw new OperationConflictError("تغيرت المسودة. أعد تحميلها قبل ترحيل الإرجاع.");
        }
        if (record.status === "posted") return { record, created: false };
        await tx.inventory.assertStockMutationAllowed();
        const now = clock.now();
        if (now.getTime() > source.returnDeadlineAt.getTime()) throw new ReturnWindowExpiredError();
        const plan = planReturn(source, record.lines.map((line) => ({
          sourceLineId: line.sourceLineId,
          quantity: line.quantity,
          sellableQuantity: line.sellableQuantity,
        })));
        if (plan.suggestedRefundPiasters !== record.suggestedRefundPiasters
          || plan.suggestedRefund.checkoutChargePiasters !== record.suggestedRefund.checkoutChargePiasters) {
          throw new OperationConflictError("تغيرت الكميات المتاحة للإرجاع. أنشئ مسودة جديدة.");
        }
        const claimed = await tx.inventory.claimReturnOperation({
          operationId: record.operationId,
          payloadFingerprint: record.draftPayloadFingerprint,
          actorStaffId: manager.id,
        });
        if (claimed.kind === "replay") {
          const replay = await tx.returns.getByOperationId(record.operationId);
          if (!replay?.postedAt) throw new OperationConflictError();
          return { record: replay, created: false };
        }
        const lineIdBySource = new Map(record.lines.map((line) => [line.sourceLineId, line.id]));
        const units: ReturnUnitWrite[] = plan.units.map((unit) => ({
          id: crypto.randomUUID(),
          returnLineId: lineIdBySource.get(unit.sourceLineId) ?? "",
          sourceSaleUnitId: unit.sourceSaleUnitId,
          sourceRecordingSaleUnitId: unit.sourceRecordingSaleUnitId,
          sourceOnlineOrderLineId: unit.sourceOnlineOrderLineId,
          sourceOnlineOrderUnitIndex: unit.sourceOnlineOrderUnitIndex,
          startOffset: unit.startOffset,
          quantity: unit.quantity,
          paidUnitPiasters: unit.paidUnitPiasters,
        }));
        if (units.some((unit) => !unit.returnLineId)) throw new ReturnsValidationError("بيانات أصناف الإرجاع غير متطابقة.");
        const restorations: ReturnRestorationWrite[] = plan.restorations.map((item) => ({
          id: crypto.randomUUID(),
          ...item,
        }));
        if (record.source.kind === "delivered_online_order" && plan.protectionEffects.length > 0) {
          await tx.inventory.adjustDeliveredReturnProtection({
            orderId: record.source.id,
            operationId: record.operationId,
            recordedAt: claimed.recordedAt,
            effects: plan.protectionEffects,
          });
        }
        for (const item of restorations) {
          await tx.inventory.restoreToOriginalBatch({
            operationId: record.operationId,
            batchId: item.batchId,
            variantId: item.variantId,
            quantity: item.quantity,
            recordedAt: claimed.recordedAt,
          });
        }
        const posted = await tx.returns.post({
          returnId: record.id,
          postedByStaffId: manager.id,
          postedAt: claimed.recordedAt,
          units,
          restorations,
        });
        if (restorations.length > 0) await tx.inventory.bumpStockVersion();
        return { record: posted, created: true };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async markPaid(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const body = expectObject(input, "بيانات دفع الاسترداد غير صالحة.");
      assertAllowedKeys(body, PAY_KEYS, "بيانات دفع الاسترداد غير صالحة.");
      if (body.status !== "paid") throw new ReturnsValidationError("حالة دفع الاسترداد غير صالحة.");
      const operationId = assertUuid(body.operationId, "معرّف العملية غير صالح.");
      const amountPiasters = nonnegativeMoney(body.amountPiasters, "قيمة الاسترداد المدفوعة غير صالحة.");
      const fingerprint = fingerprintRefundPayment(returnId, amountPiasters);
      const outcome = await ports.uow.run(async (tx) => {
        const record = await tx.returns.getById(returnId, true);
        if (!record) throw new NotFoundError("الإرجاع غير موجود.");
        if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
        if (record.status !== "posted") throw new ReturnsValidationError("يجب ترحيل الإرجاع قبل تسجيل الدفع.");
        const existingEvent = await tx.returns.getRefundEventByOperation(operationId);
        if (existingEvent) {
          if (existingEvent.returnId !== returnId || existingEvent.payloadFingerprint !== fingerprint) {
            throw new OperationConflictError();
          }
          return { record, created: false };
        }
        const effective = await tx.corrections.getEffectiveReturn(returnId);
        const refund = projectEffectiveRefund({
          recordStatus: record.status,
          originalAuthorizedPiasters: record.authorizedRefundPiasters,
          originalPaidPiasters: record.refundPaidPiasters,
          exchangeCreditAppliedPiasters: record.exchangeCreditAppliedPiasters,
          corrected: effective,
        });
        if (!effective || refund.effectiveStatus === "cancelled") {
          throw new OperationConflictError("أُلغي تسجيل هذا الإرجاع ولا يمكن دفع استرداد له.");
        }
        const outstandingPiasters = refund.owedPiasters;
        if (outstandingPiasters === 0) {
          throw new OperationConflictError("لا يوجد مبلغ استرداد نقدي مستحق لهذا الإرجاع.");
        }
        if (amountPiasters !== outstandingPiasters) {
          throw new ReturnsValidationError("يجب أن يساوي المبلغ المدفوع الرصيد الفعلي المستحق.");
        }
        const result = await tx.returns.markPaid({
          returnId,
          operationId,
          amountPiasters,
          payloadFingerprint: fingerprint,
          actorStaffId: manager.id,
          recordedAt: clock.now(),
        });
        return { record: result.record, created: result.kind === "created" };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async quoteExchange(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const command = parseExchangeQuote(input);
      const record = await ports.returns.getById(returnId);
      if (!record) throw new NotFoundError("الإرجاع غير موجود.");
      if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
      if (record.revision !== command.expectedRevision) {
        throw new OperationConflictError("تغيرت بيانات الإرجاع. أعد تحميلها قبل عرض فرق الاستبدال.");
      }
      if (await ports.returns.getExchangeByReturnId(returnId)) {
        throw new OperationConflictError("تم تسجيل استبدال لهذا الإرجاع بالفعل.");
      }
      let correctionRevision = 0;
      let creditAvailablePiasters = record.authorizedRefundPiasters;
      if (record.status === "posted") {
        const effective = await ports.corrections.getEffectiveReturn(returnId);
        if (!effective || effective.status === "cancelled") {
          throw new OperationConflictError("أُلغي تسجيل هذا الإرجاع ولا يمكن استبداله.");
        }
        if (effective.paidPiasters > 0) {
          throw new OperationConflictError("سُدد الاسترداد النقدي لهذا الإرجاع بالفعل ولا يمكن استخدامه كرصيد استبدال.");
        }
        correctionRevision = effective.revision;
        creditAvailablePiasters = effective.authorizedRefundPiasters ?? record.authorizedRefundPiasters;
      }
      const payloadFingerprint = fingerprintExchangeQuotePayload({
        returnId,
        returnRevision: record.revision,
        correctionRevision,
        creditAvailablePiasters,
        settlement: command.settlement,
        replacementLines: command.replacementLines,
      });
      const existing = await ports.returns.getExchangeQuoteById(command.quoteId);
      if (existing) {
        if (existing.returnId !== returnId || existing.payloadFingerprint !== payloadFingerprint) {
          throw new OperationConflictError();
        }
        return { value: exchangeQuoteDto(existing), created: false };
      }
      const quotedAt = clock.now();
      const acceptedQuote = await ports.replacementPricing.quote(command.replacementLines, quotedAt);
      const inserted = await ports.returns.insertExchangeQuote({
        id: command.quoteId,
        returnId,
        returnRevision: record.revision,
        correctionRevision,
        creditAvailablePiasters,
        settlement: command.settlement,
        payloadFingerprint,
        acceptedQuote,
        quotedByStaffId: manager.id,
        quotedAt,
      });
      if (inserted.kind === "existing" && inserted.record.payloadFingerprint !== payloadFingerprint) {
        throw new OperationConflictError();
      }
      return { value: exchangeQuoteDto(inserted.record), created: inserted.kind === "created" };
    },

    async exchange(auth, id, input) {
      const manager = await requireManager(auth);
      const returnId = assertUuid(id, "الإرجاع غير موجود.");
      const command = parseExchange(input);
      const fingerprint = fingerprintExchangePayload({
        returnId,
        replacementSaleId: command.replacementSaleId,
        replacementSaleOperationId: command.replacementSaleOperationId,
        quoteId: command.quoteId,
        expectedRevision: command.expectedRevision,
        cashRefundStatus: command.cashRefundStatus,
      });
      const outcome = await ports.uow.run(async (tx) => {
        const sourceKey = await tx.returns.getSourceKey(returnId);
        if (!sourceKey) throw new NotFoundError("الإرجاع غير موجود.");
        await tx.inventory.lockStockClock("update");
        const source = await getSourceInTransaction(tx, sourceKey);
        if (!source) throw new ReturnsValidationError("تعذر العثور على المصدر الأصلي.");
        const record = await tx.returns.getById(returnId, true);
        if (!record) throw new NotFoundError("الإرجاع غير موجود.");
        if (record.source.kind !== sourceKey.kind || record.source.id !== sourceKey.id) throw new OperationConflictError();
        if (!canUseBranch(manager, record.handlingBranchId)) throw new ForbiddenError();
        await tx.returns.lockIdentities(command.exchangeId, command.operationId);
        const existingByReturn = await tx.returns.getExchangeByReturnId(returnId, true);
        const existingById = await tx.returns.getExchangeById(command.exchangeId);
        const existingByOperation = await tx.returns.getExchangeByOperationId(command.operationId);
        const existing = existingByReturn ?? existingById ?? existingByOperation;
        if (existing) {
          if (existing.id !== command.exchangeId || existing.operationId !== command.operationId
            || existing.returnId !== returnId || existing.replacementSaleId !== command.replacementSaleId
            || existing.payloadFingerprint !== fingerprint) {
            throw new OperationConflictError();
          }
          return { record, created: false };
        }
        await tx.inventory.assertStockMutationAllowed();
        if (record.revision !== command.expectedRevision) {
          throw new OperationConflictError("تغيرت المسودة. أعد تحميلها قبل إتمام الاستبدال.");
        }
        const quote = await tx.returns.getExchangeQuoteById(command.quoteId);
        if (!quote || quote.returnId !== returnId || quote.returnRevision !== record.revision) {
          throw new OperationConflictError("تغيرت بيانات الاستبدال. اعرض السعر والفرق من جديد.");
        }
        if (quote.settlement.exchangeId !== command.exchangeId
          || quote.settlement.operationId !== command.operationId
          || quote.settlement.replacementSaleId !== command.replacementSaleId
          || quote.settlement.replacementSaleOperationId !== command.replacementSaleOperationId) {
          throw new OperationConflictError("عرض السعر لا يخص عملية الاستبدال الحالية. اعرض السعر والفرق من جديد.");
        }
        let completedAt = clock.now();
        let posted = record;
        let creditAvailablePiasters = record.authorizedRefundPiasters;
        let correctionRevision = 0;
        if (record.status === "draft") {
          if (!command.receivedAndInspected) throw new ReturnsValidationError("يجب تأكيد استلام الأصناف وفحصها.");
          if (completedAt.getTime() > source.returnDeadlineAt.getTime()) throw new ReturnWindowExpiredError();
          const plan = planReturn(source, record.lines.map((line) => ({
            sourceLineId: line.sourceLineId,
            quantity: line.quantity,
            sellableQuantity: line.sellableQuantity,
          })));
          if (plan.suggestedRefundPiasters !== record.suggestedRefundPiasters
            || plan.suggestedRefund.checkoutChargePiasters !== record.suggestedRefund.checkoutChargePiasters) {
            throw new OperationConflictError("تغيرت الكميات المتاحة للإرجاع. أنشئ مسودة جديدة.");
          }
          const claimed = await tx.inventory.claimReturnOperation({
            operationId: record.operationId,
            payloadFingerprint: record.draftPayloadFingerprint,
            actorStaffId: manager.id,
          });
          if (claimed.kind === "replay") throw new OperationConflictError();
          completedAt = claimed.recordedAt;
          const lineIdBySource = new Map(record.lines.map((line) => [line.sourceLineId, line.id]));
          const units: ReturnUnitWrite[] = plan.units.map((unit) => ({
            id: crypto.randomUUID(),
            returnLineId: lineIdBySource.get(unit.sourceLineId) ?? "",
            sourceSaleUnitId: unit.sourceSaleUnitId,
            sourceRecordingSaleUnitId: unit.sourceRecordingSaleUnitId,
            sourceOnlineOrderLineId: unit.sourceOnlineOrderLineId,
            sourceOnlineOrderUnitIndex: unit.sourceOnlineOrderUnitIndex,
            startOffset: unit.startOffset,
            quantity: unit.quantity,
            paidUnitPiasters: unit.paidUnitPiasters,
          }));
          if (units.some((unit) => !unit.returnLineId)) throw new ReturnsValidationError("بيانات أصناف الإرجاع غير متطابقة.");
          const restorations: ReturnRestorationWrite[] = plan.restorations.map((item) => ({ id: crypto.randomUUID(), ...item }));
          if (record.source.kind === "delivered_online_order" && plan.protectionEffects.length > 0) {
            await tx.inventory.adjustDeliveredReturnProtection({
              orderId: record.source.id,
              operationId: record.operationId,
              recordedAt: completedAt,
              effects: plan.protectionEffects,
            });
          }
          for (const item of restorations) {
            await tx.inventory.restoreToOriginalBatch({
              operationId: record.operationId,
              batchId: item.batchId,
              variantId: item.variantId,
              quantity: item.quantity,
              recordedAt: completedAt,
            });
          }
          posted = await tx.returns.post({
            returnId,
            postedByStaffId: manager.id,
            postedAt: completedAt,
            units,
            restorations,
          });
        } else {
          const effective = await tx.corrections.getEffectiveReturn(returnId);
          if (!effective || effective.status === "cancelled") {
            throw new OperationConflictError("أُلغي تسجيل هذا الإرجاع ولا يمكن استبداله.");
          }
          if (effective.paidPiasters > 0) {
            throw new OperationConflictError("سُدد الاسترداد النقدي لهذا الإرجاع بالفعل ولا يمكن استخدامه كرصيد استبدال.");
          }
          creditAvailablePiasters = effective.authorizedRefundPiasters ?? record.authorizedRefundPiasters;
          correctionRevision = effective.revision;
        }
        if (quote.correctionRevision !== correctionRevision || quote.creditAvailablePiasters !== creditAvailablePiasters) {
          throw new OperationConflictError("تغير رصيد الإرجاع. اعرض السعر والفرق من جديد قبل تسليم النقد.");
        }
        const replacement = await tx.replacementSales.create({
          saleId: command.replacementSaleId,
          operationId: command.replacementSaleOperationId,
          payloadFingerprint: fingerprint,
          branchId: record.handlingBranchId,
          actorStaffId: manager.id,
          actorDisplayName: manager.displayName,
          occurredAt: completedAt,
          creditAvailablePiasters,
          acceptedQuote: quote.acceptedQuote,
        });
        const cashRefundPiasters = creditAvailablePiasters - replacement.creditAppliedPiasters;
        const cashRefundStatus = cashRefundPiasters === 0 ? "none" : command.cashRefundStatus;
        await tx.returns.insertExchange({
          id: command.exchangeId,
          operationId: command.operationId,
          returnId,
          replacementSaleId: replacement.sale.id,
          payloadFingerprint: fingerprint,
          creditAvailablePiasters,
          creditAppliedPiasters: replacement.creditAppliedPiasters,
          cashCollectedPiasters: replacement.cashCollectedPiasters,
          cashRefundStatus,
          cashRefundPiasters,
          cashRefundPaidPiasters: cashRefundStatus === "paid" ? cashRefundPiasters : 0,
          completedByStaffId: manager.id,
          completedAt,
        });
        await tx.inventory.bumpStockVersion();
        return { record: await tx.returns.getById(posted.id) ?? posted, created: true };
      });
      return { value: await hydrate(outcome.record), created: outcome.created };
    },

    async list(auth, input) {
      await requireManager(auth);
      const page = parseReturnList(input);
      const result = await ports.returns.listPage(page);
      return {
        items: await Promise.all(result.items.map(async (row) => {
          const corrected = row.status === "posted"
            ? await ports.corrections.getEffectiveReturn(row.id)
            : null;
          const refund = projectEffectiveRefund({
            recordStatus: row.status,
            originalAuthorizedPiasters: row.authorizedRefundPiasters,
            originalPaidPiasters: 0,
            exchangeCreditAppliedPiasters: (await ports.returns.getById(row.id))?.exchangeCreditAppliedPiasters ?? 0,
            corrected,
          });
          return {
            ...row,
            authorizedRefund: corrected?.authorizedRefund ?? row.authorizedRefund,
            authorizedRefundPiasters: refund.authorizedPiasters,
            originalAuthorizedRefundPiasters: row.authorizedRefundPiasters,
            effectiveStatus: refund.effectiveStatus,
            correctionRevision: refund.correctionRevision,
            refundStatus: refund.status,
            createdAt: row.createdAt.toISOString(),
            postedAt: row.postedAt?.toISOString() ?? null,
          };
        })),
        nextCursor: result.nextCursor,
      };
    },

    async get(auth, id) {
      await requireManager(auth);
      const record = await ports.returns.getById(assertUuid(id, "الإرجاع غير موجود."));
      if (!record) throw new NotFoundError("الإرجاع غير موجود.");
      return hydrate(record);
    },
  };
}

function projectEffectiveRefund(input: {
  recordStatus: "draft" | "posted";
  originalAuthorizedPiasters: number;
  originalPaidPiasters: number;
  exchangeCreditAppliedPiasters: number;
  corrected: EffectiveReturnState | null;
}) {
  const effectiveStatus = input.corrected?.status ?? "active";
  const authorizedPiasters = effectiveStatus === "active"
    ? input.corrected?.authorizedRefundPiasters ?? input.originalAuthorizedPiasters
    : 0;
  const paidPiasters = input.corrected?.paidPiasters ?? input.originalPaidPiasters;
  const activePosted = input.recordStatus === "posted" && effectiveStatus === "active";
  const owedPiasters = activePosted
    ? Math.max(0, authorizedPiasters - input.exchangeCreditAppliedPiasters - paidPiasters)
    : 0;
  const overpaidPiasters = activePosted
    ? Math.max(0, input.exchangeCreditAppliedPiasters + paidPiasters - authorizedPiasters)
    : 0;
  const status: ReturnDto["refund"]["status"] = input.recordStatus === "draft"
    ? "none"
    : effectiveStatus === "cancelled"
      ? "cancelled"
      : owedPiasters > 0
        ? "owed"
        : overpaidPiasters > 0
          ? "overpaid"
          : input.exchangeCreditAppliedPiasters > 0 && paidPiasters === 0
            ? "none"
            : "paid";
  return {
    effectiveStatus,
    correctionRevision: input.corrected?.revision ?? 0,
    authorizedPiasters,
    paidPiasters,
    owedPiasters,
    overpaidPiasters,
    status,
  };
}

type RequestedLine = { sourceLineId: string; quantity: number; sellableQuantity: number };

function planReturn(source: ReturnSourceRecord, requested: RequestedLine[]) {
  const sourceByLine = new Map(source.lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const selected: Array<{
    sourceLineId: string;
    sourceSaleUnitId: string | null;
    sourceRecordingSaleUnitId: string | null;
    sourceOnlineOrderLineId: string | null;
    sourceOnlineOrderUnitIndex: number | null;
    variantId: string;
    startOffset: number;
    quantity: number;
    paidUnitPiasters: number;
    variantOrdinal: number;
    sellableQuantity: number;
  }> = [];
  const linePlans: Array<{
    sourceLineId: string;
    variantId: string;
    quantity: number;
    sellableQuantity: number;
    suggestedRefundPiasters: number;
  }> = [];
  const variantPrefixes = unitVariantPrefixes(source);

  for (const request of requested) {
    if (seen.has(request.sourceLineId)) throw new ReturnsValidationError("لا تكرر صنف البيع في الإرجاع.");
    seen.add(request.sourceLineId);
    const line = sourceByLine.get(request.sourceLineId);
    if (!line) throw new ReturnsValidationError("صنف البيع الأصلي غير موجود.");
    let needed = request.quantity;
    let sellableNeeded = request.sellableQuantity;
    let suggestion = 0;
    for (const unit of line.units) {
      if (needed <= 0) break;
      for (const available of availableUnitRanges(unit)) {
        if (needed <= 0) break;
        const take = Math.min(needed, available.quantity);
        const sellableTake = Math.min(sellableNeeded, take);
        suggestion += take * unit.paidPiasters;
        selected.push({
          sourceLineId: line.id,
          sourceSaleUnitId: unit.sourceType === "original" ? unit.id : null,
          sourceRecordingSaleUnitId: unit.sourceType === "correction" ? unit.id : null,
          sourceOnlineOrderLineId: unit.sourceType === "online" ? line.id : null,
          sourceOnlineOrderUnitIndex: unit.sourceType === "online" ? unit.unitIndex : null,
          variantId: line.variantId,
          startOffset: available.startOffset,
          quantity: take,
          paidUnitPiasters: unit.paidPiasters,
          variantOrdinal: (variantPrefixes.get(unit.id) ?? 0) + available.startOffset,
          sellableQuantity: sellableTake,
        });
        needed -= take;
        sellableNeeded -= sellableTake;
      }
    }
    if (needed > 0) throw new ReturnsValidationError("الكمية المطلوبة تتجاوز الكمية غير المرتجعة.");
    linePlans.push({
      sourceLineId: line.id,
      variantId: line.variantId,
      quantity: request.quantity,
      sellableQuantity: request.sellableQuantity,
      suggestedRefundPiasters: suggestion,
    });
  }

  const restorations = restorationPlan(source, selected);
  const protectionEffects = protectionPlan(source, selected);
  const merchandisePiasters = linePlans.reduce((sum, line) => sum + line.suggestedRefundPiasters, 0);
  const exhaustsRemaining = source.lines.every((line) => {
    const requestedQuantity = requested.find((item) => item.sourceLineId === line.id)?.quantity ?? 0;
    const remaining = line.units.reduce((sum, unit) => sum + unit.quantity - unit.alreadyReturnedQuantity, 0);
    return requestedQuantity === remaining;
  });
  const checkoutChargePiasters = exhaustsRemaining ? source.availableCheckoutChargePiasters : 0;
  return {
    lines: linePlans,
    units: selected,
    restorations,
    protectionEffects,
    suggestedRefund: {
      merchandisePiasters,
      checkoutChargePiasters,
      totalPiasters: safeMoneySum(merchandisePiasters, checkoutChargePiasters),
    },
    suggestedRefundPiasters: safeMoneySum(merchandisePiasters, checkoutChargePiasters),
  };
}

function availableUnitRanges(unit: ReturnSourceRecord["lines"][number]["units"][number]) {
  const occupied = [...unit.returnedRanges].sort((left, right) => left.startOffset - right.startOffset);
  const available: Array<{ startOffset: number; quantity: number }> = [];
  let cursor = 0;
  for (const range of occupied) {
    if (range.startOffset > cursor) available.push({ startOffset: cursor, quantity: range.startOffset - cursor });
    cursor = Math.max(cursor, range.startOffset + range.quantity);
  }
  if (cursor < unit.quantity) available.push({ startOffset: cursor, quantity: unit.quantity - cursor });
  return available;
}

function protectionPlan(
  source: ReturnSourceRecord,
  selected: Array<{ sourceLineId: string; variantOrdinal: number; quantity: number }>,
) {
  if (source.source.kind !== "delivered_online_order") return [];
  const totals = new Map<string, { allocationId: string; quantityDelta: number }>();
  const byLine = new Map<string, Array<{ allocationId: string; start: number; end: number }>>();
  for (const line of source.lines) {
    let offset = 0;
    const rows = source.allocations
      .filter((allocation) => allocation.sourceLineId === line.id && allocation.allocationId)
      .map((allocation) => {
        const row = { allocationId: allocation.allocationId!, start: offset, end: offset + allocation.quantity };
        offset += allocation.quantity;
        return row;
      });
    byLine.set(line.id, rows);
  }
  for (const segment of selected) {
    let remaining = segment.quantity;
    let cursor = segment.variantOrdinal;
    for (const allocation of byLine.get(segment.sourceLineId) ?? []) {
      if (remaining <= 0) break;
      if (cursor >= allocation.end || cursor < allocation.start) continue;
      const take = Math.min(remaining, allocation.end - cursor);
      const current = totals.get(allocation.allocationId);
      totals.set(allocation.allocationId, {
        allocationId: allocation.allocationId,
        quantityDelta: (current?.quantityDelta ?? 0) + take,
      });
      cursor += take;
      remaining -= take;
    }
    if (remaining > 0) throw new ReturnsValidationError("بيانات تخصيص الطلب الأصلي غير مكتملة.");
  }
  return [...totals.values()];
}

function unitVariantPrefixes(source: ReturnSourceRecord) {
  const result = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const line of [...source.lines].sort((a, b) => a.lineIndex - b.lineIndex)) {
    for (const unit of [...line.units].sort((a, b) => a.unitIndex - b.unitIndex)) {
      const key = source.source.kind === "delivered_online_order" ? line.id : line.variantId;
      const current = counters.get(key) ?? 0;
      result.set(unit.id, current);
      counters.set(key, current + unit.quantity);
    }
  }
  return result;
}

function restorationPlan(
  source: ReturnSourceRecord,
  selected: Array<{ sourceLineId: string; variantId: string; variantOrdinal: number; quantity: number; sellableQuantity: number }>,
) {
  const allocationsByVariant = new Map<string, Array<{ start: number; end: number; batchId: string; unitCostPiasters: number; effectiveUnitCostPiasters: number }>>();
  const offsets = new Map<string, number>();
  for (const allocation of source.allocations) {
    const offsetKey = source.source.kind === "delivered_online_order" ? allocation.sourceLineId ?? "" : allocation.variantId;
    const start = offsets.get(offsetKey) ?? 0;
    const list = allocationsByVariant.get(allocation.variantId) ?? [];
    list.push({
      start,
      end: start + allocation.quantity,
      batchId: allocation.batchId,
      unitCostPiasters: allocation.unitCostPiasters,
      effectiveUnitCostPiasters: allocation.effectiveUnitCostPiasters,
    });
    allocationsByVariant.set(allocation.variantId, list);
    offsets.set(offsetKey, start + allocation.quantity);
  }
  const totals = new Map<string, Omit<ReturnRestorationWrite, "id">>();
  for (const segment of selected) {
    let remaining = segment.sellableQuantity;
    let cursor = segment.variantOrdinal;
    const allocationRows = source.source.kind === "delivered_online_order"
      ? source.allocations.filter((item) => item.sourceLineId === segment.sourceLineId).map((item, index, all) => ({
          start: all.slice(0, index).reduce((sum, row) => sum + row.quantity, 0),
          end: all.slice(0, index + 1).reduce((sum, row) => sum + row.quantity, 0),
          batchId: item.batchId,
          unitCostPiasters: item.unitCostPiasters,
          effectiveUnitCostPiasters: item.effectiveUnitCostPiasters,
        }))
      : allocationsByVariant.get(segment.variantId) ?? [];
    for (const allocation of allocationRows) {
      if (remaining <= 0) break;
      if (cursor >= allocation.end || cursor < allocation.start) continue;
      const take = Math.min(remaining, allocation.end - cursor);
      const key = `${allocation.batchId}:${segment.variantId}`;
      const existing = totals.get(key);
      totals.set(key, {
        batchId: allocation.batchId,
        variantId: segment.variantId,
        quantity: (existing?.quantity ?? 0) + take,
        unitCostPiasters: allocation.unitCostPiasters,
        effectiveUnitCostPiasters: allocation.effectiveUnitCostPiasters,
      });
      cursor += take;
      remaining -= take;
    }
    if (remaining > 0) {
      throw new ReturnsValidationError("لا يمكن استعادة صنف قابل للبيع دون دفعة تكلفة أصلية مخصصة.");
    }
  }
  return [...totals.values()];
}

function parseDraft(input: unknown) {
  const body = expectObject(input, "بيانات الإرجاع غير صالحة.");
  assertAllowedKeys(body, DRAFT_KEYS, "بيانات الإرجاع غير صالحة.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new ReturnsValidationError("اختر صنفاً واحداً على الأقل.");
  return {
    returnId: assertUuid(body.returnId, "معرّف الإرجاع غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    source: parseReturnSource(body.source, body.sourceSaleId),
    handlingBranchId: assertUuid(body.handlingBranchId, "فرع معالجة الإرجاع غير صالح."),
    authorizedRefund: parseAuthorizedRefund(body.authorizedRefund, body.authorizedRefundPiasters),
    lines: body.lines.map((raw) => {
      const line = expectObject(raw, "بيانات صنف الإرجاع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف الإرجاع غير صالحة.");
      const quantity = positiveQuantity(line.quantity, "كمية الإرجاع غير صالحة.");
      const sellableQuantity = nonnegativeQuantity(line.sellableQuantity, "الكمية القابلة للبيع غير صالحة.");
      if (sellableQuantity > quantity) throw new ReturnsValidationError("الكمية القابلة للبيع تتجاوز كمية الإرجاع.");
      return { sourceLineId: assertUuid(line.sourceLineId ?? line.sourceSaleLineId, "صنف المصدر الأصلي غير صالح."), quantity, sellableQuantity };
    }),
  };
}

function parseDraftUpdate(input: unknown) {
  const body = expectObject(input, "بيانات تعديل مسودة الإرجاع غير صالحة.");
  assertAllowedKeys(body, UPDATE_DRAFT_KEYS, "بيانات تعديل مسودة الإرجاع غير صالحة.");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new ReturnsValidationError("اختر صنفاً واحداً على الأقل.");
  }
  return {
    expectedRevision: positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة."),
    handlingBranchId: assertUuid(body.handlingBranchId, "فرع معالجة الإرجاع غير صالح."),
    authorizedRefund: parseAuthorizedRefund(body.authorizedRefund, body.authorizedRefundPiasters),
    lines: body.lines.map((raw) => {
      const line = expectObject(raw, "بيانات صنف الإرجاع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف الإرجاع غير صالحة.");
      const quantity = positiveQuantity(line.quantity, "كمية الإرجاع غير صالحة.");
      const sellableQuantity = nonnegativeQuantity(line.sellableQuantity, "الكمية القابلة للبيع غير صالحة.");
      if (sellableQuantity > quantity) throw new ReturnsValidationError("الكمية القابلة للبيع تتجاوز كمية الإرجاع.");
      return { sourceLineId: assertUuid(line.sourceLineId ?? line.sourceSaleLineId, "صنف المصدر الأصلي غير صالح."), quantity, sellableQuantity };
    }),
  };
}

function parseExchange(input: unknown) {
  const body = expectObject(input, "بيانات الاستبدال غير صالحة.");
  assertAllowedKeys(body, EXCHANGE_KEYS, "بيانات الاستبدال غير صالحة.");
  if (body.receivedAndInspected !== true) {
    throw new ReturnsValidationError("يجب تأكيد استلام الأصناف وفحصها.");
  }
  if (body.cashRefundStatus !== "owed" && body.cashRefundStatus !== "paid") {
    throw new ReturnsValidationError("حالة فرق الاسترداد النقدي غير صالحة.");
  }
  const cashRefundStatus: "owed" | "paid" = body.cashRefundStatus;
  return {
    exchangeId: assertUuid(body.exchangeId, "معرّف الاستبدال غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف عملية الاستبدال غير صالح."),
    replacementSaleId: assertUuid(body.replacementSaleId, "معرّف بيع الاستبدال غير صالح."),
    replacementSaleOperationId: assertUuid(body.replacementSaleOperationId, "معرّف عملية بيع الاستبدال غير صالح."),
    quoteId: assertUuid(body.quoteId, "معرّف عرض سعر الاستبدال غير صالح."),
    receivedAndInspected: true as const,
    expectedRevision: positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة."),
    cashRefundStatus,
  };
}

function parseExchangeQuote(input: unknown) {
  const body = expectObject(input, "بيانات عرض سعر الاستبدال غير صالحة.");
  assertAllowedKeys(body, EXCHANGE_QUOTE_KEYS, "بيانات عرض سعر الاستبدال غير صالحة.");
  if (!Array.isArray(body.replacementLines) || body.replacementLines.length === 0) {
    throw new ReturnsValidationError("اختر صنف استبدال واحداً على الأقل.");
  }
  const quantities = new Map<string, number>();
  for (const raw of body.replacementLines) {
    const line = expectObject(raw, "بيانات صنف الاستبدال غير صالحة.");
    assertAllowedKeys(line, EXCHANGE_LINE_KEYS, "بيانات صنف الاستبدال غير صالحة.");
    const variantId = assertUuid(line.variantId, "متغير الاستبدال غير صالح.");
    const quantity = positiveQuantity(line.quantity, "كمية الاستبدال غير صالحة.");
    const merged = (quantities.get(variantId) ?? 0) + quantity;
    if (!Number.isSafeInteger(merged) || merged > 1_000_000) {
      throw new ReturnsValidationError("كمية الاستبدال غير صالحة.");
    }
    quantities.set(variantId, merged);
  }
  return {
    quoteId: assertUuid(body.quoteId, "معرّف عرض سعر الاستبدال غير صالح."),
    expectedRevision: positiveQuantity(body.expectedRevision, "نسخة المسودة غير صالحة."),
    settlement: {
      exchangeId: assertUuid(body.exchangeId, "معرّف الاستبدال غير صالح."),
      operationId: assertUuid(body.operationId, "معرّف عملية الاستبدال غير صالح."),
      replacementSaleId: assertUuid(body.replacementSaleId, "معرّف بيع الاستبدال غير صالح."),
      replacementSaleOperationId: assertUuid(body.replacementSaleOperationId, "معرّف عملية بيع الاستبدال غير صالح."),
    },
    replacementLines: [...quantities].sort(([left], [right]) => left.localeCompare(right))
      .map(([variantId, quantity]) => ({ variantId, quantity })),
  };
}

function parseReturnList(input: unknown): { limit: number; cursor: string | null } {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const rawLimit = body.limit === undefined || body.limit === "" ? 50 : Number(body.limit);
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    throw new ReturnsValidationError("حجم صفحة المرتجعات غير صالح.");
  }
  const cursor = body.cursor === undefined || body.cursor === ""
    ? null
    : assertUuid(body.cursor, "مؤشر صفحة المرتجعات غير صالح.");
  return { limit: rawLimit, cursor };
}

function parseSearch(input: unknown): SourceSearch {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const search: SourceSearch = {};
  if (typeof body.reference === "string" && body.reference.trim()) search.reference = body.reference.trim().slice(0, 100);
  if (typeof body.date === "string" && body.date) {
    const match = DATE_PATTERN.exec(body.date);
    const parts = body.date.split("-").map(Number);
    const parsed = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 0) - 1, parts[2] ?? 0));
    if (!match || parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== (parts[1] ?? 0) - 1 || parsed.getUTCDate() !== parts[2]) {
      throw new ReturnsValidationError("تاريخ البحث غير صالح.");
    }
    search.date = body.date;
  }
  if (typeof body.branchId === "string" && body.branchId) search.branchId = assertUuid(body.branchId, "فرع البحث غير صالح.");
  if (typeof body.item === "string" && body.item.trim()) search.item = body.item.trim().slice(0, 120);
  if (body.amountPiasters !== undefined && body.amountPiasters !== "") search.amountPiasters = nonnegativeMoney(Number(body.amountPiasters), "قيمة البحث غير صالحة.");
  if (body.channel !== undefined && body.channel !== "physical" && body.channel !== "online") {
    throw new ReturnsValidationError("قناة البحث غير صالحة.");
  }
  if (body.channel === "physical" || body.channel === "online") search.channel = body.channel;
  return search;
}

function parseReturnSource(value: unknown, legacySaleId: unknown): ReturnSourceKeyDto {
  if (value === undefined && legacySaleId !== undefined) {
    return { kind: "physical_sale", id: assertUuid(legacySaleId, "البيع الأصلي غير صالح.") };
  }
  const source = expectObject(value, "مصدر الإرجاع غير صالح.");
  if (source.kind !== "physical_sale" && source.kind !== "delivered_online_order") {
    throw new ReturnsValidationError("نوع مصدر الإرجاع غير صالح.");
  }
  assertAllowedKeys(source, new Set(["kind", "id"]), "مصدر الإرجاع غير صالح.");
  return { kind: source.kind, id: assertUuid(source.id, "مصدر الإرجاع غير صالح.") };
}

function parseAuthorizedRefund(value: unknown, legacyTotal: unknown): ReturnRefundBreakdownDto {
  if (value === undefined) {
    const total = nonnegativeMoney(legacyTotal, "قيمة الاسترداد المعتمدة غير صالحة.");
    return { merchandisePiasters: total, checkoutChargePiasters: 0, totalPiasters: total };
  }
  const refund = expectObject(value, "تفاصيل الاسترداد المعتمد غير صالحة.");
  assertAllowedKeys(refund, new Set(["merchandisePiasters", "checkoutChargePiasters"]), "تفاصيل الاسترداد المعتمد غير صالحة.");
  const merchandisePiasters = nonnegativeMoney(refund.merchandisePiasters, "قيمة البضاعة المعتمدة غير صالحة.");
  const checkoutChargePiasters = nonnegativeMoney(refund.checkoutChargePiasters, "قيمة رسوم الطلب المعتمدة غير صالحة.");
  return { merchandisePiasters, checkoutChargePiasters, totalPiasters: safeMoneySum(merchandisePiasters, checkoutChargePiasters) };
}

function safeMoneySum(left: number, right: number) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new ReturnsValidationError("قيمة الاسترداد غير صالحة.");
  return total;
}

function positiveQuantity(value: unknown, message: string) {
  try { return assertQuantity(value, message); } catch { throw new ReturnsValidationError(message); }
}

function nonnegativeQuantity(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ReturnsValidationError(message);
  return value;
}

function nonnegativeMoney(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new ReturnsValidationError(message);
  }
  return value;
}

function assertUuid(value: unknown, message: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ReturnsValidationError(message);
  return value;
}

function expectObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReturnsValidationError(message);
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, message: string) {
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new ReturnsValidationError(message);
}

function toEventDto(event: RefundEventRecord) {
  return {
    operationId: event.operationId,
    status: event.status,
    amountPiasters: event.amountPiasters,
    actorStaffId: event.actorStaffId,
    recordedAt: event.recordedAt.toISOString(),
  };
}
