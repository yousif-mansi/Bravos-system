import { expect, test, type Page } from "@playwright/test";

test("guest reviews configured delivery and discounts while a newer cart item survives the accepted response", async ({ context, page }) => {
  await signInManager(page);
  await page.getByRole("link", { name: "مناطق التوصيل" }).click();
  const areaForm = page.getByRole("form", { name: "بيانات منطقة التوصيل" });
  await areaForm.getByLabel("اسم المنطقة").fill("مدينة الفيوم");
  await areaForm.getByLabel("رسوم التوصيل بالجنيه").fill("25");
  await areaForm.getByLabel("متاحة في صفحة الطلب").check();
  await areaForm.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ منطقة التوصيل");
  const areaRow = page.locator("article").filter({ hasText: "مدينة الفيوم" });
  await areaRow.getByRole("button", { name: "تعديل" }).click();
  await areaForm.getByLabel("رسوم التوصيل بالجنيه").fill("30");
  await areaForm.getByRole("button", { name: "حفظ" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ منطقة التوصيل");
  await expect(page.getByText("30 ج.م. · متاحة", { exact: true })).toBeVisible();
  const listedAreas = await staffApi(page, "GET", "/api/internal/delivery-areas");
  const area = listedAreas.body.find((candidate: { nameAr: string }) => candidate.nameAr === "مدينة الفيوم");
  expect(area).toBeTruthy();
  const catalog = await seedCheckoutProduct(page, "CHECKOUT-E2E-19", 40_000, 2);
  expect((await staffApi(page, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض طلب المتجر",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: cairoDate(),
    endsOn: cairoDate(),
    active: true,
    allowCoupon: true,
    productIds: [catalog.productId],
    categoryIds: [],
  })).status).toBe(201);
  expect((await staffApi(page, "POST", "/api/internal/pricing/coupons", {
    code: "GUEST25",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 2_500,
    startsOn: cairoDate(),
    endsOn: cairoDate(),
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 1,
    productIds: [catalog.productId],
    categoryIds: [],
  })).status).toBe(201);
  const nextCatalog = await seedCheckoutProduct(page, "NEXT-CHECKOUT-E2E-19", 20_000, 2);

  await page.setViewportSize({ width: 390, height: 844 });
  await addPublicProduct(page, catalog.productId);
  await cartLink(page).click();
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await expect(checkout.getByLabel("رقم بديل (اختياري)")).toBeVisible();
  await expect(checkout.getByLabel("علامة مميزة (اختياري)")).toBeVisible();
  await expect(checkout.getByLabel("ملاحظات (اختياري)")).toBeVisible();
  await checkout.getByLabel("منطقة التوصيل").selectOption(area.id);
  await checkout.getByLabel("كود الكوبون (اختياري)").fill("guest25");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();

  const review = page.getByRole("region", { name: "تفاصيل السعر" });
  await expect(review).toContainText("إجمالي المنتجات قبل الخصم");
  await expect.poll(() => normalizedText(review)).toContain("400 ج.م.");
  await expect(review).toContainText("عرض طلب المتجر");
  await expect.poll(() => normalizedText(review)).toContain("50 ج.م.");
  await expect(review).toContainText("GUEST25");
  await expect.poll(() => normalizedText(review)).toContain("25 ج.م.");
  await expect(review).toContainText("رسوم التوصيل");
  await expect.poll(() => normalizedText(review)).toContain("30 ج.م.");
  await expect.poll(() => normalizedText(review)).toContain("355 ج.م.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(checkout.getByLabel("الاسم")).toBeFocused();
  await checkout.getByLabel("الاسم").fill("أحمد حسن");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01001234567");
  await checkout.getByLabel("العنوان بالتفصيل").fill("شارع الجامعة، بجوار المكتبة");

  const operationIds: string[] = [];
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let backendAccepted: (() => void) | undefined;
  const acceptedByBackend = new Promise<void>((resolve) => { backendAccepted = resolve; });
  await page.route("**/api/public/checkout/orders", async (route) => {
    const body = route.request().postDataJSON() as { operationId: string };
    operationIds.push(body.operationId);
    const response = await route.fetch();
    backendAccepted?.();
    await responseGate;
    await route.fulfill({ response });
  }, { times: 1 });
  void checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await acceptedByBackend;

  const recoveryPage = await context.newPage();
  await recoveryPage.setViewportSize({ width: 390, height: 844 });
  await addPublicProduct(recoveryPage, nextCatalog.productId);
  await expect(cartLink(recoveryPage)).toContainText("2");
  releaseResponse?.();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("قيد المراجعة");
  await expect(page.getByText("سيتواصل معك ممثل برافوس عبر واتساب لتأكيد الطلب")).toBeVisible();
  expect(await recoveryPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(cartLink(page)).toContainText("1");
  await expect(cartLink(recoveryPage)).toContainText("1");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(stored.status).toBe("accepted");
  expect(stored.cartCompleted).toBe(true);
  expect(stored.request.operationId).toBe(operationIds[0]);
  expect(stored.request.alternatePhone).toBeUndefined();
  expect(stored.request.landmark).toBeUndefined();
  expect(stored.request.notes).toBeUndefined();

  await recoveryPage.goto("http://127.0.0.1:3001/checkout");
  await expect(recoveryPage.getByRole("form", { name: "بيانات طلب التوصيل" })).toBeVisible();
  await expect(recoveryPage.getByRole("heading", { name: "تم استلام طلبك" })).toHaveCount(0);
  await expect(cartLink(recoveryPage)).toContainText("1");
  await expect(recoveryPage.getByRole("complementary", { name: "ملخص منتجات الطلب" })).toContainText("NEXT-CHECKOUT-E2E-19");
});

test("a server error after acceptance reloads the exact request instead of creating a duplicate", async ({ page }) => {
  await signInManager(page);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: "إطسا",
    feePiasters: 2_500,
    active: true,
  });
  expect(area.status).toBe(201);
  const catalog = await seedCheckoutProduct(page, "REPLAY-CHECKOUT-E2E-19", 25_000, 1);
  await addPublicProduct(page, catalog.productId);
  await page.goto("http://127.0.0.1:3001/checkout");
  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await checkout.getByLabel("الاسم").fill("سارة علي");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01221234567");
  await checkout.getByLabel("منطقة التوصيل").selectOption(area.body.id);
  await checkout.getByLabel("العنوان بالتفصيل").fill("إطسا، شارع المركز");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();

  let acceptedOperationId = "";
  await page.route("**/api/public/checkout/orders", async (route) => {
    acceptedOperationId = (route.request().postDataJSON() as { operationId: string }).operationId;
    await route.fetch();
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "CONFLICT", messageAr: "انقطع الرد بعد حفظ الطلب." } }),
    });
  }, { times: 1 });
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("لم نتمكن من معرفة نتيجة الإرسال");
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(pending.status).toBe("pending");
  expect(pending.request.operationId).toBe(acceptedOperationId);

  expect((await staffApi(page, "PUT", `/api/internal/delivery-areas/${area.body.id}`, {
    nameAr: "إطسا",
    feePiasters: 9_000,
    active: true,
  })).status).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect.poll(() => normalizedText(page.locator(".success-total"))).toContain("275 ج.م.");
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.status).toBe("accepted");
  expect(accepted.request.operationId).toBe(acceptedOperationId);
  expect(accepted.result.quote.deliveryFeePiasters).toBe(2_500);
});

test("changed delivery pricing and a later stock shortage cannot submit an old reviewed total", async ({ page }) => {
  await signInManager(page);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: "سنورس",
    feePiasters: 2_000,
    active: true,
  });
  expect(area.status).toBe(201);
  const catalog = await seedCheckoutProduct(page, "STALE-CHECKOUT-E2E-19", 30_000, 2);

  await addPublicProduct(page, catalog.productId, 2);
  await page.goto("http://127.0.0.1:3001/checkout");
  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await checkout.getByLabel("الاسم").fill("منى محمود");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01111234567");
  await checkout.getByLabel("منطقة التوصيل").selectOption(area.body.id);
  await checkout.getByLabel("العنوان بالتفصيل").fill("ميدان سنورس، عمارة ٤");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  await expect.poll(() => normalizedText(page.getByRole("region", { name: "تفاصيل السعر" }))).toContain("620 ج.م.");

  expect((await staffApi(page, "PUT", `/api/internal/delivery-areas/${area.body.id}`, {
    nameAr: "سنورس",
    feePiasters: 4_000,
    active: true,
  })).status).toBe(200);
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("تغيّر السعر أو رسوم التوصيل");
  await expect(checkout.getByRole("button", { name: "إرسال طلب التوصيل" })).toHaveCount(0);
  await expect(checkout.getByLabel("الاسم")).toHaveValue("منى محمود");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  await expect.poll(() => normalizedText(page.getByRole("region", { name: "تفاصيل السعر" }))).toContain("640 ج.م.");

  const sold = await completePhysicalSale(page, catalog.variantId, 1);
  expect(sold.status).toBe(201);
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("الكمية المطلوبة غير متاحة حالياً");
  await expect(cartLink(page)).toContainText("2");
  await expect(checkout.getByLabel("الاسم")).toHaveValue("منى محمود");
});

test("closed public ordering keeps the cart and shows the Arabic closure screen", async ({ page }) => {
  await signInManager(page);
  const catalog = await seedCheckoutProduct(page, "CLOSED-ORDERING-E2E-28", 30_000, 1);
  await addPublicProduct(page, catalog.productId);
  await expect(cartLink(page)).toContainText("1");

  await page.route("**/api/public/runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicOrderingEnabled: false }),
    });
  });
  for (const url of ["**/api/public/checkout/quote", "**/api/public/checkout/orders"]) {
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "PUBLIC_ORDERING_DISABLED", messageAr: "الطلب عبر المتجر غير متاح حالياً." },
        }),
      });
    });
  }

  await page.goto("http://127.0.0.1:3001/checkout");
  await expect(page.getByRole("heading", { name: "الطلب عبر المتجر غير متاح حالياً" })).toBeVisible();
  await expect(page.getByText("يمكنك تصفح المنتجات والاحتفاظ بما أضفته إلى السلة")).toBeVisible();
  await expect(page.getByRole("form", { name: "بيانات طلب التوصيل" })).toHaveCount(0);
  await page.getByRole("link", { name: "عرض السلة" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(cartLink(page)).toContainText("1");
  await expect(page.getByText(/CLOSED-ORDERING-E2E-28/)).toBeVisible();
});

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function seedCheckoutProduct(page: Page, code: string, pricePiasters: number, quantity: number) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${code}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${code}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: `قميص ${code}`,
    descriptionAr: "منتج لاختبار إتمام طلب التوصيل",
    categoryId: category.body.id,
    defaultSellingPricePiasters: pricePiasters,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id as string;
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 10_000 }],
  })).status).toBe(201);
  return { productId: product.body.id as string, variantId };
}

async function addPublicProduct(page: Page, productId: string, quantity = 1) {
  await page.goto(`http://127.0.0.1:3001/products/${productId}`);
  if (quantity !== 1) await page.getByLabel("الكمية").fill(String(quantity));
  await page.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
}

async function completePhysicalSale(page: Page, variantId: string, quantity: number) {
  return staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    physicallyCompleted: true,
    lines: [{ variantId, quantity }],
  });
}

async function staffApi(page: Page, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
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

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function normalizedText(locator: ReturnType<Page["locator"]>) {
  const text = await locator.textContent() ?? "";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return [...text]
    .map((character) => arabicDigits.includes(character) ? String(arabicDigits.indexOf(character)) : character)
    .join("")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\u00a0/g, " ");
}

function cartLink(page: Page) {
  return page.locator('.store-nav a[href="/cart"]');
}
