import type { ReceiptDto, VariantIdentityDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { InventoryTransaction } from "@bravos/inventory";

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
  getById(id: string): Promise<ReceiptRecord | null>;
  list(): Promise<ReceiptRecord[]>;
};

export type ReceivingUnitOfWork = {
  run<T>(work: (tx: { receipts: ReceiptStore; inventory: InventoryTransaction }) => Promise<T>): Promise<T>;
};

export type FinalizeReceiptResult = {
  receipt: ReceiptDto;
  created: boolean;
};
