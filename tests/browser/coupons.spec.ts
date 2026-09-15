import { expect, test, type Browser, type Page } from "@playwright/test";

const ACTIVE_START = "2020-01-01";
const ACTIVE_END = "2099-12-31";

test("manager creates a coupon and cashier can apply, remove, reapply, and complete it", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const catalog = await seedProduct(page, "COUPON-E2E", "كوبون متصفح", 30_000, 5);

  await page.getByRole("link", { name: "العروض" }).click();
  const form = page.getByRole("form", { name: "إنشاء كوبون" });
  await form.getByLabel("كود الكوبون").fill("browser50");
  await form.getByLabel("حد الاستخدام").fill("5");
  await form.getByLabel("الخصم بالجنيه").fill("50");
  await form.getByLabel("من تاريخ (القاهرة)").fill(ACTIVE_START);
  await form.getByLabel("إلى تاريخ (القاهرة)").fill(ACTIVE_END);
  await form.getByRole("checkbox", { name: /COUPON-E2E/ }).check();
  await form.getByRole("checkbox", { name: "مفعل", exact: true }).check();
  await form.getByRole("button", { name: "حفظ الكوبون" }).click();
  await expect(page.getByRole("status")).toContainText("تم إنشاء الكوبون.");
  await expect(page.getByTestId("coupon-row").filter({ hasText: "browser50" })).toContainText("استخدم 0 من 5");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  await page.goto("http://127.0.0.1:5174/offers");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("link", { name: "العروض" })).toHaveCount(0);
  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);

  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  const couponInput = checkout.getByLabel("كود الكوبون (يتطلب اتصالاً)");
  const productLookupRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/internal/catalog/lookup") productLookupRequests.push(request.url());
  });
  await couponInput.fill("browser50");
  await couponInput.press("Enter");
  await expect(checkout.getByTestId("sale-cart")).toContainText(catalog.code);
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  expect(productLookupRequests).toEqual([]);
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("coupon-breakdown")).toContainText("browser50 — 50 ج.م.");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 250 ج.م.");

  await couponInput.fill("");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("coupon-breakdown")).toHaveCount(0);
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 300 ج.م.");

  await couponInput.fill("BROWSER50");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("coupon-breakdown")).toContainText("50 ج.م.");
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  await expect(page.getByTestId("sale-coupon")).toContainText("browser50 — 50 ج.م.");
  await expect(page.getByTestId("sale-details")).toContainText("الإجمالي: 250 ج.م.");
  await expect.poll(async () => (await staffApi(page, "GET", "/api/internal/sales")).body.some((sale: {
    lines: Array<{ variant: { product: { code: string } } }>;
  }) => sale.lines.some((line) => line.variant.product.code === catalog.code))).toBe(true);
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.syncStatus).toBe("acknowledged");
});

test("a last-use conflict keeps the paid cashier sale locally with exact coupon values and a visible error", async ({ browser, page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const catalog = await seedProduct(page, "COUPON-LIMIT-E2E", "حد كوبون متصفح", 20_000, 4);
  const coupon = await staffApi(page, "POST", "/api/internal/pricing/coupons", {
    code: "ONLY-ONE-E2E",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: ACTIVE_START,
    endsOn: ACTIVE_END,
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 1,
    productIds: [catalog.productId],
    categoryIds: [],
  });
  expect(coupon.status).toBe(201);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await page.getByLabel("كود الكوبون (يتطلب اتصالاً)").fill("ONLY-ONE-E2E");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("coupon-breakdown")).toContainText("ONLY-ONE-E2E — 50 ج.م.");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 150 ج.م.");

  const manager = await managerPage(browser);
  try {
    const competing = {
      saleId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      couponCode: "ONLY-ONE-E2E",
      employeeDiscountPiasters: 0,
      lines: [{ variantId: catalog.variantId, quantity: 1 }],
    };
    expect((await staffApi(manager, "POST", "/api/internal/sales/prepare", competing)).status).toBe(201);
    expect((await staffApi(manager, "POST", "/api/internal/sales", { ...competing, physicallyCompleted: true })).status).toBe(201);
  } finally {
    await manager.context().close();
  }

  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  await expect(page.getByTestId("sale-coupon")).toContainText("ONLY-ONE-E2E — 50 ج.م.");
  await expect(page.getByRole("alert").filter({ hasText: "بلغ الكوبون الحد الأقصى للاستخدام." })).toContainText(
    "البيع المكتمل محفوظ محلياً وسيظل ضمن المبيعات غير المرسلة.",
  );

  const local = await readLocalCouponSale(page, catalog.code);
  expect(local).toMatchObject({
    syncStatus: "pending",
    couponCode: "ONLY-ONE-E2E",
    couponDiscountPiasters: 5_000,
    finalTotalPiasters: 15_000,
    physicallyCompleted: true,
  });
  expect(local.appliedCoupon).toMatchObject({ id: coupon.body.id, code: "ONLY-ONE-E2E", discountPiasters: 5_000 });
  expect(local.lines[0]).toMatchObject({ couponDiscountPiasters: 5_000, paidPiasters: 15_000 });
  const central = await staffApi(page, "GET", `/api/internal/sales/operations/${local.operationId}`);
  expect(central.status).toBe(200);
  expect(central.body.physicallyCompleted).toBe(false);
  expect(central.body.appliedCoupon).toEqual(local.appliedCoupon);
});

async function managerPage(browser: Browser) {
  const context = await browser.newContext({ locale: "ar-EG" });
  const page = await context.newPage();
  await signIn(page, "owner", "e2e-owner-pass");
  return page;
}

async function signIn(page: Page, loginName: string, password: string, navigate = true) {
  if (navigate) await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function seedProduct(page: Page, code: string, label: string, price: number, quantity: number) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${label}` });
  const sizeName = `مقاس ${label}`;
  const colorName = `لون ${label}`;
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: sizeName });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: colorName });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: `منتج ${label}`,
    descriptionAr: "اختبار كوبون المتصفح",
    categoryId: category.body.id,
    defaultSellingPricePiasters: price,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id as string;
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 5_000 }],
  })).status).toBe(201);
  return { code, productId: product.body.id as string, variantId, sizeName, colorName };
}

async function addProduct(page: Page, code: string, sizeName: string, colorName: string) {
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: sizeName });
  await page.getByLabel("اللون").selectOption({ label: colorName });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
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

async function readLocalCouponSale(page: Page, productCode: string) {
  return page.evaluate(async (code) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readonly");
    const rows = await new Promise<any[]>((resolve, reject) => {
      const request = tx.objectStore("sales").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.find((sale) => sale.lines.some((line: any) => line.variant.product.code === code));
  }, productCode);
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
