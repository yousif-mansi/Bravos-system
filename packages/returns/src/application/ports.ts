import type { AppliedAutomaticOfferDto, BranchDto, ReturnDto, ReturnExchangeQuoteDto, ReturnListPageDto, ReturnRefundBreakdownDto, ReturnSourceDto, ReturnSourceKeyDto, VariantIdentityDto } from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AllocationRecord, InventoryReadStore, InventoryTransaction } from "@bravos/inventory";
import type { DeliveredOnlineOrderSourceReader } from "@bravos/online-orders";

export type { VerifiedAuth };

export type ReturnsActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  listBranches(): Promise<BranchDto[]>;
};

export type ReturnSourceUnit = {
  id: string;
  sourceType: "original" | "correction" | "online";
  lineId: string;
  variantId: string;
  unitIndex: number;
  quantity: number;
  paidPiasters: number;
  alreadyReturnedQuantity: number;
  returnedRanges: Array<{ startOffset: number; quantity: number }>;
};

export type ReturnSourceLine = {
  id: string;
  variantId: string;
  lineIndex: number;
  quantity: number;
  paidPiasters: number;
  acceptedNames: {
    productNameAr: string;
    sizeNameAr: string;
    colorNameAr: string;
  } | null;
  units: ReturnSourceUnit[];
};

export type ReturnSourceAllocation = AllocationRecord & {
  allocationId: string | null;
  sourceLineId: string | null;
};

export type ReturnSourceRecord = {
  source: ReturnSourceKeyDto;
  reference: string;
  channel: "physical" | "online";
  branchId: string | null;
  seller: { staffId: string; displayName: string } | null;
  receivedAt: Date;
  returnDeadlineAt: Date;
  originalPayment: ReturnRefundBreakdownDto;
  availableCheckoutChargePiasters: number;
  customerName: string | null;
  customerPhone: string | null;
  lines: ReturnSourceLine[];
  allocations: ReturnSourceAllocation[];
};

export type ReturnUnitWrite = {
  id: string;
  returnLineId: string;
  sourceSaleUnitId: string | null;
  sourceRecordingSaleUnitId: string | null;
  sourceOnlineOrderLineId: string | null;
  sourceOnlineOrderUnitIndex: number | null;
  startOffset: number;
  quantity: number;
  paidUnitPiasters: number;
};

export type ReturnLineWrite = {
  id: string;
  sourceLineId: string;
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
  reference: string;
  operationId: string;
  source: ReturnSourceKeyDto;
  handlingBranchId: string;
  status: "draft" | "posted";
  revision: number;
  payloadFingerprint: string;
  draftPayloadFingerprint: string;
  suggestedRefundPiasters: number;
  authorizedRefundPiasters: number;
  suggestedRefund: ReturnRefundBreakdownDto;
  authorizedRefund: ReturnRefundBreakdownDto;
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
  reference: string;
  customerName: string | null;
  status: "draft" | "posted";
  revision: number;
  source: ReturnSourceKeyDto;
  sourceReference: string;
  channel: "physical" | "online";
  originalBranch: BranchDto | null;
  handlingBranch: BranchDto;
  authorizedRefund: ReturnRefundBreakdownDto;
  authorizedRefundPiasters: number;
  refundStatus: "none" | "owed" | "paid";
  createdAt: Date;
  postedAt: Date | null;
};

export type EffectiveReturnState = {
  revision: number;
  status: "active" | "cancelled";
  authorizedRefundPiasters: number | null;
  authorizedRefund: ReturnRefundBreakdownDto | null;
  paidPiasters: number;
  lines: Array<{ returnLineId: string; quantity: number; sellableQuantity: number }> | null;
};

export type ReturnCorrectionStateReader = {
  getEffectiveReturn(returnId: string): Promise<EffectiveReturnState | null>;
};

export type SourceSearch = {
  reference?: string;
  phone?: string;
  date?: string;
  branchId?: string;
  amountPiasters?: number;
  channel?: "physical" | "online";
};

export type ReturnSourceUsage = {
  returnedByLine: Map<string, number>;
  returnedRangesByOnlineUnit: Map<string, Array<{ startOffset: number; quantity: number }>>;
  checkoutChargeAlreadyAuthorized: boolean;
};

export type ReturnsStore = {
  listPhysicalSources(search: SourceSearch): Promise<ReturnSourceRecord[]>;
  getPhysicalSource(saleId: string, lock?: boolean): Promise<ReturnSourceRecord | null>;
  getSourceKey(returnId: string): Promise<ReturnSourceKeyDto | null>;
  getSourceUsage(source: ReturnSourceKeyDto, lineIds: string[]): Promise<ReturnSourceUsage>;
  lockIdentities(returnId: string, operationId: string): Promise<void>;
  insertDraft(input: Omit<ReturnRecord, "reference" | "createdAt" | "updatedAt" | "postedByStaffId" | "postedAt" | "refundStatus" | "refundPaidPiasters" | "exchangeCreditAppliedPiasters" | "refundRecordedByStaffId" | "refundRecordedAt" | "restorations" | "refundEvents">): Promise<{ kind: "created" | "existing"; record: ReturnRecord }>;
  updateDraft(input: {
    returnId: string;
    expectedRevision: number;
    handlingBranchId: string;
    draftPayloadFingerprint: string;
    suggestedRefundPiasters: number;
    authorizedRefundPiasters: number;
    suggestedRefund: ReturnRefundBreakdownDto;
    authorizedRefund: ReturnRefundBreakdownDto;
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

export type ReturnsTransaction = {
  returns: ReturnsStore;
  inventory: InventoryTransaction;
  onlineSources: DeliveredOnlineOrderSourceReader;
  corrections: ReturnCorrectionStateReader;
  replacementSales: ReturnReplacementSaleWriter;
};

export type ReturnsUnitOfWork = {
  run<T>(work: (tx: ReturnsTransaction) => Promise<T>): Promise<T>;
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

export type ReturnServiceDependencies = {
  actors: ReturnsActorPort;
  variants: ReturnVariantReader;
  returns: ReturnsStore;
  onlineSources: DeliveredOnlineOrderSourceReader;
  inventoryReads: Pick<InventoryReadStore, "listProtectedOrderAllocations">;
  corrections: ReturnCorrectionStateReader;
  replacementSales: ReturnReplacementSaleReader;
  replacementPricing: ReturnReplacementPricing;
  uow: ReturnsUnitOfWork;
  clock: { now(): Date };
};

export type ReturnReportingFact = {
  returnId: string;
  postedAt: Date;
  source: ReturnSourceKeyDto;
  channel: "physical" | "online";
  handlingBranchId: string;
  authorizedRefund: ReturnRefundBreakdownDto;
  refundPaidPiasters: number;
  refundCashEvents: Array<{ amountPiasters: number; recordedAt: Date }>;
  exchange: null | {
    replacementSaleId: string;
    creditAppliedPiasters: number;
    cashCollectedPiasters: number;
    cashRefundPaidPiasters: number;
    completedAt: Date;
  };
  lines: Array<{ returnLineId: string; sourceLineId: string; variantId: string; quantity: number; sellableQuantity: number }>;
  restorations: Array<{ batchId: string; variantId: string; quantity: number; unitCostPiasters: number }>;
};

export type ReturnReportingHeader = Pick<ReturnReportingFact,
  "returnId" | "postedAt" | "source" | "channel" | "handlingBranchId">;

export type ReturnReportingFactsReader = {
  listPostedHeadersPage(input: {
    from: Date; to: Date; limit: number; after?: { postedAt: Date; id: string } | null;
  }): Promise<ReturnReportingHeader[]>;
  listPostedFactsPage(input: {
    from: Date; to: Date; limit: number; after?: { postedAt: Date; id: string } | null;
  }): Promise<ReturnReportingFact[]>;
};
