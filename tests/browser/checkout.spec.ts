import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { PublicOrderSubmissionDto } from "@bravos/contracts/public";

const acknowledgment = "استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.";

test("guest reviews configured delivery and discounts while a newer cart item survives the accepted response", async ({ context, page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath("checkout-quote-phone-390.png"), fullPage: true });

  const nameInput = checkout.getByLabel("الاسم");
  const primaryPhoneInput = checkout.getByLabel("رقم الموبايل الأساسي");
  const alternatePhoneInput = checkout.getByLabel("رقم بديل (اختياري)");
  const addressInput = checkout.getByLabel("العنوان بالتفصيل");
  expect(await nameInput.getAttribute("required")).not.toBeNull();
  expect(await primaryPhoneInput.getAttribute("required")).not.toBeNull();
  expect(await checkout.getByLabel("منطقة التوصيل").getAttribute("required")).not.toBeNull();
  expect(await addressInput.getAttribute("required")).not.toBeNull();
  expect(await alternatePhoneInput.getAttribute("required")).toBeNull();
  await expect(primaryPhoneInput).toHaveAttribute("type", "tel");
  let invalidSubmitRequests = 0;
  const watchInvalidSubmit = (request: { url(): string; method(): string }) => {
    if (request.method() === "POST" && request.url().includes("/api/public/checkout/orders")) invalidSubmitRequests += 1;
  };
  page.on("request", watchInvalidSubmit);
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveAttribute("aria-invalid", "true");
  const nameErrorId = await nameInput.getAttribute("aria-describedby");
  expect(nameErrorId).toBeTruthy();
  await expect(page.locator(`#${nameErrorId}`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("checkout-invalid-phone-390.png"), fullPage: true });
  expect(invalidSubmitRequests).toBe(0);
  await nameInput.fill("أحمد حسن");
  await expect(nameInput).not.toHaveAttribute("aria-invalid", "true");
  await expect(nameInput).toHaveValue("أحمد حسن");
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(primaryPhoneInput).toBeFocused();
  await expect(primaryPhoneInput).toHaveAttribute("aria-invalid", "true");
  await primaryPhoneInput.fill("01001234567");
  await expect(primaryPhoneInput).not.toHaveAttribute("aria-invalid", "true");
  await expect(primaryPhoneInput).toHaveValue("01001234567");
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(addressInput).toBeFocused();
  await expect(addressInput).toHaveAttribute("aria-invalid", "true");
  await addressInput.fill("شارع الجامعة، بجوار المكتبة");
  await expect(addressInput).not.toHaveAttribute("aria-invalid", "true");
  await expect(addressInput).toHaveValue("شارع الجامعة، بجوار المكتبة");
  expect(invalidSubmitRequests).toBe(0);
  page.off("request", watchInvalidSubmit);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("checkout-quote-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

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
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
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

test("accepted acknowledgment survives staff confirmation and an empty-cart reload", async ({ page }) => {
  await signInManager(page);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: "منطقة إعادة الإقرار", feePiasters: 2_500, active: true,
  });
  expect(area.status).toBe(201);
  const catalog = await seedCheckoutProduct(page, "ACK-CONFIRMED-E2E", 25_000, 1);
  await addPublicProduct(page, catalog.productId);
  await page.goto("http://127.0.0.1:3001/checkout");
  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await fillCheckoutCustomer(checkout, area.body.id);
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  const submissions: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) submissions.push(request.postDataJSON());
  });
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
  const accepted = await storedAttempt(page);
  expect(accepted.status).toBe("accepted");
  expect(accepted.cartCompleted).toBe(true);
  await confirmSubmittedOrder(page, accepted.result.orderId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
  await expect(page.locator(".order-reference strong")).toHaveText(accepted.result.reference);
  await expect.poll(() => normalizedText(page.locator(".success-total"))).toContain("275 ج.م.");
  expect(await storedAttempt(page)).toEqual(accepted);
  expect(submissions).toEqual([accepted.request]);
  await expectCartCompletedOnce(page, accepted.request.operationId);
});

test("a lost acceptance response replays the exact long reference after staff confirmation without a duplicate", async ({ page }, testInfo) => {
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

  await setNextIsolatedOrderReference();
  let acceptedOperationId = "";
  let originalAcknowledgment!: PublicOrderSubmissionDto;
  const submissionRequests: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) submissionRequests.push(request.postDataJSON());
  });
  await page.route("**/api/public/checkout/orders", async (route) => {
    acceptedOperationId = (route.request().postDataJSON() as { operationId: string }).operationId;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    originalAcknowledgment = await response.json();
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
  expect(originalAcknowledgment.reference).toBe("BRV-1000000");
  await confirmSubmittedOrder(page, originalAcknowledgment.orderId);

  expect((await staffApi(page, "PUT", `/api/internal/delivery-areas/${area.body.id}`, {
    nameAr: "إطسا",
    feePiasters: 9_000,
    active: true,
  })).status).toBe(200);
  const replayResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/public/checkout/orders"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const recoveredResponse = await replayResponse;
  expect(recoveredResponse.status()).toBe(200);
  expect(await recoveredResponse.json()).toEqual(originalAcknowledgment);
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
  await expect(page.locator(".order-reference strong")).toHaveText("BRV-1000000");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("checkout-recovered-long-reference-phone-390.png"), fullPage: true });
  await expect.poll(() => normalizedText(page.locator(".success-total"))).toContain("275 ج.م.");
  const accepted = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
  expect(accepted.status).toBe("accepted");
  expect(accepted.request.operationId).toBe(acceptedOperationId);
  expect(accepted.result.quote.deliveryFeePiasters).toBe(2_500);
  expect(accepted.result).toEqual(originalAcknowledgment);
  expect(submissionRequests).toEqual([pending.request, pending.request]);
  await expectCartCompletedOnce(page, acceptedOperationId);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
  await expect(page.locator(".order-reference strong")).toHaveText("BRV-1000000");
  expect(await storedAttempt(page)).toEqual(accepted);
  expect(submissionRequests).toEqual([pending.request, pending.request]);
  await expectCartCompletedOnce(page, acceptedOperationId);
  const orders = await staffApi(page, "GET", "/api/internal/online-orders");
  expect(orders.body.filter((order: { primaryPhone: string }) => order.primaryPhone === pending.request.primaryPhone)).toEqual([
    expect.objectContaining({ id: originalAcknowledgment.orderId, reference: "BRV-1000000", status: "confirmed" }),
  ]);
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
  await expect(page.getByRole("region", { name: "منتجات السلة" }).getByRole("heading", { name: "قميص CLOSED-ORDERING-E2E-28", exact: true })).toBeVisible();
});

async function fillCheckoutCustomer(checkout: ReturnType<Page["getByRole"]>, areaId: string) {
  await checkout.getByLabel("الاسم").fill("عميل الإقرار المحفوظ");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01009876543");
  await checkout.getByLabel("منطقة التوصيل").selectOption(areaId);
  await checkout.getByLabel("العنوان بالتفصيل").fill("الفيوم، شارع الاختبار");
}

async function storedAttempt(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-checkout-v1") ?? "null"));
}

async function expectCartCompletedOnce(page: Page, operationId: string) {
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null"));
  expect(cart.items).toEqual([]);
  expect(cart.completedCheckoutOperationIds).toEqual([operationId]);
  await expect(cartLink(page)).toContainText("0");
}

async function confirmSubmittedOrder(page: Page, orderId: string) {
  const order = await staffApi(page, "GET", `/api/internal/online-orders/${orderId}`);
  expect(order.status).toBe(200);
  const agreementQuote = await staffApi(page, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: order.body.revision,
    lines: order.body.lines.map(({ variantId, requestedQuantity }: { variantId: string; requestedQuantity: number }) => ({ variantId, quantity: requestedQuantity })),
  });
  expect(agreementQuote.status).toBe(201);
  const agreed = await staffApi(page, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreementQuote.body.orderRevision,
    quoteId: agreementQuote.body.quoteId,
    reviewDigest: agreementQuote.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status).toBe(201);
  const confirmed = await staffApi(page, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.agreedRevision.version,
    itemsLocatedAndSetAside: true,
    fulfillmentBranchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
  });
  expect(confirmed.status).toBe(201);
  expect(confirmed.body.status).toBe("confirmed");
}

async function setNextIsolatedOrderReference() {
  // Only the disposable Playwright cluster is eligible; never use a configured development database.
  const controlFile = process.env.BRAVOS_E2E_CONTROL_FILE;
  if (!controlFile || path.dirname(path.resolve(controlFile)) !== path.resolve(".local")) {
    throw new Error("The isolated Playwright control file is required for reference seeding.");
  }
  // Worker config evaluation generates its own unused path. The active stack belongs
  // to the CLI parent that forked this worker, never to another/stale test run.
  process.kill(process.ppid, 0);
  const controlNames = (await readdir(path.resolve(".local"))).filter((name) =>
    new RegExp(`^e2e-control-${process.ppid}-[a-f0-9]{24}\\.json$`, "u").test(name));
  if (controlNames.length !== 1) {
    throw new Error("Expected exactly one isolated control file owned by this Playwright parent.");
  }
  const control = JSON.parse(await readFile(path.resolve(".local", controlNames[0]!), "utf8"));
  expect(control).toMatchObject({ version: 1, apiPort: 3011, databasePort: 55433 });
  if (!Number.isInteger(control.port) || control.port < 1 || control.port > 65_535
    || typeof control.token !== "string" || !/^[a-f0-9]{64}$/u.test(control.token)) {
    throw new Error("Invalid isolated Playwright control contract.");
  }
  const liveControl = await fetch(`http://127.0.0.1:${control.port}/`, { signal: AbortSignal.timeout(3_000) });
  expect(liveControl.status).toBe(404);
  await liveControl.arrayBuffer();
  const pool = new Pool({ host: "127.0.0.1", port: control.databasePort, database: "bravos_e2e", user: "bravos", password: "bravos-test" });
  try {
    const identity = await pool.query("SELECT current_database() AS database, inet_server_port() AS port");
    expect(identity.rows[0]).toEqual({ database: "bravos_e2e", port: 55433 });
    const sequence = await pool.query("SELECT last_value FROM online_order_reference_number_seq");
    expect(Number(sequence.rows[0].last_value)).toBeLessThan(999_999);
    // Advance monotonically: later tests continue above this boundary rather than reusing references.
    await pool.query("SELECT setval('online_order_reference_number_seq',999999,true)");
  } finally {
    await pool.end();
  }
}

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
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
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
