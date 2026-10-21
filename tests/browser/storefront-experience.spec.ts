import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectContrast, expectTargetCoverage, expectTargetSize, measureContrast, tabTo, type ContrastSample } from "./support/storefront-a11y";

const STORE = "http://127.0.0.1:3001";
const API = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const FRESH_RECEIPT_STATUS = "We received your order request. It is pending. Placing the request does not reserve the items, and this is not a completed sale.";
const STORED_RECEIPT_STATUS = "This order request was already received and was not submitted again. This receipt does not establish its current status.";

function fixtureCollectionCard(page: Page, productName: string, productId: string) {
  const products = page.getByRole("region", { name: "Products" });
  return products.getByRole("link", { name: productName }).and(products.locator(`a.product-card[href="/products/${productId}"]`));
}

test("storefront route presentation remains reachable across supported widths and zoom equivalent", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const marker = `SF12-${suffix}`;
  const mixedText = `BRAVOS Classic نص عربي لاتيني ${marker}`;
  const categoryName = `تصنيف ${mixedText}`;
  const sizeName = `مقاس XL ${marker}`;
  const colorName = `لون أسود ${marker}`;
  const unavailableColorName = `لون غير متوفر ${marker}`;
  const productName = `قميص ${mixedText} للتأكد من حدود السطر`;
  const address = `الفيوم، شارع الجامعة الطويل بجوار مكتبة BRAVOS Classic ${marker}، مبنى 12، الدور الثالث، شقة 4، البوابة الخضراء 2026`;

  const category = await staffApi(page, "/api/internal/catalog/categories", { nameAr: categoryName });
  const size = await staffApi(page, "/api/internal/catalog/sizes", { nameAr: sizeName });
  const color = await staffApi(page, "/api/internal/catalog/colors", { nameAr: colorName });
  const unavailableColor = await staffApi(page, "/api/internal/catalog/colors", { nameAr: unavailableColorName });
  for (const response of [category, size, color, unavailableColor]) expect(response.status).toBe(201);
  const imageRefs: string[] = [];
  for (let index = 1; index <= 2; index += 1) {
    const media = await staffApi(page, "/api/internal/catalog/media", {
      fileName: `sf12-${marker}-${index}.png`, contentType: "image/png", base64: PNG,
    });
    expect(media.status).toBe(201);
    imageRefs.push(media.body.ref as string);
  }
  const product = await staffApi(page, "/api/internal/catalog/products", {
    code: `SF12-${suffix}`, nameAr: productName,
    descriptionAr: `وصف ${mixedText} مع أرقام 2026 و ٣٥٠ للتحقق من اتجاه النص والتفافه.`,
    categoryId: category.body.id, defaultSellingPricePiasters: 35000, publication: "available",
    imageRefs, sizeGuideAr: `دليل مقاس طويل ${marker} مع BRAVOS Classic و ٣٥٠.`,
    variants: [
      { sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null },
      { sizeId: size.body.id, colorId: unavailableColor.body.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(product.status).toBe(201);
  const branchId = (await (await page.request.get(`${API}/api/internal/workspace`)).json()).activeBranch.id;
  expect((await staffApi(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId, receiptDate: "2026-09-25",
    lines: [{ variantId: product.body.variants[0].id, quantity: 3, unitCostPiasters: 12000 }],
  })).status).toBe(201);
  const area = await staffApi(page, "/api/internal/delivery-areas", { nameAr: `مدينة الفيوم ${marker}`, feePiasters: 2500, active: true });
  expect(area.status).toBe(201);

  const findings: unknown[] = [];
  const manualContrast: ContrastSample[] = [];
  const contrastSamples: ContrastSample[] = [];
  const recordContrast = async (locator: ReturnType<Page["locator"]>, id: string, mode: ContrastSample["mode"]) => {
    const measured = await locator.first().evaluate(measureContrast, { id, mode });
    contrastSamples.push(measured);
    if (!measured.manual) return;
    manualContrast.push(measured);
    await locator.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`manual-contrast-${id}.png`) });
  };
  const routes = [
    { name: "arrival", url: `${STORE}/`, ready: "#home-title" },
    { name: "collection", url: `${STORE}/?category=${category.body.id}`, ready: "a.product-card" },
    { name: "product", url: `${STORE}/products/${product.body.id}`, ready: "#product-quantity" },
    { name: "cart", url: `${STORE}/cart`, ready: ".cart-line" },
    { name: "checkout", url: `${STORE}/checkout`, ready: "form.checkout-form" },
    { name: "not-found", url: `${STORE}/products/00000000-0000-4000-8000-000000000000`, ready: "#main-content h1" },
  ];
  const cartEvents: unknown[] = [];
  await page.route("**/api/public/analytics/events", async (route) => {
    const event = route.request().postDataJSON() as { eventType: string };
    if (event.eventType === "cart_addition") cartEvents.push(event);
    await route.continue();
  });
  await page.goto(routes[2].url);
  await page.getByRole("button", { name: "Add to bag" }).first().click();
  await expect(page.getByRole("status")).toContainText("Added");

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(route.url);
      await expect(page.locator(route.ready).first()).toBeVisible();
      if (route.name === "arrival" || route.name === "collection") {
        await expect(page.getByRole("search")).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: "Search" })).toHaveCount(0);
        await expect(page.getByText(/^\d+ products?$/)).toHaveCount(0);
        await expect(page.getByRole("combobox", { name: "Sort" }).locator("option"))
          .toHaveText(["Default order", "Price: low to high", "Price: high to low"]);
      }
      if (route.name === "arrival") {
        await expect(page.getByRole("heading", { name: "Selected pieces", exact: true })).toHaveCount(0);
        await expect(page.getByRole("region", { name: "Products", exact: true })).toHaveCount(0);
        const homeTitle = page.locator("#home-title");
        await expect(homeTitle).toHaveText("Bravos Menswear");
        await expect(homeTitle).toHaveClass(/sr-only/);
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
        const hero = page.locator("section").filter({ has: homeTitle });
        const cover = hero.locator("img");
        await expect(cover).toHaveAttribute("alt", "");
        await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([2048, 774]);
        await expect(hero.locator("a, button, p")).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
        const categoryLink = page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName });
        await expect(categoryLink).toBeVisible();
        await expectTargetSize(categoryLink);
      }
      if (route.name === "collection") {
        await expect(page.getByRole("heading", { level: 1 })).toContainText(categoryName);
        const chip = page.getByRole("link", { name: `Remove category: ${categoryName}` });
        const clearCategory = page.getByRole("link", { name: "Clear category", exact: true });
        const selectedCategory = page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName, exact: true });
        await expect(chip).toBeVisible();
        await expectTargetSize(chip);
        await expectTargetSize(clearCategory);
        await expectTargetSize(selectedCategory);
        const card = fixtureCollectionCard(page, productName, product.body.id);
        await expect(card).toHaveCount(1);
        await expect(card).toBeVisible();
        await expect(card).toHaveAttribute("href", `/products/${product.body.id}`);
        const cardTitle = card.getByRole("heading", { name: productName, exact: true });
        await expect(cardTitle).toHaveText(productName);
        await expect(cardTitle).toHaveAttribute("dir", "auto");
        await expect(cardTitle).toHaveCSS("text-align", "center");
        const cardImage = card.locator("img");
        await expect(cardImage).toHaveCSS("object-fit", "cover");
        await expect(cardImage).toHaveCSS("padding", "0px");
        await expect(cardImage).toHaveCSS("margin", "0px");
        const frame = await cardImage.evaluate((image) => {
          const container = image.parentElement!;
          const box = container.getBoundingClientRect();
          const mediaImage = image as HTMLImageElement;
          return {
            ratio: box.width / box.height,
            radius: getComputedStyle(container).borderRadius,
            // Layout dimensions exclude the preserved hover/focus zoom transform.
            edgeDelta: Math.max(Math.abs(mediaImage.offsetLeft), Math.abs(mediaImage.offsetTop), Math.abs(mediaImage.offsetWidth - container.clientWidth), Math.abs(mediaImage.offsetHeight - container.clientHeight)),
          };
        });
        expect(frame.ratio, `${width}px card frame is 4:5`).toBeCloseTo(4 / 5, 2);
        expect(frame.radius, `${width}px card media corners`).toBe("12px");
        expect(frame.edgeDelta, `${width}px image fills its frame`).toBeLessThanOrEqual(1);
        const priceBox = await card.locator("p").first().boundingBox();
        const stockBox = await card.locator("[data-availability]").boundingBox();
        expect(priceBox, `${width}px card price`).not.toBeNull();
        expect(stockBox, `${width}px card availability`).not.toBeNull();
        expect(Math.abs(priceBox!.y + priceBox!.height / 2 - stockBox!.y - stockBox!.height / 2), `${width}px price and availability share one row`).toBeLessThanOrEqual(1);
      }
      if (route.name === "product") {
        await expect(page.getByRole("heading", { name: productName })).toBeVisible();
        await expect(page.getByText(sizeName).first()).toBeVisible();
        await expect(page.getByText(colorName).first()).toBeVisible();
        const gallery = page.getByRole("region", { name: `Photos of ${productName}` });
        await expectTargetSize(gallery.getByRole("button", { name: "Next photo" }));
        await expectTargetSize(gallery.getByRole("button", { name: "Previous photo" }));
        await expectTargetSize(gallery.getByRole("button", { name: "Show photo 2 of 2" }));
        const variant = page.getByRole("group", { name: "Color" }).getByRole("radio", { name: new RegExp(colorName) });
        const labelBox = await variant.locator("xpath=ancestor::label[1]").boundingBox();
        expect(labelBox?.width, "enabled variant label width").toBeGreaterThanOrEqual(44);
        expect(labelBox?.height, "enabled variant label height").toBeGreaterThanOrEqual(44);
      }
      if (route.name === "cart") {
        await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
        await expectTargetSize(page.getByRole("button", { name: "Remove", exact: true }));
      }
      if (route.name === "checkout") {
        const checkout = page.getByRole("form", { name: "Checkout" });
        await checkout.getByLabel("Detailed address").fill(address);
        await expect(checkout.getByLabel("Detailed address")).toHaveValue(address);
        for (const recoveryLink of await page.getByRole("link", { name: "Edit bag" }).all()) {
          if (await recoveryLink.isVisible()) await expectTargetSize(recoveryLink);
        }
      }
      if (route.name === "not-found") {
        await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
        await expectTargetSize(page.getByRole("link", { name: "Shop" }));
      }
      await expectTargetCoverage(page);
      const geometry = await page.evaluate(presentationProbe, { marker, address, width });
      findings.push({ route: route.name, width, geometry });
      if (route.name !== "not-found") expect(geometry.markerNodeCount, `${route.name} retains mixed-script fixture coverage`).toBeGreaterThan(0);
      if (geometry.violations.length > 0) {
        const geometryPath = testInfo.outputPath(`geometry-${route.name}-${width}.json`);
        await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
        await page.screenshot({ path: testInfo.outputPath(`geometry-${route.name}-${width}.png`), fullPage: true });
      }
      expect(geometry.scrollWidth, `${route.name} at ${width}px must not overflow horizontally`).toBeLessThanOrEqual(width);
      expect(geometry.violations, `${route.name} at ${width}px text, controls, and sticky surfaces`).toEqual([]);
      expect(geometry.skipTop, "unfocused skip link stays offscreen").toBeLessThan(0);
      if (route.name === "arrival") await revealFixtureFilterLink(page, categoryName, width);
      if (width === 320 || width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${route.name}-${width}.png`), fullPage: true });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const nonexistentCategoryId = crypto.randomUUID();
  await page.goto(`${STORE}/?category=${nonexistentCategoryId}`);
  await expect(page.locator("#catalog-title")).toHaveText("Unavailable category");
  await expect(page.getByRole("heading", { name: "No matching products" })).toBeVisible();
  const emptyRecovery = page.getByRole("main").getByRole("link", { name: "Categories", exact: true });
  await expectTargetSize(emptyRecovery);
  await expect(emptyRecovery).toHaveAttribute("href", "/#catalog-title");
  await expectTargetCoverage(page);
  const emptyGeometry = await page.evaluate(presentationProbe, { marker: "category", address: "", width: 390 });
  expect(emptyGeometry.markerNodeCount, "empty-category recovery has visible layout coverage").toBeGreaterThan(0);
  expect(emptyGeometry.scrollWidth).toBeLessThanOrEqual(390);
  expect(emptyGeometry.violations).toEqual([]);
  await recordContrast(page.getByRole("heading", { name: "No matching products" }), "empty-category-heading", "text");
  await recordContrast(page.getByText("Try another category, or view the categories."), "empty-category-status", "text");

  await page.setViewportSize({ width: 640, height: 844 });
  await page.goto(routes[2].url);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const zoom = await page.evaluate(() => {
    const bar = document.querySelector("[aria-label='Add product to bag']");
    const box = bar?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      mainWidth: document.querySelector("#main-content")?.getBoundingClientRect().width,
      purchaseBar: box ? { ...box.toJSON(), position: getComputedStyle(bar!).position } : null,
    };
  });
  expect(zoom.scrollWidth).toBeLessThanOrEqual(zoom.viewportWidth);
  expect(zoom.purchaseBar?.left).toBeGreaterThanOrEqual(0);
  expect(zoom.purchaseBar?.right).toBeLessThanOrEqual(zoom.viewportWidth);
  if (zoom.purchaseBar?.position === "sticky" || zoom.purchaseBar?.position === "fixed") {
    expect(zoom.purchaseBar.top).toBeGreaterThanOrEqual(0);
    expect(zoom.purchaseBar.bottom).toBeLessThanOrEqual(844);
  }
  findings.push({ route: "product", width: "640 at CSS zoom 2", zoomNote: "CSS zoom is not browser 200% zoom.", ...zoom });
  await page.screenshot({ path: testInfo.outputPath("product-zoom-equivalent.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => ({ behavior: getComputedStyle(document.documentElement).scrollBehavior, transition: getComputedStyle(document.querySelector("button")!).transitionDuration }));
  expect(reducedMotion.behavior).toBe("auto");
  expect(reducedMotion.transition).toBe("0s");
  findings.push({ route: "product", reducedMotion, reducedMotionNote: "prefers-reduced-motion emulation, not a physical device." });

  await page.goto(routes[0].url);
  await expect.poll(() => page.locator("section").filter({ has: page.locator("#home-title") }).locator("img").evaluate((img) => getComputedStyle(img).animationName)).toBe("none");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  const skipFocus = await skip.evaluate((element) => ({ top: element.getBoundingClientRect().top, outline: getComputedStyle(element).outlineStyle }));
  expect(skipFocus.top).toBeGreaterThanOrEqual(0);
  expect(skipFocus.outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  findings.push({ route: "arrival", skipFocus, afterSkip: await page.evaluate(() => ({ active: document.activeElement?.tagName, hash: location.hash })) });

  await recordContrast(page.locator("#home-title"), "arrival-heading", "text");
  await recordContrast(page.getByRole("heading", { name: "Shop by category" }), "arrival-display", "text");
  await recordContrast(page.getByText("Your order starts as a request. Items are not reserved until confirmation. We confirm availability with you on WhatsApp."), "arrival-introduction", "text");
  await recordContrast(page.locator("section[data-paused] p").first(), "ticker-text", "text");
  await recordContrast(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Bag/ }), "header-link", "text");
  await recordContrast(page.locator(".cart-count").first(), "header-cart-count", "text");
  const sortControl = page.getByRole("combobox", { name: "Sort" });
  await expect(sortControl).toBeEnabled();
  await recordContrast(sortControl, "sort-boundary", "boundary");
  await tabTo(page, sortControl);
  await recordContrast(sortControl, "sort-focused-text", "text");
  await recordContrast(sortControl, "sort-focused-outline", "outline");
  const categoryControl = page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName, exact: true });
  await recordContrast(categoryControl, "category-control-text", "text");
  await tabTo(page, categoryControl);
  await recordContrast(categoryControl, "category-focused-text", "text");
  await recordContrast(categoryControl, "category-focused-boundary", "boundary");
  await recordContrast(categoryControl, "category-focused-outline", "outline");

  await page.goto(routes[1].url);
  await recordContrast(page.locator("#catalog-title"), "collection-heading", "text");
  const wallCard = page.getByRole("region", { name: "Products" }).locator("a.product-card").filter({ hasText: productName });
  await recordContrast(wallCard.locator("h3"), "product-card-name", "text");
  await recordContrast(wallCard.getByText("In Stock"), "product-card-availability", "text");
  await recordContrast(wallCard.locator("p").first(), "product-card-price", "text");
  await recordContrast(page.getByRole("link", { name: `Remove category: ${categoryName}` }), "filter-chip", "text");
  await recordContrast(page.getByRole("link", { name: `Remove category: ${categoryName}` }), "filter-chip-boundary", "boundary");
  const selectedCategory = page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName, exact: true });
  await recordContrast(selectedCategory, "selected-category", "text");
  await recordContrast(selectedCategory, "selected-category-boundary", "boundary");

  await page.goto(routes[2].url);
  await recordContrast(page.getByRole("heading", { name: productName }), "product-heading", "text");
  await recordContrast(page.getByText(sizeName).first(), "selected-variant", "text");
  const colors = page.getByRole("group", { name: "Color" });
  const unavailableVariant = colors.getByRole("radio", { name: new RegExp(unavailableColorName) });
  await expect(unavailableVariant).toBeDisabled();
  await recordContrast(unavailableVariant.locator("xpath=ancestor::label[1]"), "disabled-variant", "text");
  await recordContrast(page.locator("#product-quantity"), "quantity-boundary", "boundary");
  const checkedVariant = colors.getByRole("radio", { name: new RegExp(colorName) });
  await tabTo(page, checkedVariant);
  await recordContrast(checkedVariant.locator("xpath=ancestor::label[1]"), "focused-variant", "text");
  await recordContrast(checkedVariant.locator("xpath=ancestor::label[1]"), "focused-variant-outline", "outline");

  await page.goto(routes[3].url);
  await recordContrast(page.locator(".cart-line [role='group']").first(), "cart-quantity-boundary", "boundary");
  await recordContrast(page.getByRole("status").first(), "cart-status", "text");

  await page.goto(routes[5].url);
  await recordContrast(page.getByRole("heading", { name: "Product not found" }), "not-found-heading", "text");
  await recordContrast(page.getByText("This product may be unpublished."), "not-found-copy", "text");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STORE);
  await page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName, exact: true }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: categoryName, exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.getByLabel("Sort").evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")))).toBe(true);
  await page.getByLabel("Sort").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.getByRole("region", { name: "Products" }).locator("a.product-card").filter({ hasText: productName }).click();
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  await expect(page.getByRole("group", { name: "Color" }).getByRole("radio", { name: new RegExp(colorName) })).toBeChecked();
  await page.getByRole("button", { name: "Add to bag" }).last().click();
  await expect(page.getByRole("status")).toContainText("Added");
  await expect.poll(() => cartEvents.length).toBe(2);
  await page.getByRole("link", { name: "Added · View bag" }).click();
  await expect(page.locator(".cart-line output")).toHaveText("2");
  await page.getByRole("link", { name: "Checkout" }).click();
  const checkout = page.getByRole("form", { name: "Checkout" });
  await checkout.getByLabel("Delivery").selectOption(area.body.id);
  await checkout.getByRole("button", { name: "Review price" }).click();
  await expect(page.getByRole("region", { name: "Price details" })).toContainText("Delivery fee");
  const quoteStatus = page.getByRole("status").filter({ hasText: "The price was updated from current stock and settings." });
  await expect(quoteStatus).toBeVisible();
  await recordContrast(quoteStatus, "quote-status", "text");
  await checkout.getByRole("button", { name: "Place order request" }).click();
  const name = checkout.getByLabel("Name");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#customerName-error")).toHaveText("Complete this field.");
  await recordContrast(page.locator("#customerName-error"), "field-error", "text");
  await checkout.getByLabel("Name").fill(`عميل اختبار الوصول ${marker}`);
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#customerName-error")).toHaveCount(0);
  await checkout.getByLabel("Primary mobile number").fill("01001234567");
  await checkout.getByLabel("Detailed address").fill(address);
  await checkout.getByRole("button", { name: "Place order request" }).click();
  await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
  const acknowledgment = page.getByRole("status");
  await expect(acknowledgment).toHaveText(FRESH_RECEIPT_STATUS);
  await recordContrast(acknowledgment, "acknowledgment-status", "text");
  const acknowledgmentLink = page.getByRole("link", { name: "Back to the store" });
  await expectTargetSize(acknowledgmentLink);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Order request already received", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(STORED_RECEIPT_STATUS);
    await expectTargetSize(page.getByRole("link", { name: "Back to the store" }));
    await expectTargetCoverage(page);
    const acknowledgmentGeometry = await page.evaluate(presentationProbe, { marker, address: "", width });
    expect(acknowledgmentGeometry.scrollWidth, `acknowledgment at ${width}px`).toBeLessThanOrEqual(width);
    expect(acknowledgmentGeometry.violations).toEqual([]);
  }
  findings.push({
    route: "customer-journey",
    cartAdditionEvents: cartEvents.length,
    orderStatus: "pending",
    manualContrast: manualContrast.map(({ id, manualReason, backgroundKind }) => ({ id, manualReason, backgroundKind })),
  });
  for (const contrastSample of contrastSamples) await expectContrast(contrastSample);
  expect(manualContrast.map((item) => item.id)).toContain("header-link");
  expect(manualContrast.find((item) => item.id === "header-link")?.manualReason).toMatch(/glass|backdrop|image|gradient/i);
  const contrastPath = testInfo.outputPath("contrast-samples.json");
  await writeFile(contrastPath, JSON.stringify({ samples: contrastSamples, manual: manualContrast }, null, 2));
  console.log(JSON.stringify(findings, null, 2));
});

function presentationProbe({ marker, address, width }: { marker: string; address: string; width: number }) {
  type Violation = { kind: string; text: string; detail: string };
  const violations: Violation[] = [];
  const markerNodes = [...document.querySelectorAll<HTMLElement>("h1, h2, h3, p, a, label, span, textarea, small, strong")]
    .filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const value = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element.value : "";
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0
        && ((element.innerText || "").includes(marker) || value.includes(marker) || (address !== "" && value.includes(address)));
    });
  for (const element of markerNodes) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const railClip = filterRailClip(element, box);
    if (!railClip.viewportOverflowIsClip && (box.left < -1 || box.right > innerWidth + 1)) {
      violations.push({ kind: "outside-viewport", text: clip(element), detail: `${Math.round(box.left)}..${Math.round(box.right)} in ${innerWidth}` });
    }
    // A link scrolled fully out of the category rail is not visible content. Keep wrap checks for anything still shown.
    if (railClip.fullyHidden) continue;
    const clips = style.overflowX === "hidden" || style.overflowX === "clip";
    if ((clips || element instanceof HTMLTextAreaElement) && element.scrollWidth > element.clientWidth + 1) {
      violations.push({ kind: "clipped-text", text: clip(element), detail: `${element.scrollWidth} > ${element.clientWidth}` });
    }
    if (style.overflowX === "visible" && element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
      violations.push({ kind: "content-wider-than-box", text: clip(element), detail: `${element.scrollWidth} > ${element.clientWidth}` });
    }
  }
  const homeTitle = document.querySelector("#home-title");
  if (homeTitle) {
    const hero = homeTitle.closest("section");
    const cover = hero?.querySelector("img");
    if (homeTitle.textContent !== "Bravos Menswear" || !homeTitle.classList.contains("sr-only")) {
      violations.push({ kind: "hero-title", text: homeTitle.textContent ?? "", detail: homeTitle.className });
    }
    if (document.documentElement.lang !== "en" || document.documentElement.dir !== "ltr") {
      violations.push({ kind: "document-direction", text: document.documentElement.lang, detail: document.documentElement.dir });
    }
    if (!(cover instanceof HTMLImageElement) || cover.alt !== "" || cover.naturalWidth !== 2048 || cover.naturalHeight !== 774) {
      violations.push({ kind: "hero-cover", text: cover instanceof HTMLImageElement ? `${cover.alt} ${cover.naturalWidth}x${cover.naturalHeight}` : "missing", detail: "image-only cover 2048x774" });
    }
    if (hero?.querySelector("a, button, p")) {
      violations.push({ kind: "hero-overlay", text: "overlay", detail: "hero contains a link, button, or paragraph" });
    }
    const visible: string[] = [];
    if (hero) {
      const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const value = node.textContent?.trim() ?? "";
        if (value && parent && !parent.closest(".sr-only")) visible.push(value);
        node = walker.nextNode();
      }
    }
    if (visible.length > 0) violations.push({ kind: "visible-hero-copy", text: visible.join(" "), detail: "image-only hero" });
  }
  const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary")]
    .filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.bottom > 0 && box.top < innerHeight && box.width > 1 && box.height > 1
        && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
    });
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  // behavior "auto" still follows the smooth computed value, so a same-turn read would see the pre-scroll box.
  root.style.scrollBehavior = "auto";
  for (const control of controls) {
    control.scrollIntoView({ block: "nearest", inline: "nearest" });
    const box = control.getBoundingClientRect();
    const centerX = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2));
    const centerY = Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2));
    if (centerY < 0 || centerY >= innerHeight || centerX < 0 || centerX >= innerWidth) continue;
    const hit = document.elementFromPoint(centerX, centerY);
    if (devOverlay(hit) || devOverlay(control)) continue;
    const covered = hit && hit !== control && !control.contains(hit) && !hit.contains(control);
    if (!covered) continue;
    const sticky = stickyAncestor(hit);
    if (sticky && !sticky.contains(control)) {
      violations.push({ kind: "sticky-obstruction", text: clip(control), detail: `${clip(sticky)} covers ${Math.round(centerX)},${Math.round(centerY)}` });
    }
  }
  root.style.scrollBehavior = previousScrollBehavior;
  const skip = document.querySelector<HTMLElement>(".skip-link");
  return {
    width: innerWidth,
    markerNodeCount: markerNodes.length,
    scrollWidth: document.documentElement.scrollWidth,
    violations,
    skipTop: Math.round(skip?.getBoundingClientRect().top ?? 0),
  };

  function devOverlay(element: Element | null) {
    let node: Node | null = element;
    while (node) {
      if (node instanceof Element && (node.id === "next-logo" || node.id === "devtools-indicator" || node.classList.contains("nextjs-toast") || node.tagName === "NEXTJS-PORTAL" || (node.getAttribute("aria-label") ?? "").includes("Next.js Dev Tools"))) return true;
      const root = node.getRootNode();
      if (root instanceof ShadowRoot && root.host && root.host !== node) {
        node = root.host;
        continue;
      }
      node = node.parentNode;
    }
    return false;
  }

  function stickyAncestor(element: Element | null) {
    let node = element;
    while (node && node !== document.documentElement) {
      const position = getComputedStyle(node).position;
      if (position === "sticky" || position === "fixed") return node;
      node = node.parentElement;
    }
    return null;
  }

  function clip(element: Element) {
    return (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  }

  // CollectionControls renders nav "Filter by category" with overflow-x auto. Focus scrolls a clipped link into that rail.
  function filterRailClip(element: HTMLElement, box: DOMRect) {
    const rail = element.closest<HTMLElement>("nav[aria-label='Filter by category']");
    const none = { viewportOverflowIsClip: false, fullyHidden: false };
    if (!rail || rail === element) return none;
    const overflowX = getComputedStyle(rail).overflowX;
    if (overflowX !== "auto" && overflowX !== "scroll") return none;
    const railBox = rail.getBoundingClientRect();
    if (railBox.width <= 0 || railBox.left < -1 || railBox.right > innerWidth + 1) return none;
    const extendsOutsideRail = box.left < railBox.left - 1 || box.right > railBox.right + 1;
    const visibleLeft = Math.max(box.left, railBox.left);
    const visibleRight = Math.min(box.right, railBox.right);
    const fullyHidden = visibleRight - visibleLeft <= 1;
    const overflowsViewport = box.left < -1 || box.right > innerWidth + 1;
    const visibleSliceLeft = Math.max(box.left, 0);
    const visibleSliceRight = Math.min(box.right, innerWidth);
    const sliceInsideRail = visibleSliceRight - visibleSliceLeft <= 1
      || (visibleSliceLeft >= railBox.left - 1 && visibleSliceRight <= railBox.right + 1);
    return {
      viewportOverflowIsClip: overflowsViewport && extendsOutsideRail && sliceInsideRail,
      fullyHidden,
    };
  }
}

async function revealFixtureFilterLink(page: Page, categoryName: string, width: number) {
  const rail = page.getByRole("navigation", { name: "Filter by category" });
  const link = rail.getByRole("link", { name: categoryName, exact: true });
  await expect(link, `${width}px fixture filter link`).toHaveCount(1);
  await expect(link).toBeVisible();
  const bound = await page.evaluate(() => document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]").length);
  expect(bound, "rendered tabbable controls").toBeGreaterThan(0);
  let presses = 0;
  for (let attempt = 0; attempt < bound + 8; attempt += 1) {
    await page.keyboard.press("Tab");
    const focusKind = await page.evaluate(() => {
      const overlay = (start: EventTarget | null) => {
        let node: Node | null = start instanceof Node ? start : null;
        while (node) {
          if (node instanceof Element && (node.id === "next-logo" || node.id === "devtools-indicator" || node.classList.contains("nextjs-toast") || node.tagName === "NEXTJS-PORTAL" || (node.getAttribute("aria-label") ?? "").includes("Next.js Dev Tools"))) return true;
          const root = node.getRootNode();
          if (root instanceof ShadowRoot && root.host && root.host !== node) {
            node = root.host;
            continue;
          }
          node = node.parentNode;
        }
        return false;
      };
      const node = document.activeElement;
      if (!node || node === document.body || node === document.documentElement) return "none";
      return overlay(node) ? "overlay" : "product";
    });
    if (focusKind !== "product") continue;
    presses += 1;
    if (await link.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(link, `${width}px fixture filter link is reachable by Tab`).toBeFocused();
  expect(presses, `${width}px Tab presses before the fixture filter link`).toBeGreaterThan(0);
  await expect.poll(async () => link.evaluate((element) => {
    const scroller = element.closest("nav");
    const box = element.getBoundingClientRect();
    const railBox = scroller?.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    const overflowX = scroller ? getComputedStyle(scroller).overflowX : "";
    const fullyInsideRail = Boolean(railBox)
      && box.left >= railBox!.left - 1 && box.right <= railBox!.right + 1
      && box.top >= railBox!.top - 1 && box.bottom <= railBox!.bottom + 1;
    const fullyInsideViewport = box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
    const unobscured = centerX >= 0 && centerX < innerWidth && centerY >= 0 && centerY < innerHeight
      && Boolean(hit && (hit === element || element.contains(hit)));
    return {
      overflowX,
      fullyInsideRail,
      fullyInsideViewport,
      unobscured,
      reachable: document.activeElement === element,
      fitsTarget: box.width >= 44 && box.height >= 44,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  }), `${width}px focused fixture filter link is fully revealed`).toMatchObject({
    overflowX: expect.stringMatching(/^(auto|scroll)$/),
    fullyInsideRail: true,
    fullyInsideViewport: true,
    unobscured: true,
    reachable: true,
    fitsTarget: true,
  });
}

async function signInManager(page: Page) {
  await page.goto(`${API}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
}

async function staffApi(page: Page, url: string, payload: unknown) {
  const response = await page.request.fetch(`${API}${url}`, {
    method: "POST", headers: { origin: API, "content-type": "application/json" }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
