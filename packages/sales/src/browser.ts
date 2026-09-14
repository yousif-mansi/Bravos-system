export {
  allocateEmployeeDiscount,
  assertMergedSaleQuantities,
  mergeVariantQuantities,
  priceSaleLines,
} from "./domain/discount.ts";
export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "./domain/pos-update.ts";
export type { PosUpdateDecision } from "./domain/pos-update.ts";
export { SalesValidationError } from "./domain/errors.ts";
export { createOfflinePosServices, priceOfflineCart } from "./application/offline-pos.ts";
export type { OfflinePosServices } from "./application/offline-pos.ts";
export {
  PosStorageError,
  type CompleteOfflineSaleInput,
  type OfflineCompletedSale,
  type OfflinePendingSale,
  type OfflinePosStore,
  type OfflineSaleKind,
  type SessionTransition,
} from "./application/offline-ports.ts";
export { createDexiePosStore } from "./adapters/dexie-pos.ts";
