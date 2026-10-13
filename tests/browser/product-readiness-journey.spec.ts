import { expect, test, type Page } from "@playwright/test";
import type { ManagerProductDto, ManagementReportDto, OnlineOrderDto, OnlineOrderAgreementQuoteDto } from "@bravos/contracts";
import type { CheckoutQuoteDto, PublicOrderSubmissionDto, PublicOrderSubmissionRequest, PublicProductDto } from "@bravos/contracts/public";

const STAFF = "http://127.0.0.1:5174";
const STORE = "http://127.0.0.1:3001";

// Run through playwright.config.ts: its e2e-stack creates a fresh disposable
// PostgreSQL database and refuses to reuse servers. Never point this at live data.
// All fixtures and assertions use HTTP, with no database reads or mocked commerce.
test("customer purchase journey leaves pending stock intact and confirms one branch exactly once", async ({ page }) => {
  const fixture = await seedJourney(page);
  const { product, regular, premium, empty, a, b, areaId, suffix } = fixture;
  const beforeReport = await onlineReport(page, a);
  await expectBranchStock(page, product.id, a, regular.id, premium.id, [4, 3]);
  await expectBranchStock(page, product.id, b, regular.id, premium.id, [1, 2]);
  await expectPublicStock(page, product.id, regular.id, premium.id, empty.id, [4, 3]);

  await page.goto(STORE);
  await page.getByLabel("ابحث عن منتج").fill(suffix);
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${suffix}`));
  await page.locator("a.product-card").filter({ hasText: product.nameAr }).click();
  await expect(page.getByRole("heading", { name: product.nameAr })).toBeVisible();
  const panel = page.locator(".purchase-panel");
  await expect(panel.locator(`input[value="${empty.id}"]`)).toBeDisabled();
  await panel.locator(`input[value="${regular.id}"]`).check();
  await expect(panel.getByLabel("الكمية")).toHaveAttribute("max", "4");
  await panel.getByLabel("الكمية").fill("5");
  await expect(panel.getByRole("button", { name: "أضف إلى السلة", exact: true })).toBeDisabled();
  const excessive = await api<{ error: { code: string } }>(page, STORE, "POST", "/api/public/checkout/quote", {
    deliveryAreaId: areaId, lines: [{ variantId: regular.id, quantity: 5 }],
  }, 409);
  expect(excessive.error.code).toBe("INSUFFICIENT_STOCK");
  await panel.getByLabel("الكمية").fill("1");
  await addSelected(page);
  await panel.locator(`input[value="${premium.id}"]`).check();
  await addSelected(page);
  await panel.getByRole("link", { name: "عرض السلة", exact: true }).click();

  const regularLine = page.locator(".cart-line").filter({ hasText: regular.size.nameAr });
  const premiumLine = page.locator(".cart-line").filter({ hasText: premium.size.nameAr });
  const summary = page.getByRole("complementary", { name: "ملخص السلة" });
  await expect(page.locator(".cart-line")).toHaveCount(2);
  await expect(summary).toContainText(`مجموع مبدئي${money(55_000)}`);
  await regularLine.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(regularLine.locator("output")).toHaveText("2");
  await expect(summary).toContainText(`مجموع مبدئي${money(80_000)}`);
  await regularLine.getByRole("button", { name: "زيادة الكمية" }).click();
  await expect(regularLine.locator("output")).toHaveText("3");
  await expect(summary).toContainText(`مجموع مبدئي${money(105_000)}`);
  await regularLine.getByRole("button", { name: "تقليل الكمية" }).click();
  await expect(regularLine.locator("output")).toHaveText("2");
  await premiumLine.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(summary).toContainText(`مجموع مبدئي${money(50_000)}`);
  await regularLine.getByRole("link", { name: product.nameAr }).click();
  await panel.locator(`input[value="${premium.id}"]`).check();
  await addSelected(page);
  await panel.getByRole("link", { name: "عرض السلة", exact: true }).click();
  await expect(page.locator(".cart-line")).toHaveCount(2);
  await expect(regularLine.locator("output")).toHaveText("2");
  await expect(premiumLine.locator("output")).toHaveText("1");
  await expect(summary).toContainText(`مجموع مبدئي${money(80_000)}`);
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();

  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  for (const name of ["customerName", "primaryPhone", "deliveryAreaId", "detailedAddress"]) {
    await expect(checkout.locator(`[name="${name}"]`)).toHaveAttribute("required", "");
  }
  await checkout.getByLabel("منطقة التوصيل").selectOption(areaId);
  const quoteResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/public/checkout/quote" && response.request().method() === "POST");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  const quoted = await quoteResponse;
  expect(quoted.status()).toBe(200);
  const quote = await quoted.json() as CheckoutQuoteDto;
  expectPublicSafe(quote);
  // Independent arithmetic: 2 x 250 + 1 x 300 = 800; fixture delivery 25 = 825 EGP.
  expect(quote).toMatchObject({
    merchandiseOriginalPiasters: 80_000, automaticOfferDiscountPiasters: 0,
    couponDiscountPiasters: 0, merchandiseTotalPiasters: 80_000,
    deliveryFeePiasters: 2_500, finalTotalPiasters: 82_500,
  });
  expect(quote.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ variantId: regular.id, quantity: 2, listedUnitPricePiasters: 25_000, merchandiseTotalPiasters: 50_000 }),
    expect.objectContaining({ variantId: premium.id, quantity: 1, listedUnitPricePiasters: 30_000, merchandiseTotalPiasters: 30_000 }),
  ]));
  expect(quote.lines).toHaveLength(2);
  const review = page.getByRole("region", { name: "تفاصيل السعر" });
  await expect(review.getByText("إجمالي المنتجات بعد الخصم").locator("..")).toContainText(money(80_000));
  await expect(review.getByText(`رسوم التوصيل إلى ${fixture.areaName}`).locator("..")).toContainText(money(2_500));
  await expect(review.getByText("الإجمالي عند الاستلام").locator("..")).toContainText(money(82_500));

  let submissions = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/public/checkout/orders" && request.method() === "POST") submissions += 1;
  });
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  for (const name of ["customerName", "primaryPhone", "detailedAddress"]) {
    await expect(checkout.locator(`[name="${name}"]`)).toHaveAttribute("aria-invalid", "true");
  }
  expect(submissions).toBe(0);
  await checkout.getByLabel("الاسم").fill("عميل رحلة المخزون");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01012345678");
  await checkout.getByLabel("العنوان بالتفصيل").fill("الفيوم، شارع رحلة الاختبار، منزل ١");
  const submissionResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/public/checkout/orders" && response.request().method() === "POST");
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  const submitted = await submissionResponse;
  expect(submitted.status()).toBe(201);
  const accepted = await submitted.json() as PublicOrderSubmissionDto;
  const acceptedCommand = submitted.request().postDataJSON() as PublicOrderSubmissionRequest;
  expect(accepted.status).toBe("pending");
  expect(accepted.quote).toEqual(quote);
  expectPublicSafe(accepted);
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.");
  await expect(page.locator(".success-total")).toContainText(money(82_500));
  expect(submissions).toBe(1);
  const savedCart = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null"));
  expect(savedCart.items).toEqual([]);
  expect(savedCart.completedCheckoutOperationIds).toEqual([acceptedCommand.operationId]);

  await expectBranchStock(page, product.id, a, regular.id, premium.id, [4, 3]);
  await expectBranchStock(page, product.id, b, regular.id, premium.id, [1, 2]);
  await expectPublicStock(page, product.id, regular.id, premium.id, empty.id, [4, 3]);
  expect((await onlineReport(page, a)).summary).toEqual(beforeReport.summary);
  const pending = await api<OnlineOrderDto>(page, STAFF, "GET", `/api/internal/online-orders/${accepted.orderId}`, undefined, 200);
  expect(pending).toMatchObject({ status: "pending", fulfillmentBranchId: null, requestedFinalTotalPiasters: 82_500 });

  // Staff records the unchanged customer-agreed quote before physical set-aside.
  const agreedQuote = await api<OnlineOrderAgreementQuoteDto>(page, STAFF, "POST", `/api/internal/online-orders/${accepted.orderId}/agreement-quotes`, {
    expectedRevision: pending.revision,
    lines: [{ variantId: regular.id, quantity: 2 }, { variantId: premium.id, quantity: 1 }],
  }, 201);
  expect(agreedQuote).toMatchObject({ merchandiseTotalPiasters: 80_000, deliveryFeePiasters: 2_500, finalTotalPiasters: 82_500 });
  const agreed = await api<OnlineOrderDto>(page, STAFF, "POST", `/api/internal/online-orders/${accepted.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(), expectedRevision: pending.revision, quoteId: agreedQuote.quoteId,
    reviewDigest: agreedQuote.reviewDigest, customerAgreed: true,
  }, 201);
  expect(agreed.agreedRevision).not.toBeNull();
  const confirmation = {
    operationId: crypto.randomUUID(), expectedRevision: agreed.revision,
    agreedRevision: agreed.agreedRevision!.version, fulfillmentBranchId: a, itemsLocatedAndSetAside: true,
  };
  const confirmed = await api<OnlineOrderDto>(page, STAFF, "POST", `/api/internal/online-orders/${accepted.orderId}/confirm`, confirmation, 201);
  expect(confirmed).toMatchObject({ status: "confirmed", fulfillmentBranchId: a, confirmedQuote: { finalTotalPiasters: 82_500 } });
  await expectBranchStock(page, product.id, a, regular.id, premium.id, [2, 2]);
  await expectBranchStock(page, product.id, b, regular.id, premium.id, [1, 2]);
  await expectPublicStock(page, product.id, regular.id, premium.id, empty.id, [2, 2]);
  const recognized = await onlineReport(page, a);
  expect(recognized.summary.completedCount).toBe(beforeReport.summary.completedCount + 1);
  expect(recognized.summary.grossMerchandiseSalesPiasters).toBe(beforeReport.summary.grossMerchandiseSalesPiasters + 80_000);
  expect(recognized.summary.grossFinalSalesPiasters).toBe(beforeReport.summary.grossFinalSalesPiasters + 82_500);
  expect(recognized.completedSales.filter((sale) => sale.source.id === accepted.orderId)).toEqual([
    expect.objectContaining({ channel: "online", branch: expect.objectContaining({ id: a }), effectiveMerchandisePiasters: 80_000, effectiveFinalPiasters: 82_500 }),
  ]);

  const replay = await api<OnlineOrderDto>(page, STAFF, "POST", `/api/internal/online-orders/${accepted.orderId}/confirm`, confirmation, 200);
  expect(replay).toEqual(confirmed);
  const publicReplay = await api<PublicOrderSubmissionDto>(page, STORE, "POST", "/api/public/checkout/orders", acceptedCommand, 200);
  expect(publicReplay).toEqual(accepted);
  expectPublicSafe(publicReplay);
  await expectBranchStock(page, product.id, a, regular.id, premium.id, [2, 2]);
  await expectBranchStock(page, product.id, b, regular.id, premium.id, [1, 2]);
  expect((await onlineReport(page, a)).summary).toEqual(recognized.summary);
});

async function seedJourney(page: Page) {
  await page.goto(`${STAFF}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  const workspace = await api<{ authorizedBranches: Array<{ id: string; code: string }> }>(page, STAFF, "GET", "/api/internal/workspace", undefined, 200);
  const a = workspace.authorizedBranches.find((branch) => branch.code === "abshway")!.id;
  const b = workspace.authorizedBranches.find((branch) => branch.code === "fayoum")!.id;
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await api<{ id: string }>(page, STAFF, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف الرحلة ${suffix}` }, 201);
  const color = await api<{ id: string }>(page, STAFF, "POST", "/api/internal/catalog/colors", { nameAr: `أسود رحلة ${suffix}` }, 201);
  const sizes: Array<{ id: string }> = [];
  for (const size of ["M", "L", "XL"]) {
    sizes.push(await api<{ id: string }>(page, STAFF, "POST", "/api/internal/catalog/sizes", { nameAr: `${size} رحلة ${suffix}` }, 201));
  }
  const product = await api<ManagerProductDto>(page, STAFF, "POST", "/api/internal/catalog/products", {
    code: `PURCHASE-${suffix}`, nameAr: `قميص رحلة المخزون ${suffix}`, descriptionAr: "منتج رحلة شراء معزولة",
    categoryId: category.id, defaultSellingPricePiasters: 25_000, publication: "available", imageRefs: [], sizeGuideAr: null,
    variants: sizes.map((size, index) => ({ sizeId: size.id, colorId: color.id, onlineVisible: true, sellingPricePiastersOverride: index === 1 ? 30_000 : null })),
  }, 201);
  const regular = product.variants.find((variant) => variant.size.id === sizes[0]!.id)!;
  const premium = product.variants.find((variant) => variant.size.id === sizes[1]!.id)!;
  const empty = product.variants.find((variant) => variant.size.id === sizes[2]!.id)!;
  for (const [branchId, quantities] of [[a, [4, 3]], [b, [1, 2]]] as const) {
    await api(page, STAFF, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), branchId, receiptDate: cairoDate(),
      lines: [{ variantId: regular.id, quantity: quantities[0], unitCostPiasters: 10_000 }, { variantId: premium.id, quantity: quantities[1], unitCostPiasters: 12_000 }],
    }, 201);
  }
  // This isolated area's fee is intentionally independent of live configuration.
  const areaName = `منطقة رحلة المخزون ${suffix}`;
  const area = await api<{ id: string }>(page, STAFF, "POST", "/api/internal/delivery-areas", { nameAr: areaName, feePiasters: 2_500, active: true }, 201);
  return { product, regular, premium, empty, a, b, areaId: area.id, areaName, suffix };
}

async function addSelected(page: Page) {
  const panel = page.locator(".purchase-panel");
  await panel.getByRole("button", { name: "أضف إلى السلة", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
}

async function expectBranchStock(page: Page, productId: string, branchId: string, regularId: string, premiumId: string, quantities: [number, number]) {
  await api(page, STAFF, "POST", "/api/internal/active-branch", { branchId }, 200);
  const snapshot = await api<Array<{ id: string; variants: Array<{ id: string; availableQuantity: number }> }>>(page, STAFF, "GET", "/api/internal/catalog/pos-snapshot", undefined, 200);
  const product = snapshot.find((item) => item.id === productId);
  expect(product).toBeTruthy();
  expect(product!.variants.find((variant) => variant.id === regularId)?.availableQuantity).toBe(quantities[0]);
  expect(product!.variants.find((variant) => variant.id === premiumId)?.availableQuantity).toBe(quantities[1]);
}

async function expectPublicStock(page: Page, productId: string, regularId: string, premiumId: string, emptyId: string, quantities: [number, number]) {
  const product = await api<PublicProductDto>(page, STORE, "GET", `/api/public/catalog/products/${productId}`, undefined, 200);
  expectPublicSafe(product);
  expect(product.variants.find((variant) => variant.id === regularId)).toMatchObject({ availableQuantity: quantities[0], orderable: true });
  expect(product.variants.find((variant) => variant.id === premiumId)).toMatchObject({ availableQuantity: quantities[1], orderable: true });
  expect(product.variants.find((variant) => variant.id === emptyId)).toMatchObject({ availableQuantity: 0, orderable: false });
}

async function onlineReport(page: Page, branchId: string) {
  return api<ManagementReportDto>(page, STAFF, "GET", `/api/internal/reports/management?period=day&date=${cairoDate()}&channel=online&branchId=${branchId}&detailPageSize=100`, undefined, 200);
}

function expectPublicSafe(value: unknown) {
  if (Array.isArray(value)) value.forEach(expectPublicSafe);
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      expect(key, `public response key ${key}`).not.toMatch(/cost|profit|batch|allocation|staff|employee|branch|inventoryValue|customer|primaryPhone|alternatePhone|detailedAddress|landmark|notes|history/i);
      expectPublicSafe(nested);
    }
  }
}

async function api<T = unknown>(page: Page, origin: string, method: "GET" | "POST", path: string, data: unknown, status: number): Promise<T> {
  const response = await page.request.fetch(`${origin}${path}`, { method, headers: { origin }, data });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  return response.json() as Promise<T>;
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function money(piasters: number) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", minimumFractionDigits: 0 }).format(piasters / 100);
}
