import type {
  BranchDto,
  AppliedAutomaticOfferDto,
  AppliedCouponDto,
  AutomaticOfferDto,
  CashierProductLookupDto,
  CompletedOperationProofDto,
  ManagerSaleDto,
  RestoreDeferredSaleDto,
  RestorePauseDto,
  PosPriceSnapshotDto,
  CouponDto,
  CouponUsageProofDto,
  SaleAcknowledgementDto,
  SaleDto,
  SalePaymentDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AllocationRecord, DiscrepancyRecord, InventoryTransaction } from "@bravos/inventory";
import type { CouponUsageTransaction } from "@bravos/pricing";
import type { VariantLineAllocation } from "../domain/discount.ts";
import type { ParsedReceiptClaim, ReceiptIdentity } from "../domain/receipt-number.ts";

export type { VerifiedAuth };

export type SalesActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
  listBranches(): Promise<BranchDto[]>;
};

export type DeferredCompletedSalePort = {
  retainIfRequired(input: {
    operationId: string;
    saleId: string;
    payloadFingerprint: string;
    // null means the caller did not report a generation; the current generation is used.
    sourceGeneration: number | null;
    sourceDeviceId: string | null;
    originalStaffId: string;
    branchId: string;
    occurredAt: Date;
    payload: Record<string, unknown>;
  }): Promise<boolean>;
  list(): Promise<RestoreDeferredSaleDto[]>;
};

export type ListedPriceBasis = {
  variantId: string;
  productId: string;
  categoryId: string;
  listedUnitPricePiasters: number;
  minimumUnitPricePiasters: number | null;
  identity: VariantIdentityDto;
};

export type AutomaticPricingPort = {
  snapshotRules(operationIds?: string[]): Promise<{
    automaticOffers: AutomaticOfferDto[];
    coupons: CouponDto[];
    couponAccountedOperations: CouponUsageProofDto[];
  }>;
  evaluate(
    lines: Array<{
      variantId: string;
      productId: string;
      categoryId: string;
      quantity: number;
      listedUnitPricePiasters: number;
    }>,
    at?: Date,
    couponCode?: string | null,
  ): Promise<{
    appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
    automaticOfferDiscountPiasters: number;
    unitRanges: Array<{
      variantId: string;
      unitIndex: number;
      quantity: number;
      listedPiasters: number;
      automaticOfferDiscountPiasters: number;
    }>;
    appliedCoupon: AppliedCouponDto | null;
    couponDiscountPiasters: number;
    couponUnitRanges: Array<{
      variantId: string;
      unitIndex: number;
      quantity: number;
      listedPiasters: number;
      automaticOfferDiscountPiasters: number;
      couponDiscountPiasters: number;
    }>;
  }>;
};

export type ListedPriceReader = {
  getListedPrices(ids: string[]): Promise<ListedPriceBasis[]>;
};

export type PricingQuoteReader = {
  run<T>(work: (quote: {
    prices: ListedPriceReader;
    automaticPricing: AutomaticPricingPort;
  }) => Promise<T>): Promise<T>;
};

export type CashierCatalogReader = {
  listCashierProducts(auth: VerifiedAuth): Promise<CashierProductLookupDto[]>;
};

export type PriceSnapshotPrice = {
  variantId: string;
  productId: string;
  categoryId: string;
  listedUnitPricePiasters: number;
  // Absent or null on a snapshot issued before the floor existed. Zero is a real floor.
  minimumUnitPricePiasters?: number | null;
};

export type PriceSnapshotRecord = {
  id: string;
  pricingVersion: 1 | null;
  staffId: string;
  branchId: string;
  deviceId: string;
  issuedAt: Date;
  restoreGeneration: number;
  prices: PriceSnapshotPrice[];
  automaticOffers: AutomaticOfferDto[];
  coupons: CouponDto[];
  couponAccountedOperations: CouponUsageProofDto[];
};

export type PriceSnapshotStore = {
  insert(input: PriceSnapshotRecord): Promise<PriceSnapshotRecord>;
  getById(id: string): Promise<PriceSnapshotRecord | null>;
};

export type SaleUnitWrite = {
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  employeeDiscountPiasters: number;
};

export type SaleLineWrite = {
  id: string;
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  employeeDiscountPiasters: number;
  acceptedMinimumUnitPiasters?: number | null;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  lineIndex: number;
  units: SaleUnitWrite[];
};

export type SaleRecord = {
  id: string;
  reference: string | null;
  operationId: string;
  branchId: string;
  soldByStaffId: string;
  soldByDisplayName: string;
  discountedByStaffId: string | null;
  occurredAt: Date;
  recordedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  appliedCoupon: AppliedCouponDto | null;
  couponUsageDiscrepancy: {
    detectedAt: Date;
    usageLimit: number;
    countBefore: number;
    actualCount: number;
  } | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  finalTotalPiasters: number;
  exchangeCreditAppliedPiasters: number;
  cashReceivedPiasters: number;
  payment: SalePaymentDto;
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  recoveredByStaffId: string | null;
  recoveredAt: Date | null;
  sourceDeviceId: string | null;
  sourceSnapshotId: string | null;
  /** Loaded receipt metadata. Absent until a completion attaches a claim. */
  receiptIdentity?: ReceiptIdentity | null;
  lines: SaleLineWrite[];
};

export type PhysicalSaleReportingReader = {
  countCompletedFacts(input: {
    from: Date;
    to: Date;
    branchId?: string | null;
    employeeId?: string | null;
  }): Promise<number>;
  listCompletedFactsPage(input: {
    from: Date;
    to: Date;
    branchId?: string | null;
    employeeId?: string | null;
    limit: number;
    after?: { occurredAt: Date; id: string } | null;
  }): Promise<SaleRecord[]>;
  getCompletedAttributionsByIds(ids: string[]): Promise<Array<Pick<SaleRecord,
    "id" | "branchId" | "soldByStaffId" | "soldByDisplayName" | "finalTotalPiasters">>>;
};

export type SaleInsert = {
  id: string;
  reference?: string | null;
  operationId: string;
  branchId: string;
  soldByStaffId: string;
  soldByDisplayName: string;
  discountedByStaffId: string | null;
  occurredAt: Date;
  recordedAt: Date | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  appliedCoupon: AppliedCouponDto | null;
  couponUsageDiscrepancy: SaleRecord["couponUsageDiscrepancy"];
  employeeDiscountPiasters: number;
  discountReason: string | null;
  finalTotalPiasters: number;
  exchangeCreditAppliedPiasters?: number;
  cashReceivedPiasters?: number;
  payment?: SalePaymentDto;
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  recoveredByStaffId?: string | null;
  recoveredAt?: Date | null;
  sourceDeviceId?: string | null;
  sourceSnapshotId?: string | null;
  sourceRestoreGeneration: number;
  lines: SaleLineWrite[];
};

export type SaleInsertResult =
  | { kind: "created"; record: SaleRecord }
  | { kind: "existing"; record: SaleRecord };

export type SaleStore = {
  lockIdentities(saleId: string, operationId: string): Promise<void>;
  insert(input: SaleInsert): Promise<SaleInsertResult>;
  updateCompletion(input: {
    id: string;
    payment?: SalePaymentDto;
    payloadFingerprint?: string;
    occurredAt: Date;
    recordedAt: Date;
    costsIncomplete: boolean;
    lines: SaleLineWrite[];
    recoveredByStaffId?: string | null;
    recoveredAt?: Date | null;
    couponUsageDiscrepancy?: SaleRecord["couponUsageDiscrepancy"];
    sourceRestoreGeneration?: number | null;
  }): Promise<SaleRecord>;
  getById(id: string): Promise<SaleRecord | null>;
  getByOperationId(operationId: string): Promise<SaleRecord | null>;
  listCompletedOperationProofs(operationIds: string[]): Promise<CompletedOperationProofDto[]>;
  listDeferredCompletionProofs(operationIds: string[]): Promise<CompletedOperationProofDto[]>;
  markRestoreDeferredReconciled(operationId: string, managerStaffId: string): Promise<void>;
  getRestoreDeferredPreparedSale(operationId: string): Promise<SaleInsert | null>;
  listCompletedOperationIds(operationIds: string[]): Promise<string[]>;
  listCompleted(): Promise<SaleRecord[]>;
  listCompletedForStaff(staffId: string, branchIds: string[]): Promise<SaleRecord[]>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
  registerReceiptPrefix(input: {
    id: string;
    deviceId: string;
    staffId: string;
    restoreGeneration: number;
  }): Promise<{ registrationId: string; deviceId: string; prefix: string }>;
  /**
   * Persist numbering metadata for a sale row that already exists in this transaction.
   * A conflict or a mismatched replay does not change the paid sale. An assigned reference stays reserved.
   */
  attachReceiptClaim(input: {
    saleId: string;
    claim: ParsedReceiptClaim;
    sourceDeviceId: string | null;
  }): Promise<SaleRecord>;
};

// Supplied by the restore feature at composition. Reading it holds the shared restore barrier
// lock for the current transaction, so the generation cannot change until the transaction ends.
export type RestoreRuntimePort = {
  current(): Promise<{ generation: number; pause: RestorePauseDto | null }>;
};

export type SalesTransaction = {
  sales: SaleStore;
  inventory: InventoryTransaction;
  snapshots: PriceSnapshotStore;
  couponUsage: CouponUsageTransaction;
  restore: RestoreRuntimePort;
};

export type SalesUnitOfWork = {
  run<T>(
    work: (tx: SalesTransaction) => Promise<T>,
  ): Promise<T>;
  runRestoreControl<T>(
    work: (tx: SalesTransaction) => Promise<T>,
  ): Promise<T>;
};

export type ExchangeReplacementSaleWrite = {
  saleId: string;
  operationId: string;
  payloadFingerprint: string;
  branchId: string;
  actorStaffId: string;
  actorDisplayName: string;
  occurredAt: Date;
  creditAvailablePiasters: number;
  acceptedQuote: ExchangeReplacementAcceptedQuote;
};

export type ExchangeReplacementAcceptedQuote = {
  originalTotalPiasters: number;
  finalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  lines: VariantLineAllocation[];
};

/** Produces a coherent connected-POS quote from one database snapshot. */
export type ExchangeReplacementPricing = {
  quote(
    lines: Array<{ variantId: string; quantity: number }>,
    at: Date,
  ): Promise<ExchangeReplacementAcceptedQuote>;
};

export type ExchangeReplacementSaleResult = {
  sale: SaleRecord;
  allocations: AllocationRecord[];
  creditAppliedPiasters: number;
  cashCollectedPiasters: number;
};

/** Narrow same-transaction writer used by Returns to create a linked replacement sale. */
export type ExchangeReplacementSaleWriter = {
  create(input: ExchangeReplacementSaleWrite): Promise<ExchangeReplacementSaleResult>;
  getById(id: string): Promise<SaleRecord | null>;
  listAllocations(operationId: string): Promise<AllocationRecord[]>;
};

export type IssuePriceSnapshotResult = PosPriceSnapshotDto;

export type PricedCommandLines = VariantLineAllocation[];

export type CompleteSaleResult = {
  sale: SaleDto | ManagerSaleDto;
  created: boolean;
  acknowledgement: SaleAcknowledgementDto;
};

export type PrepareSaleResult = {
  sale: SaleDto | ManagerSaleDto;
  created: boolean;
};

export type { AllocationRecord, DiscrepancyRecord };

/** Sale-owned purchase lookup candidates; does not expose costs. */
export type PhysicalSaleSourceSearch = {
  reference?: string; phone?: string; date?: string; branchId?: string; amountPiasters?: number;
  limit?: number; after?: { receivedAt: string; id: string; channel: "physical" | "online" };
};
export type PhysicalSaleSourceCandidate = {
  id: string;
  receivedAtKey: string;
  receiptReference?: string;
  receiptNumberingConflict?: true;
};

export type PhysicalSaleReceiptProjection = {
  id: string;
  receiptReference?: string;
  receiptNumberingConflict?: true;
};

export type PhysicalSaleSourceCandidateReader = {
  list(search: PhysicalSaleSourceSearch): Promise<PhysicalSaleSourceCandidate[]>;
  projections(ids: string[]): Promise<PhysicalSaleReceiptProjection[]>;
};

export type CustomerRecord = {
  id: string;
  normalizedPhone: string;
  displayName: string;
};

export type PhysicalPaidPurchase = {
  sourceId: string;
  reference: string;
  paidAt: Date;
  lines: Array<{ variantId: string; quantity: number }>;
};

export type CustomerListQuery = {
  query: string;
  digits: string;
  limit: number;
  after: { displayName: string; id: string } | null;
};

/** Sale-owned customer identity and completed physical purchases. Does not read online orders. */
export type CustomerDirectory = {
  findByPhone(normalizedPhone: string): Promise<CustomerRecord | null>;
  getById(id: string): Promise<CustomerRecord | null>;
  list(input: CustomerListQuery): Promise<CustomerRecord[]>;
  listPhysicalPurchases(customer: CustomerRecord, from: string, to: string): Promise<PhysicalPaidPurchase[]>;
};

/**
 * Delivered online purchases for one already-normalized phone.
 * Implemented by online orders and injected at composition so sales never reads those tables.
 */
export type PaidOnlinePurchaseReader = {
  listDeliveredPurchases(
    normalizedPhone: string,
    from: string,
    to: string,
  ): Promise<Array<{
    sourceId: string;
    reference: string;
    paidAt: Date;
    products: Array<{ nameAr: string; optionText: string | null; quantity: number }>;
  }>>;
};
