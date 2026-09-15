import type { AppliedAutomaticOfferDto, BranchDto, ReturnDto, ReturnExchangeQuoteDto, ReturnListPageDto, ReturnSourceDto, VariantIdentityDto } from "@bravos/contracts";
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
  effectiveUnitCostPiasters: number;
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
  exchangeCreditAppliedPiasters: number;
  refundRecordedByStaffId: string | null;
  refundRecordedAt: Date | null;
  lines: ReturnLineWrite[];
  restorations: ReturnRestorationWrite[];
  refundEvents: RefundEventRecord[];
};

export type ReturnExchangeRecord = {
  id: string;
  operationId: string;
  returnId: string;
  replacementSaleId: string;
  payloadFingerprint: string;
  creditAvailablePiasters: number;
  creditAppliedPiasters: number;
  cashCollectedPiasters: number;
  cashRefundStatus: "none" | "owed" | "paid";
  cashRefundPiasters: number;
  cashRefundPaidPiasters: number;
  completedByStaffId: string;
  completedAt: Date;
};

export type ReturnReplacementAcceptedQuote = {
  originalTotalPiasters: number;
  finalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  lines: Array<{
    variantId: string;
    quantity: number;
    listedUnitPricePiasters: number;
    originalPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters: number;
    employeeDiscountPiasters: number;
    units: Array<{
      unitIndex: number;
      quantity: number;
      listedPiasters: number;
      discountPiasters: number;
      paidPiasters: number;
      automaticOfferDiscountPiasters: number;
      couponDiscountPiasters: number;
      employeeDiscountPiasters: number;
    }>;
  }>;
};

export type ReturnExchangeQuoteRecord = {
  id: string;
  returnId: string;
  returnRevision: number;
  correctionRevision: number;
  creditAvailablePiasters: number;
  settlement: {
    exchangeId: string;
    operationId: string;
    replacementSaleId: string;
    replacementSaleOperationId: string;
  };
  payloadFingerprint: string;
  acceptedQuote: ReturnReplacementAcceptedQuote;
  quotedByStaffId: string;
  quotedAt: Date;
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
  insertDraft(input: Omit<ReturnRecord, "createdAt" | "updatedAt" | "postedByStaffId" | "postedAt" | "refundStatus" | "refundPaidPiasters" | "exchangeCreditAppliedPiasters" | "refundRecordedByStaffId" | "refundRecordedAt" | "restorations" | "refundEvents">): Promise<{ kind: "created" | "existing"; record: ReturnRecord }>;
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
  getExchangeByReturnId(returnId: string, lock?: boolean): Promise<ReturnExchangeRecord | null>;
  getExchangeById(id: string): Promise<ReturnExchangeRecord | null>;
  getExchangeByOperationId(operationId: string): Promise<ReturnExchangeRecord | null>;
  getExchangeQuoteById(id: string): Promise<ReturnExchangeQuoteRecord | null>;
  insertExchangeQuote(input: ReturnExchangeQuoteRecord): Promise<{ kind: "created" | "existing"; record: ReturnExchangeQuoteRecord }>;
  insertExchange(input: ReturnExchangeRecord): Promise<ReturnExchangeRecord>;
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

export type ReturnReplacementSaleRecord = {
  id: string;
  operationId: string;
  finalTotalPiasters: number;
};

export type ReturnReplacementSaleWriter = {
  create(input: {
    saleId: string;
    operationId: string;
    payloadFingerprint: string;
    branchId: string;
    actorStaffId: string;
    actorDisplayName: string;
    occurredAt: Date;
    creditAvailablePiasters: number;
    acceptedQuote: ReturnReplacementAcceptedQuote;
  }): Promise<{
    sale: ReturnReplacementSaleRecord;
    allocations: AllocationRecord[];
    creditAppliedPiasters: number;
    cashCollectedPiasters: number;
  }>;
  getById(id: string): Promise<ReturnReplacementSaleRecord | null>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
};

export type ReturnReplacementSaleReader = Pick<ReturnReplacementSaleWriter, "getById" | "listAllocations">;

export type ReturnReplacementPricing = {
  quote(lines: Array<{ variantId: string; quantity: number }>, at: Date): Promise<ReturnReplacementAcceptedQuote>;
};

export type ReturnsUnitOfWork = {
  run<T>(work: (tx: {
    returns: ReturnsStore;
    inventory: InventoryTransaction;
    corrections: ReturnCorrectionStateReader;
    replacementSales: ReturnReplacementSaleWriter;
  }) => Promise<T>): Promise<T>;
};

export type ReturnServices = {
  listSources(auth: VerifiedAuth | null, input: unknown): Promise<ReturnSourceDto[]>;
  createDraft(auth: VerifiedAuth | null, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  updateDraft(auth: VerifiedAuth | null, id: string, input: unknown): Promise<ReturnDto>;
  post(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  markPaid(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  quoteExchange(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnExchangeQuoteDto; created: boolean }>;
  exchange(auth: VerifiedAuth | null, id: string, input: unknown): Promise<{ value: ReturnDto; created: boolean }>;
  list(auth: VerifiedAuth | null, input: unknown): Promise<ReturnListPageDto>;
  get(auth: VerifiedAuth | null, id: string): Promise<ReturnDto>;
};
