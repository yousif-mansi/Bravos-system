import { expect, test, type Page } from "@playwright/test";
import { expectKeyboardFocus, expectTargetSize, tabTo } from "./support/storefront-a11y";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
type SeedProduct = { id: string; nameAr: string; variants: Array<{ id: string; size: { nameAr: string } }> };

for (const width of [320, 390, 768]) {
test(`keyboard at ${width}px reaches gallery, cart recovery actions and checkout fields`, async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const fixture = await seedProduct(page);
  await page.setViewportSize({ width, height: 844 });
  if (width === 320) {
    await page.goto(`${STORE}/`);
    const collectionSort = page.locator("#collection-sort").filter({ visible: true });
    await expect(collectionSort).toHaveCount(1);
    await expect(collectionSort).toBeEnabled();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const hero = page.getByRole("region", { name: "Bravos Menswear", exact: true });
    const homeTitle = hero.locator("#home-title");
    await expect(homeTitle).toHaveText("Bravos Menswear");
    await expect(homeTitle).toHaveClass(/sr-only/);
    const cover = hero.locator("img");
    await expect(cover).toHaveAttribute("alt", "");
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([2048, 774]);
    await expect(hero.locator("a, button, p")).toHaveCount(0);
    await cover.evaluate(async (img: HTMLImageElement) => {
      const targets = [img, img.parentElement].filter((node): node is Element => node instanceof Element);
      const finite = targets.flatMap((node) => node.getAnimations()).filter((animation) => {
        const iterations = animation.effect?.getComputedTiming().iterations;
        return iterations === undefined || Number.isFinite(iterations);
      });
      await Promise.all(finite.map((animation) => animation.finished));
    });
    const coverBox = await cover.boundingBox();
    expect(coverBox).not.toBeNull();
    expect(coverBox!.width).toBeLessThanOrEqual(width);
    expect(await hero.evaluate((section) => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const value = node.textContent?.trim() ?? "";
        if (value && parent && !parent.closest(".sr-only")) parts.push(value);
        node = walker.nextNode();
      }
      return parts;
    })).toEqual([]);
  }
  await page.goto(`${STORE}/products/${fixture.product.id}`);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(skip);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);

  const gallery = page.getByRole("region", { name: `Photos of ${fixture.product.nameAr}` });
  const frame = gallery.getByLabel("Use the left and right arrow keys to browse product photos");
  await tabTo(page, frame);
  await page.keyboard.press("End");
  await expect(frame).toBeFocused();
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 3`);
  await page.keyboard.press("ArrowLeft");
  await expect(frame).toBeFocused();
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 2`);
  await page.keyboard.press("ArrowRight");
  await expect(frame).toBeFocused();
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 3`);
  await tabTo(page, gallery.getByRole("button", { name: "Show photo 2 of 3" }));
  await page.keyboard.press("Enter");
  await expect(gallery.getByRole("button", { name: "Show photo 2 of 3" })).toHaveAttribute("aria-current", "true");
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 2`);
  await expect(gallery.getByText("Photo 2 of 3")).toHaveAttribute("aria-live", "polite");

  const panel = page.getByRole("region", { name: "Choose size and color" });
  const colors = panel.getByRole("group", { name: "Color" });
  const sizes = panel.getByRole("group", { name: "Size" });
  await expect(colors.getByRole("radio")).toHaveCount(1);
  const first = sizes.getByRole("radio", { name: new RegExp(fixture.firstSize) });
  const unavailable = sizes.getByRole("radio", { name: new RegExp(fixture.unavailableSize) });
  const last = sizes.getByRole("radio", { name: new RegExp(fixture.lastSize) });
  await expect(unavailable).toHaveCount(0);
  await tabTo(page, first);
  await expect(first).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expectKeyboardFocus(last);
  await expect(last).toBeChecked();
  await expect(first).not.toBeChecked();
  await expect(unavailable).toHaveCount(0);

  const bar = page.getByLabel("Add product to bag", { exact: true });
  await expect(bar).toContainText(fixture.lastSize);
  const quantity = panel.getByRole("spinbutton", { name: "Quantity" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(quantity);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  const inlineAdd = panel.getByRole("button", { name: "Add to bag", exact: true });
  await expect(inlineAdd).toBeDisabled();
  await expect(bar).toBeHidden();
  await expect(bar.getByRole("button", { includeHidden: true })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("1");
  await expect(inlineAdd).toBeEnabled();
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(inlineAdd);
  await expect(bar).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("phone-keyboard-add-focus.png") });
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  await expect(quantity).toBeDisabled();
  await expect(bar.getByRole("button", { name: "Available quantity is in your bag" })).toBeDisabled();

  const cartLink = bar.getByRole("link", { name: "Added · View bag" });
  await tabTo(page, cartLink);
  await expect(bar).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("phone-keyboard-cart-focus.png") });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/cart`);
  const line = page.getByRole("article").filter({ hasText: fixture.product.nameAr });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(fixture.lastSize);
  await expect(line.locator("output")).toHaveText("1");
  await page.reload();
  await expect(line).toHaveCount(1);
  await expect(line.locator("output")).toHaveText("1");
  await expect(line.locator("output")).toHaveAttribute("aria-live", "polite");
  await expect(line).toContainText(fixture.lastSize);

  const productLink = line.getByRole("link", { name: fixture.product.nameAr });
  await expectTargetSize(productLink);
  const summary = page.getByRole("complementary", { name: "Bag summary" });
  const refresh = summary.getByRole("button", { name: "Refresh product details" });
  await expect(refresh).toBeEnabled();
  await tabTo(page, refresh);
  await page.keyboard.press("Enter");
  await expect(refresh).toBeEnabled();
  await expect(line.locator("output")).toHaveText("1");
  if (width === 390) {
    const workspace = await page.request.get(`${INTERNAL}/api/internal/workspace`);
    expect(workspace.status()).toBe(200);
    const branchId = (await workspace.json()).activeBranch.id as string;
    const lastVariantId = fixture.product.variants.find((variant) => variant.size.nameAr === fixture.lastSize)!.id;
    await create(page, "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), branchId,
      receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      lines: [{ variantId: lastVariantId, quantity: 2, unitCostPiasters: 10_000 }],
    });
    await tabTo(page, refresh);
    await page.keyboard.press("Enter");
    await expect(line.locator("output")).toHaveText("1");
    const increase = line.getByRole("button", { name: "Increase quantity" });
    await tabTo(page, increase);
    await expect(increase).toHaveAccessibleName("Increase quantity");
    await expectTargetSize(increase);
    await page.keyboard.press("Enter");
    await expect(line.locator("output")).toHaveText("2");
    await tabTo(page, productLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/products/${fixture.product.id}$`));
    const mobileAdd = page.getByLabel("Add product to bag", { exact: true }).getByRole("button", { name: "Add to bag", exact: true });
    await tabTo(page, mobileAdd);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Added to your bag.");
    const addedCart = page.getByLabel("Add product to bag", { exact: true }).getByRole("link", { name: "Added · View bag" });
    await tabTo(page, addedCart);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${STORE}/cart`);
    const extra = page.getByRole("article").filter({ hasText: fixture.firstSize });
    const kept = page.getByRole("article").filter({ hasText: fixture.lastSize });
    await expect(extra).toHaveCount(1);
    await expect(kept.locator("output")).toHaveText("2");
    const removeExtra = extra.getByRole("button", { name: "Remove", exact: true });
    await tabTo(page, removeExtra);
    await expect(removeExtra).toHaveAccessibleName("Remove");
    await expectTargetSize(removeExtra);
    await page.keyboard.press("Enter");
    await expect(extra).toHaveCount(0);
    await expect(kept).toHaveCount(1);
    await expect(kept.locator("output")).toHaveText("2");
  }
  const continueShopping = summary.getByRole("link", { name: "Continue shopping" });
  await tabTo(page, continueShopping);
  await expectTargetSize(continueShopping);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/#catalog-title`);
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  const categoryLink = page.getByRole("navigation", { name: "Filter by category" })
    .getByRole("link", { name: fixture.categoryName, exact: true });
  await tabTo(page, categoryLink);
  await expectTargetSize(categoryLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`[?&]category=${fixture.categoryId}`));
  await expect(page.getByRole("region", { name: "Products" }).locator("a.product-card").filter({ hasText: fixture.product.nameAr })).toHaveCount(1);
  if (width === 390) {
    // Client navigation updates the URL while a hidden busy select is still in the tree.
    // Tab only after the visible accessible control is enabled and shows the settled value.
    const sort = page.getByRole("combobox", { name: "Sort" });
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("default");
    await expect(sort.locator("option")).toHaveText(["Default order", "Price: low to high", "Price: high to low"]);
    await tabTo(page, sort);
    await expect(sort).toHaveAccessibleName("Sort");
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/sort=price-asc/);
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("price-asc");
    if (!await sort.evaluate((element) => element === document.activeElement)) await tabTo(page, sort);
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/sort=price-desc/);
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("price-desc");
    const removeCategory = page.getByRole("link", { name: `Remove category: ${fixture.categoryName}` });
    await tabTo(page, removeCategory);
    await expect(removeCategory).toHaveAccessibleName(`Remove category: ${fixture.categoryName}`);
    await expectTargetSize(removeCategory);
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/[?&]category=/);
    await expect(page).toHaveURL(/sort=price-desc/);
    await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  }
  await tabTo(page, page.getByRole("banner").locator('a[href="/cart"]'));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/cart`);
  const checkoutLink = summary.getByRole("link", { name: "Checkout" });
  await tabTo(page, checkoutLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/checkout`);

  const form = page.getByRole("form", { name: "Checkout" });
  const name = form.getByRole("textbox", { name: "Name" });
  const phone = form.getByRole("textbox", { name: "Primary mobile number" });
  const area = form.getByRole("combobox", { name: "Delivery" });
  const address = form.getByRole("textbox", { name: "Detailed address" });
  const optionalDetails = form.locator("details").filter({
    has: form.page().locator("summary", { hasText: "Optional delivery details" }),
  });
  const optionalSummary = optionalDetails.locator("summary");
  await expect(optionalSummary).toHaveText("Optional delivery details");
  await expect(optionalDetails).not.toHaveJSProperty("open", true);
  const collapsedAlternate = form.getByRole("textbox", { name: "Alternate number (optional)", includeHidden: true });
  await expect(collapsedAlternate).toBeAttached();
  await expect(collapsedAlternate).toBeHidden();
  const addressValue = width === 390
    ? `الفيوم، شارع الجامعة الطويل بجوار مكتبة BRAVOS Classic ${fixture.product.nameAr}، مبنى 12، الدور الثالث، شقة 4، البوابة الخضراء 2026`
    : "الفيوم، شارع الاختبار بجوار BRAVOS 2026";
  await tabTo(page, name);
  await expect(name).toHaveAccessibleName("Name");
  if (width === 390) {
    let orderPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/public/checkout/orders")) orderPosts += 1;
    });
    await tabTo(page, area);
    await page.keyboard.press("Home");
    const options = await area.locator("option").count();
    for (let index = 0; index < options && await area.inputValue() !== fixture.areaId; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(area).toHaveValue(fixture.areaId);
    const review = form.getByRole("button", { name: "Review price", exact: true });
    await tabTo(page, review);
    const quoteResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/public/checkout/quote") && response.ok());
    await page.keyboard.press("Enter");
    const quote = await (await quoteResponse).json() as { lines: Array<{ productId: string; quantity: number }>; deliveryFeePiasters: number };
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({ productId: fixture.product.id, quantity: 2 });
    expect(quote.deliveryFeePiasters).toBe(2500);
    const quoteStatus = form.getByRole("status").filter({ hasText: "The price was updated from current stock and settings." });
    await expect(quoteStatus).toBeVisible();
    await expect(page.getByRole("region", { name: "Price details" })).toContainText("Cash on delivery total");
    const submit = form.getByRole("button", { name: "Place order request" });
    await tabTo(page, submit);
    await page.keyboard.press("Enter");
    await expectKeyboardFocus(name);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", "customerName-error");
    await expect(page.locator("#customerName-error")).toHaveText("Complete this field.");
    expect(orderPosts).toBe(0);
    await page.keyboard.type("عميل لوحة المفاتيح");
    await expect(name).toHaveValue("عميل لوحة المفاتيح");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#customerName-error")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(phone);
    await page.keyboard.type("01012345678");
    await expect(phone).toHaveValue("01012345678");
    await tabTo(page, submit);
    await page.keyboard.press("Enter");
    await expectKeyboardFocus(address);
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(address).toHaveAttribute("aria-describedby", "detailedAddress-error");
    await expect(page.locator("#detailedAddress-error")).toHaveText("Enter the detailed address.");
    expect(orderPosts).toBe(0);
    await page.keyboard.type(addressValue);
    await expect(address).toHaveValue(addressValue);
    await expect(address).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#detailedAddress-error")).toHaveCount(0);
    await tabTo(page, optionalSummary);
    await expectKeyboardFocus(optionalSummary);
    await expectTargetSize(optionalSummary);
    await page.keyboard.press("Enter");
    await expect(optionalDetails).toHaveJSProperty("open", true);
    const alternate = form.getByRole("textbox", { name: "Alternate number (optional)", includeHidden: true });
    await expect(alternate).toBeVisible();
    await tabTo(page, alternate);
    await page.keyboard.type("01112345678");
    await expect(alternate).toHaveValue("01112345678");
    await tabTo(page, optionalSummary);
    await page.keyboard.press("Enter");
    await expect(optionalDetails).not.toHaveJSProperty("open", true);
    await expect(alternate).toBeHidden();
    await expect(alternate).toHaveValue("01112345678");
    await page.keyboard.press("Enter");
    await expect(optionalDetails).toHaveJSProperty("open", true);
    await expect(alternate).toBeVisible();
    await expect(alternate).toHaveValue("01112345678");
    await page.keyboard.press("Enter");
    await expect(optionalDetails).not.toHaveJSProperty("open", true);
    await tabTo(page, submit);
    const orderResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/public/checkout/orders"));
    await page.keyboard.press("Enter");
    const order = await orderResponse;
    expect(order.status()).toBe(201);
    expect(order.request().postDataJSON()).toMatchObject({ alternatePhone: "01112345678" });
    expect(orderPosts).toBe(1);
    await expect(page.getByRole("heading", { name: "Order request received" })).toBeVisible();
    const acknowledgment = page.getByRole("status");
    await expect(acknowledgment).toHaveText("We received your order request. It is pending. Placing the request does not reserve the items, and this is not a completed sale.");
    const returnLink = page.getByRole("link", { name: "Back to the store" });
    await tabTo(page, returnLink);
    await expect(returnLink).toHaveAccessibleName("Back to the store");
    await expectTargetSize(returnLink);
  } else {
    await page.keyboard.type("عميل لوحة المفاتيح");
    await expect(name).toHaveValue("عميل لوحة المفاتيح");
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(phone);
    await page.keyboard.type("01012345678");
    await expect(phone).toHaveValue("01012345678");
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(area);
    await page.keyboard.press("Home");
    const options = await area.locator("option").count();
    for (let index = 0; index < options && await area.inputValue() !== fixture.areaId; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(area).toHaveValue(fixture.areaId);
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(address);
    await page.keyboard.type(addressValue);
    await expect(address).toHaveValue(addressValue);
    await expect(form.getByRole("button", { name: "Review price", exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: testInfo.outputPath(`checkout-keyboard-address-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
}

test("more than forty real category links can be tabbed through to category recovery", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`${INTERNAL}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const suffix = crypto.randomUUID().slice(0, 8);
  // Public category links are categories of published products, not empty taxonomy rows.
  const size = await create<{ id: string }>(page, "/api/internal/catalog/sizes", { nameAr: `مقاس عبور ${suffix}` });
  const color = await create<{ id: string }>(page, "/api/internal/catalog/colors", { nameAr: `لون عبور ${suffix}` });
  let selectedCategoryId = "";
  let selectedCategoryName = "";
  for (let index = 0; index < 41; index += 1) {
    const padded = String(index + 1).padStart(2, "0");
    const category = await create<{ id: string }>(page, "/api/internal/catalog/categories", {
      nameAr: `تصنيف عبور ${suffix} ${padded}`,
    });
    if (index === 0) {
      selectedCategoryId = category.id;
      selectedCategoryName = `تصنيف عبور ${suffix} ${padded}`;
    }
    await create(page, "/api/internal/catalog/products", {
      code: `CROSS-${suffix}-${padded}`,
      nameAr: `قطعة عبور ${suffix} ${padded}`,
      descriptionAr: "",
      categoryId: category.id,
      defaultSellingPricePiasters: 20_000,
      publication: "available",
      imageRefs: [],
      sizeGuideAr: null,
      variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${STORE}/?category=${selectedCategoryId}`);
  const navigation = page.getByRole("navigation", { name: "Filter by category" });
  await expect(navigation).toBeVisible();
  const links = navigation.getByRole("link");
  await expect.poll(async () => links.count(), { message: "rendered category links" }).toBeGreaterThan(40);
  const trace = await tabTo(page, links.last());
  expect(trace.categoryLinks, "real Tab presses through category links before recovery").toBeGreaterThan(40);
  await expectKeyboardFocus(links.last());
  const clearCategory = page.getByRole("link", { name: `Remove category: ${selectedCategoryName}` });
  await tabTo(page, clearCategory);
  await expectKeyboardFocus(clearCategory);
  await expectTargetSize(clearCategory);
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/[?&]category=/);
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
});

test("reduced-motion desktop keyboard gallery preserves focus and leaves purchase content visible", async ({ page }, testInfo) => {
  const fixture = await seedProduct(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${STORE}/products/${fixture.product.id}`);
  const gallery = page.getByRole("region", { name: `Photos of ${fixture.product.nameAr}` });
  const panel = page.getByRole("region", { name: "Choose size and color" });
  await expect(page.getByRole("heading", { name: fixture.product.nameAr })).toBeVisible();
  await expect(panel.getByRole("spinbutton", { name: "Quantity" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add to bag", exact: true })).toBeVisible();

  const frame = gallery.getByLabel("Use the left and right arrow keys to browse product photos");
  await tabTo(page, frame);
  for (const [key, image] of [["End", 3], ["Home", 1]] as const) {
    await page.keyboard.press(key);
    await expectKeyboardFocus(frame);
    await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo ${image}`);
    await expect(gallery.getByText(`Photo ${image} of 3`)).toBeVisible();
  }
  await page.keyboard.press("ArrowRight");
  await expectKeyboardFocus(frame);
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 2`);
  await page.keyboard.press("ArrowLeft");
  await expectKeyboardFocus(frame);
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 1`);
  const next = gallery.getByRole("button", { name: "Next photo" });
  await tabTo(page, next);
  await page.keyboard.press("Space");
  await expectKeyboardFocus(next);
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — photo 2`);

  const sizes = panel.getByRole("group", { name: "Size" });
  await expect(panel.getByRole("group", { name: "Color" }).getByRole("radio")).toHaveCount(1);
  const first = sizes.getByRole("radio", { name: new RegExp(fixture.firstSize) });
  const last = sizes.getByRole("radio", { name: new RegExp(fixture.lastSize) });
  await tabTo(page, first);
  await page.keyboard.press("ArrowDown");
  await expectKeyboardFocus(last);
  await expect(last).toBeChecked();
  await expect(panel.getByRole("button", { name: "Add to bag", exact: true })).toBeVisible();
  await expect.poll(() => page.locator("main").evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
  )).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-reduced-motion-variant-focus.png") });
});


async function seedProduct(page: Page) {
  await page.goto(`${INTERNAL}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  const suffix = crypto.randomUUID().slice(0, 8);
  const firstSize = `01 M ${suffix}`;
  const unavailableSize = `02 L ${suffix}`;
  const lastSize = `03 XL ${suffix}`;
  const categoryName = `وصول لوحة المفاتيح ${suffix}`;
  const category = await create<{ id: string }>(page, "/api/internal/catalog/categories", { nameAr: categoryName });
  const sizes: Array<{ id: string }> = [];
  for (const nameAr of [firstSize, unavailableSize, lastSize]) {
    sizes.push(await create<{ id: string }>(page, "/api/internal/catalog/sizes", { nameAr }));
  }
  const color = await create<{ id: string }>(page, "/api/internal/catalog/colors", { nameAr: `أسود ${suffix}` });
  const imageRefs: string[] = [];
  for (let image = 1; image <= 3; image += 1) {
    const media = await create<{ ref: string }>(page, "/api/internal/catalog/media", {
      fileName: `keyboard-${suffix}-${image}.png`, contentType: "image/png", base64: PNG,
    });
    imageRefs.push(media.ref);
  }
  const product = await create<SeedProduct>(page, "/api/internal/catalog/products", {
    code: `KEYBOARD-${suffix}`, nameAr: `قميص ${suffix}`,
    descriptionAr: "قطعة تجريبية للتحقق من الوصول بلوحة المفاتيح.", categoryId: category.id,
    defaultSellingPricePiasters: 25_000, publication: "available", imageRefs,
    sizeGuideAr: "اختر المقاس المناسب قبل الإضافة إلى السلة.",
    variants: sizes.map((size, index) => ({ sizeId: size.id, colorId: color.id, onlineVisible: index !== 1, sellingPricePiastersOverride: null })),
  });
  const workspace = await page.request.get(`${INTERNAL}/api/internal/workspace`);
  expect(workspace.status()).toBe(200);
  const branchId = (await workspace.json()).activeBranch.id;
  const warehouseId = "33333333-3333-4333-8333-333333333333";
  await create(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: warehouseId,
    receiptDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()),
    lines: [{ productId: product.id, quantity: 1, unitCostPiasters: 10_000 }],
  });
  await create(page, "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(), sourceBranchId: warehouseId, destinationBranchId: branchId, productId: product.id, quantity: 1,
  });
  const area = await create<{ id: string }>(page, "/api/internal/delivery-areas", {
    nameAr: `منطقة لوحة المفاتيح ${suffix}`, feePiasters: 2500, active: true,
  });
  return { product, firstSize, unavailableSize, lastSize, areaId: area.id, categoryId: category.id, categoryName };
}

async function create<T = unknown>(page: Page, path: string, payload: unknown): Promise<T> {
  const response = await page.request.post(`${INTERNAL}${path}`, {
    headers: { origin: INTERNAL, "content-type": "application/json" }, data: payload,
  });
  expect(response.status(), `create fixture ${path}`).toBe(201);
  return response.json() as Promise<T>;
}
