export type {
  ManagerSaleAllocationDto,
  ManagerSaleDto,
  PosPriceSnapshotDto,
  SaleDiscrepancyDto,
  SaleDto,
  SaleLineDto,
  SaleUnitDto,
} from "@bravos/contracts";
export { SalesValidationError } from "./domain/errors.ts";
export { allocateEmployeeDiscount, assertMergedSaleQuantities, priceSaleLines } from "./domain/discount.ts";
export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "./domain/pos-update.ts";
export type { PosUpdateDecision } from "./domain/pos-update.ts";
export { fingerprintSalePayload, normalizeSalePayload } from "./domain/fingerprint.ts";
export { createSalesServices, type SalesServices } from "./application/sales.ts";
export type {
  CompleteSaleResult,
  ListedPriceReader,
  PrepareSaleResult,
  SaleStore,
  SalesActorPort,
  SalesUnitOfWork,
  VerifiedAuth,
} from "./application/ports.ts";
