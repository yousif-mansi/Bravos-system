import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expectContrast, expectTargetCoverage, expectTargetSize, measureContrast, tabTo, type ContrastSample } from "./support/storefront-a11y";

const STORE = "http://127.0.0.1:3001";
const API = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ACKNOWLEDGMENT = "استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.";

test("storefront route presentation remains reachable across supported widths and zoom equivalent", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const marker = `SF12-${suffix}`;
  const query = `BRAVOS Classic نص عربي لاتيني ${marker}`;
  const categoryName = `تصنيف ${query}`;
  const sizeName = `مقاس XL ${marker}`;
  const colorName = `لون أسود ${marker}`;
  const unavailableColorName = `لون غير متوفر ${marker}`;
  const productName = `قميص ${query} للتأكد من حدود السطر`;
  const address = `الفيوم، شارع الجامعة الطويل بجوار مكتبة BRAVOS Classic ${marker}، مبنى 12، الدور الثالث، شقة 4، البوابة الخضراء 2026`;
  expect(query.length).toBeLessThanOrEqual(80);

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
    descriptionAr: `وصف ${query} مع أرقام 2026 و ٣٥٠ للتحقق من اتجاه النص والتفافه.`,
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
    { name: "collection", url: `${STORE}/?q=${encodeURIComponent(query)}&category=${category.body.id}`, ready: "a.product-card" },
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
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة");

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(route.url);
      await expect(page.locator(route.ready).first()).toBeVisible();
      if (route.name === "arrival") {
        await expect(page.getByRole("heading", { name: "اختيارات هادئة. حضور واضح." })).toBeVisible();
        await expect(page.getByRole("heading", { name: "اختيارك يبدأ هنا." })).toBeVisible();
        const categoryLink = page.getByRole("navigation", { name: "اكتشف تصنيفات المتجر" }).getByRole("link", { name: categoryName });
        await expect(categoryLink).toBeVisible();
        await expectTargetSize(categoryLink);
      }
      if (route.name === "collection") {
        await expect(page.getByRole("heading", { level: 1 })).toContainText(categoryName);
        const chip = page.getByRole("link", { name: `إزالة البحث: ${query}` });
        const clearAll = page.getByRole("link", { name: "مسح كل التصفية" });
        const selectedCategory = page.getByRole("navigation", { name: "تصفية حسب التصنيف" }).getByRole("link", { name: categoryName, exact: true });
        await expect(chip).toBeVisible();
        await expectTargetSize(chip);
        await expectTargetSize(clearAll);
        await expectTargetSize(selectedCategory);
        await expect(page.locator("a.product-card").filter({ hasText: productName })).toBeVisible();
      }
      if (route.name === "product") {
        await expect(page.getByRole("heading", { name: productName })).toBeVisible();
        await expect(page.getByText(sizeName).first()).toBeVisible();
        await expect(page.getByText(colorName).first()).toBeVisible();
        const gallery = page.getByRole("region", { name: `صور ${productName}` });
        await expectTargetSize(gallery.getByRole("button", { name: "الصورة التالية" }));
        await expectTargetSize(gallery.getByRole("button", { name: "الصورة السابقة" }));
        await expectTargetSize(gallery.getByRole("button", { name: "عرض الصورة 2 من 2" }));
        const variant = page.getByRole("radio", { name: new RegExp(colorName) });
        const labelBox = await variant.locator("xpath=ancestor::label[1]").boundingBox();
        expect(labelBox?.width, "enabled variant label width").toBeGreaterThanOrEqual(44);
        expect(labelBox?.height, "enabled variant label height").toBeGreaterThanOrEqual(44);
      }
      if (route.name === "cart") {
        await expect(page.getByRole("button", { name: "حذف", exact: true })).toBeVisible();
        await expectTargetSize(page.getByRole("button", { name: "حذف", exact: true }));
      }
      if (route.name === "checkout") {
        const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
        await checkout.getByLabel("العنوان بالتفصيل").fill(address);
        await expect(checkout.getByLabel("العنوان بالتفصيل")).toHaveValue(address);
        for (const recoveryLink of await page.getByRole("link", { name: "تعديل السلة" }).all()) {
          if (await recoveryLink.isVisible()) await expectTargetSize(recoveryLink);
        }
      }
      if (route.name === "not-found") {
        await expect(page.getByRole("heading", { name: "المنتج غير موجود" })).toBeVisible();
        await expectTargetSize(page.getByRole("link", { name: "العودة إلى المنتجات" }));
      }
      await expectTargetCoverage(page);
      const geometry = await page.evaluate(presentationProbe, { marker, address, width });
      findings.push({ route: route.name, width, geometry });
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
  await page.goto(`${STORE}/?q=${encodeURIComponent(`SF12-لا-يوجد-${marker}`)}`);
  await expect(page.getByRole("heading", { name: "لا توجد منتجات مطابقة" })).toBeVisible();
  const emptyRecovery = page.getByRole("link", { name: "عرض كل المنتجات" });
  await expectTargetSize(emptyRecovery);
  await expectTargetCoverage(page);
  const emptyGeometry = await page.evaluate(presentationProbe, { marker: `SF12-لا-يوجد-${marker}`, address: "", width: 390 });
  expect(emptyGeometry.scrollWidth).toBeLessThanOrEqual(390);
  expect(emptyGeometry.violations).toEqual([]);
  await recordContrast(page.getByRole("heading", { name: "لا توجد منتجات مطابقة" }), "empty-search-heading", "text");
  await recordContrast(page.getByText("جرّب عبارة بحث أخرى أو امسح التصفية لعرض المنتجات."), "empty-search-status", "text");

  await page.setViewportSize({ width: 640, height: 844 });
  await page.goto(routes[2].url);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const zoom = await page.evaluate(() => {
    const bar = document.querySelector("[aria-label='إضافة المنتج إلى السلة']");
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
  const skip = page.getByRole("link", { name: "انتقل إلى المحتوى" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  const skipFocus = await skip.evaluate((element) => ({ top: element.getBoundingClientRect().top, outline: getComputedStyle(element).outlineStyle }));
  expect(skipFocus.top).toBeGreaterThanOrEqual(0);
  expect(skipFocus.outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  findings.push({ route: "arrival", skipFocus, afterSkip: await page.evaluate(() => ({ active: document.activeElement?.tagName, hash: location.hash })) });

  await recordContrast(page.locator("#home-title"), "arrival-heading", "text");
  await recordContrast(page.locator('p[lang="en"][aria-hidden="true"]').filter({ hasText: "OWN YOUR" }), "arrival-display", "text");
  await recordContrast(page.getByText("ابدأ بقطعة تناسبك. اختر المقاس واللون، وراجع تفاصيل طلبك على مهل."), "arrival-introduction", "text");
  await recordContrast(page.locator(".eyebrow").first(), "eyebrow", "text");
  await recordContrast(page.getByRole("navigation", { name: "التنقل الرئيسي" }).getByRole("link", { name: /السلة/ }), "header-link", "text");
  await recordContrast(page.locator(".cart-count").first(), "header-cart-count", "text");
  await recordContrast(page.locator("#product-search"), "search-placeholder", "placeholder");
  await recordContrast(page.locator("#product-search"), "search-boundary", "boundary");
  await tabTo(page, page.locator("#product-search"));
  await recordContrast(page.locator("#product-search"), "search-focused-text", "text");
  await recordContrast(page.locator("#product-search"), "search-focused-outline", "outline");
  await recordContrast(page.locator("#collection-sort"), "sort-boundary", "boundary");

  await page.goto(routes[1].url);
  await recordContrast(page.getByRole("status").filter({ hasText: "منتج" }).first(), "collection-count", "text");
  await recordContrast(page.locator("a.product-card").filter({ hasText: productName }).locator("h3"), "product-card-name", "text");
  await recordContrast(page.locator("a.product-card").filter({ hasText: productName }).getByText("متوفر"), "product-card-availability", "text");
  await recordContrast(page.getByText("راجع سعر المقاس واللون وتوفرهما في صفحة المنتج."), "collection-note", "text");
  await recordContrast(page.getByRole("link", { name: `إزالة البحث: ${query}` }), "filter-chip", "text");
  await recordContrast(page.getByRole("link", { name: `إزالة البحث: ${query}` }), "filter-chip-boundary", "boundary");
  const selectedCategory = page.getByRole("navigation", { name: "تصفية حسب التصنيف" }).getByRole("link", { name: categoryName, exact: true });
  await recordContrast(selectedCategory, "selected-category", "text");
  await recordContrast(selectedCategory, "selected-category-boundary", "boundary");

  await page.goto(routes[2].url);
  await recordContrast(page.getByRole("heading", { name: productName }), "product-heading", "text");
  await recordContrast(page.getByText(sizeName).first(), "selected-variant", "text");
  const unavailableVariant = page.getByRole("radio", { name: new RegExp(unavailableColorName) });
  await expect(unavailableVariant).toBeDisabled();
  await recordContrast(unavailableVariant.locator("xpath=ancestor::label[1]"), "disabled-variant", "text");
  await recordContrast(page.locator("#product-quantity"), "quantity-boundary", "boundary");
  const checkedVariant = page.getByRole("radio", { name: new RegExp(colorName) });
  await tabTo(page, checkedVariant);
  await recordContrast(checkedVariant.locator("xpath=ancestor::label[1]"), "focused-variant", "text");
  await recordContrast(checkedVariant.locator("xpath=ancestor::label[1]"), "focused-variant-outline", "outline");

  await page.goto(routes[3].url);
  await recordContrast(page.locator(".cart-line [role='group']").first(), "cart-quantity-boundary", "boundary");
  await recordContrast(page.getByRole("status").first(), "cart-status", "text");

  await page.goto(routes[5].url);
  await recordContrast(page.getByRole("heading", { name: "المنتج غير موجود" }), "not-found-heading", "text");
  await recordContrast(page.getByText("قد يكون المنتج غير منشور حالياً."), "not-found-copy", "text");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STORE);
  await page.getByLabel("ابحث عن منتج").fill(query);
  await page.getByRole("button", { name: "بحث" }).click();
  await expect(page).toHaveURL(/q=/);
  await page.getByRole("link", { name: categoryName, exact: true }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("link", { name: categoryName, exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.getByLabel("ترتيب المنتجات").evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")))).toBe(true);
  await page.getByLabel("ترتيب المنتجات").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.locator("a.product-card").filter({ hasText: productName }).click();
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  await expect(page.getByRole("radio", { name: new RegExp(colorName) })).toBeChecked();
  await page.getByRole("button", { name: "أضف إلى السلة" }).last().click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة");
  await expect.poll(() => cartEvents.length).toBe(2);
  await page.getByRole("link", { name: "تمت الإضافة · عرض السلة" }).click();
  await expect(page.locator(".cart-line output")).toHaveText("2");
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();
  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await checkout.getByLabel("منطقة التوصيل").selectOption(area.body.id);
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  await expect(page.getByRole("region", { name: "تفاصيل السعر" })).toContainText("رسوم التوصيل");
  const quoteStatus = page.getByRole("status").filter({ hasText: "تم تحديث السعر من المخزون والإعدادات الحالية." });
  await expect(quoteStatus).toBeVisible();
  await recordContrast(quoteStatus, "quote-status", "text");
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  const name = checkout.getByLabel("الاسم");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#customerName-error")).toHaveText("أكمل هذا الحقل.");
  await recordContrast(page.locator("#customerName-error"), "field-error", "text");
  await checkout.getByLabel("الاسم").fill(`عميل اختبار الوصول ${marker}`);
  await expect(name).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#customerName-error")).toHaveCount(0);
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01001234567");
  await checkout.getByLabel("العنوان بالتفصيل").fill(address);
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  const acknowledgment = page.getByRole("status");
  await expect(acknowledgment).toHaveText(ACKNOWLEDGMENT);
  await recordContrast(acknowledgment, "acknowledgment-status", "text");
  const acknowledgmentLink = page.getByRole("link", { name: "العودة إلى المتجر" });
  await expectTargetSize(acknowledgmentLink);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
    await expectTargetSize(page.getByRole("link", { name: "العودة إلى المتجر" }));
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
  if (width === 320) {
    const headline = document.querySelector<HTMLElement>('p[lang="en"][aria-hidden="true"]');
    if (headline?.innerText.includes("OWN YOUR")) {
      const box = headline.getBoundingClientRect();
      const lines = [...headline.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE || node.nodeName === "SPAN").map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return { text: node.textContent, rects: [...range.getClientRects()].map((rect) => ({ left: rect.left, right: rect.right })) };
      });
      if (lines.some((line) => line.rects.length !== 1 || line.rects[0]!.left < box.left - 1 || line.rects[0]!.right > box.right + 1)) {
        violations.push({ kind: "display-lines", text: "OWN YOUR PRESENCE", detail: JSON.stringify(lines) });
      }
    }
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

  // CollectionControls renders nav "تصفية حسب التصنيف" with overflow-x auto. Focus scrolls a clipped link into that rail.
  function filterRailClip(element: HTMLElement, box: DOMRect) {
    const rail = element.closest<HTMLElement>("nav[aria-label='تصفية حسب التصنيف']");
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
  const rail = page.getByRole("navigation", { name: "تصفية حسب التصنيف" });
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
