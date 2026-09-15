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
  };
};

export type PublicationStatus = "available" | "coming_soon" | "hidden";

export type CategoryDto = {
  id: string;
  nameAr: string;
  parentId: string | null;
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
  PublicProductAvailability,
  PublicProductDto,
  PublicProductPublication,
  PublicProductVariantDto,
} from "./public.ts";

export type CashierVariantDto = {
  id: string;
  size: SizeDto;
  color: ColorDto;
  sellingPricePiasters: number;
  availableQuantity: number;
};

export type CashierProductLookupDto = {
  id: string;
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
  batchId: string;
  variant: VariantIdentityDto;
};

export type ReceiptDto = {
  id: string;
  operationId: string;
  receiptDate: string;
  receivedByStaffId: string;
  recordedAt: string;
  lines: ReceiptLineDto[];
};

export type InventoryBatchDto = {
  id: string;
  variantId: string;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCostPiasters: number;
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
};

export type SaleLineDto = {
  id: string;
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  units: SaleUnitDto[];
  variant: VariantIdentityDto;
};

export type SaleDiscrepancyDto = {
  unallocatedQuantity: number;
  messageAr: string;
};

export type PosPriceSnapshotDto = {
  snapshotId: string;
  staffId: string;
  branch: BranchDto;
  deviceId: string;
  issuedAt: string;
  stockVersion: number;
  includedOperationIds: string[];
  includedOperations: CompletedOperationProofDto[];
  products: CashierProductLookupDto[];
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
  employeeDiscountPiasters: number;
  discountReason: string | null;
  discountedByStaffId: string | null;
  finalTotalPiasters: number;
  physicallyCompleted: boolean;
  discrepancy: SaleDiscrepancyDto | null;
  lines: SaleLineDto[];
};

export type ManagerSaleAllocationDto = {
  batchId: string;
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
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
