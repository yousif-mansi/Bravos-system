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

/**
 * Public inventory transaction contract used by receiving now and by later
 * cash-sale / confirmation allocation. FIFO is recorded_at then batch id.
 * allocateFromOldestAvailable, releaseAllocation and restoreToOriginalBatches
 * are part of this contract and are implemented when those tickets arrive.
 */
export type InventoryTransaction = {
  claimReceiveOperation(input: {
    operationId: string;
    payload: ReceivePayload;
    actorStaffId: string;
  }): Promise<ClaimedOperation>;
  receiveBatches(input: {
    operationId: string;
    receiptId: string;
    receiptDate: string;
    recordedAt: Date;
    lines: ReceiveBatchLine[];
  }): Promise<ReceivedBatchRecord[]>;
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listAvailableBatchesFifo(variantId: string): Promise<ReceivedBatchRecord[]>;
};

export type InventoryReadStore = {
  quantitiesFor(variantIds: string[]): Promise<Map<string, number>>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  listBatches(): Promise<BatchRecord[]>;
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
