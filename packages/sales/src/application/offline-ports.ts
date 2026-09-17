import type {
  BranchDto,
  CashierProductLookupDto,
  CompletedOperationProofDto,
  PosPriceSnapshotDto,
  SaleAcknowledgementDto,
  SaleDto,
  WorkspaceDto,
} from "@bravos/contracts";

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
  automaticOfferDiscountPiasters?: number;
  couponDiscountPiasters?: number;
  employeeDiscountPiasters?: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  units: Array<{
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
    automaticOfferDiscountPiasters?: number;
    couponDiscountPiasters?: number;
    employeeDiscountPiasters?: number;
  }>;
  variant: SaleDto["lines"][number]["variant"];
};

export type OfflineCompletedSale = {
  id: string;
  staffId: string;
  operationId: string;
  deviceId: string;
  snapshotId: string | null;
  pricingVersion?: 1 | null;
  restoreGeneration?: number;
  kind: OfflineSaleKind;
  syncStatus: OfflineSyncStatus;
  branch: BranchDto;
  soldByStaffId: string;
  soldByDisplayName: string;
  occurredAt: string;
  pricingOccurredAt?: string | null;
  recordedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  couponCode: string | null;
  originalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  appliedAutomaticOffer: SaleDto["appliedAutomaticOffer"];
  couponDiscountPiasters: number;
  appliedCoupon: SaleDto["appliedCoupon"];
  employeeDiscountPiasters: number;
  discountReason: string | null;
  discountedByStaffId: string | null;
  finalTotalPiasters: number;
  physicallyCompleted: true;
  payloadFingerprint: string | null;
  couponUsageAccountedSnapshotIssuedAt?: string | null;
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
    couponCode?: string | null;
    employeeDiscountPiasters: number;
    discountReason: string | null;
    lines: Array<{ variantId: string; quantity: number }>;
  } | null;
  occurredAt: string | null;
  pricingOccurredAt?: string | null;
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
  pricingOccurredAt?: string | null;
  customerName: string | null;
  customerPhone: string | null;
  couponCode: string | null;
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

export type DeviceStockCache = {
  version: number;
  restoreGeneration: number;
  availability: Record<string, number>;
  includedOperationIds: string[];
};

export type OfflineAcknowledgement = SaleAcknowledgementDto & {
  sales?: Array<
    Pick<SaleDto, "id" | "operationId" | "recordedAt" | "soldByStaffId" | "finalTotalPiasters" | "lines" | "discrepancy">
  >;
};

export type { CompletedOperationProofDto };

export type OtherPendingQueue = {
  staffId: string;
  pendingCount: number;
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
  countUnaccountedCouponUses(couponId: string, snapshotIssuedAt: string): Promise<number>;
  completeSale(
    input: CompleteOfflineSaleInput,
    priced: {
      lines: OfflineCompletedSale["lines"];
      originalTotalPiasters: number;
      automaticOfferDiscountPiasters: number;
      appliedAutomaticOffer: SaleDto["appliedAutomaticOffer"];
      couponDiscountPiasters: number;
      appliedCoupon: SaleDto["appliedCoupon"];
      finalTotalPiasters: number;
      payloadFingerprint: string;
    },
  ): Promise<OfflineCompletedSale>;
  recordCompleted(
    sale: OfflineCompletedSale,
    cachedByVariant: Map<string, number>,
  ): Promise<OfflineCompletedSale>;
  listUnsynced(staffId: string): Promise<OfflineCompletedSale[]>;
  listCompleted(staffId: string): Promise<OfflineCompletedSale[]>;
  markAcknowledged(staffId: string, saleId: string): Promise<void>;
  applyAcknowledgement(input: OfflineAcknowledgement): Promise<void>;
  countOtherPending(staffId: string): Promise<number>;
  listPreservedPending(staffId: string): Promise<OfflineCompletedSale[]>;
  listPendingOperationIds(): Promise<string[]>;
  readStockVersion(): Promise<number>;
  readStockCache(): Promise<DeviceStockCache>;
  loadPending(staffId: string): Promise<OfflinePendingSale | null>;
  listRecoverablePending(staffId: string): Promise<OfflinePendingSale[]>;
  savePending(pending: OfflinePendingSale): Promise<"assigned" | "blocked">;
  clearPending(staffId: string, expectedSaleId: string): Promise<void>;
  migrateLegacyMarkers(): Promise<void>;
  requestPersistentStorage(): Promise<boolean | null>;
  readSchemaVersion(): Promise<number>;
};
