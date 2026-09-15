import type { SaleAcknowledgementDto, SaleDto } from "@bravos/contracts";
import { assertMergedSaleQuantities, priceSaleLines } from "../domain/discount.ts";
import { SalesValidationError } from "../domain/errors.ts";
import { digestOfflineSale } from "../domain/offline-digest.ts";
import type { CompleteOfflineSaleInput, OfflineCompletedSale, OfflinePosStore } from "./offline-ports.ts";

export type RecoveredSaleAck = Pick<
  SaleDto,
  "id" | "operationId" | "recordedAt" | "soldByStaffId" | "finalTotalPiasters" | "lines" | "discrepancy"
> & { acknowledgement: SaleAcknowledgementDto };

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

    priceCart(input: CompleteOfflineSaleInput) {
      return priceOfflineCart(input);
    },

    async recordCompleted(sale: OfflineCompletedSale, cachedByVariant: Map<string, number>) {
      const payloadFingerprint = await digestOfflineSale({
        id: sale.id,
        kind: sale.kind,
        snapshotId: sale.snapshotId,
        customerName: sale.customerName,
        customerPhone: sale.customerPhone,
        employeeDiscountPiasters: sale.employeeDiscountPiasters,
        discountReason: sale.discountReason,
        lines: sale.lines,
        payloadFingerprint: null,
      });
      return store.recordCompleted({ ...sale, payloadFingerprint }, cachedByVariant);
    },

    async completeSale(input: CompleteOfflineSaleInput): Promise<OfflineCompletedSale> {
      const priced = priceOfflineCart(input);
      const payloadFingerprint = await digestOfflineSale({
        id: input.saleId,
        kind: input.kind,
        snapshotId: input.kind === "accepted" ? input.snapshot.snapshotId : null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        employeeDiscountPiasters: input.employeeDiscountPiasters,
        discountReason: input.discountReason,
        lines: input.lines,
      });
      return store.completeSale(input, {
        originalTotalPiasters: priced.originalTotalPiasters,
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
