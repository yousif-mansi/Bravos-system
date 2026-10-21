import { expect, test, type Download, type Page } from "@playwright/test";

test("storefront activity appears as anonymous aggregate counts and stays manager-only", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const product = await seedProduct(page, `ANALYTICS-${crypto.randomUUID().slice(0, 8)}`, 3);
  const nextProduct = await seedProduct(page, `ANALYTICS-NEXT-${crypto.randomUUID().slice(0, 8)}`, 1);
  const day = cairoDate();
  const before = await staffApi(page, "GET", `/api/internal/analytics?from=${day}&to=${day}`);
  expect(before.status).toBe(200);

  const events: Array<Record<string, unknown>> = [];
  const eventCookieHeaders: string[] = [];
  const eventCacheHeaders: string[] = [];
  const recordedOperationIds = new Set<string>();
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== "/api/public/analytics/events" || !response.ok()) return;
    eventCacheHeaders.push(response.headers()["cache-control"] ?? "");
    const payload = response.request().postDataJSON() as { operationId?: string } | null;
    if (payload?.operationId) recordedOperationIds.add(payload.operationId);
  });
  await page.route("**/api/public/analytics/events", async (route) => {
    events.push(route.request().postDataJSON() as Record<string, unknown>);
    eventCookieHeaders.push(route.request().headers()["cookie"] ?? "");
    await route.continue();
  });

  await page.goto("http://127.0.0.1:3001");
  await page.locator(`[data-category-rail="${product.categoryId}"]`).scrollIntoViewIfNeeded();
  await page.getByRole("link", { name: new RegExp(product.nameAr) }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your bag.");
  await page.getByLabel("Primary").getByRole("link", { name: "Shop", exact: true }).click();
  await page.locator(`[data-category-rail="${nextProduct.categoryId}"]`).scrollIntoViewIfNeeded();
  await page.getByRole("link", { name: new RegExp(nextProduct.nameAr) }).click();
  await expect(page.getByRole("heading", { name: nextProduct.nameAr })).toBeVisible();

  await expect.poll(() => new Set(events.map((event) => event.eventType)).size).toBe(3);
  await expect.poll(() => recordedOperationIds.size).toBe(4);
  const visits = events.filter((event) => event.eventType === "visit");
  const productViews = events.filter((event) => event.eventType === "product_view");
  const cartAdditions = events.filter((event) => event.eventType === "cart_addition");
  expect(visits.length).toBeGreaterThan(0);
  expect(new Set(visits.map((event) => event.operationId)).size).toBe(1);
  expect(cartAdditions.length).toBeGreaterThan(0);
  expect(new Set(cartAdditions.map((event) => event.operationId)).size).toBe(1);
  for (const viewedProductId of [product.productId, nextProduct.productId]) {
    const matchingViews = productViews.filter((event) => event.productId === viewedProductId);
    expect(matchingViews.length).toBeGreaterThan(0);
    expect(new Set(matchingViews.map((event) => event.operationId)).size).toBe(1);
  }
  expect(new Set(productViews.map((event) => event.operationId)).size).toBe(2);
  const visit = events.find((event) => event.eventType === "visit")!;
  const productView = events.find((event) => event.eventType === "product_view")!;
  const cartAddition = events.find((event) => event.eventType === "cart_addition")!;
  expect(Object.keys(visit).sort()).toEqual(["eventType", "operationId"]);
  expect(Object.keys(productView).sort()).toEqual(["eventType", "operationId", "productId"]);
  expect(Object.keys(cartAddition).sort()).toEqual(["eventType", "operationId", "productId", "quantity", "variantId"]);
  expect(productView.productId).toBe(product.productId);
  expect(cartAddition).toMatchObject({ productId: product.productId, variantId: product.variantId, quantity: 2 });
  expect(eventCookieHeaders.every((header) => header === "")).toBe(true);
  expect(eventCacheHeaders.every((header) => header.includes("no-store"))).toBe(true);
  const storefrontStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(storefrontStorageKeys.filter((key) => /analytics|visitor|profile/i.test(key))).toEqual([]);
  const cachedPublicEvents = await cachedRequestsMatching(page, "/api/public/analytics/events");
  expect(cachedPublicEvents).toEqual([]);

  const replay = await publicApi(page, "POST", "/api/public/analytics/events", cartAddition);
  expect(replay.status).toBe(200);
  expect(JSON.stringify(replay.body)).not.toMatch(/customer|phone|address|cost|profit|visitor/i);

  const analyticsResponsePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/internal/analytics" && response.request().method() === "GET"
  ));
  await page.goto("http://127.0.0.1:5174/analytics");
  const analyticsResponse = await analyticsResponsePromise;
  expect(analyticsResponse.headers()["cache-control"]).toContain("no-store");
  expect(JSON.stringify(await analyticsResponse.json())).not.toMatch(/customer|phone|address|cost|profit|visitor/i);
  await expect(page.getByRole("heading", { name: "تحليلات المتجر" })).toBeVisible();
  await page.getByLabel("من يوم").fill(day);
  await page.getByLabel("إلى يوم").fill(day);
  await page.getByRole("button", { name: "عرض التحليلات" }).click();
  await expect(page.getByTestId("analytics-period")).toContainText(day);

  const increments: Record<string, number> = {
    visits: 1,
    productViews: 2,
    successfulCartAdditions: 1,
    acceptedOrderSubmissions: 0,
    completedOnlineSales: 0,
  };
  for (const [metric, increment] of Object.entries(increments)) {
    const previous = before.body.metrics[metric].count as number;
    await expect.poll(async () => normalizedInteger(
      await page.getByTestId(`analytics-${metric}`).locator("strong").textContent(),
    )).toBe(previous + increment);
  }
  await expect(page.getByText(/ليست أعداد أشخاص فريدين أو نسب تحويل/)).toBeVisible();
  const internalStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(internalStorageKeys.filter((key) => /analytics|visitor|profile/i.test(key))).toEqual([]);
  const cachedAnalytics = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const opened = await caches.open(name);
      urls.push(...(await opened.keys()).map((request) => request.url));
    }
    return urls.filter((url) => url.includes("/api/internal/analytics"));
  });
  expect(cachedAnalytics).toEqual([]);

  await page.goto("http://127.0.0.1:5174/workspace");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "تحليلات المتجر" })).toHaveCount(0);
  expect((await staffApi(page, "GET", `/api/internal/analytics?from=${day}&to=${day}`)).status).toBe(403);
  expect((await rawDownload(page, `/api/internal/reports/management/export?format=pdf&period=day&date=${day}`)).status()).toBe(403);
  await page.goto("http://127.0.0.1:5174/analytics");
  await expect(page).toHaveURL(/\/workspace$/);

  const signedOut = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/sign-out" && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const signedOutResponse = await signedOut;
  expect(signedOutResponse.ok(), `${signedOutResponse.status()} ${await signedOutResponse.text()}`).toBe(true);
  expect((await staffApi(page, "GET", `/api/internal/analytics?from=${day}&to=${day}`)).status).toBe(401);
  expect((await rawDownload(page, `/api/internal/reports/management/export?format=xlsx&period=day&date=${day}`)).status()).toBe(401);
});

test("manager downloads PDF and Excel from the exact applied report filters", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  const branchId = workspace.body.activeBranch.id as string;
  const employeeId = workspace.body.staff.id as string;
  const product = await seedProduct(page, `EXPORT-${crypto.randomUUID().slice(0, 8)}`, 26);
  for (let index = 0; index < 26; index += 1) {
    const sale = await completePhysicalSale(page, product.variantId);
    expect(sale.status).toBe(201);
  }

  await page.getByRole("link", { name: "التقارير", exact: true }).click();
  await expect(page.getByRole("heading", { name: "تقارير الإدارة" })).toBeVisible();

  const day = cairoDate();
  await page.getByLabel("الفترة", { exact: true }).selectOption("day");
  await page.getByLabel("اليوم", { exact: true }).fill(day);
  await page.getByLabel("الفرع", { exact: true }).selectOption(branchId);
  await page.getByLabel("القناة", { exact: true }).selectOption("physical");
  await page.getByLabel("الموظف", { exact: true }).selectOption(employeeId);
  const reportResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management"
      && url.searchParams.get("period") === "day"
      && url.searchParams.get("date") === day
      && url.searchParams.get("branchId") === branchId
      && url.searchParams.get("channel") === "physical"
      && url.searchParams.get("employeeId") === employeeId
      && url.searchParams.get("detailPage") === "1";
  });
  await page.getByRole("button", { name: "عرض التقرير" }).click();
  expect((await reportResponse).status()).toBe(200);

  const secondPageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management"
      && url.searchParams.get("detailPage") === "2";
  });
  await page.getByRole("button", { name: "الصفحة التالية" }).first().click();
  expect((await secondPageResponse).status()).toBe(200);
  await expect(page.getByText(/صفحة التفاصيل 2/).first()).toBeVisible();

  const appliedFilters = { period: "day", date: day, branchId, channel: "physical", employeeId };
  const pdf = await downloadReport(page, "تنزيل PDF", "pdf", appliedFilters);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);
  await expectUsableDownload(pdf);

  const xlsx = await downloadReport(page, "تنزيل Excel", "xlsx", appliedFilters);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/i);
  await expectUsableDownload(xlsx);
});

test("late analytics and export responses cannot cross an account sign-out", async ({ page, context }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const analyticsGate = gate();
  let analyticsBackendReady: (() => void) | undefined;
  const analyticsReady = new Promise<void>((resolve) => { analyticsBackendReady = resolve; });
  await page.route("**/api/internal/analytics?*", async (route) => {
    const response = await route.fetch();
    analyticsBackendReady?.();
    await analyticsGate.wait;
    try {
      await route.fulfill({ response });
    } catch {
      // Signing out aborts the stale account request before it can be fulfilled.
    }
  });

  await page.goto("http://127.0.0.1:5174/analytics");
  await analyticsReady;
  const accountPage = await context.newPage();
  await accountPage.goto("http://127.0.0.1:5174/workspace");
  await accountPage.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  analyticsGate.release();
  await expect(page.locator("[data-testid^='analytics-']")).toHaveCount(0);
  await accountPage.close();
  await page.unroute("**/api/internal/analytics?*");

  await signIn(page, "owner", "e2e-owner-pass");
  await page.getByRole("link", { name: "التقارير", exact: true }).click();
  await expect(page.getByRole("button", { name: "تنزيل PDF" })).toBeVisible();
  const exportGate = gate();
  let exportBackendReady: (() => void) | undefined;
  const exportReady = new Promise<void>((resolve) => { exportBackendReady = resolve; });
  await page.route("**/api/internal/reports/management/export?*", async (route) => {
    const response = await route.fetch();
    exportBackendReady?.();
    await exportGate.wait;
    try {
      await route.fulfill({ response });
    } catch {
      // Account replacement intentionally cancels this already-rendered private file.
    }
  });

  await page.getByRole("button", { name: "تنزيل PDF" }).click();
  await exportReady;
  const exportAccountPage = await context.newPage();
  await exportAccountPage.goto("http://127.0.0.1:5174/workspace");
  await exportAccountPage.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  const lateDownload = page.waitForEvent("download", { timeout: 1_500 }).then(() => true, () => false);
  exportGate.release();
  expect(await lateDownload).toBe(false);
  await exportAccountPage.close();
});

async function downloadReport(
  page: Page,
  buttonName: string,
  format: "pdf" | "xlsx",
  filters: Record<string, string>,
) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management/export"
      && url.searchParams.get("format") === format;
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["content-type"]).toBe(format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const url = new URL(response.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, format });
  expect(url.searchParams.has("detailPage")).toBe(false);
  expect(url.searchParams.has("detailPageSize")).toBe(false);
  return download;
}

async function expectUsableDownload(download: Download) {
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += Buffer.byteLength(chunk);
  expect(bytes).toBeGreaterThan(100);
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function seedProduct(page: Page, suffix: string, quantity: number) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const nameAr = `منتج تحليلات ${suffix}`;
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: suffix,
    nameAr,
    descriptionAr: "منتج لاختبار التحليلات المجمعة",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20_000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: workspace.body.activeBranch.id,
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 9_000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  return { productId: product.body.id as string, categoryId: category.body.id as string, variantId, nameAr };
}

async function completePhysicalSale(page: Page, variantId: string) {
  return staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    physicallyCompleted: true,
    lines: [{ variantId, quantity: 1 }],
  });
}

async function cachedRequestsMatching(page: Page, path: string) {
  return page.evaluate(async (expectedPath) => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const opened = await caches.open(name);
      urls.push(...(await opened.keys()).map((request) => request.url));
    }
    return urls.filter((url) => new URL(url).pathname === expectedPath);
  }, path);
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

async function publicApi(page: Page, method: "POST", url: string, payload: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:3001", "content-type": "application/json" },
    data: payload,
  });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

function rawDownload(page: Page, url: string) {
  return page.request.get(`http://127.0.0.1:5174${url}`, {
    headers: { origin: "http://127.0.0.1:5174" },
  });
}

function gate() {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release: () => release?.() };
}

function normalizedInteger(text: string | null) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return Number([...(text ?? "")]
    .map((character) => arabicDigits.includes(character) ? String(arabicDigits.indexOf(character)) : character)
    .join("")
    .replace(/[^0-9-]/g, ""));
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
