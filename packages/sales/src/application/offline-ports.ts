import type { BranchDto, CashierProductLookupDto, PosPriceSnapshotDto, SaleDto, WorkspaceDto } from "@bravos/contracts";

export type OfflineSaleKind = "accepted" | "connected";

export type OfflineSyncStatus = "pending" | "acknowledged";

export type OfflineSaleLine = {
  id: string;
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  units: Array<{
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
  }>;
  variant: SaleDto["lines"][number]["variant"];
};

export type OfflineCompletedSale = {
  id: string;
  staffId: string;
  operationId: string;
  deviceId: string;
  snapshotId: string | null;
  kind: OfflineSaleKind;
  syncStatus: OfflineSyncStatus;
  branch: BranchDto;
  soldByStaffId: string;
  soldByDisplayName: string;
  occurredAt: string;
  recordedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  discountedByStaffId: string | null;
  finalTotalPiasters: number;
  physicallyCompleted: true;
  lines: OfflineSaleLine[];
};

export type OfflineStockEffect = {
  id: string;
  staffId: string;
  operationId: string;
  variantId: string;
  quantity: number;
};

export type OfflinePendingSale = {
  staffId: string;
  saleId: string;
  operationId: string;
  phase: "prepared" | "uncertain" | "rejected";
  physicallyCompleted: boolean;
  digest: string | null;
  payload: {
    customerName: string | null;
    customerPhone: string | null;
    employeeDiscountPiasters: number;
    discountReason: string | null;
    lines: Array<{ variantId: string; quantity: number }>;
  } | null;
  occurredAt: string | null;
  quote: SaleDto | null;
  snapshot: PosPriceSnapshotDto | null;
  quoteOrigin: "server" | "snapshot" | null;
  cachedByVariant: Record<string, number> | null;
};

export type OfflineSession = {
  staffId: string;
  workspace: WorkspaceDto;
  signedOut: boolean;
  updatedAt: string;
};

export type CompleteOfflineSaleInput = {
  staffId: string;
  saleId: string;
  operationId: string;
  deviceId: string;
  snapshot: PosPriceSnapshotDto;
  kind: OfflineSaleKind;
  branch: BranchDto;
  soldByDisplayName: string;
  occurredAt: string;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{
    key?: string;
    variantId: string;
    quantity: number;
    product: CashierProductLookupDto;
    variant: CashierProductLookupDto["variants"][number];
  }>;
};

export class PosStorageError extends Error {
  readonly code = "STORAGE" as const;
  constructor(message = "تعذر حفظ البيع محلياً.") {
    super(message);
    this.name = "PosStorageError";
  }
}

export type SessionTransition = {
  revision: string;
  expectedRevision: string | null;
};

export type OfflinePosStore = {
  deviceId(): Promise<string>;
  rememberSession(workspace: WorkspaceDto, transition?: SessionTransition): Promise<boolean>;
  markSignedOut(staffId: string, transition?: SessionTransition): Promise<boolean>;
  readSessionRevision(): Promise<string | null>;
  canUpgradeSafely(incomingSchemaVersion: number): Promise<boolean>;
  loadSignedInWorkspace(): Promise<WorkspaceDto | null>;
  saveSnapshot(staffId: string, snapshot: PosPriceSnapshotDto): Promise<void>;
  loadSnapshot(staffId: string): Promise<PosPriceSnapshotDto | null>;
  lookupProduct(staffId: string, code: string): Promise<CashierProductLookupDto | null>;
  availableQuantity(variantId: string, cachedAvailable: number): Promise<number>;
  completeSale(
    input: CompleteOfflineSaleInput,
    priced: {
      lines: OfflineCompletedSale["lines"];
      originalTotalPiasters: number;
      finalTotalPiasters: number;
    },
  ): Promise<OfflineCompletedSale>;
  recordCompleted(
    sale: OfflineCompletedSale,
    cachedByVariant: Map<string, number>,
  ): Promise<OfflineCompletedSale>;
  listUnsynced(staffId: string): Promise<OfflineCompletedSale[]>;
  listCompleted(staffId: string): Promise<OfflineCompletedSale[]>;
  markAcknowledged(staffId: string, saleId: string): Promise<void>;
  loadPending(staffId: string): Promise<OfflinePendingSale | null>;
  listRecoverablePending(staffId: string): Promise<OfflinePendingSale[]>;
  savePending(pending: OfflinePendingSale): Promise<"assigned" | "blocked">;
  clearPending(staffId: string, expectedSaleId: string): Promise<void>;
  migrateLegacyMarkers(): Promise<void>;
  requestPersistentStorage(): Promise<boolean | null>;
  readSchemaVersion(): Promise<number>;
};
