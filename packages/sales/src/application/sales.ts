import type {
  BranchDto,
  CustomerHistoryDto,
  CustomerListDto,
  CustomerSummaryDto,
  ManagerSaleDto,
  PosPriceSnapshotDto,
  SaleAcknowledgementDto,
  SaleDto,
  SaleLineDto,
  SalePaymentDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import {
  ForbiddenError,
  isManager,
  NotFoundError,
  UnauthenticatedError,
  capabilitiesFor,
} from "@bravos/identity";
import {
  OperationConflictError,
  assertPiasters,
  assertQuantity,
  type AllocateResult,
  type AllocationRecord,
  type InventoryTransaction,
} from "@bravos/inventory";
import { evaluateAutomaticOffers, evaluateCoupon } from "@bravos/pricing";
import { cairoPeriod } from "../domain/cairo-period.ts";
import { customerSearchDigits, normalizeCustomerPhone } from "../domain/customer-phone.ts";
import { assertMergedSaleQuantities, mergeVariantQuantities, priceSaleLines, stampAcceptedFloors } from "../domain/discount.ts";
import { SaleRestoreGenerationChangedError, SaleRetainedForRestoreError, SalesValidationError } from "../domain/errors.ts";
import { addMoney, assertSafeMoney, subtractMoney } from "../domain/money.ts";
import { cashPayment, parsePaymentInput, paymentMatches, validatePayment } from "../domain/payment.ts";
import { parseReceiptClaim, type ParsedReceiptClaim } from "../domain/receipt-number.ts";
import {
  fingerprintAcceptedSalePayload,
  fingerprintSalePayload,
  type SalePayload,
} from "../domain/fingerprint.ts";
import type {
  CashierCatalogReader,
  CustomerDirectory,
  DeferredCompletedSalePort,
  PaidOnlinePurchaseReader,
  CompleteSaleResult,
  AutomaticPricingPort,
  ListedPriceReader,
  PricingQuoteReader,
  PrepareSaleResult,
  PriceSnapshotRecord,
  PriceSnapshotStore,
  SaleInsert,
  SaleLineWrite,
  SaleRecord,
  SalesActorPort,
  SalesUnitOfWork,
  SaleStore,
  VerifiedAuth,
} from "./ports.ts";

const PREPARE_KEYS = new Set([
  "saleId",
  "operationId",
  "customerName",
  "customerPhone",
  "couponCode",
  "employeeDiscountPiasters",
  "discountReason",
  "payment",
  "occurredAt",
  "lines",
]);
const COMPLETE_KEYS = new Set([
  ...PREPARE_KEYS,
  "physicallyCompleted",
  "pendingOperationIds",
  "restoreGeneration",
  "deviceId",
  "receiptClaim",
]);
const ACCEPTED_KEYS = new Set([
  ...COMPLETE_KEYS,
  "deviceId",
  "snapshotId",
  "pricingVersion",
  "pricingOccurredAt",
]);
const RECOVER_KEYS = new Set([...ACCEPTED_KEYS]);
const SNAPSHOT_KEYS = new Set(["deviceId", "pendingOperationIds", "receiptRegistrationId"]);
const LINE_KEYS = new Set(["variantId", "quantity"]);
const ACCEPTED_LINE_KEYS = new Set(["variantId", "quantity", "listedUnitPricePiasters"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCREPANCY_MESSAGE = "لم تُخصص كل الكمية من المخزون المسجّل.";
const COUPON_DISCREPANCY_MESSAGE =
  "تم الاحتفاظ بسعر البيع المكتمل رغم تجاوز حد استخدام الكوبون، ويحتاج إلى مراجعة المدير.";

async function attachAck(
  tx: { inventory: InventoryTransaction; sales: SaleStore },
  record: SaleRecord,
  created: boolean,
  coverageVariantIds: string[],
  pendingOperationIds: string[],
): Promise<{ record: SaleRecord; created: boolean; acknowledgement: SaleAcknowledgementDto }> {
  const variantIds = [...new Set([...coverageVariantIds, ...record.lines.map((line) => line.variantId)])];
  const stockVersion = created ? await tx.inventory.bumpStockVersion() : await tx.inventory.currentStockVersion();
  const quantities = await tx.inventory.quantitiesFor(record.branchId, variantIds);
  const includedOperations = await tx.sales.listCompletedOperationProofs([
    ...pendingOperationIds,
    record.operationId,
  ]);
  return {
    record,
    created,
    acknowledgement: {
      branchId: record.branchId,
      acknowledgedOperationIds: [record.operationId],
      stockVersion,
      includedOperationIds: includedOperations.map((proof) => proof.operationId),
      includedOperations,
      availability: variantIds.map((variantId) => ({
        variantId,
        availableQuantity: quantities.get(variantId) ?? 0,
      })),
    },
  };
}

async function allocateSaleLines(
  inventory: InventoryTransaction,
  branchId: string,
  operationId: string,
  recordedAt: Date,
  sourceLines: Array<{ id: string; variantId: string; quantity: number }>,
  allowPartial: boolean,
): Promise<{ allocations: AllocateResult[]; costsIncomplete: boolean }> {
  const operationalProductId = await inventory.operationalProductIds(sourceLines.map((line) => line.variantId));
  const order = sourceLines
    .map((line, index) => ({ line, index }))
    .sort((left, right) => {
      if (left.line.variantId === right.line.variantId) {
        return left.index - right.index;
      }
      return left.line.variantId < right.line.variantId ? -1 : 1;
    });
  const allocations: AllocateResult[] = new Array(sourceLines.length);
  let costsIncomplete = false;
  for (const item of order) {
    const productId = operationalProductId.get(item.line.variantId);
    const allocated = await inventory.allocateFromOldestAvailable({
      branchId,
      operationId,
      variantId: item.line.variantId,
      ...(productId ? { productId } : {}),
      quantity: item.line.quantity,
      recordedAt,
      allowPartial,
    });
    if (allocated.unallocatedQuantity > 0) {
      costsIncomplete = true;
      await inventory.recordDiscrepancy({
        branchId,
        operationId,
        variantId: item.line.variantId,
        requestedQuantity: item.line.quantity,
        allocatedQuantity: allocated.allocatedQuantity,
        recordedAt,
      });
    }
    allocations[item.index] = allocated;
  }
  return { allocations, costsIncomplete };
}

export type SalesServices = ReturnType<typeof createSalesServices>;

export function createSalesServices(ports: {
  actors: SalesActorPort;
  prices: ListedPriceReader;
  pricingQuote: PricingQuoteReader;
  sales: SaleStore;
  snapshots: PriceSnapshotStore;
  cashierCatalog: CashierCatalogReader;
  uow: SalesUnitOfWork;
  allocations: { listAllocations(operationId: string): Promise<AllocationRecord[]> };
  deferredCompletions: DeferredCompletedSalePort;
  customers: CustomerDirectory;
  paidOnline: PaidOnlinePurchaseReader;
  clock?: { now(): Date };
}) {
  async function requireCashier(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    const branchId = await ports.actors.getSessionBranch(auth.sessionId);
    if (!branchId || !capabilitiesFor(staff, branchId).cashier) {
      throw new ForbiddenError();
    }
    const branches = await ports.actors.listBranches();
    const branch = branches.find((item) => item.id === branchId);
    if (!branch) {
      throw new ForbiddenError();
    }
    return { staff, branch };
  }

  async function requireStaff(auth: VerifiedAuth | null) {
    if (!auth) {
      throw new UnauthenticatedError();
    }
    const staff = await ports.actors.getStaff(auth.staffId);
    if (!staff || staff.disabled) {
      throw new UnauthenticatedError();
    }
    return staff;
  }

  async function requireManager(auth: VerifiedAuth | null) {
    const staff = await requireStaff(auth);
    if (!isManager(staff)) {
      throw new ForbiddenError();
    }
    return staff;
  }

  async function hydrate(record: SaleRecord, viewerIsManager: boolean): Promise<SaleDto | ManagerSaleDto> {
    const branches = await ports.actors.listBranches();
    const branch = branches.find((item) => item.id === record.branchId);
    if (!branch) {
      throw new SalesValidationError("فرع البيع غير موجود.");
    }
    const identities = await ports.prices.getListedPrices(record.lines.map((line) => line.variantId));
    const byId = new Map(identities.map((item) => [item.variantId, item.identity]));
    const unallocatedQuantity = record.lines.reduce((sum, line) => sum + line.unallocatedQuantity, 0);
    const sale: SaleDto = {
      id: record.id,
      reference: record.reference,
      operationId: record.operationId,
      branch,
      soldByStaffId: record.soldByStaffId,
      soldByDisplayName: record.soldByDisplayName,
      occurredAt: record.occurredAt.toISOString(),
      recordedAt: record.recordedAt ? record.recordedAt.toISOString() : null,
      customerName: record.customerName,
      customerPhone: record.customerPhone,
      originalTotalPiasters: record.originalTotalPiasters,
      automaticOfferDiscountPiasters: record.automaticOfferDiscountPiasters,
      appliedAutomaticOffer: record.appliedAutomaticOffer,
      couponDiscountPiasters: record.couponDiscountPiasters,
      appliedCoupon: record.appliedCoupon,
      employeeDiscountPiasters: record.employeeDiscountPiasters,
      discountReason: record.discountReason,
      discountedByStaffId: record.discountedByStaffId,
      finalTotalPiasters: record.finalTotalPiasters,
      exchangeCreditAppliedPiasters: record.exchangeCreditAppliedPiasters,
      cashReceivedPiasters: record.cashReceivedPiasters,
      payment: record.payment,
      physicallyCompleted: record.physicallyCompleted,
      discrepancy:
        unallocatedQuantity > 0 || record.couponUsageDiscrepancy
          ? {
              unallocatedQuantity,
              messageAr: [
                ...(unallocatedQuantity > 0 ? [DISCREPANCY_MESSAGE] : []),
                ...(record.couponUsageDiscrepancy ? [COUPON_DISCREPANCY_MESSAGE] : []),
              ].join(" "),
            }
          : null,
      lines: record.lines.map((line) => toLineDto(line, byId.get(line.variantId))),
      ...receiptStaffMetadata(record.receiptIdentity),
    };
    if (!viewerIsManager) {
      return sale;
    }
    const allocations = record.physicallyCompleted
      ? (await ports.allocations.listAllocations(record.operationId)).map((item) => ({
          batchId: item.batchId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitCostPiasters: item.unitCostPiasters,
          effectiveUnitCostPiasters: item.effectiveUnitCostPiasters,
        }))
      : [];
    return {
      ...sale,
      couponUsageDiscrepancy: record.couponUsageDiscrepancy && record.appliedCoupon
        ? {
            couponId: record.appliedCoupon.id,
            couponCode: record.appliedCoupon.code,
            couponDiscountPiasters: record.couponDiscountPiasters,
            usageLimit: record.couponUsageDiscrepancy.usageLimit,
            centralUsedCount: record.couponUsageDiscrepancy.actualCount,
            detectedAt: record.couponUsageDiscrepancy.detectedAt.toISOString(),
            messageAr: COUPON_DISCREPANCY_MESSAGE,
          }
        : null,
      allocations,
      costsIncomplete: record.costsIncomplete,
      recoveredByStaffId: record.recoveredByStaffId,
      recoveredAt: record.recoveredAt ? record.recoveredAt.toISOString() : null,
    };
  }

  function canRead(staff: Awaited<ReturnType<typeof requireStaff>>, record: SaleRecord): boolean {
    if (isManager(staff)) {
      return true;
    }
    const authorized = staff.grants
      .filter((grant) => grant.cashier || grant.orderRepresentative)
      .map((grant) => grant.branchId);
    return record.soldByStaffId === staff.id && authorized.includes(record.branchId);
  }

  function canCashierOn(staff: Awaited<ReturnType<typeof requireStaff>>, branchId: string): boolean {
    return capabilitiesFor(staff, branchId).cashier;
  }

  function assertCanRead(staff: Awaited<ReturnType<typeof requireStaff>>, record: SaleRecord) {
    if (!canRead(staff, record)) {
      throw new ForbiddenError();
    }
  }

  function replayOrConflict(record: SaleRecord, fingerprint: string, operationId: string, payment?: SalePaymentDto | null) {
    if (record.payloadFingerprint !== fingerprint || record.operationId !== operationId) {
      throw new OperationConflictError();
    }
    if (record.physicallyCompleted && payment !== undefined &&
      !paymentMatches(record.payment, validatePayment(payment, record.finalTotalPiasters - record.exchangeCreditAppliedPiasters))) {
      throw new OperationConflictError();
    }
  }

  async function catalogCoverage(auth: VerifiedAuth): Promise<string[]> {
    const products = await ports.cashierCatalog.listCashierProducts(auth);
    return [...new Set(products.flatMap((product) => [
      product.operationalVariantId,
      ...product.variants.map((variant) => variant.id),
    ]))];
  }

  async function commitSnapshotPricedSale(input: {
    viewer: Awaited<ReturnType<typeof requireStaff>>;
    seller: { id: string; displayName: string };
    branch: BranchDto;
    snapshot: NonNullable<Awaited<ReturnType<PriceSnapshotStore["getById"]>>>;
    command: ParsedAcceptedSale;
    fingerprint: string;
    recoveredByStaffId: string | null;
    recoveredAt: Date | null;
    requireViewerRead: boolean;
    coverageVariantIds: string[];
    // The generation a synchronized sale was made under; null for a manager recovery.
    expectedRestoreGeneration: number | null;
  }): Promise<{ record: SaleRecord; created: boolean; acknowledgement: SaleAcknowledgementDto }> {
    const snapshotPrices = new Map(input.snapshot.prices.map((item) => [item.variantId, item.listedUnitPricePiasters]));
    for (const line of input.command.lines) {
      const listed = snapshotPrices.get(line.variantId);
      if (listed === undefined) {
        throw new SalesValidationError("المتغير المحدد غير موجود.");
      }
      if (line.listedUnitPricePiasters !== null && line.listedUnitPricePiasters !== listed) {
        throw new SalesValidationError("قيم البيع المقبولة غير متطابقة.");
      }
    }
    return ports.uow.run(async (tx) => {
      await tx.inventory.lockStockClock("update");
      const finish = async (record: SaleRecord, created: boolean) => {
        const attached = await tx.sales.attachReceiptClaim({
          saleId: record.id,
          claim: input.command.receiptClaim,
          sourceDeviceId: input.command.deviceId,
        });
        return attachAck(tx, attached, created, input.coverageVariantIds, input.command.pendingOperationIds);
      };
      const existing = await loadLockedIdentity(tx.sales, input.command.saleId, input.command.operationId);
      if (existing?.physicallyCompleted) {
        replayOrConflict(existing, input.fingerprint, input.command.operationId, input.command.payment);
        if (input.requireViewerRead) {
          assertCanRead(input.viewer, existing);
        }
        return finish(existing, false);
      }
      if (existing) {
        replayOrConflict(existing, input.fingerprint, input.command.operationId, input.command.payment);
        throw new OperationConflictError();
      }
      if (input.expectedRestoreGeneration !== null
        && (await tx.restore.current()).generation !== input.expectedRestoreGeneration) {
        throw new SaleRestoreGenerationChangedError();
      }
      if (input.recoveredByStaffId) {
        await tx.sales.markRestoreDeferredReconciled(input.command.operationId, input.recoveredByStaffId);
      }
      const claimed = await tx.inventory.claimSaleOperation({
        operationId: input.command.operationId,
        payloadFingerprint: input.fingerprint,
        actorStaffId: input.seller.id,
      });
      if (claimed.kind === "replay") {
        const replayed = await tx.sales.getByOperationId(input.command.operationId);
        if (!replayed) {
          throw new SalesValidationError("تعذر العثور على البيع الأصلي.");
        }
        replayOrConflict(replayed, input.fingerprint, input.command.operationId, input.command.payment);
        if (input.requireViewerRead) {
          assertCanRead(input.viewer, replayed);
        }
        return finish(replayed, false);
      }
      const quantities = assertMergedSaleQuantities(input.command.lines);
      const basketLines = quantities.map((line) => {
        const basis = input.snapshot.prices.find((item) => item.variantId === line.variantId);
        if (!basis) throw new SalesValidationError("المتغير المحدد غير موجود.");
        if (
          input.command.pricingVersion === 1 &&
          input.command.lines.some(
            (acceptedLine) =>
              acceptedLine.variantId === line.variantId &&
              acceptedLine.listedUnitPricePiasters !== basis.listedUnitPricePiasters,
          )
        ) {
          throw new SalesValidationError("سعر البيع المقبول لا يطابق لقطة الأسعار.");
        }
        return {
          variantId: line.variantId,
          productId: basis.productId,
          categoryId: basis.categoryId,
          quantity: line.quantity,
          listedUnitPricePiasters: basis.listedUnitPricePiasters,
        };
      });
      const automatic = evaluateAutomaticOffers({
        offers: input.snapshot.automaticOffers,
        lines: basketLines,
        at: input.command.pricingOccurredAt,
      });
      const coupon = evaluateCoupon({
        coupons: input.snapshot.coupons,
        code: input.command.couponCode,
        lines: basketLines,
        automaticOffer: automatic.appliedAutomaticOffer,
        automaticRanges: automatic.unitRanges,
        at: input.command.pricingOccurredAt,
      });
      const pricedWithoutFloor = priceSaleLines(
        basketLines,
        input.command.employeeDiscountPiasters,
        automatic.appliedAutomaticOffer ? automatic.unitRanges : undefined,
        coupon.appliedCoupon ? coupon.unitRanges : undefined,
      );
      const priced = {
        ...pricedWithoutFloor,
        lines: stampAcceptedFloors(pricedWithoutFloor.lines, new Map(basketLines.map((line) => {
          const basis = input.snapshot.prices.find((item) => item.variantId === line.variantId);
          return [line.variantId, basis?.minimumUnitPricePiasters] as const;
        }))),
      };
      const payment = validatePayment(input.command.payment, priced.finalTotalPiasters);
      const acceptedPricing = {
        ...priced,
        appliedAutomaticOffer: automatic.appliedAutomaticOffer,
        appliedCoupon: coupon.appliedCoupon,
      };
      let couponUsageDiscrepancy: SaleRecord["couponUsageDiscrepancy"] = null;
      if (coupon.appliedCoupon) {
        const usage = await tx.couponUsage.claimCompletedOffline({
          couponId: coupon.appliedCoupon.id,
          sourceType: "physical_sale",
          sourceId: input.command.saleId,
          operationId: input.command.operationId,
          payloadFingerprint: input.fingerprint,
          claimedAt: claimed.recordedAt,
        });
        if (usage.overLimit) {
          couponUsageDiscrepancy = {
            detectedAt: claimed.recordedAt,
            usageLimit: usage.usageLimit,
            countBefore: usage.centralUsedCount - 1,
            actualCount: usage.centralUsedCount,
          };
        }
      }
      const sourceLines = priced.lines.map((line) => ({
        id: crypto.randomUUID(),
        variantId: line.variantId,
        quantity: line.quantity,
      }));
      const allocated = await allocateSaleLines(
        tx.inventory,
        input.branch.id,
        input.command.operationId,
        claimed.recordedAt,
        sourceLines,
        true,
      );
      const completedLines: SaleLineWrite[] = priced.lines.map((line, index) => {
        const row = allocated.allocations[index];
        return {
          id: sourceLines[index]?.id ?? crypto.randomUUID(),
          variantId: line.variantId,
          quantity: line.quantity,
          listedUnitPricePiasters: line.listedUnitPricePiasters,
          originalPiasters: line.originalPiasters,
          discountPiasters: line.discountPiasters,
          paidPiasters: line.paidPiasters,
          automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
          couponDiscountPiasters: line.couponDiscountPiasters,
          employeeDiscountPiasters: line.employeeDiscountPiasters,
          acceptedMinimumUnitPiasters: line.acceptedMinimumUnitPiasters ?? null,
          allocatedQuantity: row?.allocatedQuantity ?? 0,
          unallocatedQuantity: row?.unallocatedQuantity ?? line.quantity,
          lineIndex: index,
          units: toUnitWrites(line.units),
        };
      });
      const inserted = await tx.sales.insert(
        toInsert(
          {
            saleId: input.command.saleId,
            operationId: input.command.operationId,
            physicallyCompleted: true,
            customerName: input.command.customerName,
            customerPhone: input.command.customerPhone,
            couponCode: input.command.couponCode,
            employeeDiscountPiasters: input.command.employeeDiscountPiasters,
            discountReason: input.command.discountReason,
            payment: input.command.payment,
            occurredAt: input.command.occurredAt,
            lines: input.command.lines,
            pendingOperationIds: [],
            restoreGeneration: input.snapshot.restoreGeneration,
            deviceId: input.command.deviceId,
            receiptClaim: input.command.receiptClaim,
          },
          { staff: input.seller, branch: input.branch },
          acceptedPricing,
          input.fingerprint,
          {
            physicallyCompleted: true,
            recordedAt: claimed.recordedAt,
            costsIncomplete: allocated.costsIncomplete,
            completedLines,
            occurredAt: input.command.occurredAt,
              recoveredByStaffId: input.recoveredByStaffId,
              recoveredAt: input.recoveredAt,
              sourceDeviceId: input.command.deviceId,
              sourceSnapshotId: input.command.snapshotId,
              sourceRestoreGeneration: input.snapshot.restoreGeneration,
              couponUsageDiscrepancy,
              payment,
          },
        ),
      );
      if (inserted.kind === "existing") {
        replayOrConflict(inserted.record, input.fingerprint, input.command.operationId, input.command.payment);
        if (input.requireViewerRead) {
          assertCanRead(input.viewer, inserted.record);
        }
        return finish(inserted.record, false);
      }
      return finish(inserted.record, true);
    });
  }

  return {
    async prepare(auth: VerifiedAuth | null, input: unknown): Promise<PrepareSaleResult> {
      const current = await requireCashier(auth);
      const command = parseSaleWrite(input, false);
      const fingerprint = fingerprintSalePayload(toPayload(command));
      const quantities = mergeVariantQuantities(command.lines);
      const preliminary =
        (await ports.sales.getById(command.saleId)) ??
        (await ports.sales.getByOperationId(command.operationId));
      if (!preliminary) {
        await ports.uow.run(async (tx) => {
          await tx.inventory.lockStockClock("share");
          const available = await tx.inventory.quantitiesFor(current.branch.id, quantities.map((item) => item.variantId));
          for (const item of quantities) {
            if ((available.get(item.variantId) ?? 0) < item.quantity) {
              throw new SalesValidationError("الكمية المتاحة غير كافية.");
            }
          }
        });
      }
      const priced = preliminary ? null : await ports.pricingQuote.run(async (quote) => {
        const listed = await quote.prices.getListedPrices(quantities.map((item) => item.variantId));
        return priceFromListed(quote.automaticPricing, listed, quantities, command.employeeDiscountPiasters, command.couponCode);
      });
      const outcome = await ports.uow.run(async (tx) => {
        await tx.inventory.lockStockClock("share");
        const existing = await loadLockedIdentity(tx.sales, command.saleId, command.operationId);
        if (existing) {
          replayOrConflict(existing, fingerprint, command.operationId, command.payment);
          assertCanRead(current.staff, existing);
          return { record: existing, created: false };
        }
        await tx.inventory.assertStockMutationAllowed();
        const available = await tx.inventory.quantitiesFor(current.branch.id, quantities.map((item) => item.variantId));
        for (const item of quantities) {
          if ((available.get(item.variantId) ?? 0) < item.quantity) {
            throw new SalesValidationError("الكمية المتاحة غير كافية.");
          }
        }
        if (!priced) throw new SalesValidationError("تعذر تسعير البيع.");
        const inserted = await tx.sales.insert(
          toInsert(command, current, priced, fingerprint, {
            physicallyCompleted: false,
            recordedAt: null,
            costsIncomplete: false,
            sourceRestoreGeneration: (await tx.restore.current()).generation,
          }),
        );
        if (inserted.kind === "existing") {
          replayOrConflict(inserted.record, fingerprint, command.operationId);
          assertCanRead(current.staff, inserted.record);
          return { record: inserted.record, created: false };
        }
        return { record: inserted.record, created: true };
      });
      return { sale: await hydrate(outcome.record, isManager(current.staff)), created: outcome.created };
    },

    async complete(auth: VerifiedAuth | null, input: unknown): Promise<CompleteSaleResult> {
      const actor = await requireStaff(auth);
      if (!auth) {
        throw new UnauthenticatedError();
      }
      const sessionBranchId = await ports.actors.getSessionBranch(auth.sessionId);
      const branches = await ports.actors.listBranches();
      const command = parseSaleWrite(input, true);
      const fingerprint = fingerprintSalePayload(toPayload(command));
      const quantities = mergeVariantQuantities(command.lines);
      const catalog = await ports.cashierCatalog.listCashierProducts(auth);
      const coverageVariantIds = [...new Set(catalog.flatMap((product) => [
        product.operationalVariantId,
        ...product.variants.map((variant) => variant.id),
      ]))];
      const preliminary =
        (await ports.sales.getById(command.saleId)) ??
        (await ports.sales.getByOperationId(command.operationId));
      const completionBranchId = preliminary?.branchId ?? sessionBranchId;
      if (!completionBranchId || !canCashierOn(actor, completionBranchId)) throw new ForbiddenError();
      if (await ports.deferredCompletions.retainIfRequired({
        operationId: command.operationId,
        saleId: command.saleId,
        payloadFingerprint: fingerprint,
        sourceGeneration: command.restoreGeneration,
        sourceDeviceId: command.deviceId,
        originalStaffId: preliminary?.soldByStaffId ?? actor.id,
        branchId: completionBranchId,
        occurredAt: command.occurredAt ?? new Date(),
        payload: {
          ...deferredPayload("connected", command),
          // A retained connected sale keeps its accepted prices, so recovery works even when the
          // restored data no longer holds the prepared sale.
          ...(preliminary && !preliminary.physicallyCompleted ? { preparedSale: preparedSaleJson(preliminary) } : {}),
        },
      })) throw new SaleRetainedForRestoreError();
      const directPricing = preliminary ? null : await ports.pricingQuote.run(async (quote) => {
        const listed = await quote.prices.getListedPrices(quantities.map((item) => item.variantId));
        return priceFromListed(quote.automaticPricing, listed, quantities, command.employeeDiscountPiasters, command.couponCode);
      });
      const outcome = await ports.uow.run(async (tx) => {
        await tx.inventory.lockStockClock("update");
        const finish = async (record: SaleRecord, created: boolean) => {
          const attached = await tx.sales.attachReceiptClaim({
            saleId: record.id,
            claim: command.receiptClaim,
            sourceDeviceId: command.deviceId,
          });
          return attachAck(tx, attached, created, coverageVariantIds, command.pendingOperationIds);
        };
        const existing = await loadLockedIdentity(tx.sales, command.saleId, command.operationId);
        if (existing?.physicallyCompleted) {
          replayOrConflict(existing, fingerprint, command.operationId, command.payment);
          assertCanRead(actor, existing);
          return finish(existing, false);
        }
        const restore = await tx.restore.current();
        if (command.restoreGeneration !== null && command.restoreGeneration !== restore.generation) {
          throw new SaleRestoreGenerationChangedError();
        }
        const saleGeneration = restore.generation;
        if (existing) {
          replayOrConflict(existing, fingerprintSalePayload(toPayload({ ...command, physicallyCompleted: false })), command.operationId);
          assertCanRead(actor, existing);
          if (!canCashierOn(actor, existing.branchId)) {
            throw new ForbiddenError();
          }
        } else {
          if (!sessionBranchId || !canCashierOn(actor, sessionBranchId)) {
            throw new ForbiddenError();
          }
        }
        const prepared = Boolean(existing && !existing.physicallyCompleted);
        const allowPartial = prepared;
        const currentBranch = branches.find((item) => item.id === (existing?.branchId ?? sessionBranchId));
        if (!currentBranch) {
          throw new ForbiddenError();
        }
        const seller = existing
          ? { id: existing.soldByStaffId, displayName: existing.soldByDisplayName }
          : actor;

        const claimed = await tx.inventory.claimSaleOperation({
          operationId: command.operationId,
          payloadFingerprint: fingerprint,
          actorStaffId: seller.id,
        });
        if (claimed.kind === "replay") {
          const replayed = await tx.sales.getByOperationId(command.operationId);
          if (!replayed) {
            throw new SalesValidationError("تعذر العثور على البيع الأصلي.");
          }
          replayOrConflict(replayed, fingerprint, command.operationId, command.payment);
          assertCanRead(actor, replayed);
          return finish(replayed, false);
        }

        const acceptedCoupon = existing?.appliedCoupon ?? directPricing?.appliedCoupon ?? null;
        let couponUsageDiscrepancy: SaleRecord["couponUsageDiscrepancy"] = null;
        if (acceptedCoupon) {
          const usageInput = {
            couponId: acceptedCoupon.id,
            sourceType: "physical_sale",
            sourceId: command.saleId,
            operationId: command.operationId,
            payloadFingerprint: fingerprint,
            claimedAt: claimed.recordedAt,
          } as const;
          if (prepared) {
            const usage = await tx.couponUsage.claimCompletedOffline(usageInput);
            if (usage.overLimit) {
              couponUsageDiscrepancy = {
                detectedAt: claimed.recordedAt,
                usageLimit: usage.usageLimit,
                countBefore: usage.centralUsedCount - 1,
                actualCount: usage.centralUsedCount,
              };
            }
          } else {
            await tx.couponUsage.claim(usageInput);
          }
        }

        const sourceLines =
          prepared && existing
            ? existing.lines.map((line) => ({
                id: line.id,
                variantId: line.variantId,
                quantity: line.quantity,
              }))
            : quantities.map((line) => ({
                id: crypto.randomUUID(),
                variantId: line.variantId,
                quantity: line.quantity,
              }));
        const occurredAt = command.occurredAt ?? claimed.recordedAt;
        const allocated = await allocateSaleLines(
          tx.inventory,
          currentBranch.id,
          command.operationId,
          claimed.recordedAt,
          sourceLines,
          allowPartial,
        );
        const costsIncomplete = allocated.costsIncomplete;
        const allocations = allocated.allocations;
        const priced = prepared && existing
          ? {
              lines: existing.lines.map((line) => ({
                variantId: line.variantId,
                quantity: line.quantity,
                listedUnitPricePiasters: line.listedUnitPricePiasters,
                originalPiasters: line.originalPiasters,
                discountPiasters: line.discountPiasters,
                paidPiasters: line.paidPiasters,
                automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
                couponDiscountPiasters: line.couponDiscountPiasters,
                employeeDiscountPiasters: line.employeeDiscountPiasters,
                acceptedMinimumUnitPiasters: line.acceptedMinimumUnitPiasters ?? null,
                units: line.units.map((unit) => ({
                  unitIndex: unit.unitIndex,
                  quantity: unit.quantity,
                  listedPiasters: unit.listedPiasters,
                  discountPiasters: unit.discountPiasters,
                  paidPiasters: unit.paidPiasters,
                  automaticOfferDiscountPiasters: unit.automaticOfferDiscountPiasters,
                  couponDiscountPiasters: unit.couponDiscountPiasters,
                  employeeDiscountPiasters: unit.employeeDiscountPiasters,
                })),
              })),
              originalTotalPiasters: existing.originalTotalPiasters,
              finalTotalPiasters: existing.finalTotalPiasters,
              appliedAutomaticOffer: existing.appliedAutomaticOffer,
              appliedCoupon: existing.appliedCoupon,
            }
          : directPricing;
        if (!priced) {
          throw new SalesValidationError("تعذر تسعير البيع.");
        }
        const payment = validatePayment(command.payment, priced.finalTotalPiasters);
        const completedLines: SaleLineWrite[] = priced.lines.map((line, index) => {
          const allocated = allocations[index];
          return {
            id: sourceLines[index]?.id ?? crypto.randomUUID(),
            variantId: line.variantId,
            quantity: line.quantity,
            listedUnitPricePiasters: line.listedUnitPricePiasters,
            originalPiasters: line.originalPiasters,
            discountPiasters: line.discountPiasters,
            paidPiasters: line.paidPiasters,
            automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
            couponDiscountPiasters: line.couponDiscountPiasters,
            employeeDiscountPiasters: line.employeeDiscountPiasters,
            acceptedMinimumUnitPiasters: line.acceptedMinimumUnitPiasters ?? null,
            allocatedQuantity: allocated?.allocatedQuantity ?? 0,
            unallocatedQuantity: allocated?.unallocatedQuantity ?? line.quantity,
            lineIndex: index,
            units: toUnitWrites(line.units),
          };
        });

        if (prepared && existing) {
          const record = await tx.sales.updateCompletion({
            id: existing.id,
            occurredAt,
            recordedAt: claimed.recordedAt,
            costsIncomplete,
            lines: completedLines,
            couponUsageDiscrepancy,
            payment,
            payloadFingerprint: fingerprint,
            sourceRestoreGeneration: saleGeneration,
          });
          return finish(record, true);
        }
        const inserted = await tx.sales.insert(
          toInsert(
            command,
            { staff: seller, branch: currentBranch },
            priced,
            fingerprint,
            {
              physicallyCompleted: true,
              recordedAt: claimed.recordedAt,
              costsIncomplete,
              completedLines,
              payment,
              occurredAt,
              sourceRestoreGeneration: saleGeneration,
            },
          ),
        );
        if (inserted.kind === "existing") {
          replayOrConflict(inserted.record, fingerprint, command.operationId, command.payment);
          assertCanRead(actor, inserted.record);
          return finish(inserted.record, false);
        }
        return finish(inserted.record, true);
      });
      return {
        sale: await hydrate(outcome.record, isManager(actor)),
        created: outcome.created,
        acknowledgement: outcome.acknowledgement,
      };
    },

    async issuePriceSnapshot(auth: VerifiedAuth | null, input: unknown): Promise<PosPriceSnapshotDto> {
      const current = await requireCashier(auth);
      if (!auth) {
        throw new UnauthenticatedError();
      }
      const request = parseSnapshotRequest(input);
      const products = await ports.cashierCatalog.listCashierProducts(auth);
      const ids = [...new Set(products.flatMap((product) => [
        product.operationalVariantId,
        ...product.variants.map((variant) => variant.id),
      ]))];
      const pricingSnapshot = await ports.pricingQuote.run(async (quote) => {
        const [listed, rules] = await Promise.all([
          quote.prices.getListedPrices(ids),
          quote.automaticPricing.snapshotRules(request.pendingOperationIds),
        ]);
        return { listed, ...rules };
      });
      const listed = pricingSnapshot.listed;
      const byId = new Map(listed.map((row) => [row.variantId, row.listedUnitPricePiasters]));
      const categoryByProductId = new Map(listed.map((row) => [row.productId, row.categoryId]));
      const prices = ids.map((variantId) => {
        const basis = pricingSnapshot.listed.find((row) => row.variantId === variantId);
        if (!basis) {
          throw new SalesValidationError("المتغير المحدد غير موجود.");
        }
        return {
          variantId,
          productId: basis.productId,
          categoryId: basis.categoryId,
          listedUnitPricePiasters: basis.listedUnitPricePiasters,
          minimumUnitPricePiasters: basis.minimumUnitPricePiasters,
        };
      });
      const issuedAt = new Date();
      const stock = await ports.uow.runRestoreControl(async (tx) => {
        await tx.inventory.lockStockClock("share");
        const stockVersion = await tx.inventory.currentStockVersion();
        const restore = await tx.restore.current();
        const receiptRegistration = request.receiptRegistrationId
          ? await tx.sales.registerReceiptPrefix({
              id: request.receiptRegistrationId,
              deviceId: request.deviceId,
              staffId: current.staff.id,
              restoreGeneration: restore.generation,
            })
          : null;
        const quantities = await tx.inventory.quantitiesFor(current.branch.id, ids);
        const includedOperations = await tx.sales.listCompletedOperationProofs(request.pendingOperationIds);
        const deferredCompletionProofs = await tx.sales.listDeferredCompletionProofs(request.pendingOperationIds);
        const record = await tx.snapshots.insert({
          id: crypto.randomUUID(),
          pricingVersion: 1,
          staffId: current.staff.id,
          branchId: current.branch.id,
          deviceId: request.deviceId,
          issuedAt,
          restoreGeneration: restore.generation,
          prices,
          automaticOffers: pricingSnapshot.automaticOffers,
          coupons: pricingSnapshot.coupons,
          couponAccountedOperations: pricingSnapshot.couponAccountedOperations,
        });
        const stockPause = await tx.inventory.recordTillSnapshot({
          deviceId: request.deviceId,
          staffId: current.staff.id,
          snapshotId: record.id,
          issuedAt,
          stockVersion,
          restoreGeneration: restore.generation,
          pendingOperationIds: request.pendingOperationIds,
          includedOperationIds: includedOperations.map((proof) => proof.operationId),
        });
        return {
          record, stockVersion, quantities, includedOperations, deferredCompletionProofs, stockPause,
          restoreGeneration: restore.generation, restorePause: restore.pause, receiptRegistration,
        };
      });
      return {
        snapshotId: stock.record.id,
        pricingVersion: 1,
        staffId: stock.record.staffId,
        branch: current.branch,
        deviceId: stock.record.deviceId,
        issuedAt: stock.record.issuedAt.toISOString(),
        stockVersion: stock.stockVersion,
        stockPause: stock.stockPause,
        restoreGeneration: stock.restoreGeneration,
        restorePause: stock.restorePause,
        includedOperationIds: stock.includedOperations.map((proof) => proof.operationId),
        includedOperations: stock.includedOperations,
        deferredCompletionProofs: stock.deferredCompletionProofs,
        automaticOffers: stock.record.automaticOffers,
        coupons: stock.record.coupons,
        couponAccountedOperations: stock.record.couponAccountedOperations,
        ...(stock.receiptRegistration ? { receiptRegistration: stock.receiptRegistration } : {}),
        products: products.map((product) => {
          const categoryId = categoryByProductId.get(product.id) ?? product.categoryId;
          return {
            ...product,
            availableQuantity: stock.quantities.get(product.operationalVariantId) ?? 0,
            ...(categoryId ? { categoryId } : {}),
            variants: product.variants.map((variant) => ({
              ...variant,
              sellingPricePiasters: byId.get(variant.id) ?? variant.sellingPricePiasters,
              availableQuantity: stock.quantities.get(variant.id) ?? 0,
            })),
          };
        }),
      };
    },

    async acceptOffline(auth: VerifiedAuth | null, input: unknown): Promise<CompleteSaleResult> {
      const actor = await requireStaff(auth);
      if (!auth) {
        throw new UnauthenticatedError();
      }
      const command = parseAcceptedSale(input);
      const snapshot = await ports.snapshots.getById(command.snapshotId);
      if (!snapshot) {
        throw new NotFoundError("لقطة الأسعار غير موجودة.");
      }
      if (snapshot.staffId !== actor.id) {
        throw new ForbiddenError();
      }
      if (snapshot.deviceId !== command.deviceId) {
        throw new SalesValidationError("معرّف الجهاز غير صالح.");
      }
      assertSnapshotPricingVersion(snapshot, command.pricingVersion);
      if (!canCashierOn(actor, snapshot.branchId)) {
        throw new ForbiddenError();
      }
      const branches = await ports.actors.listBranches();
      const branch = branches.find((item) => item.id === snapshot.branchId);
      if (!branch) {
        throw new ForbiddenError();
      }
      const fingerprint = fingerprintAcceptedSalePayload({
        saleId: command.saleId,
        snapshotId: command.snapshotId,
        ...(command.pricingVersion === 1
          ? {
              pricingVersion: 1 as const,
              occurredAt: command.occurredAt.toISOString(),
              pricingOccurredAt: command.pricingOccurredAt.toISOString(),
            }
          : {}),
        customerName: command.customerName,
        customerPhone: command.customerPhone,
        couponCode: command.couponCode,
        employeeDiscountPiasters: command.employeeDiscountPiasters,
        discountReason: command.discountReason,
        ...(command.payment ? { payment: command.payment } : {}),
        lines: command.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          ...(command.pricingVersion === 1
            ? { listedUnitPricePiasters: line.listedUnitPricePiasters }
            : {}),
        })),
      });
      const sourceGeneration = command.restoreGeneration ?? snapshot.restoreGeneration;
      if (command.restoreGeneration !== null && command.restoreGeneration !== snapshot.restoreGeneration) {
        throw new SalesValidationError("جيل لقطة البيع غير متطابق.");
      }
      if (await ports.deferredCompletions.retainIfRequired({
        operationId: command.operationId, saleId: command.saleId, payloadFingerprint: fingerprint,
        sourceGeneration, sourceDeviceId: command.deviceId, originalStaffId: actor.id, branchId: branch.id,
        occurredAt: command.occurredAt, payload: deferredPayload("accepted", command),
      })) throw new SaleRetainedForRestoreError();
      const coverageVariantIds = [...new Set([...snapshot.prices.map((item) => item.variantId), ...(await catalogCoverage(auth))])];
      const outcome = await commitSnapshotPricedSale({
        viewer: actor,
        seller: actor,
        branch,
        snapshot,
        command,
        fingerprint,
        recoveredByStaffId: null,
        recoveredAt: null,
        expectedRestoreGeneration: sourceGeneration,
        requireViewerRead: true,
        coverageVariantIds,
      });
      return {
        sale: await hydrate(outcome.record, isManager(actor)),
        created: outcome.created,
        acknowledgement: outcome.acknowledgement,
      };
    },

    async recoverOffline(auth: VerifiedAuth | null, input: unknown): Promise<CompleteSaleResult> {
      const manager = await requireManager(auth);
      if (!auth) {
        throw new UnauthenticatedError();
      }
      const recovered = parseRecoverCommand(input);
      const coverageVariantIds = await catalogCoverage(auth);
      if (recovered.kind === "prepared") {
        const outcome = await ports.uow.run(async (tx) => {
          await tx.inventory.lockStockClock("update");
          let existing = await loadLockedIdentity(tx.sales, recovered.saleId, recovered.operationId);
          if (!existing) {
            const retained = await tx.sales.getRestoreDeferredPreparedSale(recovered.operationId);
            if (retained && retained.id === recovered.saleId) existing = (await tx.sales.insert(retained)).record;
          }
          if (!existing) {
            throw new NotFoundError("لم يُحفظ البيع بعد.");
          }
          await tx.sales.markRestoreDeferredReconciled(recovered.operationId, manager.id);
          const finish = async (record: SaleRecord, created: boolean) => {
            const attached = await tx.sales.attachReceiptClaim({
              saleId: record.id,
              claim: recovered.receiptClaim,
              sourceDeviceId: recovered.deviceId,
            });
            return attachAck(tx, attached, created, coverageVariantIds, recovered.pendingOperationIds);
          };
          if (existing.physicallyCompleted) {
            if (!paymentMatches(existing.payment, validatePayment(recovered.payment, existing.finalTotalPiasters - existing.exchangeCreditAppliedPiasters))) {
              throw new OperationConflictError();
            }
            return finish(existing, false);
          }
          const recoveredFingerprint = recovered.payment
            ? fingerprintSalePayload({
                saleId: existing.id,
                customerName: existing.customerName,
                customerPhone: existing.customerPhone,
                couponCode: existing.appliedCoupon?.code ?? null,
                employeeDiscountPiasters: existing.employeeDiscountPiasters,
                discountReason: existing.discountReason,
                payment: recovered.payment,
                lines: existing.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
              })
            : existing.payloadFingerprint;
          const claimed = await tx.inventory.claimSaleOperation({
            operationId: existing.operationId,
            payloadFingerprint: recoveredFingerprint,
            actorStaffId: existing.soldByStaffId,
          });
          if (claimed.kind === "replay") {
            const replayed = await tx.sales.getByOperationId(existing.operationId);
            if (!replayed?.physicallyCompleted) {
              throw new SalesValidationError("تعذر العثور على البيع الأصلي.");
            }
            return finish(replayed, false);
          }
          let couponUsageDiscrepancy: SaleRecord["couponUsageDiscrepancy"] = null;
          if (existing.appliedCoupon) {
            const usage = await tx.couponUsage.claimCompletedOffline({
              couponId: existing.appliedCoupon.id,
              sourceType: "physical_sale",
              sourceId: existing.id,
              operationId: existing.operationId,
              payloadFingerprint: recoveredFingerprint,
              claimedAt: claimed.recordedAt,
            });
            if (usage.overLimit) {
              couponUsageDiscrepancy = {
                detectedAt: claimed.recordedAt,
                usageLimit: usage.usageLimit,
                countBefore: usage.centralUsedCount - 1,
                actualCount: usage.centralUsedCount,
              };
            }
          }
          const sourceLines = existing.lines.map((line) => ({
            id: line.id,
            variantId: line.variantId,
            quantity: line.quantity,
          }));
          const allocated = await allocateSaleLines(
            tx.inventory,
            existing.branchId,
            existing.operationId,
            claimed.recordedAt,
            sourceLines,
            true,
          );
          const completedLines: SaleLineWrite[] = existing.lines.map((line, index) => {
            const row = allocated.allocations[index];
            return {
              ...line,
              allocatedQuantity: row?.allocatedQuantity ?? 0,
              unallocatedQuantity: row?.unallocatedQuantity ?? line.quantity,
            };
          });
          const record = await tx.sales.updateCompletion({
            id: existing.id,
            occurredAt: recovered.occurredAt ?? existing.occurredAt,
            recordedAt: claimed.recordedAt,
            costsIncomplete: allocated.costsIncomplete,
            payment: validatePayment(recovered.payment, existing.finalTotalPiasters - existing.exchangeCreditAppliedPiasters),
            payloadFingerprint: recoveredFingerprint,
            lines: completedLines,
            recoveredByStaffId: manager.id,
            recoveredAt: new Date(),
            couponUsageDiscrepancy,
            sourceRestoreGeneration: recovered.sourceRestoreGeneration,
          });
          return finish(record, true);
        });
        return {
          sale: await hydrate(outcome.record, true),
          created: outcome.created,
          acknowledgement: outcome.acknowledgement,
        };
      }
      const snapshot = await ports.snapshots.getById(recovered.command.snapshotId);
      if (!snapshot) {
        throw new NotFoundError("لقطة الأسعار غير موجودة.");
      }
      if (snapshot.deviceId !== recovered.command.deviceId) {
        throw new SalesValidationError("معرّف الجهاز غير صالح.");
      }
      assertSnapshotPricingVersion(snapshot, recovered.command.pricingVersion);
      const original = await ports.actors.getStaff(snapshot.staffId);
      if (!original) {
        throw new NotFoundError("الموظف الأصلي غير موجود.");
      }
      const branches = await ports.actors.listBranches();
      const branch = branches.find((item) => item.id === snapshot.branchId);
      if (!branch) {
        throw new ForbiddenError();
      }
      const fingerprint = fingerprintAcceptedSalePayload({
        saleId: recovered.command.saleId,
        snapshotId: recovered.command.snapshotId,
        ...(recovered.command.pricingVersion === 1
          ? {
              pricingVersion: 1 as const,
              occurredAt: recovered.command.occurredAt.toISOString(),
              pricingOccurredAt: recovered.command.pricingOccurredAt.toISOString(),
            }
          : {}),
        customerName: recovered.command.customerName,
        customerPhone: recovered.command.customerPhone,
        couponCode: recovered.command.couponCode,
        employeeDiscountPiasters: recovered.command.employeeDiscountPiasters,
        discountReason: recovered.command.discountReason,
        ...(recovered.command.payment ? { payment: recovered.command.payment } : {}),
        lines: recovered.command.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          ...(recovered.command.pricingVersion === 1
            ? { listedUnitPricePiasters: line.listedUnitPricePiasters }
            : {}),
        })),
      });
      const outcome = await commitSnapshotPricedSale({
        viewer: manager,
        seller: original,
        branch,
        snapshot,
        command: recovered.command,
        fingerprint,
        recoveredByStaffId: manager.id,
        recoveredAt: new Date(),
        requireViewerRead: false,
        expectedRestoreGeneration: null,
        coverageVariantIds: [...new Set([...snapshot.prices.map((item) => item.variantId), ...coverageVariantIds])],
      });
      return {
        sale: await hydrate(outcome.record, true),
        created: outcome.created,
        acknowledgement: outcome.acknowledgement,
      };
    },

    async listDeferredForRestore(auth: VerifiedAuth | null) {
      await requireManager(auth);
      return ports.deferredCompletions.list();
    },

    async list(auth: VerifiedAuth | null): Promise<Array<SaleDto | ManagerSaleDto>> {
      const staff = await requireStaff(auth);
      const rows = isManager(staff)
        ? await ports.sales.listCompleted()
        : await ports.sales.listCompletedForStaff(
            staff.id,
            staff.grants.filter((grant) => grant.cashier || grant.orderRepresentative).map((grant) => grant.branchId),
          );
      return Promise.all(rows.map((row) => hydrate(row, isManager(staff))));
    },

    async get(auth: VerifiedAuth | null, id: string): Promise<SaleDto | ManagerSaleDto> {
      const staff = await requireStaff(auth);
      const saleId = assertUuid(id, "البيع غير موجود.");
      const record = await ports.sales.getById(saleId);
      if (!record?.physicallyCompleted) {
        throw new NotFoundError("البيع غير موجود.");
      }
      if (!canRead(staff, record)) {
        throw new ForbiddenError();
      }
      return hydrate(record, isManager(staff));
    },

    async getByOperation(auth: VerifiedAuth | null, operationId: string): Promise<SaleDto | ManagerSaleDto> {
      const staff = await requireStaff(auth);
      const id = assertUuid(operationId, "معرّف العملية غير صالح.");
      const record = await ports.sales.getByOperationId(id);
      if (!record) {
        throw new NotFoundError("لم يُحفظ البيع بعد.");
      }
      if (!canRead(staff, record)) {
        throw new ForbiddenError();
      }
      return hydrate(record, isManager(staff));
    },

    referencedVariantIds(variantIds: string[]) {
      return ports.sales.referencedVariantIds(variantIds);
    },

    async listCustomers(auth: VerifiedAuth | null, input: unknown): Promise<CustomerListDto> {
      await requireManager(auth);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new SalesValidationError("بيانات العملاء غير صالحة.");
      }
      const body = input as Record<string, unknown>;
      if (Object.keys(body).some((key) => key !== "q" && key !== "limit" && key !== "cursor")) {
        throw new SalesValidationError("بيانات العملاء غير صالحة.");
      }
      const rawQuery = body.q === undefined || body.q === null ? "" : body.q;
      if (typeof rawQuery !== "string" || rawQuery.length > 80) {
        throw new SalesValidationError("نص البحث غير صالح.");
      }
      const query = rawQuery.trim();
      let limit = 40;
      if (body.limit !== undefined && body.limit !== null && body.limit !== "") {
        if (typeof body.limit === "string" && !/^\d+$/.test(body.limit)) {
          throw new SalesValidationError("حد الصفحة غير صالح.");
        }
        const parsed = typeof body.limit === "number" ? body.limit : Number(body.limit);
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 80) {
          throw new SalesValidationError("حد الصفحة غير صالح.");
        }
        limit = parsed;
      }
      const after = decodeCustomerCursor(body.cursor);
      const rows = await ports.customers.list({
        query,
        digits: customerSearchDigits(query),
        limit: limit + 1,
        after,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        customers: page.map(toCustomerSummary),
        nextCursor: rows.length > limit && last ? encodeCustomerCursor(last) : null,
      };
    },

    async lookupCustomer(
      auth: VerifiedAuth | null,
      input: unknown,
    ): Promise<{ customer: CustomerSummaryDto | null }> {
      await requireCashier(auth);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new SalesValidationError("بيانات العميل غير صالحة.");
      }
      const body = input as Record<string, unknown>;
      const keys = Object.keys(body);
      if (keys.some((key) => key !== "phone" && key !== "name")) {
        throw new SalesValidationError("بيانات العميل غير صالحة.");
      }
      if (body.name !== undefined && typeof body.name !== "string") {
        throw new SalesValidationError("اسم العميل غير صالح.");
      }
      if (typeof body.phone !== "string") {
        throw new SalesValidationError("رقم الهاتف غير صالح للعميل.");
      }
      const phone = normalizeCustomerPhone(body.phone);
      if (!phone) throw new SalesValidationError("رقم الهاتف غير صالح للعميل.");
      const customer = await ports.customers.findByPhone(phone);
      return { customer: customer ? toCustomerSummary(customer) : null };
    },

    async customerHistory(
      auth: VerifiedAuth | null,
      customerId: string,
      periodInput: unknown,
    ): Promise<CustomerHistoryDto> {
      await requireManager(auth);
      const id = assertUuid(customerId, "العميل غير موجود.");
      const period = periodInput === undefined || periodInput === null || periodInput === ""
        ? "year"
        : periodInput;
      if (period !== "month" && period !== "year") {
        throw new SalesValidationError("فترة العرض غير صالحة.");
      }
      const customer = await ports.customers.getById(id);
      if (!customer) throw new NotFoundError("العميل غير موجود.");
      const bounds = cairoPeriod(ports.clock?.now() ?? new Date(), period);
      const [physical, online] = await Promise.all([
        ports.customers.listPhysicalPurchases(customer, bounds.from, bounds.to),
        ports.paidOnline.listDeliveredPurchases(customer.normalizedPhone, bounds.from, bounds.to),
      ]);
      const variantIds = [...new Set(physical.flatMap((purchase) => purchase.lines.map((line) => line.variantId)))];
      const listed = variantIds.length === 0 ? [] : await ports.prices.getListedPrices(variantIds);
      const byVariant = new Map(listed.map((row) => [row.variantId, row.identity]));
      const purchases = [
        ...physical.map((purchase) => ({
          channel: "physical" as const,
          sourceId: purchase.sourceId,
          reference: purchase.reference,
          paidAt: purchase.paidAt.toISOString(),
          products: purchase.lines.map((line) => {
            const identity = byVariant.get(line.variantId);
            return {
              nameAr: identity?.product.nameAr ?? "صنف محفوظ",
              optionText: identity ? purchaseOption(identity) : null,
              quantity: line.quantity,
            };
          }),
        })),
        ...online.map((purchase) => ({
          channel: "online" as const,
          sourceId: purchase.sourceId,
          reference: purchase.reference,
          paidAt: purchase.paidAt.toISOString(),
          products: purchase.products,
        })),
      ].sort((left, right) => {
        if (left.paidAt === right.paidAt) return left.sourceId < right.sourceId ? 1 : -1;
        return left.paidAt < right.paidAt ? 1 : -1;
      });
      return {
        customer: toCustomerSummary(customer),
        period,
        from: bounds.from,
        to: bounds.to,
        purchaseCount: purchases.length,
        purchases,
      };
    },
  };
}

function toCustomerSummary(customer: { id: string; normalizedPhone: string; displayName: string }): CustomerSummaryDto {
  return {
    id: customer.id,
    normalizedPhone: customer.normalizedPhone,
    displayName: customer.displayName,
  };
}

function encodeCustomerCursor(customer: { displayName: string; id: string }): string {
  return Buffer.from(JSON.stringify({ n: customer.displayName, i: customer.id }), "utf8").toString("base64url");
}

function decodeCustomerCursor(value: unknown): { displayName: string; id: string } | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512) {
    throw new SalesValidationError("صفحة العملاء غير صالحة.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new SalesValidationError("صفحة العملاء غير صالحة.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SalesValidationError("صفحة العملاء غير صالحة.");
  }
  const row = parsed as { n?: unknown; i?: unknown };
  if (typeof row.n !== "string" || row.n.length > 200 || typeof row.i !== "string" || !UUID_PATTERN.test(row.i)) {
    throw new SalesValidationError("صفحة العملاء غير صالحة.");
  }
  return { displayName: row.n, id: row.i };
}

function purchaseOption(identity: VariantIdentityDto): string | null {
  if (identity.purpose === "operational") return null;
  const parts = [identity.size.nameAr, identity.color.nameAr].map((name) => name.trim()).filter((name) => name.length > 0);
  return parts.length > 0 ? parts.join(" / ") : null;
}

async function loadLockedIdentity(sales: SaleStore, saleId: string, operationId: string) {
  await sales.lockIdentities(saleId, operationId);
  const existing = await sales.getById(saleId);
  const byOperation = await sales.getByOperationId(operationId);
  if (existing && existing.operationId !== operationId) {
    throw new OperationConflictError();
  }
  if (byOperation && byOperation.id !== saleId) {
    throw new OperationConflictError();
  }
  return existing ?? byOperation;
}

async function priceFromListed(
  automaticPricing: AutomaticPricingPort,
  listed: Awaited<ReturnType<ListedPriceReader["getListedPrices"]>>,
  quantities: Array<{ variantId: string; quantity: number }>,
  employeeDiscountPiasters: number,
  couponCode: string | null,
) {
  const byId = new Map(listed.map((row) => [row.variantId, row]));
  const missing = quantities.filter((line) => !byId.has(line.variantId));
  if (missing.length > 0) {
    throw new SalesValidationError("المتغير المحدد غير موجود.");
  }
  const lines = quantities.map((line) => {
    const basis = byId.get(line.variantId);
    if (!basis) throw new SalesValidationError("المتغير المحدد غير موجود.");
    return {
      variantId: line.variantId,
      productId: basis.productId,
      categoryId: basis.categoryId,
      quantity: line.quantity,
      listedUnitPricePiasters: basis.listedUnitPricePiasters,
    };
  });
  const automatic = await automaticPricing.evaluate(lines, undefined, couponCode);
  const priced = priceSaleLines(
    lines,
    employeeDiscountPiasters,
    automatic.appliedAutomaticOffer ? automatic.unitRanges : undefined,
    automatic.appliedCoupon ? automatic.couponUnitRanges : undefined,
  );
  return {
    ...priced,
    lines: stampAcceptedFloors(priced.lines, new Map(lines.map((line) => {
      const basis = byId.get(line.variantId);
      return [line.variantId, basis?.minimumUnitPricePiasters] as const;
    }))),
    appliedAutomaticOffer: automatic.appliedAutomaticOffer,
    appliedCoupon: automatic.appliedCoupon,
  };
}

type PricedSale = ReturnType<typeof priceSaleLines> & {
  appliedAutomaticOffer: SaleInsert["appliedAutomaticOffer"];
  appliedCoupon: SaleInsert["appliedCoupon"];
};

function toInsert(
  command: ParsedSale,
  actor: { staff: { id: string; displayName: string }; branch: { id: string } },
  priced: PricedSale,
  fingerprint: string,
  options: {
    physicallyCompleted: boolean;
    recordedAt: Date | null;
    costsIncomplete: boolean;
    completedLines?: SaleLineWrite[];
    occurredAt?: Date;
    recoveredByStaffId?: string | null;
    recoveredAt?: Date | null;
    couponUsageDiscrepancy?: SaleRecord["couponUsageDiscrepancy"];
    payment?: SalePaymentDto | null;
    sourceDeviceId?: string | null;
    sourceSnapshotId?: string | null;
    sourceRestoreGeneration: number;
  },
): SaleInsert {
  const pricedLines = priced.lines;
  const originalTotalPiasters = priced.originalTotalPiasters;
  const automaticOfferDiscountPiasters = pricedLines.reduce(
    (sum, line) => addMoney(sum, line.automaticOfferDiscountPiasters),
    0,
  );
  const couponDiscountPiasters = pricedLines.reduce((sum, line) => addMoney(sum, line.couponDiscountPiasters), 0);
  const lines =
    options.completedLines ??
    pricedLines.map((line, index) => ({
      id: crypto.randomUUID(),
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: line.listedUnitPricePiasters,
      originalPiasters: line.originalPiasters,
      discountPiasters: line.discountPiasters,
      paidPiasters: line.paidPiasters,
      automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
      couponDiscountPiasters: line.couponDiscountPiasters,
      employeeDiscountPiasters: line.employeeDiscountPiasters,
      acceptedMinimumUnitPiasters: line.acceptedMinimumUnitPiasters ?? null,
      allocatedQuantity: 0,
      unallocatedQuantity: 0,
      lineIndex: index,
      units: toUnitWrites(line.units),
    }));
  const finalTotalPiasters = subtractMoney(
    subtractMoney(originalTotalPiasters, automaticOfferDiscountPiasters),
    addMoney(couponDiscountPiasters, command.employeeDiscountPiasters),
  );
  const payment = validatePayment(options.payment, finalTotalPiasters);
  return {
    id: command.saleId,
    operationId: command.operationId,
    branchId: actor.branch.id,
    soldByStaffId: actor.staff.id,
    soldByDisplayName: actor.staff.displayName,
    discountedByStaffId: command.employeeDiscountPiasters > 0 ? actor.staff.id : null,
    occurredAt: options.occurredAt ?? command.occurredAt ?? options.recordedAt ?? new Date(),
    recordedAt: options.recordedAt,
    customerName: command.customerName,
    customerPhone: command.customerPhone,
    originalTotalPiasters,
    automaticOfferDiscountPiasters,
    appliedAutomaticOffer: priced.appliedAutomaticOffer,
    couponDiscountPiasters,
    appliedCoupon: priced.appliedCoupon,
    couponUsageDiscrepancy: options.couponUsageDiscrepancy ?? null,
    employeeDiscountPiasters: command.employeeDiscountPiasters,
    discountReason: command.discountReason,
    finalTotalPiasters,
    payment,
    cashReceivedPiasters: payment.cashPiasters,
    payloadFingerprint: fingerprint,
    physicallyCompleted: options.physicallyCompleted,
    costsIncomplete: options.costsIncomplete,
    recoveredByStaffId: options.recoveredByStaffId ?? null,
    recoveredAt: options.recoveredAt ?? null,
    sourceDeviceId: options.sourceDeviceId ?? null,
    sourceSnapshotId: options.sourceSnapshotId ?? null,
    sourceRestoreGeneration: options.sourceRestoreGeneration,
    lines,
  };
}

function toPayload(command: ParsedSale): SalePayload {
  return {
    saleId: command.saleId,
    customerName: command.customerName,
    customerPhone: command.customerPhone,
    couponCode: command.couponCode,
    employeeDiscountPiasters: command.employeeDiscountPiasters,
    discountReason: command.discountReason,
    ...(command.physicallyCompleted && command.payment ? { payment: command.payment } : {}),
    lines: command.lines,
  };
}

function toLineDto(line: SaleLineWrite, variant: SaleLineDto["variant"] | undefined): SaleLineDto {
  if (!variant) {
    throw new SalesValidationError("المتغير المحدد غير موجود.");
  }
  const offerEffects = line.automaticOfferDiscountPiasters > 0 || line.couponDiscountPiasters > 0
    ? {
        automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
        couponDiscountPiasters: line.couponDiscountPiasters,
        employeeDiscountPiasters: line.employeeDiscountPiasters,
      }
    : {};
  return {
    id: line.id,
    variantId: line.variantId,
    quantity: line.quantity,
    listedUnitPricePiasters: line.listedUnitPricePiasters,
    originalPiasters: line.originalPiasters,
    discountPiasters: line.discountPiasters,
    paidPiasters: line.paidPiasters,
    ...offerEffects,
    allocatedQuantity: line.allocatedQuantity,
    unallocatedQuantity: line.unallocatedQuantity,
    units: line.units.map((unit) => ({
      unitIndex: unit.unitIndex,
      quantity: unit.quantity,
      listedPiasters: unit.listedPiasters,
      discountPiasters: unit.discountPiasters,
      paidPiasters: unit.paidPiasters,
      ...(unit.automaticOfferDiscountPiasters > 0 || unit.couponDiscountPiasters > 0
        ? {
            automaticOfferDiscountPiasters: unit.automaticOfferDiscountPiasters,
            couponDiscountPiasters: unit.couponDiscountPiasters,
            employeeDiscountPiasters: unit.employeeDiscountPiasters,
          }
        : {}),
    })),
    variant,
  };
}

type ParsedSale = {
  saleId: string;
  operationId: string;
  physicallyCompleted: boolean;
  customerName: string | null;
  customerPhone: string | null;
  couponCode: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  payment: SalePaymentDto | null;
  occurredAt: Date | null;
  pendingOperationIds: string[];
  restoreGeneration: number | null;
  deviceId: string | null;
  receiptClaim: ParsedReceiptClaim;
  lines: Array<{ variantId: string; quantity: number }>;
};

type ParsedAcceptedSale = {
  saleId: string;
  operationId: string;
  deviceId: string;
  snapshotId: string;
  pricingVersion: 1 | null;
  pricingOccurredAt: Date;
  customerName: string | null;
  customerPhone: string | null;
  couponCode: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  payment: SalePaymentDto | null;
  occurredAt: Date;
  pendingOperationIds: string[];
  restoreGeneration: number | null;
  receiptClaim: ParsedReceiptClaim;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number | null }>;
};

function assertSnapshotPricingVersion(snapshot: PriceSnapshotRecord, commandVersion: 1 | null): void {
  const snapshotVersion = snapshot.pricingVersion ?? null;
  if (commandVersion === 1) {
    if (snapshotVersion !== 1) {
      throw new SalesValidationError("إصدار تسعير اللقطة غير صالح.");
    }
    return;
  }
  if (snapshotVersion === 1 && (snapshot.automaticOffers.length > 0 || snapshot.coupons.length > 0)) {
    throw new SalesValidationError("إصدار تسعير اللقطة مطلوب للأسعار الترويجية المحفوظة.");
  }
}

function parsePendingOperationIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new SalesValidationError("بيانات البيع غير صالحة.");
  }
  if (value.length > 500) {
    throw new SalesValidationError("بيانات البيع غير صالحة.");
  }
  const ids = value.map((item) => assertUuid(item, "معرّف العملية غير صالح."));
  return [...new Set(ids)];
}

function parseSnapshotRequest(input: unknown): { deviceId: string; pendingOperationIds: string[]; receiptRegistrationId: string | null } {
  const body = expectObject(input, "بيانات اللقطة غير صالحة.");
  assertAllowedKeys(body, SNAPSHOT_KEYS, "بيانات اللقطة غير صالحة.");
  return {
    deviceId: assertUuid(body.deviceId, "معرّف الجهاز غير صالح."),
    pendingOperationIds: parsePendingOperationIds(body.pendingOperationIds),
    receiptRegistrationId: body.receiptRegistrationId === undefined || body.receiptRegistrationId === null
      ? null
      : assertUuid(body.receiptRegistrationId, "معرّف تسجيل الإيصال غير صالح."),
  };
}

function parseAcceptedSale(input: unknown): ParsedAcceptedSale {
  const body = expectObject(input, "بيانات البيع غير صالحة.");
  assertAllowedKeys(body, ACCEPTED_KEYS, "بيانات البيع غير صالحة.");
  if (body.physicallyCompleted !== true) {
    throw new SalesValidationError("يجب تأكيد تسليم البضاعة والدفع.");
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new SalesValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  const occurredAt = parseOptionalTime(body.occurredAt);
  if (!occurredAt) {
    throw new SalesValidationError("وقت حدوث البيع غير صالح.");
  }
  const pricingVersion =
    body.pricingVersion === undefined || body.pricingVersion === null
      ? null
      : body.pricingVersion === 1
        ? 1
        : (() => {
            throw new SalesValidationError("إصدار تسعير اللقطة غير صالح.");
          })();
  const pricingOccurredAt = pricingVersion === 1 ? parseOptionalTime(body.pricingOccurredAt) : occurredAt;
  if (!pricingOccurredAt) {
    throw new SalesValidationError("وقت قبول الأسعار غير صالح.");
  }
  return {
    saleId: assertUuid(body.saleId, "معرّف البيع غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    deviceId: assertUuid(body.deviceId, "معرّف الجهاز غير صالح."),
    snapshotId: assertUuid(body.snapshotId, "لقطة الأسعار غير موجودة."),
    pricingVersion,
    pricingOccurredAt,
    customerName: parseOptionalText(body.customerName, 120, "اسم الزبون غير صالح."),
    customerPhone: parseOptionalText(body.customerPhone, 40, "هاتف الزبون غير صالح."),
    couponCode: parseCouponCode(body.couponCode),
    employeeDiscountPiasters: assertDiscountPiasters(body.employeeDiscountPiasters),
    discountReason: parseOptionalText(body.discountReason, 200, "سبب الخصم غير صالح."),
    payment: parsePaymentInput(body.payment),
    occurredAt,
    pendingOperationIds: parsePendingOperationIds(body.pendingOperationIds),
    restoreGeneration: parseRestoreGeneration(body.restoreGeneration, null),
    receiptClaim: parseReceiptClaim(body.receiptClaim),
    lines: body.lines.map((item) => {
      const line = expectObject(item, "بيانات صنف البيع غير صالحة.");
      assertAllowedKeys(line, ACCEPTED_LINE_KEYS, "بيانات صنف البيع غير صالحة.");
      return {
        variantId: assertUuid(line.variantId, "المتغير المحدد غير موجود."),
        quantity: assertQuantity(line.quantity, "الكمية غير صالحة."),
        listedUnitPricePiasters:
          line.listedUnitPricePiasters === undefined
            ? pricingVersion === 1
              ? (() => {
                  throw new SalesValidationError("سعر البيع المقبول غير موجود.");
                })()
              : null
            : assertPiasters(line.listedUnitPricePiasters, "سعر البيع غير صالح."),
      };
    }),
  };
}

function parseRecoverCommand(
  input: unknown,
):
  | { kind: "snapshot"; command: ParsedAcceptedSale }
  | { kind: "prepared"; saleId: string; operationId: string; pendingOperationIds: string[]; occurredAt: Date | null;
      sourceRestoreGeneration: number | null; payment: SalePaymentDto | null; deviceId: string | null;
      receiptClaim: ParsedReceiptClaim } {
  const body = expectObject(input, "بيانات البيع غير صالحة.");
  assertAllowedKeys(body, RECOVER_KEYS, "بيانات البيع غير صالحة.");
  if (body.physicallyCompleted !== true) {
    throw new SalesValidationError("يجب تأكيد تسليم البضاعة والدفع.");
  }
  if (body.snapshotId === undefined || body.snapshotId === null || body.snapshotId === "") {
    return {
      kind: "prepared",
      saleId: assertUuid(body.saleId, "معرّف البيع غير صالح."),
      operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
      pendingOperationIds: parsePendingOperationIds(body.pendingOperationIds),
      occurredAt: parseOptionalTime(body.occurredAt),
      sourceRestoreGeneration: parseRestoreGeneration(body.restoreGeneration, null),
      payment: parsePaymentInput(body.payment),
      deviceId: body.deviceId !== undefined && body.deviceId !== null
        ? assertUuid(body.deviceId, "معرّف الجهاز غير صالح.")
        : null,
      receiptClaim: parseReceiptClaim(body.receiptClaim),
    };
  }
  return { kind: "snapshot", command: parseAcceptedSale(input) };
}

function parseSaleWrite(input: unknown, complete: boolean): ParsedSale {
  const body = expectObject(input, "بيانات البيع غير صالحة.");
  assertAllowedKeys(body, complete ? COMPLETE_KEYS : PREPARE_KEYS, "بيانات البيع غير صالحة.");
  if (complete && body.physicallyCompleted !== true) {
    throw new SalesValidationError("يجب تأكيد تسليم البضاعة والدفع.");
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new SalesValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  return {
    saleId: assertUuid(body.saleId, "معرّف البيع غير صالح."),
    operationId: assertUuid(body.operationId, "معرّف العملية غير صالح."),
    physicallyCompleted: complete,
    customerName: parseOptionalText(body.customerName, 120, "اسم الزبون غير صالح."),
    customerPhone: parseOptionalText(body.customerPhone, 40, "هاتف الزبون غير صالح."),
    couponCode: parseCouponCode(body.couponCode),
    employeeDiscountPiasters: assertDiscountPiasters(body.employeeDiscountPiasters),
    discountReason: parseOptionalText(body.discountReason, 200, "سبب الخصم غير صالح."),
    payment: parsePaymentInput(body.payment),
    occurredAt: parseOptionalTime(body.occurredAt),
    pendingOperationIds: complete ? parsePendingOperationIds(body.pendingOperationIds) : [],
    restoreGeneration: complete ? parseRestoreGeneration(body.restoreGeneration, null) : null,
    deviceId: complete && body.deviceId !== undefined && body.deviceId !== null
      ? assertUuid(body.deviceId, "معرّف الجهاز غير صالح.")
      : null,
    receiptClaim: complete ? parseReceiptClaim(body.receiptClaim) : { kind: "absent" },
    lines: body.lines.map((item) => {
      const line = expectObject(item, "بيانات صنف البيع غير صالحة.");
      assertAllowedKeys(line, LINE_KEYS, "بيانات صنف البيع غير صالحة.");
      return {
        variantId: assertUuid(line.variantId, "المتغير المحدد غير موجود."),
        quantity: assertQuantity(line.quantity, "الكمية غير صالحة."),
      };
    }),
  };
}

function parseRestoreGeneration(value: unknown, fallback: number | null): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SalesValidationError("جيل الاستعادة غير صالح.");
  }
  return value;
}

function preparedSaleJson(record: SaleRecord): Record<string, unknown> {
  return {
    ...record,
    occurredAt: record.occurredAt.toISOString(),
    recordedAt: record.recordedAt?.toISOString() ?? null,
    couponUsageDiscrepancy: null,
    recoveredAt: null,
  };
}

function serializedReceiptClaim(claim: ParsedReceiptClaim): Record<string, unknown> | undefined {
  if (claim.kind === "absent") return undefined;
  if (claim.kind === "valid") return { ...claim.claim };
  return claim.claimedReference === null ? {} : { reference: claim.claimedReference };
}

function deferredPayload(kind: "connected" | "accepted", command: ParsedSale | ParsedAcceptedSale): Record<string, unknown> {
  const receiptClaim = serializedReceiptClaim(command.receiptClaim);
  return {
    kind,
    saleId: command.saleId,
    operationId: command.operationId,
    physicallyCompleted: true,
    restoreGeneration: command.restoreGeneration,
    occurredAt: command.occurredAt?.toISOString() ?? null,
    customerName: command.customerName,
    customerPhone: command.customerPhone,
    couponCode: command.couponCode,
    employeeDiscountPiasters: command.employeeDiscountPiasters,
    discountReason: command.discountReason,
    ...(command.payment ? { payment: command.payment } : {}),
    pendingOperationIds: command.pendingOperationIds,
    lines: command.lines,
    ...(command.deviceId ? { deviceId: command.deviceId } : {}),
    ...(receiptClaim ? { receiptClaim } : {}),
    ...(kind === "accepted" ? {
      snapshotId: (command as ParsedAcceptedSale).snapshotId,
      pricingVersion: (command as ParsedAcceptedSale).pricingVersion,
      pricingOccurredAt: (command as ParsedAcceptedSale).pricingOccurredAt.toISOString(),
    } : {}),
  };
}

function receiptStaffMetadata(identity: SaleRecord["receiptIdentity"]): {
  receiptReference?: string;
  receiptNumberingConflict?: true;
} {
  if (!identity) return {};
  const conflict = identity.status === "conflict" || identity.numberingConflict === true;
  return {
    ...(identity.reference ? { receiptReference: identity.reference } : {}),
    ...(conflict ? { receiptNumberingConflict: true as const } : {}),
  };
}

function assertDiscountPiasters(value: unknown): number {
  if (typeof value !== "number") {
    throw new SalesValidationError("قيمة الخصم غير صالحة.");
  }
  try {
    return assertSafeMoney(value);
  } catch {
    throw new SalesValidationError("قيمة الخصم غير صالحة.");
  }
}

function toUnitWrites(
  units: Array<{
    unitIndex?: number;
    quantity?: number;
    listedPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
    automaticOfferDiscountPiasters?: number;
    couponDiscountPiasters?: number;
    employeeDiscountPiasters?: number;
  }>,
): SaleLineWrite["units"] {
  return units.map((unit, index) => ({
    unitIndex: unit.unitIndex ?? index,
    quantity: unit.quantity ?? 1,
    listedPiasters: unit.listedPiasters,
    discountPiasters: unit.discountPiasters,
    paidPiasters: unit.paidPiasters,
    automaticOfferDiscountPiasters: unit.automaticOfferDiscountPiasters ?? 0,
    couponDiscountPiasters: unit.couponDiscountPiasters ?? 0,
    employeeDiscountPiasters:
      unit.employeeDiscountPiasters ?? unit.discountPiasters - (unit.automaticOfferDiscountPiasters ?? 0) - (unit.couponDiscountPiasters ?? 0),
  }));
}

function parseCouponCode(value: unknown): string | null {
  const parsed = parseOptionalText(value, 64, "كود الكوبون غير صالح.");
  return parsed ? parsed.toLocaleUpperCase("en-US") : null;
}

function parseOptionalText(value: unknown, max: number, messageAr: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new SalesValidationError(messageAr);
  }
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > max) {
    throw new SalesValidationError(messageAr);
  }
  return trimmed;
}

function parseOptionalTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new SalesValidationError("وقت حدوث البيع غير صالح.");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SalesValidationError("وقت حدوث البيع غير صالح.");
  }
  return parsed;
}

function expectObject(value: unknown, messageAr: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SalesValidationError(messageAr);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(body: Record<string, unknown>, allowed: Set<string>, messageAr: string) {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new SalesValidationError(messageAr);
    }
  }
}

function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new SalesValidationError(messageAr);
  }
  return value;
}
