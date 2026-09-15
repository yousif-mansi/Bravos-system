import type {
  CashierProductLookupDto,
  AutomaticOfferDto,
  AutomaticOfferWriteDto,
  CategoryDto,
  CouponDto,
  CouponWriteDto,
  ColorDto,
  ExpenseCategoryDto,
  ExpenseDto,
  ExpenseTotalsDto,
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  ManagerProductDto,
  PosPriceSnapshotDto,
  ReceiptDto,
  ReturnCorrectionDetailDto,
  ReturnDto,
  ReturnListPageDto,
  ReturnSourceDto,
  SaleAcknowledgementDto,
  SaleCorrectionDetailDto,
  SaleDto,
  SizeDto,
  StaffAccountDto,
  StorefrontContactsDto,
  UploadedProductMediaDto,
  VariantLowStockDto,
  WorkspaceDto,
} from "@bravos/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageAr: string,
  ) {
    super(messageAr);
    this.name = "ApiError";
  }
}

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? "CONFLICT",
      body?.error?.messageAr ?? "تعذر إكمال العملية.",
    );
  }
  return body as T;
}

export function signIn(loginName: string, password: string) {
  return request<{ user: { username?: string } }>("/api/auth/sign-in/username", {
    method: "POST",
    body: JSON.stringify({ username: loginName, password }),
  });
}

export function signOut() {
  return request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) });
}

export function getWorkspace() {
  return request<WorkspaceDto>("/api/internal/workspace");
}

export function selectBranch(branchId: string) {
  return request<WorkspaceDto>("/api/internal/active-branch", {
    method: "POST",
    body: JSON.stringify({ branchId }),
  });
}

export function listStaff() {
  return request<StaffAccountDto[]>("/api/internal/staff");
}

export function createStaff(input: {
  loginName: string;
  displayName: string;
  password: string;
  grants: Array<{ branchId: string; cashier: boolean; orderRepresentative: boolean }>;
}) {
  return request<StaffAccountDto>("/api/internal/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetStaffPassword(staffId: string, password: string) {
  return request(`/api/internal/staff/${staffId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function disableStaff(staffId: string) {
  return request(`/api/internal/staff/${staffId}/disable`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function setStaffGrants(
  staffId: string,
  grants: Array<{ branchId: string; cashier: boolean; orderRepresentative: boolean }>,
) {
  return request<StaffAccountDto>(`/api/internal/staff/${staffId}/grants`, {
    method: "POST",
    body: JSON.stringify({ grants }),
  });
}

export function requestOwnerRecovery(loginName: string) {
  return request("/api/internal/owner-recovery/request", {
    method: "POST",
    body: JSON.stringify({ loginName }),
  });
}

export function completeOwnerRecovery(token: string, password: string) {
  return request("/api/internal/owner-recovery/complete", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function listCategories() {
  return request<CategoryDto[]>("/api/internal/catalog/categories");
}

export function createCategory(input: { nameAr: string; parentId?: string | null }) {
  return request<CategoryDto>("/api/internal/catalog/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCategory(categoryId: string, nameAr: string) {
  return request<CategoryDto>(`/api/internal/catalog/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify({ nameAr }),
  });
}

export function listSizes() {
  return request<SizeDto[]>("/api/internal/catalog/sizes");
}

export function createSize(nameAr: string) {
  return request<SizeDto>("/api/internal/catalog/sizes", {
    method: "POST",
    body: JSON.stringify({ nameAr }),
  });
}

export function updateSize(sizeId: string, nameAr: string) {
  return request<SizeDto>(`/api/internal/catalog/sizes/${sizeId}`, {
    method: "PATCH",
    body: JSON.stringify({ nameAr }),
  });
}

export function listColors() {
  return request<ColorDto[]>("/api/internal/catalog/colors");
}

export function createColor(nameAr: string) {
  return request<ColorDto>("/api/internal/catalog/colors", {
    method: "POST",
    body: JSON.stringify({ nameAr }),
  });
}

export function updateColor(colorId: string, nameAr: string) {
  return request<ColorDto>(`/api/internal/catalog/colors/${colorId}`, {
    method: "PATCH",
    body: JSON.stringify({ nameAr }),
  });
}

export function listProducts() {
  return request<ManagerProductDto[]>("/api/internal/catalog/products");
}

export function createProduct(input: {
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultSellingPricePiasters: number;
  publication: "available" | "coming_soon" | "hidden";
  imageRefs: string[];
  sizeGuideAr: string | null;
  variants: Array<{
    sizeId: string;
    colorId: string;
    sellingPricePiastersOverride: number | null;
  }>;
}) {
  return request<ManagerProductDto>("/api/internal/catalog/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProduct(
  productId: string,
  input: {
    code: string;
    nameAr: string;
    descriptionAr: string;
    categoryId: string;
    defaultSellingPricePiasters: number;
    publication: "available" | "coming_soon" | "hidden";
    imageRefs: string[];
    sizeGuideAr: string | null;
    variants: Array<{
      sizeId: string;
      colorId: string;
      sellingPricePiastersOverride: number | null;
    }>;
  },
) {
  return request<ManagerProductDto>(`/api/internal/catalog/products/${productId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getStorefrontContacts() {
  return request<StorefrontContactsDto>("/api/internal/storefront/contacts");
}

export function updateStorefrontContacts(input: {
  whatsappUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}) {
  return request<StorefrontContactsDto>("/api/internal/storefront/contacts", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function uploadProductImage(file: File) {
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ApiError(400, "VALIDATION", "حجم الصورة غير صالح. الحد الأقصى 5 ميجابايت.");
  }
  const base64 = await fileToBase64(file);
  return request<UploadedProductMediaDto>("/api/internal/catalog/media", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      base64,
    }),
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة."));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("تعذر قراءة ملف الصورة."));
        return;
      }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function listAutomaticOffers() {
  return request<AutomaticOfferDto[]>("/api/internal/pricing/offers");
}

export function createAutomaticOffer(input: AutomaticOfferWriteDto) {
  return request<AutomaticOfferDto>("/api/internal/pricing/offers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAutomaticOffer(offerId: string, input: AutomaticOfferWriteDto) {
  return request<AutomaticOfferDto>(`/api/internal/pricing/offers/${offerId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listCoupons() {
  return request<CouponDto[]>("/api/internal/pricing/coupons");
}

export function createCoupon(input: CouponWriteDto) {
  return request<CouponDto>("/api/internal/pricing/coupons", { method: "POST", body: JSON.stringify(input) });
}

export function updateCoupon(couponId: string, input: CouponWriteDto) {
  return request<CouponDto>(`/api/internal/pricing/coupons/${couponId}`, { method: "PUT", body: JSON.stringify(input) });
}

export function lookupProductByCode(code: string) {
  return request<CashierProductLookupDto>(
    `/api/internal/catalog/lookup?code=${encodeURIComponent(code)}`,
  );
}

export function finalizeReceipt(input: {
  operationId: string;
  receiptDate: string;
  lines: Array<{ variantId: string; quantity: number; unitCostPiasters: number }>;
}) {
  return request<ReceiptDto>("/api/internal/receiving/receipts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listReceipts() {
  return request<ReceiptDto[]>("/api/internal/receiving/receipts");
}

export function getReceipt(receiptId: string) {
  return request<ReceiptDto>(`/api/internal/receiving/receipts/${receiptId}`);
}

export function correctReceipt(receiptId: string, input: {
  operationId: string;
  expectedRevision: number;
  reason: string;
  lines: Array<{ lineId: string; quantity: number; unitCostPiasters: number }>;
}) {
  return request<ReceiptDto>(`/api/internal/receiving/receipts/${receiptId}/corrections`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function lookupReceivingOperation(operationId: string): Promise<ReceiptDto | null> {
  try {
    return await request<ReceiptDto>(`/api/internal/receiving/operations/${operationId}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      return null;
    }
    throw caught;
  }
}

export function listBatches() {
  return request<InventoryBatchDto[]>("/api/internal/inventory/batches");
}

export function listLowStock() {
  return request<LowStockVariantDto[]>("/api/internal/inventory/low-stock");
}

export function getInventorySettings() {
  return request<InventorySettingsDto>("/api/internal/inventory/settings");
}

export function updateInventorySettings(lowStockThreshold: number) {
  return request<InventorySettingsDto>("/api/internal/inventory/settings", {
    method: "PATCH",
    body: JSON.stringify({ lowStockThreshold }),
  });
}

export function setVariantLowStockThreshold(variantId: string, lowStockThreshold: number | null) {
  return request<VariantLowStockDto>(`/api/internal/inventory/variants/${variantId}/low-stock-threshold`, {
    method: "PUT",
    body: JSON.stringify({ lowStockThreshold }),
  });
}

export type SaleWrite = {
  saleId: string;
  operationId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason?: string | null;
  occurredAt?: string | null;
  pendingOperationIds?: string[];
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number }>;
};

export function listCashierCatalog() {
  return request<CashierProductLookupDto[]>("/api/internal/catalog/pos-snapshot");
}

export function issuePosSnapshot(deviceId: string, pendingOperationIds: string[] = []) {
  return request<PosPriceSnapshotDto>("/api/internal/sales/pos-snapshots", {
    method: "POST",
    body: JSON.stringify({ deviceId, pendingOperationIds }),
  });
}

export type SyncedSaleDto = SaleDto & { acknowledgement: SaleAcknowledgementDto };

export function acceptOfflineSale(input: SaleWrite & { deviceId: string; snapshotId: string }) {
  return request<SyncedSaleDto>("/api/internal/sales/accepted", {
    method: "POST",
    body: JSON.stringify({ ...input, physicallyCompleted: true }),
  });
}

export function recoverOfflineSale(
  input: Partial<SaleWrite> & { saleId: string; operationId: string; deviceId?: string; snapshotId?: string },
) {
  return request<SyncedSaleDto>("/api/internal/sales/recover", {
    method: "POST",
    body: JSON.stringify({ ...input, physicallyCompleted: true }),
  });
}

export function prepareSale(input: SaleWrite) {
  return request<SaleDto>("/api/internal/sales/prepare", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeSale(input: SaleWrite) {
  return request<SyncedSaleDto>("/api/internal/sales", {
    method: "POST",
    body: JSON.stringify({ ...input, physicallyCompleted: true }),
  });
}

export function listSales() {
  return request<SaleDto[]>("/api/internal/sales");
}

export function getSale(saleId: string) {
  return request<SaleDto>(`/api/internal/sales/${saleId}`);
}

export async function lookupSaleOperation(operationId: string): Promise<SaleDto | null> {
  try {
    return await request<SaleDto>(`/api/internal/sales/operations/${operationId}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      return null;
    }
    throw caught;
  }
}

export function listExpenseCategories() {
  return request<ExpenseCategoryDto[]>("/api/internal/expense-categories");
}

export function createExpenseCategory(nameAr: string) {
  return request<ExpenseCategoryDto>("/api/internal/expense-categories", {
    method: "POST",
    body: JSON.stringify({ nameAr }),
  });
}

export function updateExpenseCategory(categoryId: string, input: { nameAr: string; active: boolean }) {
  return request<ExpenseCategoryDto>(`/api/internal/expense-categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type ExpenseWrite = {
  operationId: string;
  amountPiasters: number;
  expenseDate: string;
  categoryId: string;
  description: string;
};

export function createExpense(input: ExpenseWrite) {
  return request<ExpenseDto>("/api/internal/expenses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listExpenses() {
  return request<ExpenseDto[]>("/api/internal/expenses");
}

export function getExpense(expenseId: string) {
  return request<ExpenseDto>(`/api/internal/expenses/${expenseId}`);
}

export function getExpenseTotals() {
  return request<ExpenseTotalsDto>("/api/internal/expenses/totals");
}

export function changeExpense(expenseId: string, input: {
  operationId: string;
  expectedRevision: number;
  type: "correction" | "cancellation";
  reason: string;
  amountPiasters?: number;
  expenseDate?: string;
  categoryId?: string;
  description?: string;
}) {
  return request<ExpenseDto>(`/api/internal/expenses/${expenseId}/changes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function lookupExpenseOperation(operationId: string): Promise<ExpenseDto | null> {
  try {
    return await request<ExpenseDto>(`/api/internal/expenses/operations/${operationId}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return null;
    throw caught;
  }
}

export type ReturnSourceSearch = {
  reference?: string;
  date?: string;
  branchId?: string;
  item?: string;
  amountPiasters?: number;
};

export function listReturnSources(search: ReturnSourceSearch = {}) {
  const query = new URLSearchParams();
  if (search.reference) query.set("reference", search.reference);
  if (search.date) query.set("date", search.date);
  if (search.branchId) query.set("branchId", search.branchId);
  if (search.item) query.set("item", search.item);
  if (search.amountPiasters !== undefined) query.set("amountPiasters", String(search.amountPiasters));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ReturnSourceDto[]>(`/api/internal/returns/sources${suffix}`);
}

export function createReturnDraft(input: {
  returnId: string;
  operationId: string;
  sourceSaleId: string;
  handlingBranchId: string;
  authorizedRefundPiasters: number;
  lines: Array<{ sourceSaleLineId: string; quantity: number; sellableQuantity: number }>;
}) {
  return request<ReturnDto>("/api/internal/returns", { method: "POST", body: JSON.stringify(input) });
}

export function updateReturnDraft(returnId: string, input: {
  expectedRevision: number;
  handlingBranchId: string;
  authorizedRefundPiasters: number;
  lines: Array<{ sourceSaleLineId: string; quantity: number; sellableQuantity: number }>;
}) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function postReturn(returnId: string, expectedRevision: number) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/post`, {
    method: "POST",
    body: JSON.stringify({ receivedAndInspected: true, expectedRevision }),
  });
}

export function payReturnRefund(returnId: string, amountPiasters: number, operationId: string) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/refund`, {
    method: "POST",
    body: JSON.stringify({ operationId, status: "paid", amountPiasters }),
  });
}

export function quoteReturnExchange(returnId: string, input: {
  quoteId: string;
  exchangeId: string;
  operationId: string;
  replacementSaleId: string;
  replacementSaleOperationId: string;
  expectedRevision: number;
  replacementLines: Array<{ variantId: string; quantity: number }>;
}) {
  return request<import("@bravos/contracts").ReturnExchangeQuoteDto>(`/api/internal/returns/${returnId}/exchange-quote`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeReturnExchange(returnId: string, input: {
  exchangeId: string;
  operationId: string;
  replacementSaleId: string;
  replacementSaleOperationId: string;
  receivedAndInspected: true;
  expectedRevision: number;
  cashRefundStatus: "owed" | "paid";
  quoteId: string;
}) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}/exchange`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listReturns(input: { limit?: number; cursor?: string } = {}) {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor) query.set("cursor", input.cursor);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<ReturnListPageDto>(`/api/internal/returns${suffix}`);
}

export function getReturn(returnId: string) {
  return request<ReturnDto>(`/api/internal/returns/${returnId}`);
}

export type SaleCorrectionWrite = {
  operationId: string;
  expectedRevision: number;
  type: "correction" | "cancellation";
  reason: string;
  effective: {
    finalTotalPiasters: number;
    lines: Array<{ lineId: string; quantity: number; paidPiasters: number }>;
  } | null;
  merchandise: Array<{ lineId: string; quantityDelta: number }>;
  cash: { direction: "paid_out" | "recovered"; amountPiasters: number } | null;
};

export type ReturnCorrectionWrite = Omit<SaleCorrectionWrite, "effective"> & {
  effective: {
    authorizedRefundPiasters: number;
    lines: Array<{ lineId: string; quantity: number; sellableQuantity: number }>;
  } | null;
};

export function getSaleCorrection(saleId: string) {
  return request<SaleCorrectionDetailDto>(`/api/internal/corrections/sales/${saleId}`);
}

export function changeSaleCorrection(saleId: string, input: SaleCorrectionWrite) {
  return request<SaleCorrectionDetailDto>(`/api/internal/corrections/sales/${saleId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getReturnCorrection(returnId: string) {
  return request<ReturnCorrectionDetailDto>(`/api/internal/corrections/returns/${returnId}`);
}

export function changeReturnCorrection(returnId: string, input: ReturnCorrectionWrite) {
  return request<ReturnCorrectionDetailDto>(`/api/internal/corrections/returns/${returnId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
