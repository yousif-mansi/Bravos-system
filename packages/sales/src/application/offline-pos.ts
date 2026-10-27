import type { SaleAcknowledgementDto, SaleDto } from "@bravos/contracts";
import { evaluateAutomaticOffers, evaluateCoupon, normalizeCouponCode, PricingValidationError } from "@bravos/pricing";
import { assertMergedSaleQuantities, priceSaleLines } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import { digestOfflineSale } from "../domain/offline-digest.ts";
import { validatePayment } from "../domain/payment.ts";
import { POS_SCHEMA_VERSION } from "../domain/pos-update.ts";
import type { CompleteOfflineSaleInput, OfflineCompletedSale, OfflinePosStore } from "./offline-ports.ts";

export type RecoveredSaleAck = Pick<
  SaleDto,
  "id" | "operationId" | "recordedAt" | "soldByStaffId" | "finalTotalPiasters" | "lines" | "discrepancy"
> & { acknowledgement: SaleAcknowledgementDto; reference?: string | null };

export function createOfflinePosServices(store: OfflinePosStore) {
  return {
    deviceId: () => store.deviceId(),
    rememberSession: store.rememberSession.bind(store),
    markSignedOut: store.markSignedOut.bind(store),
    readSessionRevision: store.readSessionRevision.bind(store),
    canUpgradeSafely: store.canUpgradeSafely.bind(store),
    loadSignedInWorkspace: () => store.loadSignedInWorkspace(),
    saveSnapshot: store.saveSnapshot.bind(store),
    loadSnapshot: store.loadSnapshot.bind(store),
    lookupProduct: store.lookupProduct.bind(store),
    availableQuantity: store.availableQuantity.bind(store),
    listUnsynced: store.listUnsynced.bind(store),
    listCompleted: store.listCompleted.bind(store),
    markAcknowledged: store.markAcknowledged.bind(store),
    applyAcknowledgement: store.applyAcknowledgement.bind(store),
    countOtherPending: store.countOtherPending.bind(store),
    listPendingOperationIds: store.listPendingOperationIds.bind(store),
    readStockVersion: store.readStockVersion.bind(store),
    readStockCache: store.readStockCache.bind(store),
    async recoverPreservedQueues(
      staffId: string,
      submit: (sale: OfflineCompletedSale) => Promise<RecoveredSaleAck>,
      stillCurrent?: () => boolean,
    ) {
      if (!(await store.canUpgradeSafely(POS_SCHEMA_VERSION))) {
        return { recovered: 0, remaining: await store.countOtherPending(staffId) };
      }
      const rows = await store.listPreservedPending(staffId);
      let recovered = 0;
      for (const local of rows) {
        if (stillCurrent && !stillCurrent()) {
          break;
        }
        const synced = await submit(local);
        if (stillCurrent && !stillCurrent()) {
          break;
        }
        const { acknowledgement, ...sale } = synced;
        await store.applyAcknowledgement({
          branchId: local.branch.id,
          acknowledgedOperationIds: acknowledgement.acknowledgedOperationIds,
          stockVersion: acknowledgement.stockVersion,
          includedOperationIds: acknowledgement.includedOperationIds,
          includedOperations: acknowledgement.includedOperations ?? [],
          availability: acknowledgement.availability,
          sales: [sale],
        });
        recovered += 1;
      }
      return { recovered, remaining: await store.countOtherPending(staffId) };
    },
    loadPending: store.loadPending.bind(store),
    listRecoverablePending: store.listRecoverablePending.bind(store),
    savePending: store.savePending.bind(store),
    clearPending: store.clearPending.bind(store),
    migrateLegacyMarkers: () => store.migrateLegacyMarkers(),
    requestPersistentStorage: () => store.requestPersistentStorage(),
    readSchemaVersion: () => store.readSchemaVersion(),

    async priceCart(input: CompleteOfflineSaleInput) {
      const coupon = input.couponCode
        ? input.snapshot.coupons?.find((item) => normalizeCouponCode(item.code) === normalizeCouponCode(input.couponCode!))
        : null;
      const localUses = coupon ? await store.countUnaccountedCouponUses(coupon.id, input.snapshot.issuedAt) : 0;
      return priceOfflineCart(input, localUses);
    },

    async recordCompleted(sale: OfflineCompletedSale, cachedByVariant: Map<string, number>) {
      const payloadFingerprint = await digestOfflineSale({
        id: sale.id,
        kind: sale.kind,
        snapshotId: sale.snapshotId,
        pricingVersion: sale.pricingVersion ?? null,
        occurredAt: sale.occurredAt,
        ...(sale.pricingOccurredAt ? { pricingOccurredAt: sale.pricingOccurredAt } : {}),
        customerName: sale.customerName,
        customerPhone: sale.customerPhone,
        couponCode: sale.couponCode,
        employeeDiscountPiasters: sale.employeeDiscountPiasters,
        discountReason: sale.discountReason,
        ...(sale.payment ? { payment: sale.payment } : {}),
        lines: sale.lines,
        payloadFingerprint: null,
      });
      return store.recordCompleted({ ...sale, payloadFingerprint }, cachedByVariant);
    },

    async completeSale(input: CompleteOfflineSaleInput): Promise<OfflineCompletedSale> {
      const coupon = input.couponCode
        ? input.snapshot.coupons?.find((item) => normalizeCouponCode(item.code) === normalizeCouponCode(input.couponCode!))
        : null;
      const localUses = coupon ? await store.countUnaccountedCouponUses(coupon.id, input.snapshot.issuedAt) : 0;
      const priced = priceOfflineCart(input, localUses);
      const payment = validatePayment(input.payment, priced.finalTotalPiasters);
      const payloadFingerprint = await digestOfflineSale({
        id: input.saleId,
        kind: input.kind,
        snapshotId: input.kind === "accepted" ? input.snapshot.snapshotId : null,
        pricingVersion: input.kind === "accepted" && input.snapshot.pricingVersion === 1 ? 1 : null,
        occurredAt: input.occurredAt,
        ...(input.pricingOccurredAt ? { pricingOccurredAt: input.pricingOccurredAt } : {}),
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        couponCode: input.couponCode,
        employeeDiscountPiasters: input.employeeDiscountPiasters,
        discountReason: input.discountReason,
        ...(input.payment ? { payment } : {}),
        lines: input.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          ...(input.kind === "accepted" && input.snapshot.pricingVersion === 1
            ? { listedUnitPricePiasters: line.variant.sellingPricePiasters }
            : {}),
        })),
      });
      return store.completeSale(input.payment ? { ...input, payment } : input, {
        originalTotalPiasters: priced.originalTotalPiasters,
        automaticOfferDiscountPiasters: priced.automaticOfferDiscountPiasters,
        appliedAutomaticOffer: priced.appliedAutomaticOffer,
        couponDiscountPiasters: priced.couponDiscountPiasters,
        appliedCoupon: priced.appliedCoupon,
        finalTotalPiasters: priced.finalTotalPiasters,
        payloadFingerprint,
        lines: priced.lines.map((line) => {
          const source = input.lines.find((item) => item.variantId === line.variantId);
          if (!source) {
            throw new SalesValidationError("المتغير المحدد غير موجود.");
          }
          return {
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
            allocatedQuantity: 0,
            unallocatedQuantity: 0,
            units: line.units,
            variant: {
              id: source.variant.id,
              product: {
                id: source.product.id,
                code: source.product.code,
                nameAr: source.product.nameAr,
              },
              size: source.variant.size,
              color: source.variant.color,
            },
          };
        }),
      });
    },
  };
}

export function priceOfflineCart(input: CompleteOfflineSaleInput, unaccountedLocalCouponUses = 0) {
  if (input.lines.length === 0) {
    throw new SalesValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  assertMergedSaleQuantities(input.lines);
  const snapshotPrices = new Map(
    input.snapshot.products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, {
        listedUnitPricePiasters: variant.sellingPricePiasters,
        productId: product.id,
        categoryId: product.categoryId ?? "",
      }] as const),
    ),
  );
  const basketLines = input.lines.map((line) => {
      const basis = snapshotPrices.get(line.variantId);
      if (!basis) {
        throw new SalesValidationError("المتغير المحدد غير موجود.");
      }
      return {
        variantId: line.variantId,
        productId: basis.productId,
        categoryId: basis.categoryId,
        quantity: line.quantity,
        listedUnitPricePiasters: basis.listedUnitPricePiasters,
      };
    });
  try {
    const automatic = evaluateAutomaticOffers({
      offers: input.snapshot.automaticOffers ?? [],
      lines: basketLines,
      at: new Date(input.pricingOccurredAt ?? input.occurredAt),
    });
    const coupons = (input.snapshot.coupons ?? []).map((coupon) => ({
      ...coupon,
      usedCount: coupon.usedCount + (input.couponCode && normalizeCouponCode(coupon.code) === normalizeCouponCode(input.couponCode)
        ? unaccountedLocalCouponUses
        : 0),
    }));
    const coupon = evaluateCoupon({
      coupons,
      code: input.couponCode,
      lines: basketLines,
      automaticOffer: automatic.appliedAutomaticOffer,
      automaticRanges: automatic.unitRanges,
      at: new Date(input.pricingOccurredAt ?? input.occurredAt),
    });
    return {
      ...priceSaleLines(
        basketLines,
        input.employeeDiscountPiasters,
        automatic.appliedAutomaticOffer ? automatic.unitRanges : undefined,
        coupon.appliedCoupon ? coupon.unitRanges : undefined,
      ),
      automaticOfferDiscountPiasters: automatic.automaticOfferDiscountPiasters,
      appliedAutomaticOffer: automatic.appliedAutomaticOffer,
      couponDiscountPiasters: coupon.couponDiscountPiasters,
      appliedCoupon: coupon.appliedCoupon,
    };
  } catch (error) {
    if (error instanceof PricingValidationError) {
      throw new SalesValidationError(error.message);
    }
    throw error;
  }
}

export type OfflinePosServices = ReturnType<typeof createOfflinePosServices>;
