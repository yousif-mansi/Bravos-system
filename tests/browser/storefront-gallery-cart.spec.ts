import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectTargetSize, tabTo } from "./support/storefront-a11y";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("product gallery keeps empty and single-image cases simple, and navigates ordered media by keyboard", async ({ page }, testInfo) => {
  await signInManager(page);
  const taxonomy = await seedTaxonomy(page, "gallery");
  const imageRefs: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
      fileName: `gallery-${index}.png`,
      contentType: "image/png",
      base64: PNG.toString("base64"),
    });
    expect(uploaded.status).toBe(201);
    imageRefs.push(uploaded.body.ref as string);
  }
  const empty = await createProduct(page, taxonomy, "GALLERY-EMPTY-E2E", "منتج بلا صور", []);
  const single = await createProduct(page, taxonomy, "GALLERY-SINGLE-E2E", "منتج بصورة واحدة", imageRefs.slice(0, 1));
  const multiple = await createProduct(page, taxonomy, "GALLERY-MULTI-E2E", "منتج بثلاث صور", imageRefs);

  await page.goto(`http://127.0.0.1:3001/products/${empty.id}`);
  const emptyGallery = page.getByRole("region", { name: "Photos of منتج بلا صور" });
  await expect(emptyGallery.getByText("No photo for this product")).toBeVisible();
  await expect(emptyGallery.getByRole("img")).toHaveCount(0);
  await expect(emptyGallery.getByRole("button")).toHaveCount(0);

  await page.goto(`http://127.0.0.1:3001/products/${single.id}`);
  const singleGallery = page.getByRole("region", { name: "Photos of منتج بصورة واحدة" });
  await expect(singleGallery.getByRole("img", { name: "منتج بصورة واحدة — photo 1" })).toHaveAttribute(
    "src", mediaSrc(imageRefs[0]),
  );
  await expect(singleGallery.getByRole("button")).toHaveCount(0);

  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/public/catalog/media/")) mediaRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:3001/products/${multiple.id}`);
  const gallery = page.getByRole("region", { name: "Photos of منتج بثلاث صور" });
  const activeImage = gallery.getByRole("img");
  await expect(activeImage).toHaveCount(1);
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[0]));
  await expect(activeImage).toHaveAttribute("alt", "منتج بثلاث صور — photo 1");
  await expect(gallery.getByText("Photo 1 of 3")).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Show photo 1 of 3" })).toHaveAttribute("aria-current", "true");
  expect(mediaRequests.some((url) => url.includes(imageRefs[1]))).toBe(false);
  expect(mediaRequests.some((url) => url.includes(imageRefs[2]))).toBe(false);

  const frame = gallery.getByLabel("Use the left and right arrow keys to browse product photos");
  await frame.focus();
  await page.keyboard.press("ArrowRight");
  await expect(activeImage).toHaveAttribute("alt", "منتج بثلاث صور — photo 2");
  await expect(gallery.getByText("Photo 2 of 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(activeImage).toHaveAttribute("alt", "منتج بثلاث صور — photo 1");
  await expect(gallery.getByText("Photo 1 of 3")).toBeVisible();

  const secondSelector = gallery.getByRole("button", { name: "Show photo 2 of 3" });
  await secondSelector.focus();
  await expect(secondSelector).toBeFocused();
  await secondSelector.press("Enter");
  await expect(secondSelector).toHaveAttribute("aria-current", "true");
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[1]));
  await expect(gallery.getByText("Photo 2 of 3")).toBeVisible();
  await gallery.getByRole("button", { name: "Next photo" }).click();
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[2]));
  await expect(gallery.getByText("Photo 3 of 3")).toBeVisible();
  await gallery.getByRole("button", { name: "Previous photo" }).focus();
  await gallery.getByRole("button", { name: "Previous photo" }).press("Space");
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[1]));
  const nextButton = gallery.getByRole("button", { name: "Next photo" });
  await nextButton.hover();
  await page.waitForTimeout(250);
  const nextHover = await colorsOf(nextButton);
  await secondSelector.hover();
  await page.waitForTimeout(250);
  const selectorHover = await colorsOf(secondSelector);
  await writeFile(testInfo.outputPath("gallery-computed-styles.json"), JSON.stringify({ nextHover, selectorHover }, null, 2));
  expect(contrastRatio(nextHover.color, nextHover.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(selectorHover.color, selectorHover.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath("gallery-phone-390.png"), fullPage: true });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("gallery-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);

  await page.route(`**/api/public/catalog/media/${imageRefs[2]}`, async (route) => {
    await route.fulfill({ status: 404, body: "" });
  });
  const beforeFailure = await gallery.boundingBox();
  await gallery.getByRole("button", { name: "Show photo 3 of 3" }).click();
  await expect(gallery.getByText("This photo is unavailable right now")).toBeVisible();
  await expect(gallery.getByRole("img")).toHaveCount(0);
  const afterFailure = await gallery.boundingBox();
  expect(beforeFailure).not.toBeNull();
  expect(afterFailure).not.toBeNull();
  expect(Math.abs((afterFailure?.height ?? 0) - (beforeFailure?.height ?? 0))).toBeLessThan(3);
  await gallery.getByRole("button", { name: "Previous photo" }).click();
  await expect(gallery.getByRole("img")).toHaveAttribute("src", mediaSrc(imageRefs[1]));
});

test("cart keeps variant details and edited quantities through reload and a later stock loss", async ({ page }, testInfo) => {
  await signInManager(page);
  const taxonomy = await seedTaxonomy(page, "cart");
  const product = await createProduct(page, taxonomy, "CART-PRESENTATION-E2E", "قميص اختبار السلة", []);
  const first = product.variants[0];
  const secondColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "رملي للسلة" });
  expect(secondColor.status).toBe(201);
  const secondProduct = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, {
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    categoryId: taxonomy.categoryId,
    defaultSellingPricePiasters: 25_000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [
      { sizeId: taxonomy.sizeId, colorId: taxonomy.colorId, sellingPricePiastersOverride: null },
      { sizeId: taxonomy.sizeId, colorId: secondColor.body.id, sellingPricePiastersOverride: 30_000 },
    ],
  });
  expect(secondProduct.status).toBe(200);
  const second = secondProduct.body.variants.find((variant: { color: { id: string } }) => variant.color.id === secondColor.body.id);
  expect(second).toBeTruthy();
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json()).activeBranch.id,
    receiptDate: cairoDate(),
    lines: [
      { variantId: first.id, quantity: 3, unitCostPiasters: 10_000 },
      { variantId: second.id, quantity: 1, unitCostPiasters: 12_000 },
    ],
  });
  expect(received.status).toBe(201);

  await page.goto("http://127.0.0.1:3001");
  await page.evaluate(({ productId, firstId, secondId }) => {
    localStorage.setItem("bravos-guest-cart-v1", JSON.stringify({
      version: 1,
      revision: `presentation-${Date.now()}`,
      items: [
        { productId, variantId: firstId, productNameAr: "قميص اختبار السلة", sizeNameAr: "M للسلة", colorNameAr: "أسود للسلة", unitPricePiasters: 25_000, imageRef: null, quantity: 2, knownAvailableQuantity: 3, orderable: true },
        { productId, variantId: secondId, productNameAr: "قميص اختبار السلة", sizeNameAr: "M للسلة", colorNameAr: "رملي للسلة", unitPricePiasters: 30_000, imageRef: null, quantity: 1, knownAvailableQuantity: 1, orderable: true },
      ],
    }));
  }, { productId: product.id, firstId: first.id, secondId: second.id });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3001/cart");
  const lines = page.locator(".cart-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("M للسلة");
  await expect(lines.first()).toContainText("أسود للسلة");
  await expect(lines.first()).toContainText(`Unit price ${money(25_000)}`);
  await expect(lines.first()).toContainText(`Selection total${money(50_000)}`);
  await expect(lines.first().locator("output")).toHaveText("2");
  await expect(lines.nth(1)).toContainText("رملي للسلة");
  await expect(lines.nth(1)).toContainText(`Selection total${money(30_000)}`);
  const summary = page.getByRole("complementary", { name: "Bag summary" });
  await expect(summary).toContainText("Items3");
  await expect(summary).toContainText(`Estimated total${money(80_000)}`);
  await expect(summary).toContainText("Before discounts and delivery. Review the final total at checkout.");
  await expect(summary).toContainText("Items in your bag are not reserved.");
  const checkoutLink = page.getByRole("link", { name: "Checkout" });
  await expect(checkoutLink).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cart-phone-390.png"), fullPage: true });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);

  const note = summary.getByText("Before discounts and delivery. Review the final total at checkout.");
  const noteColor = await note.evaluate((element) => getComputedStyle(element).color);
  const summaryBackground = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
  const increase = lines.first().getByRole("button", { name: "Increase quantity" });
  const quantityBase = await colorsOf(increase);
  await increase.hover();
  await page.waitForTimeout(250);
  const quantityHover = await colorsOf(increase);
  await checkoutLink.hover();
  await page.waitForTimeout(250);
  const checkoutHover = await colorsOf(checkoutLink);
  await checkoutLink.focus();
  const checkoutFocus = await checkoutLink.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth };
  });
  await writeFile(
    testInfo.outputPath("cart-computed-styles.json"),
    JSON.stringify({ noteColor, summaryBackground, quantityBase, quantityHover, checkoutHover, checkoutFocus }, null, 2),
  );
  expect(contrastRatio(noteColor, summaryBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(quantityHover.color, quantityHover.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(checkoutHover.color, checkoutHover.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  expect(checkoutFocus.outlineStyle).not.toBe("none");
  expect(parseFloat(checkoutFocus.outlineWidth)).toBeGreaterThanOrEqual(1);

  await lines.first().getByRole("button", { name: "Decrease quantity" }).focus();
  await lines.first().getByRole("button", { name: "Decrease quantity" }).press("Enter");
  await expect(lines.first().locator("output")).toHaveText("1");
  await expect(summary).toContainText(`Estimated total${money(55_000)}`);
  await page.reload();
  await expect(lines.first().locator("output")).toHaveText("1");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null"));
  expect(saved.items.map((item: { quantity: number }) => item.quantity)).toEqual([1, 1]);

  const sale = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), employeeDiscountPiasters: 0,
    lines: [{ variantId: second.id, quantity: 1 }], physicallyCompleted: true,
  });
  expect(sale.status).toBe(201);
  await page.getByRole("button", { name: "Refresh product details" }).click();
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1).getByRole("alert")).toContainText("This selection is unavailable right now");
  await expect(page.getByRole("link", { name: "Checkout" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("cart-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
});

test("cart preserves every saved selection through a slow failed availability read and a real retry", async ({ page }, testInfo) => {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const taxonomy = await seedTaxonomy(page, `retry-${suffix}`);
  const first = await createProduct(page, taxonomy, `CART-RETRY-A-${suffix}`, `قميص إعادة المحاولة ${suffix}`, []);
  const second = await createProduct(page, taxonomy, `CART-RETRY-B-${suffix}`, `بنطال إعادة المحاولة ${suffix}`, []);
  await receiveCartStock(page, [
    { variantId: first.variants[0].id, quantity: 3 },
    { variantId: second.variants[0].id, quantity: 2 },
  ]);
  const day = cairoDate();
  const analyticsUrl = `http://127.0.0.1:5174/api/internal/analytics?from=${day}&to=${day}`;
  const beforeAnalytics = await page.request.get(analyticsUrl);
  expect(beforeAnalytics.status()).toBe(200);
  const beforeCount = (await beforeAnalytics.json()).metrics.successfulCartAdditions.count as number;
  const additionOperationIds = new Set<string>();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/public/analytics/events" && request.method() === "POST") {
      const event = request.postDataJSON() as { eventType: string; operationId: string };
      if (event.eventType === "cart_addition") additionOperationIds.add(event.operationId);
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await addProductToCart(page, first.id, 2);
  await addProductToCart(page, second.id, 1);
  await expect.poll(() => additionOperationIds.size).toBe(2);
  await expect.poll(async () => (await (await page.request.get(analyticsUrl)).json()).metrics.successfulCartAdditions.count).toBe(beforeCount + 2);
  const savedBefore = await savedCartItems(page);
  expect(savedBefore.map((item: { variantId: string; quantity: number }) => ({ variantId: item.variantId, quantity: item.quantity }))).toEqual([
    { variantId: first.variants[0].id, quantity: 2 },
    { variantId: second.variants[0].id, quantity: 1 },
  ]);

  const failureGate = controlledGate();
  let interceptedReads = 0;
  const productPath = `/api/public/catalog/products/${first.id}`;
  await page.route(`**${productPath}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    interceptedReads += 1;
    await failureGate.wait;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Temporary availability failure" }) });
  });
  try {
    await page.goto("http://127.0.0.1:3001/cart");
    await expect.poll(() => interceptedReads).toBe(1);
    const lines = page.locator(".cart-line");
    const summary = page.getByRole("complementary", { name: "Bag summary" });
    await expect(page.locator(".cart-status")).toHaveText("Checking product details and prices…");
    const pendingRefresh = summary.getByRole("button", { name: "Updating products…" });
    await expect(pendingRefresh).toBeDisabled();
    await expect(pendingRefresh).toHaveAttribute("aria-busy", "true");
    await expect(lines).toHaveCount(2);
    await expect(lines.first().locator("output")).toHaveText("2");
    await expect(lines.nth(1).locator("output")).toHaveText("1");
    expect(await savedCartItems(page)).toEqual(savedBefore);

    failureGate.release();
    const failedStatus = page.locator(".cart-status");
    await expect(failedStatus).toHaveAttribute("role", "status");
    await expect(failedStatus).toHaveText("Stock couldn't be checked right now. Try again before continuing your order.");
    await expect(lines.first().locator("output")).toHaveAttribute("aria-live", "polite");
    await expect(lines.nth(1).locator("output")).toHaveAttribute("aria-live", "polite");
    const refresh = summary.getByRole("button", { name: "Refresh product details" });
    await expect(refresh).toBeEnabled();
    await expect(refresh).toHaveAttribute("aria-busy", "false");
    await expect(lines).toHaveCount(2);
    await expect(lines.first().locator("output")).toHaveText("2");
    await expect(lines.nth(1).locator("output")).toHaveText("1");
    await expect(lines.getByRole("alert")).toHaveCount(0);
    await expect(summary.getByText("Update the unavailable selections before checkout.")).toHaveCount(0);
    expect(await savedCartItems(page)).toEqual(savedBefore);

    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cart-read-failed-phone-390.png"), fullPage: true });

    const repriced = await staffApi(page, "PATCH", `/api/internal/catalog/products/${first.id}`, {
      code: first.code, nameAr: first.nameAr, descriptionAr: first.descriptionAr,
      categoryId: taxonomy.categoryId, defaultSellingPricePiasters: 28_000,
      publication: "available", imageRefs: [], sizeGuideAr: null,
      variants: [{ sizeId: taxonomy.sizeId, colorId: taxonomy.colorId, sellingPricePiastersOverride: null }],
    });
    expect(repriced.status).toBe(200);
    const sale = await staffApi(page, "POST", "/api/internal/sales", {
      saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), employeeDiscountPiasters: 0,
      lines: [{ variantId: second.variants[0].id, quantity: 2 }], physicallyCompleted: true,
    });
    expect(sale.status).toBe(201);
    await page.unroute(`**${productPath}`);
    await expectTargetSize(refresh);
    await tabTo(page, refresh);
    const retryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === productPath && response.request().method() === "GET");
    await page.keyboard.press("Enter");
    expect((await retryResponse).status()).toBe(200);
    const recoveredStatus = page.locator(".cart-status");
    await expect(recoveredStatus).toHaveAttribute("role", "status");
    await expect(recoveredStatus).toHaveText("Product details were updated. Review the changes and notices before you continue.");
    await expect(refresh).toBeEnabled();
    await expect(lines).toHaveCount(2);
    await expect(lines.first().locator("output")).toHaveText("2");
    await expect(lines.nth(1).locator("output")).toHaveText("1");
    await expect(lines.first()).toContainText(`Unit price ${money(28_000)}`);
    await expect(lines.nth(1).getByRole("alert")).toContainText("This selection is unavailable right now");
    await expect(summary).toContainText(`Estimated total${money(81_000)}`);
    const savedAfter = await savedCartItems(page);
    expect(savedAfter).toEqual([
      { ...savedBefore[0], unitPricePiasters: 28_000 },
      { ...savedBefore[1], knownAvailableQuantity: 0, orderable: false },
    ]);
    expect(additionOperationIds.size).toBe(2);
    const afterAnalytics = await page.request.get(analyticsUrl);
    expect(afterAnalytics.status()).toBe(200);
    expect((await afterAnalytics.json()).metrics.successfulCartAdditions.count).toBe(beforeCount + 2);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cart-read-recovered-phone-390.png"), fullPage: true });
  } finally {
    failureGate.release();
    await page.unroute(`**${productPath}`);
  }
});

test("cart replaces failed media with an unavailable-photo fallback and shows a later replacement image", async ({ page }, testInfo) => {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const taxonomy = await seedTaxonomy(page, `media-${suffix}`);
  const imageRefs: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
      fileName: `cart-media-${suffix}-${index}.png`, contentType: "image/png", base64: PNG.toString("base64"),
    });
    expect(uploaded.status).toBe(201);
    imageRefs.push(uploaded.body.ref as string);
  }
  const product = await createProduct(page, taxonomy, `CART-MEDIA-${suffix}`, `قميص الصورة ${suffix}`, [imageRefs[0]]);
  await receiveCartStock(page, [{ variantId: product.variants[0].id, quantity: 3 }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await addProductToCart(page, product.id, 2);
  const savedBefore = await savedCartItems(page);
  const mediaGate = controlledGate();
  let requested = false;
  await page.route(`**/api/public/catalog/media/${imageRefs[0]}`, async (route) => {
    requested = true;
    await mediaGate.wait;
    await route.fulfill({ status: 404, body: "" });
  });
  try {
    await page.goto("http://127.0.0.1:3001/cart", { waitUntil: "domcontentloaded" });
    const line = page.locator(".cart-line");
    await expect(line).toHaveCount(1);
    await expect.poll(() => requested).toBe(true);
    const image = line.locator("img");
    await expect(image).toHaveAttribute("alt", "");
    await expect(image).toHaveAttribute("src", mediaSrc(imageRefs[0]));
    const photo = line.locator(":scope > div").first();
    const beforeFailure = await photo.boundingBox();
    mediaGate.release();
    await expect(line.getByText("This photo is unavailable right now")).toBeVisible();
    await expect(line.locator("img")).toHaveCount(0);
    const afterFailure = await photo.boundingBox();
    expect(beforeFailure).not.toBeNull();
    expect(afterFailure).not.toBeNull();
    expect(afterFailure?.width).toBe(beforeFailure?.width);
    expect(afterFailure?.height).toBe(beforeFailure?.height);
    await expect(line.locator("output")).toHaveText("2");
    await expect(line.getByRole("button", { name: "Decrease quantity" })).toBeEnabled();
    await expect(line.getByRole("button", { name: "Increase quantity" })).toBeEnabled();
    const remove = line.getByRole("button", { name: "Remove", exact: true });
    await expect(remove).toBeEnabled();
    await expectTargetSize(remove);
    expect(await savedCartItems(page)).toEqual(savedBefore);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cart-image-fallback-phone-390.png"), fullPage: true });

    const updated = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, {
      code: product.code, nameAr: product.nameAr, descriptionAr: product.descriptionAr,
      categoryId: taxonomy.categoryId, defaultSellingPricePiasters: 25_000,
      publication: "available", imageRefs: [imageRefs[1]], sizeGuideAr: null,
      variants: [{ sizeId: taxonomy.sizeId, colorId: taxonomy.colorId, sellingPricePiastersOverride: null }],
    });
    expect(updated.status).toBe(200);
    const refreshMedia = page.getByRole("button", { name: "Refresh product details" });
    await expectTargetSize(refreshMedia);
    await tabTo(page, refreshMedia);
    const replacementResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/public/catalog/media/${imageRefs[1]}`);
    await page.keyboard.press("Enter");
    expect((await replacementResponse).status()).toBe(200);
    await expect(line.locator("img")).toHaveAttribute("src", mediaSrc(imageRefs[1]));
    await expect(line.locator("img")).toHaveAttribute("alt", "");
    await expect.poll(() => line.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(line.getByText("This photo is unavailable right now")).toHaveCount(0);
    await expect(line.locator("output")).toHaveText("2");
    expect(await savedCartItems(page)).toEqual([{ ...savedBefore[0], imageRef: imageRefs[1] }]);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cart-image-replaced-phone-390.png"), fullPage: true });
  } finally {
    mediaGate.release();
    await page.unroute(`**/api/public/catalog/media/${imageRefs[0]}`);
  }
});

async function receiveCartStock(page: Page, lines: Array<{ variantId: string; quantity: number }>) {
  const workspace = await page.request.get("http://127.0.0.1:5174/api/internal/workspace");
  expect(workspace.status()).toBe(200);
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: (await workspace.json()).activeBranch.id, receiptDate: cairoDate(),
    lines: lines.map((line) => ({ ...line, unitCostPiasters: 10_000 })),
  });
  expect(received.status).toBe(201);
}

async function addProductToCart(page: Page, productId: string, quantity: number) {
  await page.goto(`http://127.0.0.1:3001/products/${productId}`);
  await expect(page.getByRole("button", { name: "Preview bag", exact: true })).toBeEnabled();
  const panel = page.locator(".purchase-panel");
  await panel.getByLabel("Quantity").fill(String(quantity));
  await expect(panel.getByLabel("Quantity")).toHaveValue(String(quantity));
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
}

async function savedCartItems(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null").items);
}

function controlledGate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function seedTaxonomy(page: Page, suffix: string) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${suffix === "cart" ? "للسلة" : suffix === "gallery" ? "للمعرض" : suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: suffix === "cart" ? "أسود للسلة" : suffix === "gallery" ? "أسود للمعرض" : `أسود ${suffix}` });
  expect(category.status).toBe(201);
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);
  return { categoryId: category.body.id as string, sizeId: size.body.id as string, colorId: color.body.id as string };
}

async function createProduct(page: Page, taxonomy: Awaited<ReturnType<typeof seedTaxonomy>>, code: string, nameAr: string, imageRefs: string[]) {
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr,
    descriptionAr: "وصف منتج اختبار المتجر",
    categoryId: taxonomy.categoryId,
    defaultSellingPricePiasters: 25_000,
    publication: "available",
    imageRefs,
    sizeGuideAr: null,
    variants: [{ sizeId: taxonomy.sizeId, colorId: taxonomy.colorId, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  return product.body;
}

async function staffApi(page: Page, method: "POST" | "PATCH", url: string, payload: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", "content-type": "application/json" },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function colorsOf(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { color: computed.color, backgroundColor: computed.backgroundColor };
  });
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (rgb: string) => {
    const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unexpected computed color: ${rgb}`);
    const linear = channels.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function money(piasters: number) {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    currencyDisplay: "code",
    minimumFractionDigits: piasters % 100 === 0 ? 0 : 2,
  }).format(piasters / 100).replace(/\u00a0/g, " ");
}

function mediaSrc(ref: string) {
  return new RegExp(`/api/public/catalog/media/${ref.replaceAll(".", "\\.")}$`);
}
