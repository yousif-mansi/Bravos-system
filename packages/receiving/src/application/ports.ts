import type { ReceiptDto, VariantIdentityDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { BatchRecord, InventoryTransaction } from "@bravos/inventory";

export type { VerifiedAuth };

export type ReceivingActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type VariantIdentityReader = {
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
};

export type ReceiptLineWrite = {
  id: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  batchId: string;
};

export type ReceiptRecord = {
  id: string;
  operationId: string;
  receiptDate: string;
  receivedByStaffId: string;
  recordedAt: Date;
  lines: ReceiptLineWrite[];
};

export type ReceiptCorrectionLineRecord = {
  lineId: string;
  previousQuantity: number;
  previousUnitCostPiasters: number;
  effectiveQuantity: number;
  effectiveUnitCostPiasters: number;
  remainingQuantity: number;
  allocatedQuantity: number;
  quantityDelta: number;
  unitCostDeltaPiasters: number;
};

export type ReceiptCorrectionRecord = {
  id: string;
  operationId: string;
  receiptId: string;
  revision: number;
  reason: string;
  changedByStaffId: string;
  changedAt: Date;
  lines: ReceiptCorrectionLineRecord[];
};

export type ReceiptCorrectionStore = {
  insert(input: ReceiptCorrectionRecord): Promise<ReceiptCorrectionRecord>;
  getByOperationId(operationId: string): Promise<ReceiptCorrectionRecord | null>;
  listForReceipt(receiptId: string): Promise<ReceiptCorrectionRecord[]>;
};

export type ReceivingBatchReader = {
  getBatchStates(batchIds: string[]): Promise<BatchRecord[]>;
};

export type ReceiptStore = {
  insert(input: {
    id: string;
    operationId: string;
    receiptDate: string;
    receivedByStaffId: string;
    recordedAt: Date;
    lines: ReceiptLineWrite[];
  }): Promise<ReceiptRecord>;
  getByOperationId(operationId: string): Promise<ReceiptRecord | null>;
  getById(id: string, lock?: boolean): Promise<ReceiptRecord | null>;
  list(): Promise<ReceiptRecord[]>;
};

export type ReceivingUnitOfWork = {
  run<T>(work: (tx: {
    receipts: ReceiptStore;
    corrections: ReceiptCorrectionStore;
    inventory: InventoryTransaction;
  }) => Promise<T>): Promise<T>;
};

export type FinalizeReceiptResult = {
  receipt: ReceiptDto;
  created: boolean;
};

export type CorrectReceiptResult = {
  receipt: ReceiptDto;
  created: boolean;
};
