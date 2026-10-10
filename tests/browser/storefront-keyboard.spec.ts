import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
type SeedProduct = { id: string; nameAr: string; variants: Array<{ id: string; size: { nameAr: string } }> };

for (const width of [320, 390, 768]) {
test(`keyboard at ${width}px reaches gallery, cart recovery actions and checkout fields`, async ({ page }, testInfo) => {
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
  await tabTo(page, page.getByRole("banner").locator('a[href="/cart"]'));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/cart`);
  const checkoutLink = summary.getByRole("link", { name: "متابعة إتمام الطلب" });
  await tabTo(page, checkoutLink);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${STORE}/checkout`);

  const form = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  const name = form.getByRole("textbox", { name: "الاسم" });
  await tabTo(page, name);
  await page.keyboard.type("عميل لوحة المفاتيح");
  await expect(name).toHaveValue("عميل لوحة المفاتيح");
  const phone = form.getByRole("textbox", { name: "رقم الموبايل الأساسي" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(phone);
  await page.keyboard.type("01012345678");
  await expect(phone).toHaveValue("01012345678");
  const area = form.getByRole("combobox", { name: "منطقة التوصيل" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(area);
  await page.keyboard.press("Home");
  const options = await area.locator("option").count();
  for (let index = 0; index < options && await area.inputValue() !== fixture.areaId; index += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(area).toHaveValue(fixture.areaId);
  const address = form.getByRole("textbox", { name: "العنوان بالتفصيل" });
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(address);
  await page.keyboard.type("الفيوم، شارع الاختبار بجوار BRAVOS 2026");
  await expect(address).toHaveValue("الفيوم، شارع الاختبار بجوار BRAVOS 2026");
  await expect(form.getByRole("button", { name: "مراجعة السعر", exact: true })).toBeEnabled();
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
  const links = page.getByRole("navigation", { name: "اكتشف تصنيفات المتجر" }).getByRole("link");
  expect(await links.count(), "rendered category links").toBeGreaterThan(40);
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

// Advance with real Tab presses, without programmatic focus or a fixed DOM order.
// The bound is the number of currently rendered tabbable controls. Repeating a focused
// element means the cycle ended before the target.
async function tabTo(page: Page, target: Locator, unavailable?: Locator) {
  await expect(target).toBeVisible();
  const bound = await page.evaluate(() => {
    function tabbable(element: Element) {
      if (!(element instanceof HTMLElement)) return false;
      if (element.tabIndex < 0 || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
      if (element.closest("[hidden], [inert]")) return false;
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      if (element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    return [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")].filter(tabbable).length;
  });
  expect(bound, "rendered tabbable controls").toBeGreaterThan(0);
  const seen = new Set<string>();
  let categoryLinks = 0;
  for (let step = 0; step < bound; step += 1) {
    await page.keyboard.press("Tab");
    if (unavailable) await expect(unavailable).not.toBeFocused();
    const focused = page.locator(":focus").filter({ hasNot: page.locator(":focus") });
    await expectKeyboardFocus(focused);
    const identity = await focused.evaluate((element) => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.documentElement) {
        const parent: HTMLElement | null = node.parentElement;
        const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
        parts.push(`${node.tagName}:${index}`);
        node = parent;
      }
      return parts.join(">");
    });
    if (seen.has(identity)) {
      throw new Error(`Focus cycled at ${identity} after ${step + 1} Tab presses before reaching ${target}. Rendered tabbable controls: ${bound}.`);
    }
    seen.add(identity);
    const href = await focused.evaluate((element) => element.getAttribute("href"));
    if (href?.includes("category=")) categoryLinks += 1;
    if (await target.count() > 0 && await target.evaluate((element) => element === document.activeElement)) {
      return { steps: step + 1, categoryLinks };
    }
  }
  throw new Error(`Keyboard could not reach ${target} within ${bound} rendered tabbable controls`);
}

async function expectKeyboardFocus(target: Locator) {
  await expect(target).toBeFocused();
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  await expect.poll(() => target.evaluate((element) => {
    const indicator = element.matches('input[type="radio"]') ? element.closest("label")! : element;
    const style = getComputedStyle(indicator);
    return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  }), "keyboard focus has a visible indicator").toBe(true);
  let geometry: unknown;
  try {
    await expect.poll(async () => {
      geometry = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        const style = getComputedStyle(element);
        const rootStyle = getComputedStyle(document.documentElement);
        const bar = document.querySelector('[aria-label="إضافة المنتج إلى السلة"]');
        return {
          unobscured: centerX >= 0 && centerX < innerWidth && centerY >= 0 && centerY < innerHeight
            && Boolean(hit && (element === hit || element.contains(hit))),
          tag: element.tagName,
          publicText: element.textContent?.trim().slice(0, 120),
          bounds: box.toJSON(),
          center: { x: centerX, y: centerY },
          hitTag: hit?.tagName ?? null,
          hitPublicText: hit?.textContent?.trim().slice(0, 120) ?? null,
          viewport: { width: innerWidth, height: innerHeight, scrollY },
          rootScrollPadding: { start: rootStyle.scrollPaddingBlockStart, end: rootStyle.scrollPaddingBlockEnd },
          computedScrollMargin: { start: style.scrollMarginBlockStart, end: style.scrollMarginBlockEnd },
          mobileBar: bar ? { bounds: bar.getBoundingClientRect().toJSON(), visibility: getComputedStyle(bar).visibility } : null,
        };
      });
      return geometry;
    }, "keyboard focus is inside the viewport and unobscured").toMatchObject({ unobscured: true });
  } catch (error) {
    await target.page().screenshot({ path: test.info().outputPath("focus-obstruction.png") });
    const geometryPath = test.info().outputPath("focus-obstruction.json");
    await writeFile(geometryPath, JSON.stringify(geometry, null, 2));
    await test.info().attach("focus-obstruction.json", {
      path: geometryPath, contentType: "application/json",
    });
    throw error;
  }
}

async function expectTargetSize(target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
}

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
