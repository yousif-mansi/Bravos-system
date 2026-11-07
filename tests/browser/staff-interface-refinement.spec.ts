import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const base = "http://127.0.0.1:5174";
const visual = path.resolve(".scratch/pos-ui-refinement-20261106/visual");
const warehouse = "33333333-3333-4333-8333-333333333333";

test("receiving tabs preserve draft and legacy transfer updates locations once", async ({ page }) => {
  await signIn(page);
  const item = await createProduct(page);
  const workspace = await api(page, "GET", "/api/internal/workspace");
  const receipt = await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: warehouse, receiptDate: cairoDate(),
    lines: [{ productId: item.id, quantity: 4, unitCostPiasters: 40000 }],
  });
  expect(receipt.status).toBe(201);
  await page.goto(`${base}/receiving`);
  const tabs = page.getByRole("tablist", { name: "أقسام المخزون" });
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  await expect(tabs.getByRole("tab", { name: "استلام بضاعة" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await page.locator("[id^='product-']").selectOption(item.id);
  await page.locator("[id^='qty-']").fill("3");
  await page.locator("[id^='cost-']").fill("40");
  page.once("dialog", (dialog) => dialog.accept());
  await tabs.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await expect(page.getByRole("form", { name: "تسجيل إذن استلام" })).toBeHidden();
  await tabs.getByRole("tab", { name: "استلام بضاعة" }).click();
  await expect(page.locator("[id^='qty-']")).toHaveValue("3");
  await expect(page.locator("[id^='cost-']")).toHaveValue("40");
  await capture(page, "receiving-draft");

  await page.goto(`${base}/transfers`);
  await expect(page).toHaveURL(/\/receiving\?tab=transfers/);
  await expect(page.getByRole("tab", { name: "تحويل مخزون" })).toHaveAttribute("aria-selected", "true");
  const form = page.getByRole("form", { name: "نقل كمية" });
  await form.locator("#transferSource").selectOption(warehouse);
  await form.locator("#transferDestination").selectOption(workspace.body.activeBranch.id);
  await form.locator("#transferProduct").selectOption(item.id);
  await form.locator("#transferQuantity").fill("2");
  await capture(page, "transfer-ready");
  await form.getByRole("button", { name: "مراجعة النقل" }).click();
  const review = page.getByRole("dialog", { name: "مراجعة نقل المخزون" });
  await expect(review).toContainText(item.name);
  await capture(page, "transfer-review");
  const transfer = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/internal/inventory/transfers");
  await review.getByRole("button", { name: "تأكيد النقل" }).click();
  expect((await transfer).status()).toBe(201);
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await page.locator("#stockQuery").fill(item.code);
  const row = page.getByTestId("stock-location-table").getByRole("row", { name: new RegExp(item.code) });
  await expect(row.locator("td").nth(1)).toHaveText("2");
  await expect(row.locator("td").nth(2)).toHaveText("2");
  await expect(row.locator("td").nth(3)).toContainText("0");
  await capture(page, "stock-locations");
  await page.getByRole("tab", { name: "المخزون المنخفض" }).click();
  await page.locator("#lowStockQuery").fill(item.code);
  await expect(page.getByTestId("low-stock-list")).toContainText(item.code);
  await capture(page, "receiving-low-stock");
  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  await page.locator("#receiptHistoryQuery").fill(item.code);
  const receiptRow = page.getByTestId("receipt-list").getByRole("row").filter({ hasText: item.code });
  await receiptRow.getByRole("button", { name: "عرض التفاصيل" }).click();
  await expect(page.getByTestId("receipt-details")).toContainText(item.code);
  await capture(page, "receiving-history-detail");
});

test("catalog edit preserves fields between tabs and confirms switching dirty products", async ({ page }) => {
  await signIn(page);
  const first = await createProduct(page);
  const second = await createProduct(page);
  await page.goto(`${base}/catalog`);
  await page.getByLabel("الاسم أو رمز SKU").fill(first.code);
  await page.getByRole("button", { name: first.name }).click();
  const name = page.locator("#productName");
  await name.fill(`${first.name} تعديل`);
  await page.getByRole("tab", { name: "المتجر الإلكتروني" }).click();
  await expect(name).toBeHidden();
  await capture(page, "catalog-online");
  await page.getByRole("tab", { name: "المقاسات والألوان" }).click();
  await capture(page, "catalog-options");
  await page.getByRole("tab", { name: "البيانات الأساسية" }).click();
  await expect(name).toHaveValue(`${first.name} تعديل`);
  await page.getByLabel("الاسم أو رمز SKU").fill(second.code);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: second.name }).click();
  await expect(name).toHaveValue(`${first.name} تعديل`);
  await capture(page, "catalog-basic");
});

test("staff screens remain navigable at desktop and narrow widths and cashier cannot see manager sales tab", async ({ page }) => {
  await signIn(page);
  for (const [route, heading, key] of [
    ["/", "لوحة التحكم", "dashboard"],
    ["/lookup", "نقطة البيع", "pos"],
    ["/sales", "المبيعات", "sales"],
    ["/receiving", "استلام المخزون", "receiving"],
    ["/catalog", "إدارة المنتجات", "catalog"],
    ["/returns", "المرتجعات", "returns"],
    ["/online-orders", "الطلبات الأونلاين", "online-orders"],
  ] as const) {
    await page.goto(`${base}${route}`);
    await expect(page.getByRole("heading", { name: new RegExp(heading), level: 1 })).toBeVisible();
    const headingBox = await page.getByRole("heading", { name: new RegExp(heading), level: 1 }).boundingBox();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(0);
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(900);
    await capture(page, key);
  }
  await page.goto(`${base}/sales`);
  await page.getByRole("button", { name: "فاتح", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("heading", { name: "المبيعات", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "مبيعات الفروع" })).toBeVisible();
  await capture(page, "sales-light");
  await page.getByRole("button", { name: "داكن", exact: true }).click();
  await expect(page.getByRole("tab", { name: "الطلبات الإلكترونية" })).toBeVisible();
  await page.getByRole("tab", { name: "الطلبات الإلكترونية" }).click();
  await expect(page.getByTestId("confirmed-online-sales")).toBeVisible();
  await page.goto(`${base}/online-orders`);
  await page.getByRole("tab", { name: "المؤكدة وما بعدها" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.getByRole("tab", { name: "الملغاة" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.goto(`${base}/returns`);
  await expect(page.locator("#return-date")).toBeHidden();
  await page.getByText("فلاتر إضافية", { exact: true }).click();
  await expect(page.locator("#return-date")).toBeVisible();
  const onlineItem = await createProduct(page);
  const workspace = await api(page, "GET", "/api/internal/workspace");
  await stockAtBranch(page, onlineItem.id, workspace.body.activeBranch.id, 2);
  const area = await api(page, "POST", "/api/internal/delivery-areas", { nameAr: `منطقة اختبار ${crypto.randomUUID().slice(0, 8)}`, feePiasters: 5000, active: true });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const lines = [{ variantId: onlineItem.variantId, quantity: 1 }];
  const quote = await publicApi(page, "/api/public/checkout/quote", { deliveryAreaId: area.body.id, lines });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const order = await publicApi(page, "/api/public/checkout/orders", { operationId: crypto.randomUUID(), quoteId: quote.body.quoteId, deliveryAreaId: area.body.id, lines, customerName: "عميل اختبار", primaryPhone: "01012345678", detailedAddress: "شارع الاختبار" });
  expect(order.status, JSON.stringify(order.body)).toBe(201);
  await page.goto(`${base}/online-orders`);
  await page.getByTestId("online-order-row").filter({ hasText: order.body.reference }).getByRole("link", { name: "فتح التفاصيل" }).click();
  await expect(page.getByRole("region", { name: "ملخص الطلب" })).toContainText(onlineItem.name);
  await expect(page.getByRole("link", { name: "فتح واتساب" })).toHaveAttribute("href", /wa\.me\/201012345678/);
  await capture(page, "online-order-pending");
  await page.getByRole("button", { name: "مراجعة إلغاء الطلب" }).click();
  const cancellation = page.getByRole("dialog", { name: "مراجعة إلغاء الطلب" });
  await expect(cancellation.getByRole("button", { name: "إلغاء الطلب من دون تغيير المخزون" })).toBeDisabled();
  await capture(page, "online-order-cancel-review");
  await cancellation.getByRole("button", { name: "إغلاق" }).click();
  await page.getByText("إدارة الطلب والسجل", { exact: true }).click();
  const agreement = page.getByRole("form", { name: "مراجعة الاتفاق مع العميل" });
  await agreement.getByRole("button", { name: "مراجعة السعر" }).click();
  await agreement.getByLabel("وافق العميل على هذه المنتجات والأسعار").check();
  await agreement.getByRole("button", { name: "حفظ اتفاق العميل" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ الاتفاق مع العميل");
  await page.getByRole("button", { name: "مراجعة تأكيد الطلب" }).click();
  const confirmation = page.getByRole("dialog", { name: "مراجعة تأكيد الطلب" });
  await confirmation.getByLabel("فرع تجهيز الطلب").selectOption(workspace.body.activeBranch.id);
  await expect(confirmation.getByRole("button", { name: "تأكيد الطلب وخصم المخزون" })).toBeDisabled();
  await confirmation.getByLabel("وجدت الأصناف الفعلية وفصلتها لهذا الطلب").check();
  await capture(page, "online-order-confirm-review");
  await confirmation.getByRole("button", { name: "تأكيد الطلب وخصم المخزون" }).click();
  await expect(page.getByTestId("order-status")).toContainText("مؤكد");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${base}/returns`);
  await capture(page, "returns-1366");
  await page.goto(`${base}/lookup`);
  await inViewport(page.getByTestId("complete-sale"), 1366, 768);
  await capture(page, "pos-1366");
  await page.setViewportSize({ width: 390, height: 800 });
  for (const route of ["/lookup", "/receiving", "/catalog", "/returns", "/online-orders"]) {
    await page.goto(`${base}${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture(page, `${route.slice(1)}-390`);
  }
  await page.context().clearCookies();
  await signIn(page, "cashier", "e2e-cashier-pass");
  await page.goto(`${base}/sales`);
  await expect(page.getByRole("tab", { name: "الطلبات الإلكترونية" })).toHaveCount(0);
  await expect(page.getByTestId("sale-costs")).toHaveCount(0);
});

test("POS sale and one inspected return preserve quantity and cash state", async ({ page }) => {
  await signIn(page);
  const item = await createProduct(page);
  const workspace = await api(page, "GET", "/api/internal/workspace");
  await stockAtBranch(page, item.id, workspace.body.activeBranch.id, 2);
  await page.goto(`${base}/lookup`);
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(item.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByTestId("add-operational").click();
  await page.getByRole("button", { name: `زيادة كمية ${item.name}` }).click();
  await expect(page.getByRole("button", { name: `زيادة كمية ${item.name}` })).toBeDisabled();
  await page.getByRole("button", { name: `تقليل كمية ${item.name}` }).click();
  await inViewport(page.getByTestId("complete-sale"), 1440, 900);
  await capture(page, "pos-cart");
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("radio", { name: "دفع مقسّم" }).check();
  await checkout.getByLabel("المبلغ النقدي بالجنيه").fill("500");
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("999");
  let salePosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/internal/sales") salePosts += 1;
  });
  await checkout.getByTestId("complete-sale").click();
  await expect(checkout.getByRole("alert")).toContainText("أدخل مبلغ النقد والدفع الإلكتروني");
  await checkout.getByTestId("complete-sale-print").click();
  await expect(checkout.getByRole("alert")).toContainText("أدخل مبلغ النقد والدفع الإلكتروني");
  expect(salePosts).toBe(0);
  const beforeSale = await api(page, "GET", "/api/internal/inventory/batches");
  expect(beforeSale.body.find((batch: { variantId: string }) => batch.variantId === item.operationalVariantId).remainingQuantity).toBe(2);
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("1000");
  await capture(page, "pos-split-payment");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await inViewport(checkout.getByTestId("complete-sale"), 1366, 768);
  await inViewport(checkout.getByTestId("complete-sale-print"), 1366, 768);
  await capture(page, "pos-split-payment-1366");
  await page.setViewportSize({ width: 1440, height: 900 });
  const savedResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/internal/sales");
  await page.getByTestId("complete-sale").click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  const sale = await saved.json();
  expect(sale.payment).toEqual({ method: "split", cashPiasters: 50000, onlinePiasters: 100000 });
  expect(sale.finalTotalPiasters).toBe(150000);
  expect(salePosts).toBe(1);
  await expect(page.getByText("تم حفظ البيع.")).toBeVisible();
  await page.goto(`${base}/sales`);
  await page.getByLabel("بحث", { exact: true }).fill(sale.reference);
  const saleRow = page.getByTestId("sale-list").getByRole("row").filter({ hasText: "مقسّم" });
  await saleRow.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("sale-detail-region")).toContainText(item.name);
  await capture(page, "sales-detail-split");
  await page.goto(`${base}/returns`);
  await page.locator("#return-lookup").fill(sale.reference);
  await page.getByRole("form", { name: /البحث عن المعاملة الأصلية/ }).getByRole("button", { name: "بحث" }).click();
  const sourceRow = page.getByTestId("return-source-list").getByRole("row").filter({ hasText: sale.reference });
  await sourceRow.getByRole("button", { name: "اختيار" }).click();
  const draft = page.getByRole("form", { name: "إنشاء مسودة إرجاع" });
  await draft.getByLabel(`الكمية المستلمة: ${item.name}`).fill("1");
  await draft.getByLabel(`قابلة للبيع بعد الفحص: ${item.name}`).fill("1");
  await expect(page.getByTestId("refund-suggestion")).toContainText("1500");
  await capture(page, "return-inspection");
  await draft.getByRole("button", { name: "تأكيد استلام وفحص المرتجع" }).click();
  const review = page.getByRole("dialog", { name: "مراجعة المرتجع قبل التأكيد" });
  await expect(review).toContainText(item.name);
  await review.getByRole("button", { name: "تأكيد المرتجع", exact: true }).click();
  await expect(page.getByTestId("return-details")).toContainText("الاسترداد النقدي مستحق");
  const batches = await api(page, "GET", "/api/internal/inventory/batches");
  expect(batches.body.find((batch: { variantId: string }) => batch.variantId === item.operationalVariantId).remainingQuantity).toBe(2);
  await capture(page, "return-posted");
});
test("receiving correction preserves uncertain attempt until the same payload succeeds once", async ({ page }) => {
  await signIn(page);
  const first = await createProduct(page);
  const second = await createProduct(page);
  const createReceipt = async (productId: string) => api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: warehouse, receiptDate: cairoDate(),
    lines: [{ productId, quantity: 2, unitCostPiasters: 40000 }],
  });
  const original = await createReceipt(first.id);
  const other = await createReceipt(second.id);
  expect(original.status, JSON.stringify(original.body)).toBe(201);
  expect(other.status, JSON.stringify(other.body)).toBe(201);

  await page.goto(`${base}/receiving?tab=history`);
  const history = page.getByTestId("receipt-list");
  const firstRow = history.getByRole("row").filter({ hasText: first.code });
  const secondRow = history.getByRole("row").filter({ hasText: second.code });
  await firstRow.getByRole("button", { name: "عرض التفاصيل" }).click();
  const details = page.getByTestId("receipt-details");
  await details.getByRole("button", { name: "تصحيح الإذن" }).click();
  const correction = page.getByRole("form", { name: "تصحيح إذن الاستلام" });
  await correction.getByLabel("سبب التصحيح").fill("تصحيح فاتورة اختبار");
  await correction.getByLabel("الكمية", { exact: true }).fill("3");
  await correction.getByLabel("تكلفة الشراء بالجنيه").fill("45");

  const attempts: Array<{ operationId: string; [key: string]: unknown }> = [];
  await page.route(`**/api/internal/receiving/receipts/${original.body.id}/corrections`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.abort("connectionreset");
    return route.continue();
  });
  await correction.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(correction.getByRole("status")).toContainText("نتيجة التصحيح غير مؤكدة");
  await expect(correction.getByLabel("سبب التصحيح")).toBeDisabled();
  await expect(correction.getByLabel("الكمية", { exact: true })).toBeDisabled();
  await expect(correction.getByLabel("تكلفة الشراء بالجنيه")).toBeDisabled();
  await expect(correction.getByRole("button", { name: "إلغاء" })).toBeDisabled();
  await page.getByRole("button", { name: "إغلاق تفاصيل الإذن" }).click();
  await expect(page.getByRole("alert")).toContainText("نتيجة التصحيح غير مؤكدة");
  await expect(correction).toBeVisible();
  await secondRow.getByRole("button", { name: "عرض التفاصيل" }).click();
  await expect(page.getByRole("alert")).toContainText("نتيجة التصحيح غير مؤكدة");
  await expect(details).toContainText(first.code);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await expect(correction).toBeHidden();
  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  await expect(correction.getByRole("status")).toContainText("نتيجة التصحيح غير مؤكدة");
  await expect(correction.getByLabel("الكمية", { exact: true })).toHaveValue("3");
  await expect(correction.getByLabel("تكلفة الشراء بالجنيه")).toHaveValue("45");

  const before = await api(page, "GET", `/api/internal/receiving/receipts/${original.body.id}`);
  expect(before.status, JSON.stringify(before.body)).toBe(200);
  expect(before.body.corrections).toHaveLength(0);
  expect(before.body.lines[0].effectiveQuantity).toBe(2);
  await correction.getByRole("button", { name: "إعادة محاولة التصحيح" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ تصحيح إذن الاستلام" })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].operationId).toBeTruthy();
  expect(attempts[1]).toEqual(attempts[0]);
  const after = await api(page, "GET", `/api/internal/receiving/receipts/${original.body.id}`);
  expect(after.status, JSON.stringify(after.body)).toBe(200);
  expect(after.body.corrections).toHaveLength(1);
  expect(after.body.lines[0].effectiveQuantity).toBe(3);
  expect(after.body.lines[0].effectiveUnitCostPiasters).toBe(4500);
  const batches = await api(page, "GET", "/api/internal/inventory/batches");
  expect(batches.status, JSON.stringify(batches.body)).toBe(200);
  expect(batches.body.find((batch: { variantId: string }) => batch.variantId === first.operationalVariantId).remainingQuantity).toBe(3);
});
async function signIn(page: Page, user = "owner", password = "e2e-owner-pass") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/login`);
  await page.getByLabel("اسم الدخول").fill(user);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function createProduct(page: Page) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف اختبار ${suffix}` });
  const size = await api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس اختبار ${suffix}` });
  const color = await api(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون اختبار ${suffix}` });
  const code = `REF-${suffix}`;
  const name = `منتج اختبار ${suffix}`;
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code, nameAr: name, descriptionAr: "", categoryId: category.body.id,
    defaultSellingPricePiasters: 150000, minimumSellingPricePiasters: null,
    publication: "available", imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  return { id: product.body.id as string, variantId: product.body.variants[0].id as string, operationalVariantId: product.body.operationalVariantId as string, code, name };
}

async function stockAtBranch(page: Page, productId: string, branchId: string, quantity: number) {
  const receipt = await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: warehouse, receiptDate: cairoDate(),
    lines: [{ productId, quantity, unitCostPiasters: 40000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const transfer = await api(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(), sourceBranchId: warehouse, destinationBranchId: branchId, productId, quantity,
  });
  expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
}

async function api(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${base}${url}`, { method, headers: { origin: base, ...(payload ? { "content-type": "application/json" } : {}) }, data: payload });
  const body = await response.text();
  return { status: response.status(), body: body ? JSON.parse(body) : null };
}

async function publicApi(page: Page, url: string, payload: unknown) {
  const response = await page.request.post(`${base}${url}`, { headers: { origin: "http://127.0.0.1:3001", "content-type": "application/json" }, data: payload });
  const body = await response.text();
  return { status: response.status(), body: body ? JSON.parse(body) : null };
}

async function inViewport(control: Locator, width: number, height: number) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}

async function capture(page: Page, name: string) {
  await mkdir(visual, { recursive: true });
  try {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {
      message: `No document overflow on ${name} (${page.url()})`,
    }).toBe(true);
  } catch (error) {
    console.error("staff-overflow", await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("main *")].map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: box.left, right: box.right, width: box.width };
      }).filter((box) => box.left < -1 || box.right > innerWidth + 1).slice(0, 15),
    })));
    throw error;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(visual, `${name}-top.png`) });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewport = page.viewportSize()!;
  for (let y = viewport.height; y < height; y += viewport.height) {
    await page.evaluate((offset) => window.scrollTo(0, offset), y);
    await page.screenshot({ path: path.join(visual, `${name}-${y}.png`) });
  }
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
