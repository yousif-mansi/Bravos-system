import { expect, test, type Page } from "@playwright/test";

const STORE = "http://127.0.0.1:3001";
const STAFF = "http://127.0.0.1:5174";

test("delivery areas retry preserves customer fields and reviewed lines use the current price", async ({ page }) => {
  const seeded = await seed(page);
  await addProduct(page, seeded.productId);
  await page.route("**/api/public/checkout/delivery-areas", (route) => route.fulfill({ status: 502, body: "" }), { times: 1 });
  await page.goto(`${STORE}/checkout`);
  const form = checkout(page);
  await form.getByRole("textbox", { name: "الاسم", exact: true }).fill("عميل إعادة المناطق");
  await expect(form.getByRole("alert")).toContainText("تعذر تحميل مناطق التوصيل");
  await form.getByRole("button", { name: "إعادة تحميل مناطق التوصيل" }).click();
  await expect(form.getByRole("combobox", { name: /^منطقة التوصيل/ })).toBeEnabled();
  await expect(form.getByRole("textbox", { name: "الاسم", exact: true })).toHaveValue("عميل إعادة المناطق");
  expect((await staffApi(page, "PATCH", `/api/internal/catalog/products/${seeded.productId}`, {
    ...seeded.productWrite, defaultSellingPricePiasters: 35000,
  })).status).toBe(200);
  await fillCustomer(page, seeded.areaId);
  await form.getByRole("button", { name: "مراجعة السعر" }).click();
  const summary = page.getByRole("complementary", { name: "ملخص منتجات الطلب" });
  await expect.poll(() => moneyText(summary)).toContain("350 ج.م.");
  await expect.poll(() => moneyText(summary)).not.toContain("250 ج.م.");
});

test("synchronous repeated submission keeps one accepted attempt and one order", async ({ page }) => {
  const seeded = await seed(page);
  await prepareCheckout(page, seeded);
  const operations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) operations.push(request.postDataJSON().operationId);
  });
  await checkout(page).evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  expect(operations).toHaveLength(1);
  const attempt = await storedAttempt(page);
  expect(attempt.status).toBe("accepted");
  expect(attempt.request.operationId).toBe(operations[0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  const orders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(orders.body.filter((order: { id: string }) => order.id === attempt.result.orderId)).toHaveLength(1);
});

test("another tab waiting on submission recovers the accepted attempt instead of sending its own quote", async ({ page, context }) => {
  const seeded = await seed(page);
  await prepareCheckout(page, seeded);
  const second = await context.newPage();
  await second.goto(`${STORE}/checkout`);
  await fillCustomer(second, seeded.areaId);
  await checkout(second).getByRole("button", { name: "مراجعة السعر" }).click();
  await expect(checkout(second).getByRole("button", { name: "إرسال طلب التوصيل" })).toBeVisible();
  let release!: () => void;
  let accepted!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const acceptedByServer = new Promise<void>((resolve) => { accepted = resolve; });
  await page.route("**/api/public/checkout/orders", async (route) => {
    const response = await route.fetch();
    accepted();
    await responseGate;
    await route.fulfill({ response });
  }, { times: 1 });
  let secondSubmissions = 0;
  second.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) secondSubmissions += 1;
  });
  await checkout(page).getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await acceptedByServer;
  await checkout(second).evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  release();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(second.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  expect(secondSubmissions).toBe(0);
  expect((await storedAttempt(second)).result.orderId).toBe((await storedAttempt(page)).result.orderId);
});

test("an accepted lost response is recovered even when the runtime now closes ordering", async ({ page }) => {
  const seeded = await seed(page);
  await prepareCheckout(page, seeded);
  await page.route("**/api/public/checkout/orders", async (route) => {
    await route.fetch();
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT" } }) });
  }, { times: 1 });
  await checkout(page).getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("لم نتمكن من معرفة نتيجة الإرسال");
  const pending = await storedAttempt(page);
  expect(pending.status).toBe("pending");
  await page.route("**/api/public/runtime", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ publicOrderingEnabled: false }),
  }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  expect((await storedAttempt(page)).request.operationId).toBe(pending.request.operationId);
});

test("an already used quote retains the uncertain attempt and retry uses the same operation", async ({ page }) => {
  const seeded = await seed(page);
  await prepareCheckout(page, seeded);
  const operations: string[] = [];
  await page.route("**/api/public/checkout/orders", async (route) => {
    operations.push(route.request().postDataJSON().operationId);
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "QUOTE_ALREADY_USED" } }) });
  });
  await checkout(page).getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("تم استخدام مراجعة السعر");
  const pending = await storedAttempt(page);
  expect(pending.status).toBe("pending");
  await checkout(page).getByRole("button", { name: "التحقق من نفس الطلب" }).click();
  await expect.poll(() => operations.length).toBe(2);
  expect(new Set(operations)).toEqual(new Set([pending.request.operationId]));
  expect((await storedAttempt(page)).status).toBe("pending");
});

function checkout(page: Page) { return page.getByRole("form", { name: "بيانات طلب التوصيل" }); }

async function seed(page: Page) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تعافي ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const productWrite = {
    code: `RECOVERY-${suffix}`, nameAr: `قميص تعافي ${suffix}`, descriptionAr: "اختبار تعافي الطلب",
    categoryId: category.body.id, defaultSellingPricePiasters: 25000, publication: "available",
    imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, onlineVisible: true, sellingPricePiastersOverride: null }],
  };
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", productWrite);
  expect(product.status).toBe(201);
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id;
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId,
    receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 10000 }],
  });
  expect(received.status).toBe(201);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", { nameAr: `منطقة ${suffix}`, feePiasters: 2000, active: true });
  expect(area.status).toBe(201);
  return { productId: product.body.id as string, productWrite, areaId: area.body.id as string };
}

async function addProduct(page: Page, productId: string) {
  await page.goto(`${STORE}/products/${productId}`);
  await page.getByRole("button", { name: "أضف إلى السلة" }).click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة");
}

async function fillCustomer(page: Page, areaId: string) {
  const form = checkout(page);
  await form.getByRole("textbox", { name: "الاسم", exact: true }).fill("عميل الاختبار");
  await form.getByRole("textbox", { name: "رقم الموبايل الأساسي", exact: true }).fill("01012345678");
  await form.getByRole("combobox", { name: /^منطقة التوصيل/ }).selectOption(areaId);
  await form.getByRole("textbox", { name: "العنوان بالتفصيل", exact: true }).fill("الفيوم، عنوان الاختبار");
}

async function prepareCheckout(page: Page, seeded: { productId: string; areaId: string }) {
  await addProduct(page, seeded.productId);
  await page.goto(`${STORE}/checkout`);
  await fillCustomer(page, seeded.areaId);
  await checkout(page).getByRole("button", { name: "مراجعة السعر" }).click();
  await expect(checkout(page).getByRole("button", { name: "إرسال طلب التوصيل" })).toBeVisible();
}

async function storedAttempt(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
}

async function moneyText(locator: ReturnType<Page["locator"]>) {
  const digits = "٠١٢٣٤٥٦٧٨٩";
  return [...await locator.textContent() ?? ""].map((char) => digits.includes(char) ? String(digits.indexOf(char)) : char).join("").replace(/[\u200e\u200f]/g, "").replace(/\u00a0/g, " ");
}

async function staffApi(page: Page, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${STAFF}${url}`, {
    method, headers: { origin: STAFF, ...(payload ? { "content-type": "application/json" } : {}) }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
