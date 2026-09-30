import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("storefront routes load local fonts and media without layout or runtime failures", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.goto(`${INTERNAL}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await staffApi(page, "/api/internal/catalog/categories", { nameAr: `تحميل الواجهة ${suffix}` });
  const size = await staffApi(page, "/api/internal/catalog/sizes", { nameAr: `M تحميل ${suffix}` });
  const color = await staffApi(page, "/api/internal/catalog/colors", { nameAr: `أسود تحميل ${suffix}` });
  const media = await staffApi(page, "/api/internal/catalog/media", { fileName: "load.png", contentType: "image/png", base64: PNG });
  const product = await staffApi(page, "/api/internal/catalog/products", {
    code: `LOAD-${suffix}`, nameAr: `قميص تحميل الواجهة ${suffix}`, descriptionAr: "منتج لاختبار تحميل الصور والخطوط في المسار الكامل.",
    categoryId: category.id, defaultSellingPricePiasters: 35_000, publication: "available", imageRefs: [media.ref], sizeGuideAr: null,
    variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
  });
  const workspace = await (await page.request.get(`${INTERNAL}/api/internal/workspace`)).json();
  await staffApi(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: workspace.activeBranch.id,
    receiptDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    lines: [{ variantId: product.variants[0].id, quantity: 3, unitCostPiasters: 12_000 }],
  });
  await staffApi(page, "/api/internal/delivery-areas", { nameAr: `توصيل تحميل ${suffix}`, feePiasters: 2_500, active: true });
  await page.goto(`${STORE}/products/${product.id}`);
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("تمت إضافة");

  await page.addInitScript(() => {
    const shifts: Array<{ value: number; startTime: number; sources: unknown[] }> = [];
    const lcp: number[] = [];
    Object.assign(window, { __storefrontQuality: { shifts, lcp } });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: Array<{ node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> };
        if (!shift.hadRecentInput) shifts.push({ value: shift.value, startTime: shift.startTime, sources: shift.sources.map((source) => ({
          tag: source.node instanceof Element ? source.node.tagName : null,
          className: source.node instanceof Element ? String(source.node.className) : null,
          text: source.node?.textContent?.trim().slice(0, 120), before: source.previousRect.toJSON(), after: source.currentRect.toJSON(),
        })) });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) lcp.push(entry.startTime); })
      .observe({ type: "largest-contentful-paint", buffered: true });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const findings: unknown[] = [];
  const routes = [
    { name: "home", path: "/", ready: "#home-title" },
    { name: "discovery", path: `/?category=${category.id}`, ready: "a.product-card" },
    { name: "product", path: `/products/${product.id}`, ready: "#product-quantity" },
    { name: "cart", path: "/cart", ready: ".cart-line" },
    { name: "checkout", path: "/checkout", ready: "form.checkout-form" },
  ];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    for (const route of routes) {
      errors.length = 0;
      const response = await page.goto(`${STORE}${route.path}`);
      expect(response?.status()).toBe(200);
      await expect(page.locator(route.ready).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.evaluate(() => [...document.images]
        .filter((image) => image.getBoundingClientRect().bottom > 0 && image.getBoundingClientRect().top < innerHeight)
        .every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const quality = (window as unknown as { __storefrontQuality: { shifts: Array<{ value: number; startTime: number }>; lcp: number[] } }).__storefrontQuality;
        let cls = 0;
        let sessionValue = 0;
        let sessionStart = 0;
        let previous = 0;
        for (const shift of quality.shifts) {
          if (shift.startTime - previous < 1000 && shift.startTime - sessionStart < 5000) sessionValue += shift.value;
          else { sessionValue = shift.value; sessionStart = shift.startTime; }
          previous = shift.startTime;
          cls = Math.max(cls, sessionValue);
        }
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const fonts = resources.filter((entry) => /\.(?:woff2?|otf|ttf)(?:\?|$)/.test(entry.name))
          .map((entry) => ({ url: entry.name, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize }));
        const preloads = [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')]
          .map((link) => ({ url: link.href, decodedBytes: fonts.find((font) => font.url === link.href)?.decodedBytes ?? 0 }));
        return {
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cls, shifts: quality.shifts, lcpMs: quality.lcp.at(-1) ?? null,
          bodyFont: getComputedStyle(document.body).fontFamily,
          fontFaces: [...document.fonts].map((font) => ({ family: font.family, weight: font.weight, status: font.status })),
          fonts, preloads, preloadedFontBytes: preloads.reduce((sum, font) => sum + font.decodedBytes, 0),
          resourceBytes: resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
          imageCount: document.images.length,
        };
      });
      findings.push({ route: route.name, ...metrics, errors: [...errors] });
      await writeFile(testInfo.outputPath("storefront-load-metrics.json"), JSON.stringify({ browser: page.context().browser()?.version(), findings }, null, 2));
      expect.soft(metrics.scrollWidth, `${route.name} at ${width}px`).toBeLessThanOrEqual(width);
      expect.soft(metrics.cls, `${route.name} at ${width}px CLS`).toBeLessThanOrEqual(0.1);
      expect(metrics.fontFaces.filter((font) => font.status === "error")).toEqual([]);
      expect(metrics.fonts.some((font) => font.url.includes("/_next/static/media/"))).toBe(true);
      expect(metrics.fonts.every((font) => new URL(font.url).origin === STORE)).toBe(true);
      expect(errors, `${route.name} at ${width}px browser errors`).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${route.name}-${width}.png`), fullPage: true });
    }
  }
  await writeFile(testInfo.outputPath("storefront-load-metrics.json"), JSON.stringify({ browser: page.context().browser()?.version(), findings }, null, 2));
});

async function staffApi(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`${INTERNAL}${path}`, { headers: { origin: INTERNAL }, data });
  expect(response.status(), path).toBe(201);
  return response.json();
}
