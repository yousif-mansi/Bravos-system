import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const STORE = "http://127.0.0.1:3001";
const INTERNAL = "http://127.0.0.1:5174";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ROLE_WEIGHTS: Record<string, Array<[string, string]>> = {
  home: [
    ["body", "400"],
    ["#home-title", "700"],
    ["#catalog-title", "500"],
  ],
  discovery: [
    ["body", "400"],
    ["#catalog-title", "500"],
  ],
  product: [
    ["body", "400"],
    ["main h1", "400"],
  ],
  cart: [
    ["body", "400"],
    ["main h1", "400"],
  ],
  checkout: [
    ["body", "400"],
    ["main h1", "400"],
  ],
};

function isClashVariableWoff2(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return /ClashDisplay[-_]Variable/i.test(path) && /\.woff2$/i.test(path);
}

function isArialLocalOnly(src: string): boolean {
  if (/url\(/i.test(src)) return false;
  const locals = [...src.matchAll(/local\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
  if (locals.length === 0) return false;
  if (!locals.every((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim() === "Arial")) return false;
  return src.replace(/local\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, "").replace(/[\s,]+/g, "") === "";
}

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
  await page.getByRole("button", { name: "Add to bag" }).first().click();
  await expect(page.locator(".purchase-panel").getByRole("status")).toContainText("Added");

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
      expect(proof.localOnly.length, "metric fallback faces").toBeGreaterThan(0);
      for (const face of proof.localOnly) {
        expect(isArialLocalOnly(face.src), `local-only font must be Arial ${face.family}: ${face.src}`).toBe(true);
      }
      const arialFamilies = new Set(proof.localOnly.map((face) => face.family));
      const unexpectedFontErrors = proof.fontFaces.filter((font) => font.status === "error" && !arialFamilies.has(font.family));
      expect(unexpectedFontErrors, JSON.stringify({ unexpectedFontErrors, localOnly: proof.localOnly, fontFaces: proof.fontFaces })).toEqual([]);
      expect(proof.clashFamily, "Clash Display family discovered from the variable woff2").not.toBe("");
      expect(proof.clashWeight, proof.clashWeight).toContain("200");
      expect(proof.clashWeight, proof.clashWeight).toContain("700");
      expect(proof.clashLoaded.some((face) => face.status === "loaded"), JSON.stringify(proof.clashLoaded)).toBe(true);
      expect(proof.androgy, "no Androgy face").toBe(false);
      expect(metrics.preloads.some((preload) => isClashVariableWoff2(preload.url)), JSON.stringify(metrics.preloads)).toBe(true);
      for (const [selector, weight] of ROLE_WEIGHTS[route.name] ?? []) {
        expect(proof.roles[selector], `${route.name} ${selector}`).toEqual({ family: proof.clashFamily, weight });
      }
      const failedFonts = fontTraffic.filter((entry) => entry.status === "failed" || (typeof entry.status === "number" && (entry.status < 200 || entry.status >= 400)));
      expect(failedFonts, "font network").toEqual([]);
      expect(fontTraffic.length, "font responses").toBeGreaterThan(0);
      for (const entry of fontTraffic) {
        expect(new URL(entry.url).origin, entry.url).toBe(STORE);
      }
      const loadedUrls = new Set(fontTraffic.filter((entry) => entry.status !== "failed").map((entry) => entry.url.split("?")[0]));
      expect(proof.clashUrls.some((url) => loadedUrls.has(url.split("?")[0])), JSON.stringify({ clashUrls: proof.clashUrls, loadedUrls: [...loadedUrls] })).toBe(true);
      if (route.name === "home") {
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
        const title = page.locator("#home-title");
        await expect(title).toHaveText("Bravos Menswear");
        await expect(title).toHaveClass(/sr-only/);
        const hero = page.locator("section").filter({ has: title });
        const cover = hero.locator("img");
        await expect(cover).toHaveCount(1);
        await expect(cover).toHaveAttribute("alt", "");
        await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([2048, 774]);
        await expect(hero.locator("a, button, p")).toHaveCount(0);
        expect(await visibleHeroCopy(hero)).toEqual([]);
      }
      expect(errors, `${route.name} at ${width}px browser errors`).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${route.name}-${width}.png`), fullPage: true });
    }
  }
  await writeFile(testInfo.outputPath("storefront-load-metrics.json"), JSON.stringify({ browser: page.context().browser()?.version(), findings }, null, 2));
});

async function visibleHeroCopy(hero: ReturnType<Page["locator"]>) {
  return hero.evaluate((section) => {
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
  });
}

async function readFontProof(page: Page) {
  return page.evaluate(async () => {
    const normalizeWeight = (weight: string) => weight.trim() === "normal" || weight.trim() === "" ? "400" : weight.trim();
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
        const weight = rule.style.getPropertyValue("font-weight").trim();
        const urls = [...src.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/g)]
          .map((match) => new URL(match[1] || match[2] || match[3] || "", sheet.href || location.href).href);
        if (/local\(/i.test(src) && urls.length === 0) localOnly.push({ family, src });
        if (urls.length > 0) urlFaces.push({ family, weight, urls });
      }
    }
    const clashFace = urlFaces.find((face) => face.urls.some((url) => {
      const path = url.split("?")[0] ?? url;
      return /ClashDisplay[-_]Variable/i.test(path) && /\.woff2$/i.test(path);
    }));
    const clashFamily = clashFace?.family ?? "";
    const loadedMatches = clashFamily ? await document.fonts.load(`400 16px "${clashFamily}"`) : [];
    await document.fonts.ready;
    const firstFamily = (value: string) => value.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
    const roles: Record<string, { family: string; weight: string } | null> = {};
    for (const selector of ["body", "#home-title", "#catalog-title", "main h1"]) {
      const element = document.querySelector(selector);
      roles[selector] = element
        ? { family: firstFamily(getComputedStyle(element).fontFamily), weight: normalizeWeight(getComputedStyle(element).fontWeight) }
        : null;
    }
    return {
      clashFamily,
      clashWeight: clashFace?.weight ?? "",
      clashUrls: clashFace?.urls ?? [],
      clashLoaded: loadedMatches.map((match) => ({ family: match.family.replace(/["']/g, ""), weight: normalizeWeight(String(match.weight)), status: match.status })),
      androgy: urlFaces.some((face) => face.urls.some((url) => /androgy/i.test(url))),
      localOnly,
      fontFaces: [...document.fonts].map((font) => ({ family: font.family.replace(/["']/g, ""), weight: normalizeWeight(String(font.weight)), status: font.status })),
      roles,
    };
  });
}

async function staffApi(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`${INTERNAL}${path}`, { headers: { origin: INTERNAL }, data });
  expect(response.status(), path).toBe(201);
  return response.json();
}
