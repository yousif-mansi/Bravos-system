import type { BranchDto, ReturnDto, ReturnListPageDto, ReturnSourceDto, VariantIdentityDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AllocationRecord, InventoryTransaction } from "@bravos/inventory";

export type { VerifiedAuth };

export type ReturnsActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  listBranches(): Promise<BranchDto[]>;
};

export type ReturnSourceUnit = {
  id: string;
  sourceType: "original" | "correction";
  lineId: string;
  variantId: string;
  unitIndex: number;
  quantity: number;
  paidPiasters: number;
  alreadyReturnedQuantity: number;
};

export type ReturnSourceLine = {
  id: string;
  variantId: string;
  lineIndex: number;
  quantity: number;
  paidPiasters: number;
  units: ReturnSourceUnit[];
};

export type ReturnSourceRecord = {
  saleId: string;
  operationId: string;
  branchId: string;
  soldByStaffId: string;
  soldByDisplayName: string;
  occurredAt: Date;
  returnDeadlineAt: Date;
  finalTotalPiasters: number;
  customerName: string | null;
  customerPhone: string | null;
  lines: ReturnSourceLine[];
  allocations: AllocationRecord[];
};

export type ReturnUnitWrite = {
  id: string;
  returnLineId: string;
  sourceSaleUnitId: string | null;
  sourceRecordingSaleUnitId: string | null;
  startOffset: number;
  quantity: number;
  paidUnitPiasters: number;
};

export type ReturnLineWrite = {
  id: string;
  sourceSaleLineId: string;
  variantId: string;
  quantity: number;
  sellableQuantity: number;
  suggestedRefundPiasters: number;
  lineIndex: number;
};

export type ReturnRestorationWrite = {
  id: string;
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
};

export type RefundEventRecord = {
  operationId: string;
  status: "paid";
  amountPiasters: number;
  payloadFingerprint: string;
  actorStaffId: string;
  recordedAt: Date;
};

export type ReturnRecord = {
  id: string;
  operationId: string;
  sourceSaleId: string;
  handlingBranchId: string;
  status: "draft" | "posted";
  revision: number;
  payloadFingerprint: string;
  draftPayloadFingerprint: string;
  suggestedRefundPiasters: number;
  authorizedRefundPiasters: number;
  createdByStaffId: string;
  createdAt: Date;
  updatedByStaffId: string;
  updatedAt: Date;
  postedByStaffId: string | null;
  postedAt: Date | null;
  refundStatus: "none" | "owed" | "paid";
  refundPaidPiasters: number;
  refundRecordedByStaffId: string | null;
  refundRecordedAt: Date | null;
  lines: ReturnLineWrite[];
  restorations: ReturnRestorationWrite[];
  refundEvents: RefundEventRecord[];
};

export type ReturnListRecord = {
  id: string;
  status: "draft" | "posted";
  revision: number;
  sourceSaleId: string;
  sourceReference: string;
  originalBranch: BranchDto;
  handlingBranch: BranchDto;
  authorizedRefundPiasters: number;
  refundStatus: "none" | "owed" | "paid";
  createdAt: Date;
  postedAt: Date | null;
};

export type EffectiveReturnState = {
  revision: number;
  status: "active" | "cancelled";
  authorizedRefundPiasters: number | null;
  paidPiasters: number;
  lines: Array<{ returnLineId: string; quantity: number; sellableQuantity: number }> | null;
};

export type ReturnCorrectionStateReader = {
  getEffectiveReturn(returnId: string): Promise<EffectiveReturnState | null>;
};

export type SourceSearch = {
  reference?: string;
  date?: string;
  branchId?: string;
  item?: string;
  amountPiasters?: number;
};

export type ReturnsStore = {
  listSources(search: SourceSearch): Promise<ReturnSourceRecord[]>;
  getSource(saleId: string, lock?: boolean): Promise<ReturnSourceRecord | null>;
  getSourceSaleId(returnId: string): Promise<string | null>;
  lockIdentities(returnId: string, operationId: string): Promise<void>;
  insertDraft(input: Omit<ReturnRecord, "createdAt" | "updatedAt" | "postedByStaffId" | "postedAt" | "refundStatus" | "refundPaidPiasters" | "refundRecordedByStaffId" | "refundRecordedAt" | "restorations" | "refundEvents">): Promise<{ kind: "created" | "existing"; record: ReturnRecord }>;
  updateDraft(input: {
    returnId: string;
    expectedRevision: number;
    handlingBranchId: string;
    draftPayloadFingerprint: string;
    suggestedRefundPiasters: number;
    authorizedRefundPiasters: number;
    updatedByStaffId: string;
    updatedAt: Date;
    lines: ReturnLineWrite[];
  }): Promise<ReturnRecord>;
  getById(id: string, lock?: boolean): Promise<ReturnRecord | null>;
  getByOperationId(operationId: string): Promise<ReturnRecord | null>;
  listPage(input: { limit: number; cursor: string | null }): Promise<{ items: ReturnListRecord[]; nextCursor: string | null }>;
  getRefundEventByOperation(operationId: string): Promise<(RefundEventRecord & { returnId: string }) | null>;
  post(input: {
    returnId: string;
    postedByStaffId: string;
    postedAt: Date;
    units: ReturnUnitWrite[];
    restorations: ReturnRestorationWrite[];
  }): Promise<ReturnRecord>;
  markPaid(input: {
    returnId: string;
    operationId: string;
    amountPiasters: number;
    payloadFingerprint: string;
    actorStaffId: string;
    recordedAt: Date;
  }): Promise<{ kind: "created" | "existing"; record: ReturnRecord; event: RefundEventRecord }>;
};

export type ReturnVariantReader = {
  getVariants(ids: string[]): Promise<VariantIdentityDto[]>;
};

export type ReturnsUnitOfWork = {
  run<T>(work: (tx: { returns: ReturnsStore; inventory: InventoryTransaction; corrections: ReturnCorrectionStateReader }) => Promise<T>): Promise<T>;
};

export type ReturnServices = {
  listSources(auth: VerifiedAuth | null, input: unknown): Promise<ReturnSourceDto[]>;
  createDraft(auth: VerifiedAuth | null, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  updateDraft(auth: VerifiedAuth | null, id: string, input: unknown): Promise<ReturnDto>;
  post(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  markPaid(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  list(auth: VerifiedAuth | null, input: unknown): Promise<ReturnListPageDto>;
  get(auth: VerifiedAuth | null, id: string): Promise<ReturnDto>;
};
