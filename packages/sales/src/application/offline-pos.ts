import { assertMergedSaleQuantities, priceSaleLines } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import type { CompleteOfflineSaleInput, OfflineCompletedSale, OfflinePosStore } from "./offline-ports.ts";

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
    loadPending: store.loadPending.bind(store),
    listRecoverablePending: store.listRecoverablePending.bind(store),
    savePending: store.savePending.bind(store),
    clearPending: store.clearPending.bind(store),
    migrateLegacyMarkers: () => store.migrateLegacyMarkers(),
    requestPersistentStorage: () => store.requestPersistentStorage(),
    readSchemaVersion: () => store.readSchemaVersion(),

    priceCart(input: CompleteOfflineSaleInput) {
      return priceOfflineCart(input);
    },

    recordCompleted: store.recordCompleted.bind(store),

    async completeSale(input: CompleteOfflineSaleInput): Promise<OfflineCompletedSale> {
      const priced = priceOfflineCart(input);
      return store.completeSale(input, {
        originalTotalPiasters: priced.originalTotalPiasters,
        finalTotalPiasters: priced.finalTotalPiasters,
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

export function priceOfflineCart(input: CompleteOfflineSaleInput) {
  if (input.lines.length === 0) {
    throw new SalesValidationError("يجب تحديد صنف واحد على الأقل.");
  }
  assertMergedSaleQuantities(input.lines);
  const snapshotPrices = new Map(
    input.snapshot.products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, variant.sellingPricePiasters] as const),
    ),
  );
  return priceSaleLines(
    input.lines.map((line) => {
      const listed = snapshotPrices.get(line.variantId);
      if (listed === undefined) {
        throw new SalesValidationError("المتغير المحدد غير موجود.");
      }
      return {
        variantId: line.variantId,
        quantity: line.quantity,
        listedUnitPricePiasters: listed,
      };
    }),
    input.employeeDiscountPiasters,
  );
}

export type OfflinePosServices = ReturnType<typeof createOfflinePosServices>;
