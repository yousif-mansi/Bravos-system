import { openPosOptionalDetails } from "./support/pos-checkout";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const WAREHOUSE_BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const visualDir = path.resolve(".scratch/system-update-20261101/visual");

test("staff intake is product-level and storefront options share one quantity", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(visualDir, { recursive: true });
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");

  const suffix = crypto.randomUUID().slice(0, 8);
  const code = `VIS-${suffix}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف مرئي ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const black = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const white = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أبيض ${suffix}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: `منتج مرئي ${suffix}`,
    descriptionAr: "فحص الكمية المشتركة",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 100000,
    minimumSellingPricePiasters: 90000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [
      { sizeId: size.body.id, colorId: black.body.id, sellingPricePiastersOverride: null },
      { sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    receiptDate: cairoDate(),
    lines: [{ productId: product.body.id, quantity: 3, unitCostPiasters: 40000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const moved = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: workspace.body.activeBranch.id,
    productId: product.body.id,
    quantity: 3,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(201);

  await page.goto("http://127.0.0.1:5174/receiving");
  const receive = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await receive.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await receive.getByRole("button", { name: "إضافة منتج جديد" }).click();
  const intake = page.getByRole("form", { name: "إضافة منتج إلى المخزون" });
  await expect(intake.getByLabel("سعر البيع الافتراضي بالجنيه")).toBeVisible();
  await expect(intake.getByLabel("الحد الأدنى للبيع بالجنيه (اختياري)")).toBeVisible();
  await expect(intake.getByLabel("الكمية")).toBeVisible();
  await expect(intake.getByLabel("المقاس واللون")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "مقاس ولون جديدان لمنتج موجود" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "تسجيل إذن استلام" }).getByLabel("المنتج").first()).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await expect(page.getByRole("region", { name: "أماكن المخزون" })).toBeVisible();
  await expect(page.getByTestId("stock-location-table")).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, "receiving.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/transfers");
  const transfer = page.getByRole("form", { name: "نقل كمية" });
  await expect(page.getByRole("heading", { name: "نقل المخزون" })).toBeVisible();
  await expect(transfer.getByLabel("من", { exact: true })).toBeVisible();
  await expect(transfer.getByLabel("إلى", { exact: true })).toBeVisible();
  await expect(transfer.getByLabel("المنتج", { exact: true })).toBeVisible();
  await expect(transfer.getByLabel("الكمية", { exact: true })).toBeVisible();
  await expect(transfer.getByRole("option", { name: "المخزن المركزي" })).toHaveCount(2);
  await page.screenshot({ path: path.join(visualDir, "transfer.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/suppliers");
  await expect(page.getByRole("heading", { name: "الموردون" })).toBeVisible();
  await expect(page.getByRole("form", { name: "مورد جديد" }).getByLabel("اسم المورد")).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, "suppliers.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/expenses");
  const purchases = page.getByRole("region", { name: "مشتريات الموردين" });
  await expect(purchases.getByRole("heading", { name: "مشتريات الموردين" })).toBeVisible();
  await expect(purchases).toContainText("ليست مصروفاً تشغيلياً");
  await page.screenshot({ path: path.join(visualDir, "expenses-purchases.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/customers");
  const customers = page.locator("main");
  await expect(page.getByRole("heading", { name: "الزبائن" })).toBeVisible();
  await expect(page.getByRole("form", { name: "بحث عن زبون" }).getByLabel("الاسم أو الهاتف")).toBeVisible();
  await expect(page.getByTestId("customer-list").or(page.getByText("لا يوجد زبائن مسجلون."))).toBeVisible();
  await expect(customers).toContainText("منتجات مدفوعة");
  await expect(page.getByRole("region", { name: "مشتريات الزبون" })).not.toContainText("استرداد");
  await expect(customers).not.toContainText("صافي");
  await page.screenshot({ path: path.join(visualDir, "customers.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/lookup");
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await expect(lookup.getByLabel("رمز المنتج")).toBeVisible();
  await expect(page.locator("#lookupCodeHint")).toHaveCount(0);
  await expect(page.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة")).toHaveCount(0);
  await lookup.getByLabel("رمز المنتج").fill(code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  const result = page.getByTestId("lookup-result");
  await expect(result).toContainText("سعر البيع:");
  await expect(result).toContainText("الحد الأدنى للبيع:");
  await expect(result).toContainText("الكمية المتاحة في الفرع: 3");
  await expect(result.getByRole("combobox")).toHaveCount(0);
  await result.getByTestId("add-operational").click();
  const saleCart = page.getByTestId("sale-cart");
  await expect(saleCart).toContainText(code);
  await expect(saleCart).not.toContainText(`مقاس ${suffix}`);
  await openPosOptionalDetails(page.getByRole("form", { name: "إتمام البيع" }));
  await expect(page.getByLabel("هاتف الزبون (اختياري)")).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, "pos-lookup.png"), fullPage: true });

  await page.goto("http://127.0.0.1:5174/catalog");
  await page.getByRole("button", { name: "إدارة التصنيفات والمقاسات والألوان" }).click();
  await expect(page.getByRole("form", { name: "إضافة مقاس" }).getByLabel("اسم المقاس")).toBeVisible();
  await expect(page.getByRole("form", { name: "إضافة لون" }).getByLabel("اسم اللون")).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التصنيفات والمقاسات والألوان" }).click();
  await page.getByTestId("catalog-browse-filters").locator("#catalog-browse-query").fill(code);
  await page.getByRole("button", { name: `منتج مرئي ${suffix}`, exact: true }).click();
  const editor = page.getByRole("form", { name: "تعديل منتج" });
  await expect(editor.getByLabel("سعر البيع بالجنيه")).toHaveValue("1000");
  await expect(editor.getByLabel("الحد الأدنى للبيع بالجنيه (اختياري)")).toHaveValue("900");
  await page.getByRole("tab", { name: "المقاسات والألوان" }).click();
  await expect(editor.getByRole("checkbox", { name: "عرض هذه التركيبة" })).toHaveCount(2);
  await expect(editor.getByLabel("سعر مختلف للمتغير (اختياري)")).toHaveCount(0);
  await page.screenshot({ path: path.join(visualDir, "catalog-product.png"), fullPage: true });

  await page.goto(`http://127.0.0.1:3001/products/${product.body.id}`);
  await expect(page.getByRole("heading", { name: "Choose size and color" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Every option uses the same available quantity.")).toBeVisible();
  const colors = page.locator('input[name="purchase-color"]');
  await expect(colors).toHaveCount(2);
  const selectedPrice = page.locator("p", { hasText: "Selected price" }).locator("strong");
  const priceBefore = await selectedPrice.innerText();
  await page.locator("#product-quantity").fill("2");
  await page.locator(".purchase-panel").getByRole("button", { name: "Add to bag" }).click();
  await expect(page.locator("#product-availability")).toContainText("In your bag: 2.");
  await colors.nth(1).check();
  await expect(selectedPrice).toHaveText(priceBefore);
  await expect(page.locator("#product-availability")).toContainText("You can add up to 1");
  await page.locator("#product-quantity").fill("2");
  await expect(page.locator("#product-quantity-guidance")).toContainText("Reduce the quantity to 1.");
  await page.locator("#product-quantity").fill("1");
  await page.locator(".purchase-panel").getByRole("button", { name: "Add to bag" }).click();
  await expect(page.locator("#product-availability")).toContainText("In your bag: 3.");
  await expect(page.locator(".purchase-panel").getByRole("button", { name: "Available quantity is in your bag" })).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, "storefront-product.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Choose size and color" })).toBeVisible();
  await expect(colors).toHaveCount(2);
  await page.screenshot({ path: path.join(visualDir, "storefront-product-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("http://127.0.0.1:3001/cart");
  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();
  const groups = page.getByRole("group", { name: /Quantity of/ });
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator("output")).toHaveText("2");
  await expect(groups.nth(1).locator("output")).toHaveText("1");
  await expect(groups.nth(0).getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  await expect(groups.nth(1).getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  await page.screenshot({ path: path.join(visualDir, "storefront-cart.png"), fullPage: true });
});

function cairoDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
  return { status: response.status(), body: await response.json() };
}
