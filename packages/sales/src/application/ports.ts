import type {
  BranchDto,
  CashierProductLookupDto,
  ManagerSaleDto,
  PosPriceSnapshotDto,
  SaleDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AllocationRecord, DiscrepancyRecord, InventoryTransaction } from "@bravos/inventory";
import type { VariantLineAllocation } from "../domain/discount.ts";

export type { VerifiedAuth };

export type SalesActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
  listBranches(): Promise<BranchDto[]>;
};

export type ListedPriceBasis = {
  variantId: string;
  listedUnitPricePiasters: number;
  identity: VariantIdentityDto;
};

export type ListedPriceReader = {
  getListedPrices(ids: string[]): Promise<ListedPriceBasis[]>;
};

export type CashierCatalogReader = {
  listCashierProducts(auth: VerifiedAuth): Promise<CashierProductLookupDto[]>;
};

export type PriceSnapshotPrice = {
  variantId: string;
  listedUnitPricePiasters: number;
};

export type PriceSnapshotRecord = {
  id: string;
  staffId: string;
  branchId: string;
  deviceId: string;
  issuedAt: Date;
  prices: PriceSnapshotPrice[];
};

export type PriceSnapshotStore = {
  insert(input: PriceSnapshotRecord): Promise<PriceSnapshotRecord>;
  getById(id: string): Promise<PriceSnapshotRecord | null>;
};

export type SaleUnitWrite = {
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
};

export type SaleLineWrite = {
  id: string;
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  lineIndex: number;
  units: SaleUnitWrite[];
};

export type SaleRecord = {
  id: string;
  operationId: string;
  branchId: string;
  soldByStaffId: string;
  soldByDisplayName: string;
  discountedByStaffId: string | null;
  occurredAt: Date;
  recordedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  finalTotalPiasters: number;
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  lines: SaleLineWrite[];
};

export type SaleInsert = {
  id: string;
  operationId: string;
  branchId: string;
  soldByStaffId: string;
  soldByDisplayName: string;
  discountedByStaffId: string | null;
  occurredAt: Date;
  recordedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  finalTotalPiasters: number;
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  lines: SaleLineWrite[];
};

export type SaleInsertResult =
  | { kind: "created"; record: SaleRecord }
  | { kind: "existing"; record: SaleRecord };

export type SaleStore = {
  lockIdentities(saleId: string, operationId: string): Promise<void>;
  insert(input: SaleInsert): Promise<SaleInsertResult>;
  updateCompletion(input: {
    id: string;
    occurredAt: Date;
    recordedAt: Date;
    costsIncomplete: boolean;
    lines: SaleLineWrite[];
  }): Promise<SaleRecord>;
  getById(id: string): Promise<SaleRecord | null>;
  getByOperationId(operationId: string): Promise<SaleRecord | null>;
  listCompleted(): Promise<SaleRecord[]>;
  listCompletedForStaff(staffId: string, branchIds: string[]): Promise<SaleRecord[]>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
};

export type SalesUnitOfWork = {
  run<T>(
    work: (tx: {
      sales: SaleStore;
      inventory: InventoryTransaction;
      snapshots: PriceSnapshotStore;
    }) => Promise<T>,
  ): Promise<T>;
};

export type IssuePriceSnapshotResult = PosPriceSnapshotDto;

export type PricedCommandLines = VariantLineAllocation[];

export type CompleteSaleResult = {
  sale: SaleDto | ManagerSaleDto;
  created: boolean;
};

export type PrepareSaleResult = {
  sale: SaleDto | ManagerSaleDto;
  created: boolean;
};

export type { AllocationRecord, DiscrepancyRecord };
