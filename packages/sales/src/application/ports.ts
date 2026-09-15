import type {
  BranchDto,
  AppliedAutomaticOfferDto,
  AppliedCouponDto,
  AutomaticOfferDto,
  CashierProductLookupDto,
  CompletedOperationProofDto,
  ManagerSaleDto,
  PosPriceSnapshotDto,
  CouponDto,
  CouponUsageProofDto,
  SaleAcknowledgementDto,
  SaleDto,
  VariantIdentityDto,
} from "@bravos/contracts";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AllocationRecord, DiscrepancyRecord, InventoryTransaction } from "@bravos/inventory";
import type { CouponUsageTransaction } from "@bravos/pricing";
import type { VariantLineAllocation } from "../domain/discount.ts";

export type { VerifiedAuth };

export type SalesActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
  getSessionBranch(sessionId: string): Promise<string | null>;
  listBranches(): Promise<BranchDto[]>;
};

export type ListedPriceBasis = {
  variantId: string;
  productId: string;
  categoryId: string;
  listedUnitPricePiasters: number;
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
};

export type PriceSnapshotRecord = {
  id: string;
  pricingVersion: 1 | null;
  staffId: string;
  branchId: string;
  deviceId: string;
  issuedAt: Date;
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
  allocatedQuantity: number;
  unallocatedQuantity: number;
  lineIndex: number;
  units: SaleUnitWrite[];
};

export type SaleRecord = {
  id: string;
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
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  recoveredByStaffId: string | null;
  recoveredAt: Date | null;
  sourceDeviceId: string | null;
  sourceSnapshotId: string | null;
  lines: SaleLineWrite[];
};

export type SaleInsert = {
  id: string;
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
  payloadFingerprint: string;
  physicallyCompleted: boolean;
  costsIncomplete: boolean;
  recoveredByStaffId?: string | null;
  recoveredAt?: Date | null;
  sourceDeviceId?: string | null;
  sourceSnapshotId?: string | null;
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
    occurredAt: Date;
    recordedAt: Date;
    costsIncomplete: boolean;
    lines: SaleLineWrite[];
    recoveredByStaffId?: string | null;
    recoveredAt?: Date | null;
    couponUsageDiscrepancy?: SaleRecord["couponUsageDiscrepancy"];
  }): Promise<SaleRecord>;
  getById(id: string): Promise<SaleRecord | null>;
  getByOperationId(operationId: string): Promise<SaleRecord | null>;
  listCompletedOperationProofs(operationIds: string[]): Promise<CompletedOperationProofDto[]>;
  listCompletedOperationIds(operationIds: string[]): Promise<string[]>;
  listCompleted(): Promise<SaleRecord[]>;
  listCompletedForStaff(staffId: string, branchIds: string[]): Promise<SaleRecord[]>;
  referencedVariantIds(variantIds: string[]): Promise<string[]>;
};

export type SalesUnitOfWork = {
  run<T>(
    work: (tx: {
      sales: SaleStore;
      inventory: InventoryTransaction;
      snapshots: PriceSnapshotStore;
      couponUsage: CouponUsageTransaction;
    }) => Promise<T>,
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
