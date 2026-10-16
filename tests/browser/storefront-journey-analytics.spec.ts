import { expect, test, type Page } from "@playwright/test";
import type { AnalyticsSummaryDto, ManagerProductDto } from "@bravos/contracts";
import type {
  CheckoutQuoteDto, PublicAnalyticsEventRequest, PublicOrderSubmissionDto,
  PublicOrderSubmissionRequest, PublicProductDto,
} from "@bravos/contracts/public";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const acknowledgment = "We received your order request. It is pending. Placing the request does not reserve the items, and this is not a completed sale.";
type Counts = { [Key in keyof AnalyticsSummaryDto["metrics"]]: number };

// Uses the normal Playwright stack's fresh PostgreSQL cluster and real HTTP routes.
test("full shopping journey preserves aggregate analytics across desktop and mobile commerce", async ({ page }) => {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await create<{ id: string; nameAr: string }>(page, "/api/internal/catalog/categories", { nameAr: `رحلة ${suffix}` });
  const medium = await create<{ id: string }>(page, "/api/internal/catalog/sizes", { nameAr: `M ${suffix}` });
  const large = await create<{ id: string }>(page, "/api/internal/catalog/sizes", { nameAr: `L ${suffix}` });
  const black = await create<{ id: string }>(page, "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const sand = await create<{ id: string }>(page, "/api/internal/catalog/colors", { nameAr: `رملي ${suffix}` });
  const product = await create<ManagerProductDto>(page, "/api/internal/catalog/products", {
    code: `JOURNEY-${suffix}`, nameAr: `قميص رحلة ${suffix}`, descriptionAr: "قميص رحلة الشراء التجريبية",
    categoryId: category.id, defaultSellingPricePiasters: 25_000, publication: "available",
    imageRefs: [], sizeGuideAr: null,
    variants: [
      { sizeId: medium.id, colorId: black.id, sellingPricePiastersOverride: null },
      { sizeId: large.id, colorId: sand.id, sellingPricePiastersOverride: 30_000 },
    ],
  });
  const selected = product.variants.find((variant) => variant.size.id === large.id && variant.color.id === sand.id)!;
  expect(selected).toBeTruthy();
  const workspaceResponse = await page.request.get(`${INTERNAL}/api/internal/workspace`);
  expect(workspaceResponse.status()).toBe(200);
  const workspace = await workspaceResponse.json();
  await create(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: workspace.activeBranch.id, receiptDate: cairoDate(),
    lines: product.variants.map((variant) => ({ variantId: variant.id, quantity: 4, unitCostPiasters: 10_000 })),
  });
  const area = await create<{ id: string }>(page, "/api/internal/delivery-areas", {
    nameAr: `منطقة رحلة ${suffix}`, feePiasters: 2_500, active: true,
  });
  const day = cairoDate();
  const baseline = await summary(page, day);

  // Await real backend acceptance before asserting counts. Strict Mode may send
  // the same operation more than once; unique identities and persisted counts matter.
  const acceptedEvents = new Map<string, PublicAnalyticsEventRequest>();
  await page.route("**/api/public/analytics/events", async (route) => {
    const payload = route.request().postDataJSON() as PublicAnalyticsEventRequest;
    const response = await route.fetch();
    expect(response.ok(), `accept ${payload.eventType}`).toBe(true);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ operationId: payload.operationId, eventType: payload.eventType });
    await route.fulfill({ response });
    acceptedEvents.set(payload.operationId, payload);
  });
  const eventCount = (eventType: PublicAnalyticsEventRequest["eventType"]) =>
    [...acceptedEvents.values()].filter((event) => event.eventType === eventType).length;
  const expectCounts = async (increments: Counts) => {
    const actual = await summary(page, day);
    for (const key of Object.keys(increments) as Array<keyof Counts>) {
      expect(actual.metrics[key].count, key).toBe(baseline.metrics[key].count + increments[key]);
    }
    return actual;
  };
  const browsing: Counts = { visits: 1, productViews: 1, successfulCartAdditions: 0, acceptedOrderSubmissions: 0, completedOnlineSales: 0 };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(STORE);
  await expect(page.getByRole("heading", { name: "Shop by category", exact: true })).toBeVisible();
  await expect(page.getByLabel("Sort")).toBeEnabled();
  await expect.poll(() => eventCount("visit")).toBe(1);
  // Category and sort navigation preserve the root layout's visit identity.
  await page.getByLabel("Filter by category").getByRole("link", { name: category.nameAr, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`category=${category.id}`));
  await expect(page.getByLabel("Filter by category").getByRole("link", { name: category.nameAr, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Sort")).toBeEnabled();
  await page.getByLabel("Sort").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.locator("a.product-card").filter({ hasText: product.nameAr }).click();
  await expect(page.getByRole("heading", { name: product.nameAr })).toBeVisible();
  await expect.poll(() => eventCount("product_view")).toBe(1);
  expect([...acceptedEvents.values()].find((event) => event.eventType === "product_view")).toMatchObject({ productId: product.id });
  expect(eventCount("visit")).toBe(1);
  const publishedResponse = await page.request.get(`${STORE}/api/public/catalog/products/${product.id}`);
  expect(publishedResponse.status()).toBe(200);
  const published = await publishedResponse.json() as PublicProductDto;
  const firstOrderable = published.variants.find((variant) => variant.orderable);
  const alternate = published.variants.find((variant) => variant.orderable && variant.id !== firstOrderable?.id);
  expect(firstOrderable).toBeTruthy();
  expect(alternate).toBeTruthy();
  expect(eventCount("visit")).toBe(1);
  expect(eventCount("product_view")).toBe(1);
  expect(eventCount("cart_addition")).toBe(0);

  const panel = page.locator(".purchase-panel");
  const mobileBar = page.getByLabel("Add product to bag", { exact: true });
  const colors = panel.getByRole("group", { name: "Color" });
  const sizes = panel.getByRole("group", { name: "Size" });
  await expect(sizes.getByRole("radio")).toHaveCount(1);
  await expect(sizes.getByRole("radio")).toHaveValue(firstOrderable!.id);
  await colors.getByRole("radio", { name: alternate!.color.nameAr }).check();
  await expect(sizes.getByRole("radio")).toHaveCount(1);
  await expect(sizes.getByRole("radio")).toHaveValue(alternate!.id);
  expect(eventCount("visit")).toBe(1);
  expect(eventCount("product_view")).toBe(1);
  expect(eventCount("cart_addition")).toBe(0);
  const sandColor = colors.getByRole("radio", { name: new RegExp(`رملي ${suffix}`) });
  await sandColor.check();
  const selectedSize = sizes.getByRole("radio");
  await expect(selectedSize).toHaveCount(1);
  await expect(selectedSize).toBeChecked();
  await expect(selectedSize).toHaveValue(selected.id);
  await expect(sandColor).toBeChecked();
  await expect(panel.getByLabel("Quantity")).toHaveValue("1");
  await expect(mobileBar).toBeHidden();
  await expectCounts(browsing);
  await panel.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  await expect.poll(() => eventCount("cart_addition")).toBe(1);
  await expectCounts({ ...browsing, successfulCartAdditions: 1 });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileBar).toBeInViewport();
  await expect(sandColor).toBeChecked();
  await expect(selectedSize).toBeChecked();
  await expect(selectedSize).toHaveValue(selected.id);
  await expect(mobileBar).toContainText(`L ${suffix}`);
  await expect(mobileBar).toContainText(`رملي ${suffix}`);
  await expectCounts({ ...browsing, successfulCartAdditions: 1 });
  await mobileBar.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect.poll(() => eventCount("cart_addition")).toBe(2);
  const additions = [...acceptedEvents.values()].filter((event) => event.eventType === "cart_addition");
  expect(additions).toHaveLength(2);
  for (const event of additions) expect(event).toMatchObject({ productId: product.id, variantId: selected.id, quantity: 1 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(mobileBar).toBeHidden();
  await expectCounts({ ...browsing, successfulCartAdditions: 2 });

  await panel.getByRole("link", { name: "View bag", exact: true }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator(".cart-line")).toContainText(`L ${suffix}`);
  await expect(page.locator(".cart-line")).toContainText(`رملي ${suffix}`);
  await expect(page.locator(".cart-line output")).toHaveText("2");
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  const checkout = page.getByRole("form", { name: "Checkout" });
  await checkout.getByLabel("Name").fill("عميل رحلة تجريبية");
  await checkout.getByLabel("Primary mobile number").fill("01001234567");
  await checkout.getByLabel("Delivery").selectOption(area.id);
  await checkout.getByLabel("Detailed address").fill("شارع الاختبار، الفيوم");
  const quoteResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/public/checkout/quote" && response.request().method() === "POST");
  await checkout.getByRole("button", { name: "Review price" }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.ok()).toBe(true);
  const quote = await quoteResponse.json() as CheckoutQuoteDto;
  expect(quote.lines).toMatchObject([{ variantId: selected.id, quantity: 2, listedUnitPricePiasters: 30_000 }]);
  expect(quote.deliveryFeePiasters).toBe(2_500);
  await expect(page.getByRole("region", { name: "Price details" })).toContainText("Delivery fee");
  await expectCounts({ ...browsing, successfulCartAdditions: 2 });

  const submissionResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/public/checkout/orders" && response.request().method() === "POST");
  await checkout.getByRole("button", { name: "Place order request" }).click();
  const submissionResponse = await submissionResponsePromise;
  expect(submissionResponse.status()).toBe(201);
  const submission = await submissionResponse.json() as PublicOrderSubmissionDto;
  const exactRequest = submissionResponse.request().postDataJSON() as PublicOrderSubmissionRequest;
  expect(submission.status).toBe("pending");
  expect(submission.quote).toEqual(quote);
  expect(exactRequest.lines).toEqual([{ variantId: selected.id, quantity: 2 }]);
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(acknowledgment);
  const accepted = await expectCounts({ ...browsing, successfulCartAdditions: 2, acceptedOrderSubmissions: 1 });
  // Catalog revalidation on cart/checkout is not a product-page view.
  expect(eventCount("visit")).toBe(1);
  expect(eventCount("product_view")).toBe(1);
  expect(eventCount("cart_addition")).toBe(2);
  const publicProductResponse = await page.request.get(`${STORE}/api/public/catalog/products/${product.id}`);
  expect(publicProductResponse.status()).toBe(200);
  const publicProduct = await publicProductResponse.json() as PublicProductDto;
  expect(publicProduct.variants.find((variant) => variant.id === selected.id)?.availableQuantity).toBe(4);
  expect(eventCount("visit")).toBe(1);
  expect(eventCount("product_view")).toBe(1);

  // Retry the exact accepted public commands: neither identity counts twice.
  const orderReplay = await page.request.post(`${STORE}/api/public/checkout/orders`, { headers: { origin: STORE }, data: exactRequest });
  expect(orderReplay.status()).toBe(200);
  expect(await orderReplay.json()).toEqual(submission);
  const eventReplay = await page.request.post(`${STORE}/api/public/analytics/events`, { headers: { origin: STORE }, data: additions[0] });
  expect(eventReplay.status()).toBe(200);
  expect(await summary(page, day)).toEqual(accepted);
});

async function signInManager(page: Page) {
  await page.goto(`${INTERNAL}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
}

async function create<T = unknown>(page: Page, endpoint: string, data: unknown): Promise<T> {
  const response = await page.request.post(`${INTERNAL}${endpoint}`, { headers: { origin: INTERNAL }, data });
  expect(response.status(), endpoint).toBe(201);
  return response.json() as Promise<T>;
}

async function summary(page: Page, day: string): Promise<AnalyticsSummaryDto> {
  const response = await page.request.get(`${INTERNAL}/api/internal/analytics?from=${day}&to=${day}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return response.json() as Promise<AnalyticsSummaryDto>;
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
