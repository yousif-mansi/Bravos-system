export type {
  CompletedOperationProofDto,
  ManagerSaleAllocationDto,
  ManagerSaleDto,
  PosPriceSnapshotDto,
  SaleAcknowledgementDto,
  SaleDiscrepancyDto,
  SaleDto,
  SaleLineDto,
  SaleUnitDto,
  StockAvailabilityDto,
} from "@bravos/contracts";
export { SalesValidationError } from "./domain/errors.ts";
export { allocateEmployeeDiscount, assertMergedSaleQuantities, priceSaleLines } from "./domain/discount.ts";
export { evaluatePosUpdate, isDeclaredSafeMigration, POS_SCHEMA_VERSION } from "./domain/pos-update.ts";
export type { PosUpdateDecision } from "./domain/pos-update.ts";
export {
  fingerprintAcceptedSalePayload,
  fingerprintSalePayload,
  normalizeAcceptedSalePayload,
  normalizeSalePayload,
} from "./domain/fingerprint.ts";
export { createSalesServices, type SalesServices } from "./application/sales.ts";
export { createExchangeReplacementPricing, createExchangeReplacementSaleWriter } from "./application/exchange-replacement.ts";
export type {
  AutomaticPricingPort,
  CompleteSaleResult,
  ExchangeReplacementAcceptedQuote,
  ExchangeReplacementPricing,
  ExchangeReplacementSaleWriter,
  ListedPriceReader,
  PrepareSaleResult,
  SaleStore,
  SaleRecord,
  PhysicalSaleReportingReader,
  SalesActorPort,
  SalesUnitOfWork,
  VerifiedAuth,
} from "./application/ports.ts";
