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
  const bar = page.locator('[aria-label="Add product to bag"]');
  const barAdd = bar.getByRole("button", { name: "Add to bag" });
  const selectedPrice = panel.getByText("Selected price").locator("..");
  await expect(bar).toBeInViewport();
  await expect.poll(() => normalizedText(selectedPrice)).toContain("EGP 250");
  await expect.poll(() => normalizedText(bar)).toContain("EGP 250");
  const colors = panel.getByRole("group", { name: "Color" });
  const sizes = panel.getByRole("group", { name: "Size" });
  const blackSize = sizes.getByRole("radio", { name: new RegExp(`M ${suffix}`) });
  await expect(blackSize).toBeChecked();
  await expect(blackSize).toHaveValue(blackVariant.id);
  await expect(sizes.getByRole("radio", { name: new RegExp(`L ${suffix}`) })).toHaveCount(0);
  await expect(colors.getByRole("radio", { name: new RegExp(`رملي ${suffix}`) })).toBeEnabled();

  await colors.getByRole("radio", { name: new RegExp(`رملي ${suffix}`) }).check();
  const sandSize = sizes.getByRole("radio", { name: new RegExp(`M ${suffix}`) });
  const unavailable = sizes.getByRole("radio", { name: new RegExp(`L ${suffix}`) });
  await expect(sandSize).toBeChecked();
  await expect(sandSize).toHaveValue(sandVariant.id);
  await expect(unavailable).toBeDisabled();
  await expect(unavailable.locator("xpath=ancestor::label[1]")).toContainText("Unavailable");
  await expect(unavailable.locator("xpath=ancestor::label[1]")).toContainText(/EGP\s*350/);
  await sandSize.scrollIntoViewIfNeeded();
  await sandSize.focus();
  await expect(sandSize).toBeChecked();
  await expect(bar).toBeInViewport();
  await expect.poll(() => normalizedText(selectedPrice)).toContain("EGP 300");
  await expect.poll(() => normalizedText(bar)).toContain("EGP 300");
  await expect(bar).toContainText(`M ${suffix}`);
  await expect(bar).toContainText(`رملي ${suffix}`);
  const radioBox = await sandSize.boundingBox();
  const barBox = await bar.boundingBox();
  expect(radioBox && barBox).toBeTruthy();
  expect((radioBox?.y ?? 0) + (radioBox?.height ?? 0)).toBeLessThanOrEqual((barBox?.y ?? 0) + 1);
  await bar.getByRole("link", { name: "Change selection" }).click();
  await expect(panel.getByRole("heading", { name: "Choose size and color" })).toBeInViewport();

  const quantity = panel.getByLabel("Quantity");
  await quantity.fill("2");
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await expect(bar.locator("button")).toBeDisabled();
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toHaveAttribute("aria-describedby", "product-availability product-quantity-guidance");
  await expect(panel.locator("#product-quantity-guidance")).toHaveText("Reduce the quantity to 1.");
  await expect(panel.locator("#product-availability")).toContainText("You can add up to 1 of this selection.");
  await page.getByRole("heading", { name: product.body.nameAr }).click();
  await expect(bar).toBeInViewport();
  await expect.poll(() => normalizedText(bar)).toContain("EGP 300");
  const repair = bar.getByRole("link", { name: "Reduce the quantity to 1." });
  await expect(repair).toBeVisible();
  await expect(repair).toHaveAttribute("href", "#product-quantity");
  await expect(bar.getByRole("link", { name: "Change selection" })).toHaveAttribute("href", "#choose-variant");
  await page.screenshot({ path: testInfo.outputPath("quantity-guidance-phone-390.png") });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await quantity.scrollIntoViewIfNeeded();
  await expect(panel.locator("#product-quantity-guidance")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("quantity-guidance-desktop-1440.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(repair).toBeInViewport();
  await repair.click();
  await expect(quantity).toBeInViewport();
  await quantity.fill("0");
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await expect(bar.locator("button")).toBeDisabled();
  await expect(panel.locator("#product-quantity-guidance")).toHaveText("Enter a whole number from 1.");
  await page.getByRole("heading", { name: product.body.nameAr }).click();
  await expect(bar.getByRole("link", { name: "Enter a whole number from 1." })).toBeVisible();
  await quantity.fill("1.5");
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await expect(panel.locator("#product-quantity-guidance")).toHaveText("Enter a whole number from 1.");
  await quantity.fill("1");
  await expect(panel.getByRole("button", { name: "Add to bag" })).toBeEnabled();
  await expect(panel.locator("#product-quantity-guidance")).toHaveCount(0);
  await expect(quantity).not.toHaveAttribute("aria-invalid");
  await expect(quantity).toHaveAttribute("aria-describedby", "product-availability");
  await page.getByRole("heading", { name: product.body.nameAr }).click();
  await expect(bar).toBeInViewport();
  await expect(barAdd).toBeEnabled();
  await barAdd.click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  await expect(bar.getByRole("link", { name: "Added · View bag" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Available quantity is in your bag" })).toBeDisabled();
  await expect(panel.locator("#product-availability")).toContainText("You added the available quantity of this selection to your bag.");
  await expect(panel.locator("#product-availability")).toContainText("In your bag: 1.");
  await expect(panel.locator("#product-quantity-guidance")).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Reduce the quantity to 1." })).toHaveCount(0);
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
  await panel.getByLabel("Quantity").scrollIntoViewIfNeeded();
  await expect(panel.getByLabel("Quantity")).toBeInViewport();
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
