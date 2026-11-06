import { openPosOptionalDetails, stageUnpaidPosQuote } from "./support/pos-checkout";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

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
  await form.getByLabel("من تاريخ").fill(ACTIVE_START);
  await form.getByLabel("إلى تاريخ").fill(ACTIVE_END);
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

  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  const couponInput = checkout.getByLabel("كود الكوبون", { exact: true });
  const productLookupRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/internal/catalog/lookup") productLookupRequests.push(request.url());
  });
  await couponInput.fill("browser50");
  await couponInput.press("Enter");
  await expect(checkout.getByTestId("sale-cart")).toContainText(catalog.code);
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  expect(productLookupRequests).toEqual([]);
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByTestId("coupon-breakdown")).toContainText("browser50 — 50 ج.م.");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 250 ج.م.");

  await couponInput.fill("");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("coupon-breakdown")).toHaveCount(0);
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 300 ج.م.");

  await couponInput.fill("BROWSER50");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByTestId("coupon-breakdown")).toContainText("50 ج.م.");
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect(page.getByTestId("sale-coupon")).toContainText("browser50 — 50 ج.م.");
  await expect(page.getByTestId("sale-details")).toContainText("الإجمالي: 250 ج.م.");
  await expect.poll(async () => (await staffApi(page, "GET", "/api/internal/sales")).body.some((sale: {
    lines: Array<{ variant: { product: { code: string } } }>;
  }) => sale.lines.some((line) => line.variant.product.code === catalog.code))).toBe(true);
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.syncStatus).toBe("acknowledged");
});

test("cached offer and coupon prices survive offline completion while usage stays correct across tabs and refresh", async ({ context, page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const catalog = await seedProduct(page, "OFFLINE-PROMO-E2E", "عرض دون اتصال", 30_000, 6);
  expect((await staffApi(page, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض دون اتصال",
    discountType: "percentage",
    percentageBasisPoints: 1_000,
    fixedDiscountPiasters: null,
    startsOn: ACTIVE_START,
    endsOn: ACTIVE_END,
    active: true,
    allowCoupon: true,
    productIds: [catalog.productId],
    categoryIds: [],
  })).status).toBe(201);
  const coupon = await staffApi(page, "POST", "/api/internal/pricing/coupons", {
    code: "OFFLINE-CACHED-50",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: ACTIVE_START,
    endsOn: ACTIVE_END,
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 2,
    productIds: [catalog.productId],
    categoryIds: [],
  });
  expect(coupon.status).toBe(201);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  const secondTab = await context.newPage();
  await secondTab.goto("http://127.0.0.1:5174/lookup");
  await expect(secondTab.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  await context.setOffline(true);
  await completeCachedCouponSale(page, catalog, "OFFLINE-CACHED-50");
  expect((await readLocalCouponSale(page, catalog.code))).toMatchObject({
    syncStatus: "pending",
    automaticOfferDiscountPiasters: 3_000,
    couponDiscountPiasters: 5_000,
    employeeDiscountPiasters: 2_000,
    finalTotalPiasters: 20_000,
  });

  await context.setOffline(false);
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.syncStatus).toBe("acknowledged");
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.couponUsageAccountedSnapshotIssuedAt).toEqual(
    expect.any(String),
  );

  await context.setOffline(true);
  await completeCachedCouponSale(secondTab, catalog, "OFFLINE-CACHED-50");
  expect((await readLocalCouponSale(secondTab, catalog.code))).toMatchObject({ couponDiscountPiasters: 5_000 });

  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  await checkout.getByLabel("كود الكوبون", { exact: true }).fill("OFFLINE-CACHED-50");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("alert")).toContainText("بلغ الكوبون الحد الأقصى للاستخدام.");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
});

test("a Cairo-midnight handover keeps its accepted cached offer while a fresh offline quote expires", async ({ context, page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const catalog = await seedProduct(page, "OFFLINE-BOUNDARY-E2E", "حد العرض الليلي", 30_000, 4);
  expect((await staffApi(page, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض يوم واحد",
    discountType: "percentage",
    percentageBasisPoints: 1_000,
    fixedDiscountPiasters: null,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowCoupon: true,
    productIds: [catalog.productId],
    categoryIds: [],
  })).status).toBe(201);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-09-15T20:59:59.000Z"));
  await context.setOffline(true);

  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByTestId("automatic-offer-breakdown")).toContainText("30 ج.م.");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 270 ج.م.");

  await page.clock.setFixedTime(new Date("2026-09-15T21:00:01.000Z"));
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const accepted = await readLocalCouponSale(page, catalog.code);
  expect(accepted).toMatchObject({
    occurredAt: "2026-09-15T21:00:01.000Z",
    pricingOccurredAt: "2026-09-15T20:59:59.000Z",
    automaticOfferDiscountPiasters: 3_000,
    finalTotalPiasters: 27_000,
  });

  await context.setOffline(false);
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.syncStatus).toBe("acknowledged");
  const central = await staffApi(page, "GET", `/api/internal/sales/operations/${accepted.operationId}`);
  expect(central.status).toBe(200);
  expect(central.body).toMatchObject({
    occurredAt: "2026-09-15T21:00:01.000Z",
    automaticOfferDiscountPiasters: 3_000,
    finalTotalPiasters: 27_000,
  });

  await context.setOffline(true);
  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("automatic-offer-breakdown")).toHaveCount(0);
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 300 ج.م.");
});

test("a last-use race preserves the paid prepared sale and exposes the coupon discrepancy", async ({ browser, page }) => {
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  await page.getByLabel("كود الكوبون", { exact: true }).fill("ONLY-ONE-E2E");
  await checkout.getByTestId("complete-sale").click();
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
    const prepared = await staffApi(manager, "POST", "/api/internal/sales/prepare", competing);
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    expect((await staffApi(manager, "POST", "/api/internal/sales", { ...competing, physicallyCompleted: true })).status).toBe(201);
  } finally {
    await manager.context().close();
  }

  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect(page.getByTestId("sale-coupon")).toContainText("ONLY-ONE-E2E — 50 ج.م.");
  await expect.poll(async () => (await readLocalCouponSale(page, catalog.code))?.syncStatus).toBe("acknowledged");

  const local = await readLocalCouponSale(page, catalog.code);
  expect(local).toMatchObject({
    syncStatus: "acknowledged",
    couponCode: "ONLY-ONE-E2E",
    couponDiscountPiasters: 5_000,
    finalTotalPiasters: 15_000,
    physicallyCompleted: true,
  });
  expect(local.appliedCoupon).toMatchObject({ id: coupon.body.id, code: "ONLY-ONE-E2E", discountPiasters: 5_000 });
  expect(local.lines[0]).toMatchObject({ couponDiscountPiasters: 5_000, paidPiasters: 15_000 });
  const central = await staffApi(page, "GET", `/api/internal/sales/operations/${local.operationId}`);
  expect(central.status).toBe(200);
  expect(central.body.physicallyCompleted).toBe(true);
  expect(central.body.discrepancy.messageAr).toContain("تجاوز حد استخدام الكوبون");
  expect(central.body.appliedCoupon).toEqual(local.appliedCoupon);

  const inspectionPage = await managerPage(browser);
  try {
    const inspected = await staffApi(inspectionPage, "GET", `/api/internal/sales/${local.id}`);
    expect(inspected.body.couponUsageDiscrepancy).toMatchObject({
      couponId: coupon.body.id,
      couponCode: "ONLY-ONE-E2E",
      couponDiscountPiasters: 5_000,
      usageLimit: 1,
      centralUsedCount: 2,
    });
  } finally {
    await inspectionPage.context().close();
  }
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
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
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
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 5_000 }],
  })).status).toBe(201);
  return { code, productId: product.body.id as string, variantId, sizeName, colorName };
}

async function addProduct(page: Page, code: string, sizeName: string, colorName: string) {
  if (new URL(page.url()).pathname !== "/lookup") {
    await page.getByRole("link", { name: "البحث عن منتج" }).click();
  }
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  const codeInput = lookup.getByRole("textbox", { name: "رمز المنتج" });
  const matchingResult = page.getByText(`رمز المنتج: ${code}`, { exact: true });
  if ((await codeInput.inputValue()) !== code || (await matchingResult.count()) === 0) {
    await codeInput.fill(code);
    await lookup.getByRole("button", { name: "بحث" }).click();
    await expect(matchingResult).toBeVisible();
  }
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption({ label: sizeName });
  await expect(page.getByLabel("اللون")).toBeEnabled();
  await page.getByLabel("اللون").selectOption({ label: colorName });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
}

async function completeCachedCouponSale(
  page: Page,
  catalog: { code: string; sizeName: string; colorName: string },
  couponCode: string,
) {
  await addProduct(page, catalog.code, catalog.sizeName, catalog.colorName);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  await checkout.getByLabel("كود الكوبون", { exact: true }).fill(couponCode);
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("20");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByTestId("automatic-offer-breakdown")).toContainText("30 ج.م.");
  await expect(page.getByTestId("coupon-breakdown")).toContainText("50 ج.م.");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 200 ج.م.");
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
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
