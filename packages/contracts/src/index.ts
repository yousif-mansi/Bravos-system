export type BranchCode = "abshway" | "fayoum";

export type StaffRole = "manager" | "employee";

export type BranchDto = {
  id: string;
  code: BranchCode;
  nameAr: string;
};

export type StaffGrantDto = {
  branchId: string;
  cashier: boolean;
  orderRepresentative: boolean;
};

export type StaffSummaryDto = {
  id: string;
  loginName: string;
  displayName: string;
  role: StaffRole;
  disabled: boolean;
};

export type WorkspaceDto = {
  staff: StaffSummaryDto;
  authorizedBranches: BranchDto[];
  activeBranch: BranchDto | null;
  capabilities: {
    cashier: boolean;
    orderRepresentative: boolean;
    manageStaff: boolean;
    manageCatalog: boolean;
    manageInventory: boolean;
    managePricing: boolean;
  };
};

export type PublicationStatus = "available" | "coming_soon" | "hidden";

export type CategoryDto = {
  id: string;
  nameAr: string;
  parentId: string | null;
};

export type AutomaticOfferDiscountType = "percentage" | "fixed" | "fixed_bundle" | "buy_x_get_y";

export type AutomaticOfferBundleItemDto = {
  variantId: string;
  requiredQuantity: number;
};

export type AutomaticOfferDto = {
  id: string;
  nameAr: string;
  discountType: AutomaticOfferDiscountType;
  percentageBasisPoints: number | null;
  fixedDiscountPiasters: number | null;
  bundlePricePiasters: number | null;
  bundleItems: AutomaticOfferBundleItemDto[];
  buyQuantity: number | null;
  rewardQuantity: number | null;
  rewardPercentageBasisPoints: number | null;
  buyProductIds: string[];
  buyCategoryIds: string[];
  rewardProductIds: string[];
  rewardCategoryIds: string[];
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowCoupon: boolean;
  productIds: string[];
  categoryIds: string[];
  createdByStaffId: string;
  updatedByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomaticOfferWriteDto = Pick<
  AutomaticOfferDto,
  | "nameAr"
  | "discountType"
  | "percentageBasisPoints"
  | "fixedDiscountPiasters"
  | "bundlePricePiasters"
  | "bundleItems"
  | "buyQuantity"
  | "rewardQuantity"
  | "rewardPercentageBasisPoints"
  | "buyProductIds"
  | "buyCategoryIds"
  | "rewardProductIds"
  | "rewardCategoryIds"
  | "startsOn"
  | "endsOn"
  | "active"
  | "allowCoupon"
  | "productIds"
  | "categoryIds"
>;

export type AppliedAutomaticOfferDto = Pick<
  AutomaticOfferDto,
  | "id"
  | "nameAr"
  | "discountType"
  | "percentageBasisPoints"
  | "fixedDiscountPiasters"
  | "bundlePricePiasters"
  | "bundleItems"
  | "buyQuantity"
  | "rewardQuantity"
  | "rewardPercentageBasisPoints"
  | "allowCoupon"
> & {
  discountPiasters: number;
};

export type CouponDiscountType = "percentage" | "fixed";

export type CouponDto = {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  percentageBasisPoints: number | null;
  fixedDiscountPiasters: number | null;
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowAutomaticOffer: boolean;
  usageLimit: number;
  usedCount: number;
  productIds: string[];
  categoryIds: string[];
  createdByStaffId: string;
  updatedByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

export type CouponWriteDto = Pick<
  CouponDto,
  | "code"
  | "discountType"
  | "percentageBasisPoints"
  | "fixedDiscountPiasters"
  | "startsOn"
  | "endsOn"
  | "active"
  | "allowAutomaticOffer"
  | "usageLimit"
  | "productIds"
  | "categoryIds"
>;

export type AppliedCouponDto = Pick<
  CouponDto,
  "id" | "code" | "discountType" | "percentageBasisPoints" | "fixedDiscountPiasters" | "allowAutomaticOffer"
> & {
  discountPiasters: number;
};

export type DeliveryAreaDto = {
  id: string;
  nameAr: string;
  feePiasters: number;
  active: boolean;
  changedByStaffId: string;
  changedAt: string;
};

export type OnlineOrderLineDto = {
  id: string;
  variantId: string;
  productId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  requestedQuantity: number;
  requestedListedUnitPricePiasters: number;
  requestedOriginalPiasters: number;
  requestedAutomaticOfferDiscountPiasters: number;
  requestedCouponDiscountPiasters: number;
  requestedMerchandiseTotalPiasters: number;
};

export type OnlineOrderDto = {
  id: string;
  operationId: string;
  reference: string;
  status: "pending";
  customerName: string;
  primaryPhone: string;
  alternatePhone: string | null;
  detailedAddress: string;
  landmark: string | null;
  notes: string | null;
  deliveryArea: { id: string; nameAr: string; feePiasters: number };
  requestedCouponCode: string | null;
  requestedMerchandiseOriginalPiasters: number;
  requestedAutomaticOfferDiscountPiasters: number;
  requestedCouponDiscountPiasters: number;
  requestedMerchandiseTotalPiasters: number;
  requestedDeliveryFeePiasters: number;
  requestedFinalTotalPiasters: number;
  requestedAppliedAutomaticOffer: { id: string; nameAr: string; discountPiasters: number } | null;
  requestedAppliedCoupon: { code: string; discountPiasters: number } | null;
  lines: OnlineOrderLineDto[];
  submittedAt: string;
};

export type SizeDto = {
  id: string;
  nameAr: string;
};

export type ColorDto = {
  id: string;
  nameAr: string;
};

export type ManagerVariantDto = {
  id: string;
  size: SizeDto;
  color: ColorDto;
  sellingPricePiastersOverride: number | null;
  sellingPricePiasters: number;
};

export type ManagerProductDto = {
  id: string;
  code: string;
  nameAr: string;
  descriptionAr: string;
  category: CategoryDto;
  defaultSellingPricePiasters: number;
  publication: PublicationStatus;
  imageRefs: string[];
  sizeGuideAr: string | null;
  variants: ManagerVariantDto[];
  changedByStaffId: string | null;
  changedAt: string;
};

export type UploadedProductMediaDto = {
  ref: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
};

export type {
  PublicCatalogBrowseDto,
  PublicProductAvailability,
  PublicProductDto,
  PublicProductPublication,
  PublicProductSummaryDto,
  PublicProductVariantDto,
  PublicStorefrontContactsDto,
} from "./public.ts";

export type StorefrontContactsDto = import("./public.ts").PublicStorefrontContactsDto & {
  changedByStaffId: string | null;
  changedAt: string | null;
};

export type CashierVariantDto = {
  id: string;
  size: SizeDto;
  color: ColorDto;
  sellingPricePiasters: number;
  availableQuantity: number;
};

export type CashierProductLookupDto = {
  id: string;
  categoryId?: string;
  code: string;
  nameAr: string;
  descriptionAr: string;
  variants: CashierVariantDto[];
};

export type VariantIdentityDto = {
  id: string;
  product: {
    id: string;
    code: string;
    nameAr: string;
  };
  size: SizeDto;
  color: ColorDto;
};

export type ReceiptLineDto = {
  id: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  effectiveQuantity: number;
  effectiveUnitCostPiasters: number;
  remainingQuantity: number;
  allocatedQuantity: number;
  batchId: string;
  variant: VariantIdentityDto;
};

export type ReceiptCorrectionLineDto = {
  lineId: string;
  originalQuantity: number;
  originalUnitCostPiasters: number;
  previousQuantity: number;
  previousUnitCostPiasters: number;
  effectiveQuantity: number;
  effectiveUnitCostPiasters: number;
  quantityDelta: number;
  unitCostDeltaPiasters: number;
};

export type ReceiptCorrectionDto = {
  id: string;
  operationId: string;
  revision: number;
  reason: string;
  changedByStaffId: string;
  changedByDisplayName: string;
  changedAt: string;
  lines: ReceiptCorrectionLineDto[];
};

export type ReceiptDto = {
  id: string;
  operationId: string;
  receiptDate: string;
  receivedByStaffId: string;
  recordedAt: string;
  correctionRevision: number;
  corrections: ReceiptCorrectionDto[];
  lines: ReceiptLineDto[];
};

export type InventoryBatchDto = {
  id: string;
  variantId: string;
  receivedQuantity: number;
  effectiveReceivedQuantity: number;
  remainingQuantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
  recordedAt: string;
  receiptId: string;
  receiptDate: string;
  variant: VariantIdentityDto;
};

export type LowStockVariantDto = {
  variantId: string;
  availableQuantity: number;
  threshold: number;
  thresholdSource: "global" | "variant";
  variant: VariantIdentityDto;
};

export type InventorySettingsDto = {
  lowStockThreshold: number;
};

export type VariantLowStockDto = {
  variantId: string;
  lowStockThreshold: number | null;
  updatedByStaffId: string | null;
  updatedAt: string;
};

export type CountCoordinationDeviceDto = {
  deviceId: string;
  knownSnapshotId: string;
  knownSnapshotAt: string;
  knownStockVersion: number | null;
  acknowledgedSnapshotId: string | null;
  acknowledgedAt: string | null;
  acknowledgedStockVersion: number | null;
};

export type CountCoordinationDto = {
  id: string;
  operationId: string;
  status: "active" | "completed" | "cancelled" | "expired";
  boundaryStockVersion: number;
  boundaryAt: string;
  expiresAt: string;
  startedBy: StaffSummaryDto;
  finishedBy: StaffSummaryDto | null;
  finishedAt: string | null;
  devices: CountCoordinationDeviceDto[];
};

export type StockPauseDto = {
  coordinationId: string;
  boundaryStockVersion: number;
  boundaryAt: string;
  expiresAt: string;
};

export type CountCoordinationAcknowledgementDto = {
  coordinationId: string;
  deviceId: string;
  snapshotId: string;
  acknowledgedAt: string;
  acknowledgedStockVersion: number;
};

export type StockCorrectionBatchEffectDto = {
  batchId: string;
  direction: "restore" | "deduct";
  quantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
};

export type StockCorrectionDto = {
  id: string;
  operationId: string;
  coordinationId: string;
  variantId: string;
  variant: VariantIdentityDto;
  previousAvailableQuantity: number;
  correctedAvailableQuantity: number;
  quantityDelta: number;
  reason: string;
  positiveSourceBatchId: string | null;
  changedBy: StaffSummaryDto;
  changedAt: string;
  boundaryStockVersion: number;
  coordinationBoundaryAt: string;
  boundaryAt: string;
  devices: CountCoordinationDeviceDto[];
  batches: StockCorrectionBatchEffectDto[];
};

export type StockReconciliationDto = {
  id: string;
  operationId: string;
  correctionId: string;
  saleId: string;
  variantId: string;
  resolution: "included_in_count" | "allocate_missing_source";
  quantity: number;
  previousAvailableQuantity: number;
  resultingAvailableQuantity: number;
  resolvedBy: StaffSummaryDto;
  resolvedAt: string;
  batches: Array<Omit<StockCorrectionBatchEffectDto, "direction"> & { direction: "restore" | "allocate" }>;
};

export type StockReconciliationCaseDto = {
  correctionId: string;
  saleId: string;
  saleOperationId: string;
  variantId: string;
  deviceId: string;
  sourceSnapshotId: string;
  sourceSnapshotIssuedAt: string;
  occurredAt: string;
  recordedAt: string;
  boundaryAt: string;
  timing: "before_count" | "after_count";
  soldQuantity: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  costsIncomplete: boolean;
  alreadyCountedQuantity: number;
  maximumCountedQuantity: number;
};

export type FifoBatchRef = {
  batchId: string;
  variantId: string;
  remainingQuantity: number;
  unitCostPiasters: number;
  recordedAt: string;
};

export type SaleUnitDto = {
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  automaticOfferDiscountPiasters?: number;
  couponDiscountPiasters?: number;
  employeeDiscountPiasters?: number;
};

export type SaleLineDto = {
  id: string;
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  automaticOfferDiscountPiasters?: number;
  couponDiscountPiasters?: number;
  employeeDiscountPiasters?: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  units: SaleUnitDto[];
  variant: VariantIdentityDto;
};

export type SaleDiscrepancyDto = {
  unallocatedQuantity: number;
  messageAr: string;
};

export type CouponUsageDiscrepancyDto = {
  couponId: string;
  couponCode: string;
  couponDiscountPiasters: number;
  usageLimit: number;
  centralUsedCount: number;
  detectedAt: string;
  messageAr: string;
};

export type PosPriceSnapshotDto = {
  snapshotId: string;
  pricingVersion?: 1;
  staffId: string;
  branch: BranchDto;
  deviceId: string;
  issuedAt: string;
  stockVersion: number;
  stockPause: StockPauseDto | null;
  includedOperationIds: string[];
  includedOperations: CompletedOperationProofDto[];
  couponAccountedOperations: CouponUsageProofDto[];
  products: CashierProductLookupDto[];
  automaticOffers: AutomaticOfferDto[];
  coupons: CouponDto[];
};

export type CouponUsageProofDto = {
  couponId: string;
  sourceType: "physical_sale";
  sourceId: string;
  operationId: string;
  payloadFingerprint: string;
};

export type StockAvailabilityDto = {
  variantId: string;
  availableQuantity: number;
};

export type CompletedOperationProofDto = {
  operationId: string;
  saleId: string;
  contentDigest: string;
};

export type SaleAcknowledgementDto = {
  acknowledgedOperationIds: string[];
  stockVersion: number;
  includedOperationIds: string[];
  includedOperations: CompletedOperationProofDto[];
  availability: StockAvailabilityDto[];
};

export type SaleDto = {
  id: string;
  operationId: string;
  branch: BranchDto;
  soldByStaffId: string;
  soldByDisplayName: string;
  occurredAt: string;
  recordedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  originalTotalPiasters: number;
  automaticOfferDiscountPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  couponDiscountPiasters: number;
  appliedCoupon: AppliedCouponDto | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  discountedByStaffId: string | null;
  finalTotalPiasters: number;
  exchangeCreditAppliedPiasters: number;
  cashReceivedPiasters: number;
  physicallyCompleted: boolean;
  discrepancy: SaleDiscrepancyDto | null;
  couponUsageDiscrepancy?: CouponUsageDiscrepancyDto | null;
  lines: SaleLineDto[];
};

export type ManagerSaleAllocationDto = {
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
};

export type ManagerSaleDto = SaleDto & {
  allocations: ManagerSaleAllocationDto[];
  costsIncomplete: boolean;
  recoveredByStaffId: string | null;
  recoveredAt: string | null;
};

export type ExpenseCategoryDto = {
  id: string;
  nameAr: string;
  active: boolean;
  changedByStaffId: string;
  changedAt: string;
};

export type ExpenseValueDto = {
  amountPiasters: number;
  expenseDate: string;
  category: { id: string; nameAr: string };
  description: string;
};

export type ExpenseChangeDto = {
  id: string;
  operationId: string;
  type: "correction" | "cancellation";
  revision: number;
  reason: string;
  changedByStaffId: string;
  changedByDisplayName: string;
  changedAt: string;
  previous: ExpenseValueDto;
  effective: ExpenseValueDto | null;
};

export type ExpenseDto = {
  id: string;
  operationId: string;
  branch: BranchDto;
  createdByStaffId: string;
  createdByDisplayName: string;
  recordedAt: string;
  revision: number;
  status: "active" | "cancelled";
  original: ExpenseValueDto;
  effective: ExpenseValueDto | null;
  changes: ExpenseChangeDto[];
};

export type ExpenseTotalsDto = {
  totalPiasters: number;
  activeExpenseCount: number;
  byBranch: Array<{
    branch: BranchDto;
    totalPiasters: number;
    activeExpenseCount: number;
  }>;
};

export type ReturnSourceLineDto = {
  saleLineId: string;
  variantId: string;
  variant: VariantIdentityDto;
  purchasedQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  paidPiasters: number;
  remainingSuggestedPiasters: number;
  availablePaidRanges: Array<{ quantity: number; paidUnitPiasters: number }>;
};

export type ReturnSourceDto = {
  saleId: string;
  reference: string;
  channel: "physical";
  originalBranch: BranchDto;
  soldByStaffId: string;
  soldByDisplayName: string;
  receivedAt: string;
  returnDeadlineAt: string;
  finalTotalPiasters: number;
  customerName: string | null;
  customerPhone: string | null;
  lines: ReturnSourceLineDto[];
};

export type ReturnLineDto = {
  id: string;
  sourceSaleLineId: string;
  variantId: string;
  variant: VariantIdentityDto;
  quantity: number;
  sellableQuantity: number;
  unsellableQuantity: number;
  suggestedRefundPiasters: number;
};

export type ReturnBatchRestorationDto = {
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
  effectiveUnitCostPiasters: number;
};

export type ReturnRefundEventDto = {
  operationId: string;
  status: "paid";
  amountPiasters: number;
  actorStaffId: string;
  recordedAt: string;
};

export type ReturnExchangeDto = {
  id: string;
  operationId: string;
  replacementSaleId: string;
  replacementMerchandisePiasters: number;
  creditAppliedPiasters: number;
  cashCollectedPiasters: number;
  cashRefund: {
    acceptedStatus: "none" | "owed" | "paid";
    acceptedAmountPiasters: number;
    status: "none" | "owed" | "paid" | "cancelled";
    owedPiasters: number;
    paidPiasters: number;
  };
  allocations: ManagerSaleAllocationDto[];
  completedByStaffId: string;
  completedAt: string;
};

export type ReturnExchangeQuoteDto = {
  id: string;
  returnId: string;
  returnRevision: number;
  correctionRevision: number;
  settlement: {
    exchangeId: string;
    operationId: string;
    replacementSaleId: string;
    replacementSaleOperationId: string;
  };
  replacementMerchandisePiasters: number;
  creditAvailablePiasters: number;
  creditAppliedPiasters: number;
  cashCollectedPiasters: number;
  cashRefundPiasters: number;
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  lines: Array<{
    variantId: string;
    quantity: number;
    listedUnitPricePiasters: number;
    paidPiasters: number;
  }>;
  quotedAt: string;
};

export type ReturnDto = {
  id: string;
  operationId: string;
  status: "draft" | "posted";
  revision: number;
  source: ReturnSourceDto;
  handlingBranch: BranchDto;
  suggestedRefundPiasters: number;
  authorizedRefundPiasters: number;
  originalAuthorizedRefundPiasters: number;
  effectiveStatus: "active" | "cancelled";
  correctionRevision: number;
  createdByStaffId: string;
  createdAt: string;
  updatedByStaffId: string;
  updatedAt: string;
  postedByStaffId: string | null;
  postedAt: string | null;
  lines: ReturnLineDto[];
  restorations: ReturnBatchRestorationDto[];
  exchange: ReturnExchangeDto | null;
  refund: {
    status: "none" | "owed" | "paid" | "overpaid" | "cancelled";
    owedPiasters: number;
    overpaidPiasters: number;
    paidPiasters: number;
    recordedByStaffId: string | null;
    recordedAt: string | null;
    events: ReturnRefundEventDto[];
  };
};

export type ReturnListItemDto = {
  id: string;
  status: "draft" | "posted";
  revision: number;
  sourceSaleId: string;
  sourceReference: string;
  originalBranch: BranchDto;
  handlingBranch: BranchDto;
  authorizedRefundPiasters: number;
  originalAuthorizedRefundPiasters: number;
  effectiveStatus: "active" | "cancelled";
  correctionRevision: number;
  refundStatus: "none" | "owed" | "paid" | "overpaid" | "cancelled";
  createdAt: string;
  postedAt: string | null;
};

export type ReturnListPageDto = {
  items: ReturnListItemDto[];
  nextCursor: string | null;
};

export type CorrectionCashFactDto = {
  direction: "paid_out" | "recovered";
  amountPiasters: number;
};

export type CorrectionMerchandiseFactDto = {
  lineId: string;
  variantId: string;
  direction: "restore" | "deduct";
  quantity: number;
  batches: Array<{
    batchId: string;
    quantity: number;
    unitCostPiasters: number;
    effectiveUnitCostPiasters: number;
  }>;
};

export type SaleCorrectionLineDto = {
  saleLineId: string;
  variantId: string;
  variant: VariantIdentityDto;
  quantity: number;
  paidPiasters: number;
  paidRanges: Array<{ quantity: number; paidUnitPiasters: number }>;
};

export type ReturnCorrectionLineDto = {
  returnLineId: string;
  sourceSaleLineId: string;
  variantId: string;
  variant: VariantIdentityDto;
  quantity: number;
  sellableQuantity: number;
};

export type CorrectionChangeDto = {
  id: string;
  operationId: string;
  type: "correction" | "cancellation";
  revision: number;
  reason: string;
  changedByStaffId: string;
  changedByDisplayName: string;
  changedAt: string;
  effectiveTotalPiasters: number | null;
  merchandise: CorrectionMerchandiseFactDto[];
  cash: CorrectionCashFactDto | null;
};

export type SaleCorrectionDetailDto = {
  targetType: "sale";
  id: string;
  reference: string;
  revision: number;
  status: "active" | "cancelled";
  original: { finalTotalPiasters: number; lines: SaleCorrectionLineDto[] };
  effective: { finalTotalPiasters: number; lines: SaleCorrectionLineDto[] } | null;
  relationships: {
    returns: Array<{ id: string; status: "draft" | "posted"; effectiveStatus: "active" | "cancelled"; refundPaidPiasters: number }>;
  };
  actual: {
    originalCashReceivedPiasters: number;
    correctionCashPaidOutPiasters: number;
    correctionCashRecoveredPiasters: number;
    netCashReceivedPiasters: number;
    merchandiseRestoredQuantity: number;
    merchandiseDeductedQuantity: number;
  };
  changes: CorrectionChangeDto[];
};

export type ReturnCorrectionDetailDto = {
  targetType: "return";
  id: string;
  reference: string;
  sourceSaleId: string;
  revision: number;
  status: "active" | "cancelled";
  original: { authorizedRefundPiasters: number; paidPiasters: number; lines: ReturnCorrectionLineDto[] };
  effective: { authorizedRefundPiasters: number; paidPiasters: number; lines: ReturnCorrectionLineDto[] } | null;
  actual: {
    originalRefundPaidPiasters: number;
    exchangeCreditAppliedPiasters: number;
    correctionCashPaidOutPiasters: number;
    correctionCashRecoveredPiasters: number;
    netRefundPaidPiasters: number;
    merchandiseRestoredQuantity: number;
    merchandiseDeductedQuantity: number;
  };
  changes: CorrectionChangeDto[];
};

export type StaffChangeDto = {
  operation: "provision" | "reset_password" | "disable" | "replace_grants";
  actorStaffId: string | null;
  occurredAt: string;
};

export type StaffAccountDto = StaffSummaryDto & {
  grants: Array<StaffGrantDto & { branch: BranchDto }>;
  changedByStaffId: string | null;
  changedAt: string;
  changes: StaffChangeDto[];
};

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "DUPLICATE_LOGIN_NAME"
  | "DUPLICATE_PRODUCT_CODE"
  | "BRANCH_NOT_AUTHORIZED"
  | "INVALID_RECOVERY"
  | "NOT_FOUND"
  | "ORIGIN_DENIED"
  | "CONFLICT"
  | "STOCK_MUTATION_PAUSED"
  | "COORDINATION_STALE"
  | "VARIANT_REFERENCED";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    messageAr: string;
  };
};

export const BRANCH_NAMES_AR: Record<BranchCode, string> = {
  abshway: "أبشواي",
  fayoum: "الفيوم",
};
