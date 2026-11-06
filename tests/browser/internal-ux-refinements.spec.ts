import { openPosOptionalDetails } from "./support/pos-checkout";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const WAREHOUSE_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const visualDir = path.resolve(".scratch/ux-refinements-20261103/visual");

test("internal refinements keep one sale, supplier draft, customers, and stock locations", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(visualDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");

  const suffix = crypto.randomUUID().slice(0, 8);
  const code = `UX-${suffix}`;
  const productName = `منتج واجهة ${suffix}`;
  const supplierName = `مورد واجهة ${suffix}`;
  const customerName = `زبون واجهة ${suffix}`;
  const customerPhone = "01055556677";
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف واجهة ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس واجهة ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون واجهة ${suffix}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: productName,
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 150000,
    minimumSellingPricePiasters: 120000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const empty = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `UX0-${suffix}`,
    nameAr: `منتج بلا مخزون ${suffix}`,
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 10000,
    minimumSellingPricePiasters: null,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(empty.status, JSON.stringify(empty.body)).toBe(201);
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    receiptDate: cairoDate(),
    lines: [{ productId: product.body.id, quantity: 2, unitCostPiasters: 40000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const moved = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: workspace.body.activeBranch.id,
    productId: product.body.id,
    quantity: 1,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(201);
  const receiptsBefore = await staffApi(page, "GET", "/api/internal/receiving/receipts");

  await page.goto("http://127.0.0.1:5174/receiving");
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  const stock = page.getByTestId("stock-location-table");
  await expect(stock).toBeVisible();
  await page.locator("#stockQuery").fill(code);
  const stocked = stock.getByRole("row", { name: new RegExp(code) });
  await expect(stocked.locator("td").nth(1)).toHaveText("1");
  await expect(stocked.locator("td").nth(2)).toHaveText("1");
  await expect(stocked.locator("td").nth(3)).toHaveText("0 · غير متوفر");
  await page.locator("#stockQuery").fill(`UX0-${suffix}`);
  const zeroRow = stock.getByRole("row", { name: new RegExp(`UX0-${suffix}`) });
  await expect(zeroRow.locator("td").nth(1)).toHaveText("0 · غير متوفر");
  await expect(zeroRow.locator("td").nth(2)).toHaveText("0 · غير متوفر");
  await expect(zeroRow.locator("td").nth(3)).toHaveText("0 · غير متوفر");
  const locationFilters = page.getByRole("group", { name: "تصفية أماكن المخزون" });
  await expect(locationFilters.getByRole("button")).toHaveCount(3);
  const allStock = locationFilters.getByRole("button", { name: "كل المخزون", exact: true });
  const ibshaway = locationFilters.getByRole("button", { name: "أبشواي", exact: true });
  const fayoum = locationFilters.getByRole("button", { name: "الفيوم", exact: true });
  await expect(allStock).toHaveAttribute("aria-pressed", "true");
  await ibshaway.click();
  await expect(zeroRow).toHaveCount(0);
  await expect(page.getByText("لا توجد منتجات مطابقة في أماكن المخزون المحددة.")).toBeVisible();
  await page.locator("#stockQuery").fill(code.toLowerCase());
  await expect(stocked.locator("td").nth(2)).toHaveText("1");
  await fayoum.click();
  await expect(fayoum).toHaveAttribute("aria-pressed", "true");
  await expect(stocked).toHaveCount(0);
  await allStock.click();
  await expect(stocked).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, "receiving-stock-1440.png") });

  await page.getByRole("tab", { name: "استلام بضاعة" }).click();
  const draftCode = `DRAFT-${suffix}`;
  const receive = page.getByRole("form", { name: "تسجيل إذن استلام" });
  const newProduct = page.getByRole("form", { name: "إضافة منتج إلى المخزون" });
  await expect(newProduct).toHaveCount(0);
  await expect(receive.getByRole("button", { name: /^إضافة منتج/ })).toHaveCount(2);
  await receive.getByRole("button", { name: "إضافة منتج جديد" }).click();
  await page.locator("#newInventoryCode").fill(draftCode);
  await page.locator("#newInventoryName").fill("مسودة المورد");
  await page.locator("#newInventoryCategory").selectOption(category.body.id);
  await page.locator("#newInventoryPrice").fill("250");
  await page.locator("#newInventoryMinimum").fill("200");
  await page.locator("#newInventoryQuantity").fill("4");
  await page.locator("#newInventoryCost").fill("80");
  await page.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await page.locator("[id^='product-']").selectOption(product.body.id);
  await page.locator("[id^='qty-']").fill("2");
  await page.locator("[id^='cost-']").fill("40");
  await page.getByRole("button", { name: "مورد جديد", exact: true }).click();
  await page.locator("#newSupplierName").fill(supplierName);
  await page.getByTestId("create-inline-supplier").click();
  await expect(page.getByTestId("inline-supplier-notice")).toHaveText("تم اختيار المورد.");
  const supplierId = await page.locator("#receiptSupplier").inputValue();
  expect(supplierId).not.toBe("");
  await expect(receive.getByRole("combobox", { name: "المورد", exact: true })).toHaveCount(1);
  await expect(page.getByLabel("تاريخ الاستلام", { exact: true })).toHaveCount(1);
  await expect(page.locator("#receiptSupplier")).toHaveValue(supplierId);
  await expect(page.locator("#newInventoryCode")).toHaveValue(draftCode);
  await expect(page.locator("#newInventoryName")).toHaveValue("مسودة المورد");
  await expect(page.locator("#newInventoryPrice")).toHaveValue("250");
  await expect(page.locator("#newInventoryMinimum")).toHaveValue("200");
  await expect(page.locator("#newInventoryQuantity")).toHaveValue("4");
  await expect(page.locator("#newInventoryCost")).toHaveValue("80");
  await expect(page.locator("[id^='product-']")).toHaveValue(product.body.id);
  await expect(page.locator("[id^='qty-']")).toHaveValue("2");
  await expect(page.locator("[id^='cost-']")).toHaveValue("40");
  await page.locator("#newSupplierName").fill(supplierName);
  await page.getByTestId("create-inline-supplier").click();
  await expect(page.getByTestId("inline-supplier-error")).toContainText("المورد موجود بالفعل.");
  await expect(page.locator("#newInventoryCode")).toHaveValue(draftCode);
  await expect(page.locator("#newInventoryQuantity")).toHaveValue("4");
  await expect(page.locator("[id^='qty-']")).toHaveValue("2");
  const suppliers = await staffApi(page, "GET", "/api/internal/suppliers");
  expect(suppliers.body.filter((item: { nameAr: string }) => item.nameAr === supplierName)).toHaveLength(1);

  let productWrites = 0;
  await page.route("**/api/internal/catalog/products", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    productWrites += 1;
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await route.abort("connectionreset");
  });
  await newProduct.getByRole("button", { name: "حفظ المنتج وإضافته إلى الإذن" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "تعذر إكمال إنشاء المنتج." })).toBeVisible();
  await expect(newProduct.getByLabel("رمز المنتج / SKU")).toHaveValue(draftCode);
  await newProduct.getByRole("button", { name: "استعادة منتج محفوظ برمزه" }).click();
  expect(productWrites).toBe(1);
  await expect(newProduct).toHaveCount(0);
  const rows = receive.locator(".receiving-draft-table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByLabel("الكمية")).toHaveValue("4");
  await expect(rows.nth(1).getByLabel("تكلفة الشراء بالجنيه")).toHaveValue("80");
  const receiptsWhileDraft = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  expect(receiptsWhileDraft.body).toHaveLength(receiptsBefore.body.length);

  const existingProduct = rows.first().getByLabel("المنتج", { exact: true });
  await existingProduct.selectOption("");
  await receive.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "يجب تحديد المنتج لكل صنف." })).toBeVisible();
  const receiptsAfter = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  expect(receiptsAfter.body).toHaveLength(receiptsBefore.body.length);
  await page.screenshot({ path: path.join(visualDir, "receiving-feedback-1440.png") });

  await existingProduct.selectOption(product.body.id);
  await receive.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByText("تم حفظ إذن الاستلام.", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  const detail = page.getByTestId("receipt-details");
  await expect(detail).toContainText("الكمية المستلمة: 2 — تكلفة شراء الوحدة: 40 ج.م.");
  await expect(detail).toContainText("الكمية المستلمة: 4 — تكلفة شراء الوحدة: 80 ج.م.");
  const receiptsAfterSave = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  expect(receiptsAfterSave.body).toHaveLength(receiptsBefore.body.length + 1);
  expect(receiptsAfterSave.body.find((receipt: { supplierId: string }) => receipt.supplierId === supplierId)?.lines).toHaveLength(2);

  const confirmColor = await page.getByTestId("create-inline-supplier").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect([[20, 108, 67], [15, 107, 60]]).toContainEqual(rgbChannels(confirmColor));

  await page.goto("http://127.0.0.1:5174/lookup");
  await expect(page.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة")).toHaveCount(0);
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByTestId("add-operational").click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  await checkout.getByLabel("اسم الزبون (اختياري)").fill(customerName);
  await checkout.getByLabel("هاتف الزبون (اختياري)").fill(customerPhone);
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("5");
  await expect(page.getByTestId("complete-sale-print")).toBeVisible();
  const saleResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/internal/sales";
  });
  await page.getByTestId("complete-sale").click();
  const saved = await saleResponse;
  expect(saved.status()).toBeLessThan(300);
  await expect(page.getByText("تم حفظ البيع.")).toBeVisible();
  await expect(page.getByTestId("sale-details")).toBeVisible();
  const sales = await staffApi(page, "GET", "/api/internal/sales");
  expect(sales.body.filter((sale: { customerPhone?: string | null }) => sale.customerPhone === customerPhone)).toHaveLength(1);
  await page.screenshot({ path: path.join(visualDir, "pos-complete-1440.png") });

  await page.goto("http://127.0.0.1:5174/customers");
  const list = page.getByTestId("customer-list");
  await expect(list).toContainText(customerName);
  await page.getByLabel("الاسم أو الهاتف").fill("555566");
  await page.getByRole("button", { name: "بحث" }).click();
  await expect(list.getByRole("row", { name: new RegExp(customerName) })).toBeVisible();
  await list.getByTestId("customer-row").click();
  const history = page.getByTestId("customer-history");
  await expect(history).toContainText(productName);
  await expect(page.getByText("استرداد")).toHaveCount(0);
  await expect(page.getByText("صافي")).toHaveCount(0);
  await page.screenshot({ path: path.join(visualDir, "customers-1440.png") });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("http://127.0.0.1:5174/receiving");
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await expect(page.getByTestId("stock-location-table")).toBeVisible();
  const overflow = await page.locator(".data-table-wrap").first().evaluate((element) => ({
    contained: element.scrollWidth >= element.clientWidth,
    pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
  }));
  expect(overflow.contained).toBe(true);
  expect(overflow.pageFits).toBe(true);
  await page.screenshot({ path: path.join(visualDir, "receiving-narrow.png") });
});

function cairoDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rgbChannels(color: string): number[] | null {
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return rgb.slice(1, 4).map((value) => Math.round(Number(value)));
  const oklab = color.match(/^oklab\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
  if (!oklab) return null;
  const lightness = Number(oklab[1]);
  const greenRed = Number(oklab[2]);
  const blueYellow = Number(oklab[3]);
  const lmsL = lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow;
  const lmsM = lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow;
  const lmsS = lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow;
  const linear = [lmsL ** 3, lmsM ** 3, lmsS ** 3];
  const [red, green, blue] = [
    4.0767416621 * linear[0] - 3.3077115913 * linear[1] + 0.2309699292 * linear[2],
    -1.2684380046 * linear[0] + 2.6097574011 * linear[1] - 0.3413193965 * linear[2],
    -0.0041960863 * linear[0] - 0.7034186147 * linear[1] + 1.707614701 * linear[2],
  ];
  return [red, green, blue].map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  });
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}
