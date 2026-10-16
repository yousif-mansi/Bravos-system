import { expect, test, type Page } from "@playwright/test";
import type { CheckoutQuoteDto } from "@bravos/contracts/public";
import { expectTargetSize, tabTo } from "./support/storefront-a11y";

const STORE = "http://127.0.0.1:3001";
const STAFF = "http://127.0.0.1:5174";

test("a delayed failed price review preserves the checkout and keyboard retry never submits an order", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seed(page);
  const second = await seed(page, true);
  const couponCode = `RETRY${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  expect((await staffApi(page, "POST", "/api/internal/pricing/coupons", {
    code: couponCode, discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 1000,
    startsOn: today, endsOn: today, active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [seeded.productId], categoryIds: [],
  })).status).toBe(201);
  await addProduct(page, seeded.productId);
  await addProduct(page, second.productId);
  await page.goto(`${STORE}/cart`);
  const firstLine = page.getByRole("article").filter({ hasText: seeded.productWrite.nameAr });
  await firstLine.getByRole("button", { name: "Increase quantity" }).click();
  await expect(firstLine.locator("output")).toHaveText("2");
  await page.getByRole("link", { name: "Checkout" }).click();
  await fillCustomer(page, seeded.areaId);
  const form = checkout(page);
  const customerName = `عميل إعادة السعر ${couponCode}`;
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(customerName);
  const optionalFields = [
    ["Alternate number (optional)", "01112345678"],
    ["Landmark (optional)", "بجوار مكتبة الاختبار"],
    ["Notes (optional)", "يرجى الاتصال قبل التوصيل"],
    ["Coupon code (optional)", couponCode],
  ] as const;
  const optionalDetails = form.locator("details").filter({
    has: form.page().locator("summary", { hasText: "Optional delivery details" }),
  });
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  for (const [label, value] of optionalFields) await form.getByLabel(label).fill(value);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  for (const [label, value] of optionalFields.slice(0, 3)) await expect(form.getByLabel(label)).toHaveValue(value);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  const summary = page.getByRole("complementary", { name: "Your items" });
  const beforeLines = await summary.getByRole("article").allTextContents();
  expect(beforeLines).toHaveLength(2);
  await expect.poll(() => moneyText(summary.getByRole("article").filter({ hasText: seeded.productWrite.nameAr }))).toContain("2 × EGP 250");
  await expect.poll(() => moneyText(summary.getByRole("article").filter({ hasText: second.productWrite.nameAr }))).toContain("1 × EGP 250");
  const beforeOrders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(beforeOrders.status).toBe(200);
  let orderPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) orderPosts += 1;
  });
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/public/checkout/quote", async (route) => {
    expect(route.request().method()).toBe("POST");
    await responseGate;
    await route.fulfill({ status: 502, body: "" });
  }, { times: 1 });
  const calculating = form.getByText("Reviewing the current price and delivery fee.", { exact: true });
  const submit = form.getByRole("button", { name: "Place order request" });
  await form.getByRole("button", { name: "Review price", exact: true }).click();
  try {
    await expect(calculating).toBeVisible();
    await expect(calculating).toHaveAttribute("aria-live", "polite");
    await expect(form.getByRole("button", { name: "Reviewing the price…", exact: true })).toBeDisabled();
    await expect(submit).toHaveCount(0);
    expect(await storedAttempt(page)).toBeNull();
    expect(orderPosts).toBe(0);
  } finally {
    release();
  }
  await expect(form.getByRole("alert")).toHaveText("The price could not be reached. No order request was sent.");
  await expect(calculating).toHaveCount(0);
  const retry = form.getByRole("button", { name: "Review price", exact: true });
  await expect(retry).toBeEnabled();
  await expect(submit).toHaveCount(0);
  expect(await summary.getByRole("article").allTextContents()).toEqual(beforeLines);
  await assertCustomerPreserved();
  await assertNoOrder();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("checkout-quote-error-390.png"), fullPage: true });

  // The cart still has its earlier display price; retry must use the real current quote.
  expect((await staffApi(page, "PATCH", `/api/internal/catalog/products/${seeded.productId}`, {
    ...seeded.productWrite, defaultSellingPricePiasters: 35000,
  })).status).toBe(200);
  await expectTargetSize(retry);
  await tabTo(page, retry);
  const quoteResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/public/checkout/quote") && response.status() === 200);
  await page.keyboard.press("Enter");
  const quote = await (await quoteResponse).json() as CheckoutQuoteDto;
  expect(quote.lines.map(({ productId, quantity }) => ({ productId, quantity }))).toEqual(expect.arrayContaining([
    { productId: seeded.productId, quantity: 2 }, { productId: second.productId, quantity: 1 },
  ]));
  expect(quote.lines).toHaveLength(2);
  expect(quote.merchandiseOriginalPiasters).toBe(95000);
  expect(quote.deliveryFeePiasters).toBe(2000);
  expect(quote.appliedCoupon?.code).toBe(couponCode);
  expect(quote.couponDiscountPiasters).toBe(1000);
  const review = form.getByRole("region", { name: "Price details" });
  for (const [label, piasters] of [
    ["Merchandise total before discount", quote.merchandiseOriginalPiasters],
    ["Merchandise total after discount", quote.merchandiseTotalPiasters],
    [`Delivery fee to ${quote.area.nameAr}`, quote.deliveryFeePiasters],
    ["Cash on delivery total", quote.finalTotalPiasters],
  ] as const) {
    await expect.poll(() => moneyText(review.locator("p").filter({ has: page.getByText(label, { exact: true }) }).locator("strong"))).toBe(`${formatEgp(piasters)}`);
  }
  await expect.poll(() => moneyText(summary.getByRole("article").filter({ hasText: seeded.productWrite.nameAr }))).toContain("2 × EGP 350");
  await expect.poll(() => moneyText(summary.getByRole("article").filter({ hasText: second.productWrite.nameAr }))).toContain("1 × EGP 250");
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect(calculating).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await assertCustomerPreserved();
  await assertNoOrder();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("checkout-quote-recovered-390.png"), fullPage: true });

  async function assertCustomerPreserved() {
    await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(customerName);
    await expect(form.getByRole("textbox", { name: "Primary mobile number", exact: true })).toHaveValue("01012345678");
    await expect(form.getByRole("combobox", { name: /^Delivery/ })).toHaveValue(seeded.areaId);
    await expect(form.getByRole("textbox", { name: "Detailed address", exact: true })).toHaveValue("الفيوم، عنوان الاختبار");
    for (const [label, value] of optionalFields) await expect(form.getByLabel(label)).toHaveValue(value);
  }

  async function assertNoOrder() {
    expect(orderPosts).toBe(0);
    expect(await storedAttempt(page)).toBeNull();
    await expect(page.getByRole("heading", { name: "Order request received", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Order request already received", exact: true })).toHaveCount(0);
    const orders = await staffApi(page, "GET", "/api/internal/online-orders");
    expect(orders.status).toBe(200);
    expect(orders.body.map((order: { id: string }) => order.id).sort()).toEqual(beforeOrders.body.map((order: { id: string }) => order.id).sort());
  }
});

test("delivery areas retry preserves customer fields and reviewed lines use the current price", async ({ page }) => {
  const seeded = await seed(page);
  await addProduct(page, seeded.productId);
  await page.route("**/api/public/checkout/delivery-areas", (route) => route.fulfill({ status: 502, body: "" }), { times: 1 });
  await page.goto(`${STORE}/checkout`);
  const form = checkout(page);
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("عميل إعادة المناطق");
  await expect(form.getByRole("alert")).toHaveText("Delivery areas could not be loaded. Your details stay on this page. Try again.");
  const reloadAreas = form.getByRole("button", { name: "Reload delivery areas" });
  await expectTargetSize(reloadAreas);
  await tabTo(page, reloadAreas);
  await page.keyboard.press("Enter");
  await expect(form.getByRole("combobox", { name: /^Delivery/ })).toBeEnabled();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("عميل إعادة المناطق");
  expect((await staffApi(page, "PATCH", `/api/internal/catalog/products/${seeded.productId}`, {
    ...seeded.productWrite, defaultSellingPricePiasters: 35000,
  })).status).toBe(200);
  await fillCustomer(page, seeded.areaId);
  await form.getByRole("button", { name: "Review price" }).click();
  const summary = page.getByRole("complementary", { name: "Your items" });
  await expect.poll(() => moneyText(summary)).toContain("EGP 350");
  await expect.poll(() => moneyText(summary)).not.toContain("EGP 250");
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
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  expect(operations).toHaveLength(1);
  const attempt = await storedAttempt(page);
  expect(attempt.status).toBe("accepted");
  expect(attempt.request.operationId).toBe(operations[0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order request already received", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("This order request was already received and was not submitted again. This receipt does not establish its current status.");
  const orders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(orders.body.filter((order: { id: string }) => order.id === attempt.result.orderId)).toHaveLength(1);
});

test("another tab waiting on submission recovers the accepted attempt instead of sending its own quote", async ({ page, context }) => {
  const seeded = await seed(page);
  await prepareCheckout(page, seeded);
  const second = await context.newPage();
  await second.goto(`${STORE}/checkout`);
  await fillCustomer(second, seeded.areaId);
  await checkout(second).getByRole("button", { name: "Review price" }).click();
  await expect(checkout(second).getByRole("button", { name: "Place order request" })).toBeVisible();
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
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  await acceptedByServer;
  await checkout(second).evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  release();
  await expect(page.getByRole("heading", { name: "Order request received", exact: true })).toBeVisible();
  await expect(second.getByRole("heading", { name: "Order request already received", exact: true })).toBeVisible();
  await expect(second.getByRole("status")).toHaveText("This order request was already received and was not submitted again. This receipt does not establish its current status.");
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
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("We could not tell the result of this send");
  const pending = await storedAttempt(page);
  expect(pending.status).toBe("pending");
  await page.route("**/api/public/runtime", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ publicOrderingEnabled: false }),
  }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order request already received", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("This order request was already received and was not submitted again. This receipt does not establish its current status.");
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
  await checkout(page).getByRole("button", { name: "Place order request" }).click();
  await expect(page.locator('.checkout-message[role="alert"]')).toContainText("This price review was already used");
  const pending = await storedAttempt(page);
  expect(pending.status).toBe("pending");
  await checkout(page).getByRole("button", { name: "Check the same request" }).click();
  await expect.poll(() => operations.length).toBe(2);
  expect(new Set(operations)).toEqual(new Set([pending.request.operationId]));
  expect((await storedAttempt(page)).status).toBe("pending");
});

function checkout(page: Page) { return page.getByRole("form", { name: "Checkout" }); }

async function seed(page: Page, alreadySignedIn = false) {
  if (!alreadySignedIn) {
    await page.goto(`${STAFF}/login`);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
  }
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
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("status")).toContainText("Added");
}

async function fillCustomer(page: Page, areaId: string) {
  const form = checkout(page);
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("عميل الاختبار");
  await form.getByRole("textbox", { name: "Primary mobile number", exact: true }).fill("01012345678");
  await form.getByRole("combobox", { name: /^Delivery/ }).selectOption(areaId);
  await form.getByRole("textbox", { name: "Detailed address", exact: true }).fill("الفيوم، عنوان الاختبار");
}

async function prepareCheckout(page: Page, seeded: { productId: string; areaId: string }) {
  await addProduct(page, seeded.productId);
  await page.goto(`${STORE}/checkout`);
  await fillCustomer(page, seeded.areaId);
  await checkout(page).getByRole("button", { name: "Review price" }).click();
  await expect(checkout(page).getByRole("button", { name: "Place order request" })).toBeVisible();
}

async function storedAttempt(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
}

function formatEgp(piasters: number) {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    currencyDisplay: "code",
    minimumFractionDigits: piasters % 100 === 0 ? 0 : 2,
  }).format(piasters / 100).replace(/\u00a0/g, " ");
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
