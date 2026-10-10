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
    await expect(page.locator("#collection-sort")).toBeEnabled();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const headline = page.locator('p[lang="en"][aria-hidden="true"]').filter({ hasText: "OWN YOUR" });
    const geometry = await headline.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const lines = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE || node.nodeName === "SPAN")
        .map((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return { text: node.textContent, rects: Array.from(range.getClientRects(), (rect) => ({ left: rect.left, right: rect.right })) };
        });
      return { left: box.left, right: box.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, lines };
    });
    expect(geometry.lines.map((line) => line.text)).toEqual(["OWN YOUR", "PRESENCE."]);
    for (const line of geometry.lines) {
      expect(line.rects, `${line.text} must occupy one complete line`).toHaveLength(1);
      expect(line.rects[0]!.left).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(line.rects[0]!.right).toBeLessThanOrEqual(geometry.right + 1);
    }
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  }
  await page.goto(`${STORE}/products/${fixture.product.id}`);
  const skip = page.getByRole("link", { name: "انتقل إلى المحتوى" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(skip);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);

  const gallery = page.getByRole("region", { name: `صور ${fixture.product.nameAr}` });
  const frame = gallery.getByLabel("استخدم سهمي اليمين واليسار لتصفح صور المنتج");
  await tabTo(page, frame);
  await page.keyboard.press("End");
  await expect(frame).toBeFocused();
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — صورة 3`);
  await tabTo(page, gallery.getByRole("button", { name: "عرض الصورة 2 من 3" }));
  await page.keyboard.press("Enter");
  await expect(gallery.getByRole("button", { name: "عرض الصورة 2 من 3" })).toHaveAttribute("aria-current", "true");
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — صورة 2`);
  await expect(gallery.getByText("الصورة 2 من 3")).toHaveAttribute("aria-live", "polite");

  const panel = page.getByRole("region", { name: "اختر المقاس واللون" });
  const first = panel.getByRole("radio", { name: new RegExp(fixture.firstSize) });
  const unavailable = panel.getByRole("radio", { name: new RegExp(fixture.unavailableSize) });
  const last = panel.getByRole("radio", { name: new RegExp(fixture.lastSize) });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable.locator("..")).toContainText("غير متوفر");
  await tabTo(page, first, unavailable);
  await expect(first).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expectKeyboardFocus(last);
  await expect(last).toBeChecked();
  await expect(first).not.toBeChecked();
  await expect(unavailable).not.toBeChecked();

  const bar = page.getByLabel("إضافة المنتج إلى السلة", { exact: true });
  await expect(bar).toContainText(fixture.lastSize);
  const quantity = panel.getByRole("spinbutton", { name: "الكمية" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(quantity);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  const inlineAdd = panel.getByRole("button", { name: "أضف إلى السلة", exact: true });
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
  await expect(panel.getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
  await expect(quantity).toBeDisabled();
  await expect(bar.getByRole("button", { name: "الكمية المتاحة في السلة" })).toBeDisabled();

  const cartLink = bar.getByRole("link", { name: "تمت الإضافة · عرض السلة" });
  await tabTo(page, cartLink, unavailable);
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
  const summary = page.getByRole("complementary", { name: "ملخص السلة" });
  const refresh = summary.getByRole("button", { name: "تحديث بيانات المنتجات" });
  await expect(refresh).toBeEnabled();
  await tabTo(page, refresh);
  await page.keyboard.press("Enter");
  await expect(refresh).toBeEnabled();
  await expect(line.locator("output")).toHaveText("1");
  if (width === 390) {
    const workspace = await page.request.get(`${INTERNAL}/api/internal/workspace`);
    expect(workspace.status()).toBe(200);
    const branchId = (await workspace.json()).activeBranch.id as string;
    const firstVariantId = fixture.product.variants.find((variant) => variant.size.nameAr === fixture.firstSize)!.id;
    const lastVariantId = fixture.product.variants.find((variant) => variant.size.nameAr === fixture.lastSize)!.id;
    await create(page, "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), branchId,
      receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      lines: [
        { variantId: lastVariantId, quantity: 1, unitCostPiasters: 10_000 },
        { variantId: firstVariantId, quantity: 1, unitCostPiasters: 10_000 },
      ],
    });
    await tabTo(page, refresh);
    await page.keyboard.press("Enter");
    await expect(line.locator("output")).toHaveText("1");
    const increase = line.getByRole("button", { name: "زيادة الكمية" });
    await tabTo(page, increase);
    await expect(increase).toHaveAccessibleName("زيادة الكمية");
    await expectTargetSize(increase);
    await page.keyboard.press("Enter");
    await expect(line.locator("output")).toHaveText("2");
    await tabTo(page, productLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/products/${fixture.product.id}$`));
    const mobileAdd = page.getByLabel("إضافة المنتج إلى السلة", { exact: true }).getByRole("button", { name: "أضف إلى السلة", exact: true });
    await tabTo(page, mobileAdd);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("تمت إضافة الاختيار إلى السلة");
    const addedCart = page.getByLabel("إضافة المنتج إلى السلة", { exact: true }).getByRole("link", { name: "تمت الإضافة · عرض السلة" });
    await tabTo(page, addedCart);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${STORE}/cart`);
    const extra = page.getByRole("article").filter({ hasText: fixture.firstSize });
    const kept = page.getByRole("article").filter({ hasText: fixture.lastSize });
    await expect(extra).toHaveCount(1);
    await expect(kept.locator("output")).toHaveText("2");
    const removeExtra = extra.getByRole("button", { name: "حذف", exact: true });
    await tabTo(page, removeExtra);
    await expect(removeExtra).toHaveAccessibleName("حذف");
    await expectTargetSize(removeExtra);
    await page.keyboard.press("Enter");
    await expect(extra).toHaveCount(0);
    await expect(kept).toHaveCount(1);
    await expect(kept.locator("output")).toHaveText("2");
  }
  const continueShopping = summary.getByRole("link", { name: "متابعة التسوق" });
  await tabTo(page, continueShopping);
  await expectTargetSize(continueShopping);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/#catalog-title`);
  const search = page.getByRole("textbox", { name: "ابحث عن منتج" });
  await expect(search).toBeVisible();
  await tabTo(page, search);
  await page.keyboard.type(fixture.product.nameAr);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator("a.product-card").filter({ hasText: fixture.product.nameAr })).toHaveCount(1);
  if (width === 390) {
    // Client navigation updates the URL while a hidden busy select is still in the tree.
    // Tab only after the visible accessible control is enabled and shows the settled value.
    const sort = page.getByRole("combobox", { name: "ترتيب المنتجات" });
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("default");
    await tabTo(page, sort);
    await expect(sort).toHaveAccessibleName("ترتيب المنتجات");
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/sort=name/);
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("name");
    if (!await sort.evaluate((element) => element === document.activeElement)) await tabTo(page, sort);
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/sort=price-asc/);
    await expect(sort).toBeVisible();
    await expect(sort).toBeEnabled();
    await expect(sort).toHaveAttribute("aria-busy", "false");
    await expect(sort).toHaveValue("price-asc");
    const removeSearch = page.getByRole("link", { name: `إزالة البحث: ${fixture.product.nameAr}` });
    await tabTo(page, removeSearch);
    await expect(removeSearch).toHaveAccessibleName(`إزالة البحث: ${fixture.product.nameAr}`);
    await expectTargetSize(removeSearch);
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page).toHaveURL(/sort=price-asc/);
  }
  await tabTo(page, page.getByRole("banner").locator('a[href="/cart"]'));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/cart`);
  const checkoutLink = summary.getByRole("link", { name: "متابعة إتمام الطلب" });
  await tabTo(page, checkoutLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/checkout`);

  const form = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  const name = form.getByRole("textbox", { name: "الاسم" });
  const phone = form.getByRole("textbox", { name: "رقم الموبايل الأساسي" });
  const area = form.getByRole("combobox", { name: "منطقة التوصيل" });
  const address = form.getByRole("textbox", { name: "العنوان بالتفصيل" });
  const addressValue = width === 390
    ? `الفيوم، شارع الجامعة الطويل بجوار مكتبة BRAVOS Classic ${fixture.product.nameAr}، مبنى 12، الدور الثالث، شقة 4، البوابة الخضراء 2026`
    : "الفيوم، شارع الاختبار بجوار BRAVOS 2026";
  await tabTo(page, name);
  await expect(name).toHaveAccessibleName("الاسم");
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
    const review = form.getByRole("button", { name: "مراجعة السعر", exact: true });
    await tabTo(page, review);
    const quoteResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/public/checkout/quote") && response.ok());
    await page.keyboard.press("Enter");
    const quote = await (await quoteResponse).json() as { lines: Array<{ productId: string; quantity: number }>; deliveryFeePiasters: number };
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({ productId: fixture.product.id, quantity: 2 });
    expect(quote.deliveryFeePiasters).toBe(2500);
    const quoteStatus = form.getByRole("status").filter({ hasText: "تم تحديث السعر من المخزون والإعدادات الحالية." });
    await expect(quoteStatus).toBeVisible();
    await expect(page.getByRole("region", { name: "تفاصيل السعر" })).toContainText("الإجمالي عند الاستلام");
    const submit = form.getByRole("button", { name: "إرسال طلب التوصيل" });
    await tabTo(page, submit);
    await page.keyboard.press("Enter");
    await expectKeyboardFocus(name);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", "customerName-error");
    await expect(page.locator("#customerName-error")).toHaveText("أكمل هذا الحقل.");
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
    await expect(page.locator("#detailedAddress-error")).toHaveText("اكتب العنوان بالتفصيل.");
    expect(orderPosts).toBe(0);
    await page.keyboard.type(addressValue);
    await expect(address).toHaveValue(addressValue);
    await expect(address).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#detailedAddress-error")).toHaveCount(0);
    await tabTo(page, submit);
    const orderResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/public/checkout/orders"));
    await page.keyboard.press("Enter");
    const order = await orderResponse;
    expect(order.status()).toBe(201);
    expect(orderPosts).toBe(1);
    await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
    const acknowledgment = page.getByRole("status");
    await expect(acknowledgment).toHaveText("استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.");
    const returnLink = page.getByRole("link", { name: "العودة إلى المتجر" });
    await tabTo(page, returnLink);
    await expect(returnLink).toHaveAccessibleName("العودة إلى المتجر");
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
    await expect(form.getByRole("button", { name: "مراجعة السعر", exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: testInfo.outputPath(`checkout-keyboard-address-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
}

test("more than forty real category links can be tabbed through to search", async ({ page }) => {
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
  for (let index = 0; index < 41; index += 1) {
    const padded = String(index + 1).padStart(2, "0");
    const category = await create<{ id: string }>(page, "/api/internal/catalog/categories", {
      nameAr: `تصنيف عبور ${suffix} ${padded}`,
    });
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
  await page.goto(`${STORE}/`);
  const navigation = page.getByRole("navigation", { name: "اكتشف تصنيفات المتجر" });
  await expect(navigation).toBeVisible();
  const links = navigation.getByRole("link");
  await expect.poll(async () => links.count(), { message: "rendered category links" }).toBeGreaterThan(40);
  const search = page.getByRole("textbox", { name: "ابحث عن منتج" });
  await expect(search).toBeVisible();
  const trace = await tabTo(page, search);
  expect(trace.categoryLinks, "real Tab presses through category links before search").toBeGreaterThan(40);
  await expect(search).toBeFocused();
});

test("reduced-motion desktop keyboard gallery preserves focus and leaves purchase content visible", async ({ page }, testInfo) => {
  const fixture = await seedProduct(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${STORE}/products/${fixture.product.id}`);
  const gallery = page.getByRole("region", { name: `صور ${fixture.product.nameAr}` });
  const panel = page.getByRole("region", { name: "اختر المقاس واللون" });
  await expect(page.getByRole("heading", { name: fixture.product.nameAr })).toBeVisible();
  await expect(panel.getByRole("spinbutton", { name: "الكمية" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "أضف إلى السلة", exact: true })).toBeVisible();

  const frame = gallery.getByLabel("استخدم سهمي اليمين واليسار لتصفح صور المنتج");
  await tabTo(page, frame);
  for (const [key, image] of [["End", 3], ["Home", 1]] as const) {
    await page.keyboard.press(key);
    await expectKeyboardFocus(frame);
    await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — صورة ${image}`);
    await expect(gallery.getByText(`الصورة ${image} من 3`)).toBeVisible();
  }
  const next = gallery.getByRole("button", { name: "الصورة التالية" });
  await tabTo(page, next);
  await page.keyboard.press("Space");
  await expectKeyboardFocus(next);
  await expect(gallery.getByRole("img")).toHaveAccessibleName(`${fixture.product.nameAr} — صورة 2`);

  const first = panel.getByRole("radio", { name: new RegExp(fixture.firstSize) });
  const last = panel.getByRole("radio", { name: new RegExp(fixture.lastSize) });
  await tabTo(page, first);
  await page.keyboard.press("ArrowDown");
  await expectKeyboardFocus(last);
  await expect(last).toBeChecked();
  await expect(panel.getByRole("button", { name: "أضف إلى السلة", exact: true })).toBeVisible();
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
  const category = await create<{ id: string }>(page, "/api/internal/catalog/categories", { nameAr: `وصول لوحة المفاتيح ${suffix}` });
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
    variants: sizes.map((size) => ({ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null })),
  });
  const workspace = await page.request.get(`${INTERNAL}/api/internal/workspace`);
  expect(workspace.status()).toBe(200);
  await create(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: (await workspace.json()).activeBranch.id,
    receiptDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()),
    lines: product.variants.filter((variant) => variant.size.nameAr !== unavailableSize)
      .map((variant) => ({ variantId: variant.id, quantity: 1, unitCostPiasters: 10_000 })),
  });
  const area = await create<{ id: string }>(page, "/api/internal/delivery-areas", {
    nameAr: `منطقة لوحة المفاتيح ${suffix}`, feePiasters: 2500, active: true,
  });
  return { product, firstSize, unavailableSize, lastSize, areaId: area.id };
}

async function create<T = unknown>(page: Page, path: string, payload: unknown): Promise<T> {
  const response = await page.request.post(`${INTERNAL}${path}`, {
    headers: { origin: INTERNAL, "content-type": "application/json" }, data: payload,
  });
  expect(response.status(), `create fixture ${path}`).toBe(201);
  return response.json() as Promise<T>;
}
