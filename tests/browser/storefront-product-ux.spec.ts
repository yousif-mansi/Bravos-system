import { expect, test, type Page } from "@playwright/test";

const STAFF = "http://127.0.0.1:5174";
const STORE = "http://127.0.0.1:3001";

// All business fixtures use the fresh database started by playwright.config.ts.
test("collection heading follows category and search, and clearing filters returns to all products", async ({ page }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "TITLE");
  await page.goto(`${STORE}/?category=${product.category.id}`);
  await expect(page.getByRole("heading", { name: product.category.nameAr, exact: true })).toBeVisible();
  await page.goto(`${STORE}/?category=${product.category.id}&q=${encodeURIComponent(product.nameAr)}`);
  await expect(page.getByRole("heading", { name: `نتائج البحث عن «${product.nameAr}» في ${product.category.nameAr}`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "إزالة التصنيف:" , exact: false }).click();
  await expect(page.getByRole("heading", { name: `نتائج البحث عن «${product.nameAr}»`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "مسح كل التصفية" }).click();
  await expect(page.getByRole("heading", { name: "كل المنتجات", exact: true })).toBeVisible();
  await page.goto(`${STORE}/?category=stale-category`);
  await expect(page.getByRole("heading", { name: "كل المنتجات", exact: true })).toBeVisible();
});

test("invalid cart explains repair before disabled customer fields on mobile", async ({ page }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "INVALID");
  await receive(page, fixture.a, product.variants[0].id);
  await addProduct(page, product.id);
  await page.goto(`${STORE}/checkout`);
  await page.getByLabel("الاسم", { exact: false }).fill("عميل محفوظ");
  // A second tab updates the cart using its existing shared browser storage contract.
  const otherTab = await page.context().newPage();
  await otherTab.goto(`${STORE}/cart`);
  await expect(otherTab.locator(".cart-line")).toHaveCount(1);
  await expect(otherTab.getByRole("button", { name: "تحديث بيانات المنتجات" })).toBeEnabled();
  await otherTab.evaluate(() => {
    const key = "bravos-guest-cart-v1";
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, revision: crypto.randomUUID(), items: stored.items.map((item: object) => ({ ...item, orderable: false })) }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const notice = page.getByRole("alert").filter({ hasText: "عدّل السلة قبل إتمام الطلب" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "تعديل السلة" })).toHaveAttribute("href", "/cart");
  await expect(page.getByLabel("الاسم", { exact: false })).toBeDisabled();
  await expect(page.getByLabel("الاسم", { exact: false })).toHaveValue("عميل محفوظ");
  await expect(page.getByRole("button", { name: "مراجعة السعر", exact: true })).toBeDisabled();
  expect((await notice.boundingBox())!.y).toBeLessThan((await page.locator("fieldset").first().boundingBox())!.y);
  await notice.getByRole("link", { name: "تعديل السلة" }).click();
  await expect(page).toHaveURL(`${STORE}/cart`);
  await page.getByRole("link", { name: "متابعة التسوق" }).click();
  await expect(page).toHaveURL(`${STORE}/#catalog-title`);
  await otherTab.close();
});

test("stock repair roundtrip retains the checkout draft and requires a fresh quote", async ({ page }, testInfo) => {
  const fixture = await setup(page);
  const x = await createProduct(page, fixture.suffix, "X");
  const y = await createProduct(page, fixture.suffix, "Y");
  await receive(page, fixture.a, x.variants[0].id);
  await receive(page, fixture.b, y.variants[0].id);
  const couponCode = `UX-${fixture.suffix.toUpperCase()}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  expect((await staffApi(page, "POST", "/api/internal/pricing/coupons", {
    code: couponCode, discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 1000,
    startsOn: today, endsOn: today, active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [x.id], categoryIds: [],
  })).status).toBe(201);
  await addProduct(page, x.id);
  await addProduct(page, y.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${STORE}/checkout`);
  const form = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  const optionalDetails = form.locator("details").filter({
    has: form.page().locator("summary", { hasText: "تفاصيل إضافية للتوصيل (اختياري)" }),
  });
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await form.getByLabel("الاسم", { exact: false }).fill("عميل اختبار");
  await form.getByLabel("رقم الموبايل الأساسي").fill("01012345678");
  await form.getByLabel("العنوان بالتفصيل").fill("شارع الاختبار");
  await form.getByLabel("منطقة التوصيل").selectOption(fixture.areaId);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await form.getByLabel("رقم بديل (اختياري)").fill("01212345678");
  await form.getByLabel("علامة مميزة (اختياري)").fill("بجوار المكتبة");
  await form.getByLabel("ملاحظات (اختياري)").fill("الاتصال قبل التوصيل");
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("رقم بديل (اختياري)")).toHaveValue("01212345678");
  await expect(form.getByLabel("علامة مميزة (اختياري)")).toHaveValue("بجوار المكتبة");
  await expect(form.getByLabel("ملاحظات (اختياري)")).toHaveValue("الاتصال قبل التوصيل");
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await form.getByLabel("كود الكوبون (اختياري)").fill(couponCode);
  const before = await savedCart(page);
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await form.getByRole("button", { name: "مراجعة السعر", exact: true }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("INSUFFICIENT_STOCK");
  const notice = page.getByRole("alert").filter({ hasText: "تعذر توفير اختيارات السلة كاملة معاً" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "تعديل السلة" })).toHaveAttribute("href", "/cart");
  await expect(form.getByLabel("الاسم", { exact: false })).toHaveValue("عميل اختبار");
  await expect(form.getByLabel("رقم الموبايل الأساسي")).toHaveValue("01012345678");
  await expect(form.getByLabel("العنوان بالتفصيل")).toHaveValue("شارع الاختبار");
  await expect(form.getByLabel("منطقة التوصيل")).toHaveValue(fixture.areaId);
  expect(await savedCart(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("bravos-guest-checkout-v1"))).toBeNull();
  await expect(form.getByRole("button", { name: "إرسال طلب التوصيل" })).toHaveCount(0);
  const context = form.locator('[aria-label="ملخص الطلب المبدئي"]');
  await expect(context).toContainText("قبل الخصومات ورسوم التوصيل");
  expect((await context.boundingBox())!.y).toBeLessThan((await form.locator("fieldset").first().boundingBox())!.y);
  await notice.getByRole("link", { name: "تعديل السلة" }).click();
  await expect(page.getByRole("heading", { name: "سلة التسوق", exact: true })).toBeVisible();
  await page.locator(".cart-line").filter({ hasText: y.nameAr }).getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await expect(form.getByLabel("الاسم", { exact: false })).toHaveValue("عميل اختبار");
  await expect(form.getByLabel("رقم الموبايل الأساسي")).toHaveValue("01012345678");
  await expect(form.getByLabel("العنوان بالتفصيل")).toHaveValue("شارع الاختبار");
  await expect(form.getByLabel("منطقة التوصيل")).toHaveValue(fixture.areaId);
  await expect(form.getByLabel("رقم بديل (اختياري)")).toBeVisible();
  await expect(form.getByLabel("رقم بديل (اختياري)")).toHaveValue("01212345678");
  await expect(form.getByLabel("علامة مميزة (اختياري)")).toHaveValue("بجوار المكتبة");
  await expect(form.getByLabel("ملاحظات (اختياري)")).toHaveValue("الاتصال قبل التوصيل");
  await expect(form.getByLabel("كود الكوبون (اختياري)")).toHaveValue(couponCode);
  await page.screenshot({ path: testInfo.outputPath("populated-return-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await page.screenshot({ path: testInfo.outputPath("populated-return-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("رقم بديل (اختياري)")).toHaveValue("01212345678");
  await expect(page.getByRole("region", { name: "تفاصيل السعر" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "إرسال طلب التوصيل" })).toHaveCount(0);
  expect((await savedCart(page)).items).toMatchObject([{ variantId: x.variants[0].id, quantity: 1 }]);
  const reviewed = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await form.getByRole("button", { name: "مراجعة السعر", exact: true }).click();
  const quoteResponse = await reviewed;
  expect(quoteResponse.status()).toBe(200);
  const quote = await quoteResponse.json();
  expect(quote.lines).toMatchObject([{ variantId: x.variants[0].id, quantity: 1 }]);
  await expect(page.getByRole("region", { name: "تفاصيل السعر" })).toBeVisible();
  const submitted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders"));
  await form.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.request).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  // A new basket in the same navigation session must not inherit accepted customer data.
  await page.getByRole("link", { name: "العودة إلى المتجر", exact: true }).click();
  await page.locator(`a.product-card[href="/products/${x.id}"]`).click();
  await page.locator('[aria-label="إضافة المنتج إلى السلة"]').getByRole("button", { name: "أضف إلى السلة", exact: true }).click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
  await page.getByRole("banner").locator('a[href="/cart"]').click();
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();
  await expect(form.getByLabel("الاسم", { exact: false })).toHaveValue("");
  await expect(form.getByLabel("رقم الموبايل الأساسي")).toHaveValue("");
  await expect(form.getByLabel("العنوان بالتفصيل")).toHaveValue("");
  await expect(form.getByLabel("منطقة التوصيل")).toHaveValue("");
  await expect(form.getByLabel("رقم بديل (اختياري)")).toHaveValue("");
  await expect(form.getByLabel("علامة مميزة (اختياري)")).toHaveValue("");
  await expect(form.getByLabel("ملاحظات (اختياري)")).toHaveValue("");
  await expect(form.getByLabel("كود الكوبون (اختياري)")).toHaveValue("");
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("رقم بديل (اختياري)")).toBeHidden();
});

test("missing delivery areas explain the blocked decision before customer fields", async ({ page }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "AREAS");
  await receive(page, fixture.a, product.variants[0].id);
  await addProduct(page, product.id);
  const listed = await staffApi(page, "GET", "/api/internal/delivery-areas");
  const active = listed.body.filter((area: { active: boolean }) => area.active);
  try {
    for (const area of active) expect((await staffApi(page, "PUT", `/api/internal/delivery-areas/${area.id}`, { nameAr: area.nameAr, feePiasters: area.feePiasters, active: false })).status).toBe(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STORE}/checkout`);
    const notice = page.getByRole("alert").filter({ hasText: "لا توجد مناطق توصيل متاحة حالياً" });
    await expect(notice).toBeVisible();
    await expect(page.getByLabel("الاسم", { exact: false })).toBeDisabled();
    await expect(page.getByRole("button", { name: "مراجعة السعر", exact: true })).toBeDisabled();
    expect((await notice.boundingBox())!.y).toBeLessThan((await page.locator("fieldset").first().boundingBox())!.y);
    await notice.getByRole("link", { name: "العودة إلى السلة" }).click();
    await expect(page).toHaveURL(`${STORE}/cart`);
  } finally {
    for (const area of active) expect((await staffApi(page, "PUT", `/api/internal/delivery-areas/${area.id}`, { nameAr: area.nameAr, feePiasters: area.feePiasters, active: true })).status).toBe(200);
  }
});

async function setup(page: Page) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const branches = workspace.body.authorizedBranches as Array<{ id: string; code: string }>;
  const suffix = crypto.randomUUID().slice(0, 8);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", { nameAr: `منطقة تجربة ${suffix}`, feePiasters: 2000, active: true });
  expect(area.status).toBe(201);
  return { suffix, areaId: area.body.id as string, a: branches.find((branch) => branch.code === "abshway")!.id, b: branches.find((branch) => branch.code === "fayoum")!.id };
}

async function createProduct(page: Page, suffix: string, label: string) {
  const code = `UX-${label}-${suffix}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${code}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${code}` });
  for (const response of [category, size, color]) expect(response.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code, nameAr: `قميص ${code}`, descriptionAr: "منتج اختبار تجربة العميل", categoryId: category.body.id,
    defaultSellingPricePiasters: 25000, publication: "available", imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null, onlineVisible: true }],
  });
  expect(product.status).toBe(201);
  return product.body;
}

async function receive(page: Page, branchId: string, variantId: string) {
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId,
    receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    lines: [{ variantId, quantity: 1, unitCostPiasters: 10000 }],
  })).status).toBe(201);
}

async function addProduct(page: Page, productId: string) {
  await page.goto(`${STORE}/products/${productId}`);
  await page.locator(".purchase-panel").getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
}

async function savedCart(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null")); }
async function staffApi(page: Page, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${STAFF}${url}`, { method, headers: { origin: STAFF }, data: payload });
  return { status: response.status(), body: await response.json() };
}
