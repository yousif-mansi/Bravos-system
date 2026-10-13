import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const REQUIRED_FACES = [
  { family: "commerce", weight: "400" },
  { family: "commerce", weight: "500" },
  { family: "commerce", weight: "700" },
  { family: "editorial", weight: "400" },
  { family: "editorial", weight: "700" },
  { family: "display", weight: "400" },
] as const;
const PERMITTED_LOCAL_FALLBACKS = new Set(["commerce Fallback", "editorial Fallback", "display Fallback"]);

function isArialLocalOnly(src: string): boolean {
  if (/url\(/i.test(src)) return false;
  const locals = [...src.matchAll(/local\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
  if (locals.length === 0) return false;
  if (!locals.every((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim() === "Arial")) return false;
  return src.replace(/local\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, "").replace(/[\s,]+/g, "") === "";
}

const ROLE_CHECKS: Record<string, Array<[string, { family: string; weight: string }]>> = {
  home: [
    ["body", { family: "commerce", weight: "400" }],
    ["#home-title", { family: "editorial", weight: "400" }],
    ['p[lang="en"]', { family: "display", weight: "400" }],
    ["#catalog-title", { family: "editorial", weight: "400" }],
  ],
  discovery: [
    ["body", { family: "commerce", weight: "400" }],
    ["#catalog-title", { family: "editorial", weight: "400" }],
  ],
  product: [
    ["body", { family: "commerce", weight: "400" }],
    ["main h1", { family: "editorial", weight: "400" }],
  ],
  cart: [
    ["body", { family: "commerce", weight: "400" }],
    ["main h1", { family: "editorial", weight: "400" }],
  ],
  checkout: [
    ["body", { family: "commerce", weight: "400" }],
    ["main h1", { family: "editorial", weight: "400" }],
  ],
};

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
  const fontTraffic: Array<{ url: string; status: number | "failed"; failure: string | null }> = [];
  const recordFont = (url: string, resourceType: string, status: number | "failed", failure: string | null) => {
    if (resourceType !== "font" && !/\.(?:otf|ttf|woff2?)(?:$|\?)/i.test(new URL(url).pathname)) return;
    fontTraffic.push({ url, status, failure });
  };
  page.on("response", (response) => {
    recordFont(response.url(), response.request().resourceType(), response.status(), null);
  });
  page.on("requestfailed", (request) => {
    recordFont(request.url(), request.resourceType(), "failed", request.failure()?.errorText ?? "requestfailed");
  });
  const productPage = await page.goto(`${STORE}/products/${product.id}`);
  expect(productPage?.status()).toBe(200);
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
      const proof = await readFontProof(page);
      const permittedFallbackFamilies = new Set<string>();
      for (const face of proof.localOnly) {
        expect(PERMITTED_LOCAL_FALLBACKS.has(face.family), `unexpected local-only font ${face.family}: ${face.src}`).toBe(true);
        expect(isArialLocalOnly(face.src), `${face.family} src ${face.src}`).toBe(true);
        permittedFallbackFamilies.add(face.family);
      }
      expect([...permittedFallbackFamilies].sort(), JSON.stringify(proof.localOnly)).toEqual([...PERMITTED_LOCAL_FALLBACKS].sort());
      const unexpectedFontErrors = proof.fontFaces.filter((font) => font.status === "error" && !permittedFallbackFamilies.has(font.family));
      expect(unexpectedFontErrors, JSON.stringify({ unexpectedFontErrors, localOnly: proof.localOnly, fontFaces: proof.fontFaces })).toEqual([]);
      for (const required of REQUIRED_FACES) {
        const match = proof.loaded.find((face) => face.family === required.family && face.weight === required.weight);
        expect(match?.faces.some((face) => face.family === required.family && face.weight === required.weight && face.status === "loaded"), JSON.stringify(match ?? proof.loaded)).toBe(true);
        expect(proof.urlFaces.some((face) => face.family === required.family && face.weight === required.weight && face.urls.length > 0), JSON.stringify(proof.urlFaces)).toBe(true);
      }
      for (const [selector, expected] of ROLE_CHECKS[route.name] ?? []) {
        expect(proof.roles[selector], `${route.name} ${selector}`).toEqual(expected);
      }
      const failedFonts = fontTraffic.filter((entry) => entry.status === "failed" || (typeof entry.status === "number" && (entry.status < 200 || entry.status >= 400)));
      expect(failedFonts, "font network").toEqual([]);
      expect(fontTraffic.length, "font responses").toBeGreaterThan(0);
      for (const entry of fontTraffic) {
        expect(new URL(entry.url).origin, entry.url).toBe(STORE);
      }
      const loadedUrls = new Set(fontTraffic.filter((entry) => entry.status !== "failed").map((entry) => entry.url.split("?")[0]));
      for (const face of proof.urlFaces) {
        if (!REQUIRED_FACES.some((required) => required.family === face.family && required.weight === face.weight)) continue;
        expect(face.urls.some((url) => loadedUrls.has(url.split("?")[0])), JSON.stringify({ face, loadedUrls: [...loadedUrls] })).toBe(true);
      }
      expect(errors, `${route.name} at ${width}px browser errors`).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${route.name}-${width}.png`), fullPage: true });
    }
  }
  await writeFile(testInfo.outputPath("storefront-load-metrics.json"), JSON.stringify({ browser: page.context().browser()?.version(), findings }, null, 2));
});

async function readFontProof(page: Page) {
  return page.evaluate(async (required) => {
    const normalizeWeight = (weight: string) => weight.trim() === "normal" || weight.trim() === "" ? "400" : weight.trim();
    const loaded = [];
    for (const face of required) {
      const matches = await document.fonts.load(`${face.weight} 16px "${face.family}"`);
      loaded.push({
        family: face.family,
        weight: face.weight,
        faces: matches.map((match) => ({ family: match.family.replace(/["']/g, ""), weight: normalizeWeight(String(match.weight)), status: match.status })),
      });
    }
    await document.fonts.ready;
    const localOnly: Array<{ family: string; src: string }> = [];
    const urlFaces: Array<{ family: string; weight: string; urls: string[] }> = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of [...rules]) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        const src = rule.style.getPropertyValue("src");
        const weight = normalizeWeight(rule.style.getPropertyValue("font-weight"));
        const urls = [...src.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/g)]
          .map((match) => new URL(match[1] || match[2] || match[3] || "", sheet.href || location.href).href);
        if (/local\(/i.test(src) && urls.length === 0) localOnly.push({ family, src });
        if (urls.length > 0) urlFaces.push({ family, weight, urls });
      }
    }
    const firstFamily = (value: string) => value.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
    const roles: Record<string, { family: string; weight: string } | null> = {};
    for (const selector of ["body", "#home-title", 'p[lang="en"]', "#catalog-title", "main h1"]) {
      const element = document.querySelector(selector);
      roles[selector] = element
        ? { family: firstFamily(getComputedStyle(element).fontFamily), weight: normalizeWeight(getComputedStyle(element).fontWeight) }
        : null;
    }
    return {
      loaded,
      localOnly,
      urlFaces,
      fontFaces: [...document.fonts].map((font) => ({ family: font.family.replace(/["']/g, ""), weight: normalizeWeight(String(font.weight)), status: font.status })),
      roles,
    };
  }, REQUIRED_FACES.map((face) => ({ family: face.family, weight: face.weight })));
}

async function staffApi(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`${INTERNAL}${path}`, { headers: { origin: INTERNAL }, data });
  expect(response.status(), path).toBe(201);
  return response.json();
}
