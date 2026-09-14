import type {
  CashierProductLookupDto,
  CategoryDto,
  ColorDto,
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  ManagerProductDto,
  PosPriceSnapshotDto,
  ReceiptDto,
  SaleDto,
  SizeDto,
  StaffAccountDto,
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
  employeeDiscountPiasters: number;
  discountReason?: string | null;
  occurredAt?: string | null;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number }>;
};

export function listCashierCatalog() {
  return request<CashierProductLookupDto[]>("/api/internal/catalog/pos-snapshot");
}

export function issuePosSnapshot(deviceId: string) {
  return request<PosPriceSnapshotDto>("/api/internal/sales/pos-snapshots", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
}

export function acceptOfflineSale(input: SaleWrite & { deviceId: string; snapshotId: string }) {
  return request<SaleDto>("/api/internal/sales/accepted", {
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
  return request<SaleDto>("/api/internal/sales", {
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
