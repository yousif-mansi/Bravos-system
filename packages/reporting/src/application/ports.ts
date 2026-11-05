import type { BranchDto, ManagementReportDto, VariantIdentityDto } from "@bravos/contracts";
import type { ReturnCorrectionReportingReader, SaleCorrectionReportingReader } from "@bravos/corrections";
import type { ExpenseReportingReader } from "@bravos/expenses";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { InventoryReadStore } from "@bravos/inventory";
import type { OnlineOrderReportingReader } from "@bravos/online-orders";
import type { OpeningImportReportingReader } from "@bravos/opening-import";
import type { PurchaseReportingReader } from "@bravos/receiving";
import type { ReturnReportingFactsReader } from "@bravos/returns";
import type { PhysicalSaleReportingReader } from "@bravos/sales";

export type { VerifiedAuth };

export type ReportingActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  listBranches(): Promise<BranchDto[]>;
  listStaff(): Promise<AuthenticatedStaff[]>;
};

export type ReportingCatalogReader = {
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
  listVariantIds(): Promise<string[]>;
};

export type ReportingReadContext = {
  sales: PhysicalSaleReportingReader;
  saleCorrections: SaleCorrectionReportingReader;
  returnCorrections: ReturnCorrectionReportingReader;
  inventory: Pick<InventoryReadStore,
    "getBatchStates" | "listAllocationsForOperations" | "listDiscrepanciesForOperations" |
    "unresolvedDiscrepancyQuantity" | "getSettings" | "listVariantThresholds" | "quantitiesByBranchFor" |
    "productQuantitiesByRetailBranch" | "stockedProductIdsByRetailBranch" |
    "listProtectedOrderAllocationProvenance" | "listOrderRestoredCostByOperations" | "summarizeAuthoritativeAvailableInventory" |
    "summarizeProtectedOrderInventory">;
  orders: OnlineOrderReportingReader;
  returns: ReturnReportingFactsReader;
  purchases: PurchaseReportingReader;
  openingImports: OpeningImportReportingReader;
  expenses: ExpenseReportingReader;
  catalog: ReportingCatalogReader;
};

export type ReportingReadUnitOfWork = {
  run<T>(work: (context: ReportingReadContext) => Promise<T>): Promise<T>;
};

export type ReportingServices = {
  getManagementReport(auth: VerifiedAuth | null, query: unknown): Promise<ManagementReportDto>;
  getManagementReportExportSnapshot(auth: VerifiedAuth | null, query: unknown): Promise<ManagementReportDto>;
};

export type ReportingService = ReportingServices;
