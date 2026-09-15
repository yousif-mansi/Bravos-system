import type {
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  VariantIdentityDto,
  VariantLowStockDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { ReceivePayload } from "../domain/fingerprint.ts";

export type { VerifiedAuth, ReceivePayload };

export type InventoryActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type VariantIdentityReader = {
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
  listIds(): Promise<string[]>;
};

export type ClaimedOperation =
  | { kind: "created"; operationId: string; recordedAt: Date }
  | { kind: "replay"; operationId: string; recordedAt: Date };

export type ReceiveBatchLine = {
  lineId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
};

export type ReceivedBatchRecord = {
  id: string;
  variantId: string;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCostPiasters: number;
  recordedAt: Date;
  receiptId: string;
  receiptDate: string;
  sourceLineId: string;
};

export type BatchRecord = {
  id: string;
  variantId: string;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCostPiasters: number;
  recordedAt: Date;
  receiptId: string;
  receiptDate: string;
};

export type SettingsRecord = {
  lowStockThreshold: number;
};

export type AllocationRecord = {
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  recordedAt: Date;
};

export type DiscrepancyRecord = {
  variantId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
};

export type AllocateResult = {
  allocations: AllocationRecord[];
  allocatedQuantity: number;
  unallocatedQuantity: number;
};

/**
 * Public inventory transaction contract used by receiving and cash-sale
 * allocation. FIFO is recorded_at then batch id. releaseAllocation and
 * restoreToOriginalBatches remain for later tickets.
 */
export type InventoryTransaction = {
  claimReceiveOperation(input: {
    operationId: string;
    payload: ReceivePayload;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimSaleOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimReturnOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  claimCorrectionOperation(input: {
    operationId: string;
    payloadFingerprint: string;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  receiveBatches(input: {
    operationId: string;
    receiptId: string;
    receiptDate: string;
    recordedAt: Date;
    lines: ReceiveBatchLine[];
  }): Promise<ReceivedBatchRecord[]>;
  allocateFromOldestAvailable(input: {
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
    allowPartial: boolean;
  }): Promise<AllocateResult>;
  allocateCorrectionFromOldestAvailable(input: {
    operationId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<AllocateResult>;
  restoreToOriginalBatch(input: {
    operationId: string;
    batchId: string;
    variantId: string;
    quantity: number;
    recordedAt: Date;
  }): Promise<void>;
  adjustCorrectionBatch(input: {
    operationId: string;
    batchId: string;
    variantId: string;
    direction: "restore" | "deduct";
    quantity: number;
    recordedAt: Date;
  }): Promise<{ unitCostPiasters: number }>;
  recordDiscrepancy(input: {
    operationId: string;
    variantId: string;
    requestedQuantity: number;
    allocatedQuantity: number;
    recordedAt: Date;
  }): Promise<DiscrepancyRecord>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
  listDiscrepancies(operationId: string): Promise<DiscrepancyRecord[]>;
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listAvailableBatchesFifo(variantId: string): Promise<ReceivedBatchRecord[]>;
  lockStockClock(mode: "share" | "update"): Promise<void>;
  bumpStockVersion(): Promise<number>;
  currentStockVersion(): Promise<number>;
};

export type InventoryReadStore = {
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  currentStockVersion(): Promise<number>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listBatches(): Promise<BatchRecord[]>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
  listDiscrepancies(operationId: string): Promise<DiscrepancyRecord[]>;
  getSettings(): Promise<SettingsRecord>;
  updateSettings(lowStockThreshold: number, actorStaffId: string): Promise<SettingsRecord>;
  upsertVariantThreshold(
    variantId: string,
    lowStockThreshold: number,
    actorStaffId: string,
  ): Promise<VariantLowStockDto>;
  clearVariantThreshold(variantId: string, actorStaffId: string): Promise<VariantLowStockDto>;
  listVariantThresholds(): Promise<Map<string, number | null>>;
};

export type InventoryServices = {
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listBatches(auth: VerifiedAuth | null): Promise<InventoryBatchDto[]>;
  listLowStock(auth: VerifiedAuth | null): Promise<LowStockVariantDto[]>;
  getSettings(auth: VerifiedAuth | null): Promise<InventorySettingsDto>;
  updateSettings(auth: VerifiedAuth | null, input: unknown): Promise<InventorySettingsDto>;
  setVariantThreshold(
    auth: VerifiedAuth | null,
    variantId: string,
    input: unknown,
  ): Promise<VariantLowStockDto>;
};
