import { expect, test, type Page } from "@playwright/test";

const STAFF = "http://127.0.0.1:5174";
const STORE = "http://127.0.0.1:3001";

// All business fixtures use the fresh database started by playwright.config.ts.
test("collection heading follows category and clearing filters restores the category anchor", async ({ page }, testInfo) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "TITLE");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${STORE}/?category=${product.category.id}`);
  await expect(page.getByRole("heading", { name: product.category.nameAr, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Products", exact: true }).locator("a.product-card")).toHaveCount(1);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Remove category: ${product.category.nameAr}`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Clear category", exact: true }).click();
  const catalogTitle = page.locator("#catalog-title");
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  await expect(page).toHaveURL(`${STORE}/#catalog-title`);
  await expect.poll(async () => catalogTitle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector(".store-header")!.getBoundingClientRect();
    const margin = 24;
    const gap = box.top - header.bottom;
    const style = getComputedStyle(element);
    return {
      href: location.pathname + location.search + location.hash,
      scrollY: window.scrollY,
      top: box.top,
      bottom: box.bottom,
      viewportHeight: window.innerHeight,
      inView: box.top >= 0 && box.bottom <= window.innerHeight,
      headerHeight: Math.round(header.height),
      scrollMargin: Math.round(Number.parseFloat(style.scrollMarginTop)),
      paddingTop: Math.round(Number.parseFloat(style.paddingTop)),
      clearsHeader: gap >= margin,
    };
  })).toMatchObject({
    href: "/#catalog-title",
    inView: true,
    headerHeight: 64,
    scrollMargin: 88,
    paddingTop: 0,
    clearsHeader: true,
  });
  const place = await catalogTitle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { href: location.pathname + location.search + location.hash, scrollY: window.scrollY, top: box.top, bottom: box.bottom, viewportHeight: window.innerHeight };
  });
  expect(place.top, JSON.stringify(place)).toBeGreaterThanOrEqual(0);
  expect(place.bottom, JSON.stringify(place)).toBeLessThanOrEqual(place.viewportHeight);
  await expect(catalogTitle).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("category-anchor-390.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await catalogTitle.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect.poll(() => catalogTitle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector(".store-header")!.getBoundingClientRect();
    const margin = 24;
    const gap = box.top - header.bottom;
    const style = getComputedStyle(element);
    return {
      headerHeight: Math.round(header.height),
      scrollMargin: Math.round(Number.parseFloat(style.scrollMarginTop)),
      paddingTop: Math.round(Number.parseFloat(style.paddingTop)),
      clearsHeader: gap >= margin,
      inView: box.top >= 0 && box.bottom <= window.innerHeight,
    };
  })).toEqual({ headerHeight: 72, scrollMargin: 96, paddingTop: 0, clearsHeader: true, inView: true });
  await expect(catalogTitle).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("category-anchor-1440.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goBack();
  await expect(page).toHaveURL(`${STORE}/?category=${product.category.id}`);
  await expect(page.locator("#catalog-title")).toHaveText(product.category.nameAr);
  await page.goForward();
  await expect(page).toHaveURL(`${STORE}/#catalog-title`);
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  for (const categoryId of ["stale-category", crypto.randomUUID()]) {
    await page.goto(`${STORE}/?category=${categoryId}`);
    await expect(page.getByRole("region", { name: "Products", exact: true })).toHaveCount(0);
    await expect(page.locator("#catalog-title")).toHaveText("Unavailable category");
    await expect(page.getByRole("heading", { name: "No matching products", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Remove category: Unavailable category", exact: true })).toBeVisible();
    const recovery = page.getByRole("link", { name: "Categories", exact: true });
    await expect(recovery).toHaveAttribute("href", "/#catalog-title");
    await expect(page.getByRole("link", { name: "Clear category", exact: true })).toBeVisible();
    await recovery.click();
    await expect(page).toHaveURL(`${STORE}/#catalog-title`);
    await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  }
});

test("invalid cart explains repair before disabled customer fields on mobile", async ({ page }) => {
  const fixture = await setup(page);
  const product = await createProduct(page, fixture.suffix, "INVALID");
  await receive(page, fixture.a, product.variants[0].id);
  await addProduct(page, product.id);
  await page.goto(`${STORE}/checkout`);
  await page.getByLabel("Name", { exact: false }).fill("عميل محفوظ");
  // A second tab updates the cart using its existing shared browser storage contract.
  const otherTab = await page.context().newPage();
  await otherTab.goto(`${STORE}/cart`);
  await expect(otherTab.locator(".cart-line")).toHaveCount(1);
  await expect(otherTab.getByRole("button", { name: "Refresh product details" })).toBeEnabled();
  await otherTab.evaluate(() => {
    const key = "bravos-guest-cart-v1";
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, revision: crypto.randomUUID(), items: stored.items.map((item: object) => ({ ...item, orderable: false })) }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const notice = page.getByRole("alert").filter({ hasText: "Update the bag before checkout" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Edit bag" })).toHaveAttribute("href", "/cart");
  await expect(page.getByLabel("Name", { exact: false })).toBeDisabled();
  await expect(page.getByLabel("Name", { exact: false })).toHaveValue("عميل محفوظ");
  await expect(page.getByRole("button", { name: "Review price", exact: true })).toBeDisabled();
  expect((await notice.boundingBox())!.y).toBeLessThan((await page.locator("fieldset").first().boundingBox())!.y);
  await notice.getByRole("link", { name: "Edit bag" }).click();
  await expect(page).toHaveURL(`${STORE}/cart`);
  await page.getByRole("link", { name: "Continue shopping" }).click();
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
  const form = page.getByRole("form", { name: "Checkout" });
  const optionalDetails = form.locator("details").filter({
    has: form.page().locator("summary", { hasText: "Optional delivery details" }),
  });
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await form.getByLabel("Name", { exact: false }).fill("عميل اختبار");
  await form.getByLabel("Primary mobile number").fill("01012345678");
  await form.getByLabel("Detailed address").fill("شارع الاختبار");
  await form.getByLabel("Delivery").selectOption(fixture.areaId);
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await form.getByLabel("Alternate number (optional)").fill("01212345678");
  await form.getByLabel("Landmark (optional)").fill("بجوار المكتبة");
  await form.getByLabel("Notes (optional)").fill("الاتصال قبل التوصيل");
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("Alternate number (optional)")).toHaveValue("01212345678");
  await expect(form.getByLabel("Landmark (optional)")).toHaveValue("بجوار المكتبة");
  await expect(form.getByLabel("Notes (optional)")).toHaveValue("الاتصال قبل التوصيل");
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await form.getByLabel("Coupon code (optional)").fill(couponCode);
  const before = await savedCart(page);
  const rejected = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await form.getByRole("button", { name: "Review price", exact: true }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("INSUFFICIENT_STOCK");
  const notice = page.getByRole("alert").filter({ hasText: "These choices cannot all be supplied together" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Edit bag" })).toHaveAttribute("href", "/cart");
  await expect(form.getByLabel("Name", { exact: false })).toHaveValue("عميل اختبار");
  await expect(form.getByLabel("Primary mobile number")).toHaveValue("01012345678");
  await expect(form.getByLabel("Detailed address")).toHaveValue("شارع الاختبار");
  await expect(form.getByLabel("Delivery")).toHaveValue(fixture.areaId);
  expect(await savedCart(page)).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("bravos-guest-checkout-v1"))).toBeNull();
  await expect(form.getByRole("button", { name: "Place order request" })).toHaveCount(0);
  const context = form.locator('[aria-label="Preliminary order summary"]');
  await expect(context).toContainText("Before discounts and the delivery fee");
  expect((await context.boundingBox())!.y).toBeLessThan((await form.locator("fieldset").first().boundingBox())!.y);
  await notice.getByRole("link", { name: "Edit bag" }).click();
  await expect(page.getByRole("heading", { name: "Bag", exact: true })).toBeVisible();
  await page.locator(".cart-line").filter({ hasText: y.nameAr }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await expect(form.getByLabel("Name", { exact: false })).toHaveValue("عميل اختبار");
  await expect(form.getByLabel("Primary mobile number")).toHaveValue("01012345678");
  await expect(form.getByLabel("Detailed address")).toHaveValue("شارع الاختبار");
  await expect(form.getByLabel("Delivery")).toHaveValue(fixture.areaId);
  await expect(form.getByLabel("Alternate number (optional)")).toBeVisible();
  await expect(form.getByLabel("Alternate number (optional)")).toHaveValue("01212345678");
  await expect(form.getByLabel("Landmark (optional)")).toHaveValue("بجوار المكتبة");
  await expect(form.getByLabel("Notes (optional)")).toHaveValue("الاتصال قبل التوصيل");
  await expect(form.getByLabel("Coupon code (optional)")).toHaveValue(couponCode);
  await page.screenshot({ path: testInfo.outputPath("populated-return-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(optionalDetails).toHaveJSProperty("open", true);
  await page.screenshot({ path: testInfo.outputPath("populated-return-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await optionalDetails.locator("summary").click();
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("Alternate number (optional)")).toHaveValue("01212345678");
  await expect(page.getByRole("region", { name: "Price details" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Place order request" })).toHaveCount(0);
  expect((await savedCart(page)).items).toMatchObject([{ variantId: x.variants[0].id, quantity: 1 }]);
  const reviewed = page.waitForResponse((response) => response.url().endsWith("/api/public/checkout/quote"));
  await form.getByRole("button", { name: "Review price", exact: true }).click();
  const quoteResponse = await reviewed;
  expect(quoteResponse.status()).toBe(200);
  const quote = await quoteResponse.json();
  expect(quote.lines).toMatchObject([{ variantId: x.variants[0].id, quantity: 1 }]);
  await expect(page.getByRole("region", { name: "Price details" })).toBeVisible();
  const submitted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders"));
  await form.getByRole("button", { name: "Place order request" }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.request).toMatchObject({
    alternatePhone: "01212345678",
    landmark: "بجوار المكتبة",
    notes: "الاتصال قبل التوصيل",
  });
  // A new basket in the same navigation session must not inherit accepted customer data.
  await page.getByRole("link", { name: "Back to the store", exact: true }).click();
  await expect(page).toHaveURL(`${STORE}/`);
  await page.getByRole("navigation", { name: "Filter by category" })
    .getByRole("link", { name: x.category.nameAr, exact: true }).click();
  await page.locator(`a.product-card[href="/products/${x.id}"]`).click();
  await page.locator('[aria-label="Add product to bag"]').getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("Added to your bag.");
  await page.getByRole("banner").locator('a[href="/cart"]').click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(form.getByLabel("Name", { exact: false })).toHaveValue("");
  await expect(form.getByLabel("Primary mobile number")).toHaveValue("");
  await expect(form.getByLabel("Detailed address")).toHaveValue("");
  await expect(form.getByLabel("Delivery")).toHaveValue("");
  await expect(form.getByLabel("Alternate number (optional)")).toHaveValue("");
  await expect(form.getByLabel("Landmark (optional)")).toHaveValue("");
  await expect(form.getByLabel("Notes (optional)")).toHaveValue("");
  await expect(form.getByLabel("Coupon code (optional)")).toHaveValue("");
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  await expect(form.getByLabel("Alternate number (optional)")).toBeHidden();
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
    const notice = page.getByRole("alert").filter({ hasText: "No delivery areas are available right now" });
    await expect(notice).toBeVisible();
    await expect(page.getByLabel("Name", { exact: false })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Review price", exact: true })).toBeDisabled();
    expect((await notice.boundingBox())!.y).toBeLessThan((await page.locator("fieldset").first().boundingBox())!.y);
    await notice.getByRole("link", { name: "Back to bag" }).click();
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
  await page.locator(".purchase-panel").getByRole("button", { name: "Add to bag" }).click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("Added to your bag.");
}

async function savedCart(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null")); }
async function staffApi(page: Page, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${STAFF}${url}`, { method, headers: { origin: STAFF }, data: payload });
  return { status: response.status(), body: await response.json() };
}
