export type {
  ManagerSaleAllocationDto,
  ManagerSaleDto,
  SaleDiscrepancyDto,
  SaleDto,
  SaleLineDto,
  SaleUnitDto,
} from "@bravos/contracts";
export { SalesValidationError } from "./domain/errors.ts";
export { allocateEmployeeDiscount, priceSaleLines } from "./domain/discount.ts";
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
