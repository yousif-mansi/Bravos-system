export { normalizeCustomerPhone } from "./domain/customer-phone.ts";
export {
  allocateEmployeeDiscount,
  assertMergedSaleQuantities,
  mergeVariantQuantities,
  assertUnitFloors,
  priceSaleLines,
  stampAcceptedFloors,
} from "./domain/discount.ts";
export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "./domain/pos-update.ts";
export type { PosUpdateDecision } from "./domain/pos-update.ts";
export { SalesValidationError } from "./domain/errors.ts";
export {
  formatReceiptReference,
  nextReceiptSequence,
  parseReceiptClaim,
  parseReceiptReference,
} from "./domain/receipt-number.ts";
export type { ParsedReceiptClaim, ReceiptClaim, ReceiptIdentity, ReceiptNumberingStatus } from "./domain/receipt-number.ts";
export { canonicalOfflineSaleFactsJson } from "./domain/canonical-payload.ts";
export {
  digestAcceptedSalePayload,
  digestConnectedSalePayload,
  digestOfflineSale,
} from "./domain/offline-digest.ts";
export { createOfflinePosServices, priceOfflineCart } from "./application/offline-pos.ts";
export type { OfflinePosServices } from "./application/offline-pos.ts";
export {
  PosStorageError,
  type CompleteOfflineSaleInput,
  type OfflineAcknowledgement,
  type OfflineCompletedSale,
  type OfflinePendingSale,
  type OfflineReceiptNumberingStatus,
  type OfflinePosStore,
  type OfflineSaleKind,
  type OtherPendingQueue,
  type SessionTransition,
} from "./application/offline-ports.ts";
export { createDexiePosStore } from "./adapters/dexie-pos.ts";
