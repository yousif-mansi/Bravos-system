import { expect, test, type Page } from "@playwright/test";

test("product commerce keeps one variant and add state across the mobile bar and desktop rail", async ({ page }, testInfo) => {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `قمصان التجارة ${suffix}` });
  const medium = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${suffix}` });
  const large = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `L ${suffix}` });
  const black = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const sand = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `رملي ${suffix}` });
  for (const response of [category, medium, large, black, sand]) expect(response.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `COMMERCE-${suffix}`,
    nameAr: `قميص التجارة ${suffix}`,
    descriptionAr: "قميص لاختبار اختيار المقاس واللون والشراء",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25_000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: "دليل المقاسات التجريبي",
    variants: [
      { sizeId: medium.body.id, colorId: black.body.id, sellingPricePiastersOverride: null },
      { sizeId: medium.body.id, colorId: sand.body.id, sellingPricePiastersOverride: 30_000 },
      { sizeId: large.body.id, colorId: sand.body.id, sellingPricePiastersOverride: 35_000 },
    ],
  });
  expect(product.status).toBe(201);
  const blackVariant = product.body.variants.find((variant: { color: { id: string } }) => variant.color.id === black.body.id);
  const sandVariant = product.body.variants.find((variant: { size: { id: string }; color: { id: string } }) => variant.size.id === medium.body.id && variant.color.id === sand.body.id);
  expect(blackVariant).toBeTruthy();
  expect(sandVariant).toBeTruthy();
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json()).activeBranch.id,
    receiptDate: cairoDate(),
    lines: [
      { variantId: blackVariant.id, quantity: 2, unitCostPiasters: 10_000 },
      { variantId: sandVariant.id, quantity: 1, unitCostPiasters: 12_000 },
    ],
  });
  expect(receipt.status).toBe(201);

  const cartEvents: Array<{ eventType: string; productId: string; variantId: string; quantity: number }> = [];
  await page.route("**/api/public/analytics/events", async (route) => {
    const event = route.request().postDataJSON() as (typeof cartEvents)[number];
    if (event.eventType === "cart_addition") cartEvents.push(event);
    await route.continue();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:3001/products/${product.body.id}`);
  const panel = page.locator(".purchase-panel");
  const bar = page.locator('[aria-label="إضافة المنتج إلى السلة"]');
  const barAdd = bar.getByRole("button", { name: "أضف إلى السلة" });
  const selectedPrice = panel.getByText("سعر الاختيار").locator("..");
  await expect(bar).toBeInViewport();
  await expect.poll(() => normalizedText(selectedPrice)).toContain("250 ج.م.");
  await expect.poll(() => normalizedText(bar)).toContain("250 ج.م.");
  const unavailable = panel.locator("label.variant-option").filter({ hasText: `L ${suffix}` }).getByRole("radio");
  await expect(unavailable).toBeDisabled();
  await expect(panel.locator("label.variant-option").filter({ hasText: `L ${suffix}` })).toContainText("غير متوفر");

  const sandRadio = panel.locator("label.variant-option").filter({ hasText: `رملي ${suffix}` }).filter({ hasText: `M ${suffix}` }).getByRole("radio");
  await sandRadio.scrollIntoViewIfNeeded();
  await sandRadio.focus();
  await sandRadio.press("Space");
  await expect(sandRadio).toBeChecked();
  await expect(bar).toBeInViewport();
  await expect.poll(() => normalizedText(selectedPrice)).toContain("300 ج.م.");
  await expect.poll(() => normalizedText(bar)).toContain("300 ج.م.");
  await expect(bar).toContainText(`M ${suffix} / رملي ${suffix}`);
  const radioBox = await sandRadio.boundingBox();
  const barBox = await bar.boundingBox();
  expect(radioBox && barBox).toBeTruthy();
  expect((radioBox?.y ?? 0) + (radioBox?.height ?? 0)).toBeLessThanOrEqual((barBox?.y ?? 0) + 1);
  await bar.getByRole("link", { name: "تغيير الاختيار" }).click();
  await expect(panel.getByRole("heading", { name: "اختر المقاس واللون" })).toBeInViewport();

  const quantity = panel.getByLabel("الكمية");
  await quantity.fill("2");
  await expect(panel.getByRole("button", { name: "أضف إلى السلة" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "أضف إلى السلة" })).toBeDisabled();
  await expect(bar.locator("button")).toBeDisabled();
  await quantity.fill("1");
  await expect(panel.getByRole("button", { name: "أضف إلى السلة" })).toBeEnabled();
  await page.getByRole("heading", { name: product.body.nameAr }).click();
  await expect(bar).toBeInViewport();
  await expect(barAdd).toBeEnabled();
  await barAdd.click();
  await expect(panel.getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
  await expect(bar.getByRole("link", { name: "تمت الإضافة · عرض السلة" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "الكمية المتاحة في السلة" })).toBeDisabled();
  await expect.poll(() => cartEvents.length).toBe(1);
  expect(cartEvents[0]).toMatchObject({ eventType: "cart_addition", productId: product.body.id, variantId: sandVariant.id, quantity: 1 });
  const savedCart = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null"));
  expect(savedCart.items).toMatchObject([{ variantId: sandVariant.id, unitPricePiasters: 30_000, quantity: 1 }]);
  await page.screenshot({ path: testInfo.outputPath("commerce-phone-390.png"), fullPage: true });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);

  await page.setViewportSize({ width: 768, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("commerce-tablet-768.png"), fullPage: true });
  await expect(bar).toBeInViewport();
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1200 });
  const copy = page.getByRole("heading", { name: product.body.nameAr }).locator("..");
  await expect(copy).toHaveAttribute("data-sticky", "true");
  await expect.poll(() => copy.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  await expect(bar).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("commerce-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 480 });
  await expect.poll(() => copy.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  await panel.getByLabel("الكمية").scrollIntoViewIfNeeded();
  await expect(panel.getByLabel("الكمية")).toBeInViewport();
});

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function staffApi(page: Page, method: "POST", url: string, payload: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", "content-type": "application/json" },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function normalizedText(locator: ReturnType<Page["locator"]>) {
  const value = await locator.textContent() ?? "";
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return [...value].map((character) => arabicDigits.includes(character) ? String(arabicDigits.indexOf(character)) : character)
    .join("").replace(/[\u200e\u200f]/g, "").replace(/\u00a0/g, " ");
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
