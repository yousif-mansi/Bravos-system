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
  branchId: string;
  operationId: string;
  supplierId: string | null;
  supplierNameAr: string | null;
  receiptDate: string;
  receivedByStaffId: string;
  recordedAt: Date;
  lines: ReceiptLineWrite[];
};

export type ReceivingReferences = {
  operationalVariantId(productId: string): Promise<string | null>;
  supplierName(supplierId: string): Promise<string | null>;
};

export type OpeningReceivingTransaction = {
  insertOpeningReceipt(input: {
    branchId: string;
    receiptId: string;
    operationId: string;
    receiptDate: string;
    actorStaffId: string;
    recordedAt: Date;
    lines: Array<ReceiptLineWrite & { lineIndex: number }>;
  }): Promise<void>;
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

export type PurchaseReportingFact = {
  receipt: ReceiptRecord;
  corrections: Array<Pick<ReceiptCorrectionRecord, "id" | "revision" | "reason" | "changedByStaffId" | "changedAt">>;
};

export type PurchaseReportingReader = {
  countReceiptFacts(input: { fromDate: string; toDateInclusive: string }): Promise<number>;
  listReceiptFactsPage(input: {
    fromDate: string; toDateInclusive: string; limit: number;
    after?: { receiptDate: string; id: string } | null;
  }): Promise<PurchaseReportingFact[]>;
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
    branchId: string;
    operationId: string;
    supplierId: string | null;
    receiptDate: string;
    receivedByStaffId: string;
    recordedAt: Date;
    lines: ReceiptLineWrite[];
  }): Promise<ReceiptRecord>;
  getByOperationId(operationId: string): Promise<ReceiptRecord | null>;
  getById(id: string, lock?: boolean): Promise<ReceiptRecord | null>;
  list(): Promise<ReceiptRecord[]>;
  listSuppliers(): Promise<Array<{ id: string; nameAr: string }>>;
  insertSupplier(input: {
    id: string;
    nameAr: string;
    nameKey: string;
    actorStaffId: string;
  }): Promise<{ id: string; nameAr: string } | "duplicate">;
};

export type ReceivingUnitOfWork = {
  run<T>(work: (tx: {
    receipts: ReceiptStore;
    corrections: ReceiptCorrectionStore;
    inventory: InventoryTransaction;
    references: ReceivingReferences;
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
