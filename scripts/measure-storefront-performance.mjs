import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cartKey = "bravos-guest-cart-v1";
const viewports = [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 1000 }];
const conditions = { latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, cpuRate: 4, observationMs: 10_000, timeoutMs: 45_000 };
const help = `Attach-only storefront lab measurement (never starts/builds/seeds a server).
Usage: node scripts/measure-storefront-performance.mjs --origin URL --product-id ID
  --cart-state FILE --build-label LABEL --photo-provenance TEXT
  --photo-kind representative|synthetic --fixture-label LABEL --hero-note TEXT
  --attest-isolated-production [--output .scratch/NEW-DIRECTORY]

Requires an already-running, permitted, isolated localhost/127.0.0.1 production
server and anonymous Playwright storageState containing only the guest cart key.
The attestation and build label are operator statements, not verified server mode.
Captures exactly 24 successful cold samples: 4 routes x 2 viewports x 3 runs.
Fixed conditions: 150ms latency, 1.6Mbps down, 750Kbps up, 4x CPU, DPR 1,
headless installed Playwright Chromium, 10s observation after load. No interactions.
Output must be a new direct child of .scratch; default is a timestamped directory.
Synthetic data and an unmatched baseline cannot establish SF-11 acceptance.
See docs/development/storefront-performance.md for preparation and limits.`;

export function calculateCls(shifts) {
  let maximum = 0, sum = 0, first = 0, previous = 0, active = false;
  for (const shift of shifts) {
    if (shift.hadRecentInput) continue;
    if (!active || shift.time - previous >= 1000 || shift.time - first >= 5000) {
      first = shift.time;
      sum = shift.value;
      active = true;
    } else sum += shift.value;
    previous = shift.time;
    maximum = Math.max(maximum, sum);
  }
  return maximum;
}

function options(args) {
  const { values } = parseArgs({ args, options: {
    help: { type: "boolean" }, origin: { type: "string" }, "product-id": { type: "string" },
    "cart-state": { type: "string" }, "build-label": { type: "string" },
    "photo-provenance": { type: "string" }, "photo-kind": { type: "string" },
    "fixture-label": { type: "string" }, "hero-note": { type: "string" },
    "attest-isolated-production": { type: "boolean" }, output: { type: "string" },
  } });
  if (values.help) return null;
  for (const key of ["origin", "product-id", "cart-state", "build-label", "photo-provenance", "photo-kind", "fixture-label", "hero-note"]) {
    if (!values[key]?.trim()) throw new Error(`Required: --${key}. Use --help.`);
  }
  const origin = new URL(values.origin);
  if (!["http:", "https:"].includes(origin.protocol) || !["localhost", "127.0.0.1"].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("--origin must be a localhost/127.0.0.1 HTTP(S) origin without credentials, path or query.");
  }
  if (!values["attest-isolated-production"]) throw new Error("Attest that this permitted server is production mode and uses isolated non-business data with --attest-isolated-production.");
  if (!["representative", "synthetic"].includes(values["photo-kind"])) throw new Error("--photo-kind must be representative or synthetic.");
  if (!/^[a-zA-Z0-9_-]+$/.test(values["product-id"])) throw new Error("--product-id must be a single product identifier, not a path.");
  return { ...values, origin: origin.origin };
}

async function anonymousCartState(path, origin) {
  const raw = await readFile(resolve(path), "utf8");
  const state = JSON.parse(raw);
  if (Object.keys(state).some((key) => !["cookies", "origins"].includes(key))
    || !Array.isArray(state.cookies) || state.cookies.length || !Array.isArray(state.origins) || state.origins.length !== 1) {
    throw new Error("Cart state must contain no cookies and exactly one origin; authentication/checkout storage is forbidden.");
  }
  const entry = state.origins[0];
  if (Object.keys(entry).some((key) => !["origin", "localStorage"].includes(key)) || entry.origin !== origin
    || !Array.isArray(entry.localStorage) || entry.localStorage.length !== 1 || entry.localStorage[0].name !== cartKey
    || typeof entry.localStorage[0].value !== "string" || Object.keys(entry.localStorage[0]).some((key) => !["name", "value"].includes(key))) {
    throw new Error("Cart state must contain only bravos-guest-cart-v1 for the exact measurement origin; no PII, attempts, auth or IndexedDB.");
  }
  const cart = JSON.parse(entry.localStorage[0].value);
  const items = Array.isArray(cart) ? cart : cart.items;
  if (!Array.isArray(cart) && (cart.version !== 1 || !cart.revision || Object.keys(cart).some((key) => !["version", "revision", "items", "completedCheckoutOperationIds"].includes(key))
    || (cart.completedCheckoutOperationIds !== undefined && (!Array.isArray(cart.completedCheckoutOperationIds) || cart.completedCheckoutOperationIds.length)))) {
    throw new Error("Cart must be a legacy line array or v1 envelope with no completed checkout operations.");
  }
  const strings = ["productId", "variantId", "productNameAr", "sizeNameAr", "colorNameAr"];
  const allowed = [...strings, "unitPricePiasters", "imageRef", "quantity", "knownAvailableQuantity", "orderable"];
  if (!Array.isArray(items) || !items.length || items.some((item) => !item || Object.keys(item).some((key) => !allowed.includes(key))
    || strings.some((key) => typeof item[key] !== "string" || !item[key])
    || !Number.isSafeInteger(item.unitPricePiasters) || item.unitPricePiasters < 0
    || !(item.imageRef === null || typeof item.imageRef === "string")
    || !Number.isSafeInteger(item.quantity) || item.quantity < 1
    || !Number.isSafeInteger(item.knownAvailableQuantity) || item.quantity > item.knownAvailableQuantity
    || item.orderable !== true)) throw new Error("Prepared anonymous cart must contain valid, orderable, stocked lines only.");
  const totals = new Map();
  for (const item of items) totals.set(item.variantId, (totals.get(item.variantId) ?? 0) + item.quantity);
  if (items.some((item) => totals.get(item.variantId) > item.knownAvailableQuantity)) throw new Error("Prepared cart exceeds stock across repeated variant lines.");
  return { state, sha256: createHash("sha256").update(raw).digest("hex"), lineCount: totals.size, unitCount: items.reduce((sum, item) => sum + item.quantity, 0) };
}

async function outputDirectory(value) {
  const scratch = join(root, ".scratch");
  const path = resolve(root, value ?? `.scratch/storefront-performance-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const name = relative(scratch, path);
  if (!name || name === ".." || name.startsWith(`..${sep}`) || name.includes(sep) || resolve(scratch, name) !== path) {
    throw new Error("--output must be a new direct child of this repository's .scratch directory.");
  }
  await mkdir(scratch, { recursive: true });
  if ((await realpath(scratch)).toLowerCase() !== scratch.toLowerCase()) throw new Error("Refusing a redirected/symlink .scratch directory.");
  await mkdir(path); // Exclusive new directory: never overwrite another report/application file.
  return path;
}

function installObservers() {
  performance.setResourceTimingBufferSize(3000);
  const metrics = window.__storefrontLab = { shifts: [], lcp: null };
  const capture = (kind, entries) => {
    for (const entry of entries) {
      if (kind === "layout-shift") metrics.shifts.push({ time: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput });
      else metrics.lcp = { timeMs: entry.startTime, size: entry.size, tag: entry.element?.tagName ?? null, url: entry.url || null };
    }
  };
  const observers = ["layout-shift", "largest-contentful-paint"].map((kind) => {
    const observer = new PerformanceObserver((list) => capture(kind, list.getEntries()));
    observer.observe({ type: kind, buffered: true });
    return { kind, observer };
  });
  window.__finishStorefrontLab = () => {
    for (const { kind, observer } of observers) {
      capture(kind, observer.takeRecords());
      observer.disconnect();
    }
    return { ...metrics, observedUntilMs: performance.now() };
  };
}

async function ready(page, route, lineCount) {
  await page.locator("main h1").first().waitFor({ timeout: conditions.timeoutMs });
  if (route === "home") await page.locator('main a[href^="/products/"]').first().waitFor({ timeout: conditions.timeoutMs });
  if (route === "product") {
    await page.locator('.purchase-panel input[name="purchase-color"]:enabled').first().waitFor({ state: "attached", timeout: conditions.timeoutMs });
    await page.locator('.purchase-panel input[name="purchase-size"]:enabled').first().waitFor({ state: "attached", timeout: conditions.timeoutMs });
    await page.waitForFunction(() => {
      const quantity = document.querySelector("#product-quantity");
      return quantity && !quantity.disabled && Number(quantity.max) >= 1;
    }, undefined, { timeout: conditions.timeoutMs });
  }
  if (route === "cart") {
    await page.waitForFunction((count) => document.querySelectorAll(".cart-line").length === count, lineCount, { timeout: conditions.timeoutMs });
    await page.locator('a[href="/checkout"]').first().waitFor({ timeout: conditions.timeoutMs });
  }
  if (route === "checkout") {
    await page.locator("form.checkout-form").waitFor({ timeout: conditions.timeoutMs });
    await page.waitForFunction((count) => {
      const form = document.querySelector("form.checkout-form");
      const area = form?.querySelector("select");
      return document.querySelectorAll(".checkout-cart article").length === count && area && !area.disabled && [...area.options].some((option) => option.value);
    }, lineCount, { timeout: conditions.timeoutMs });
    const hasValues = await page.locator("form.checkout-form").evaluate((form) => [...form.querySelectorAll("input, textarea, select")].some((field) => field.value));
    if (hasValues) throw new Error("Checkout must load with blank customer, coupon and area fields; no customer data is accepted.");
  }
  if (await page.locator(".stock-warning").count()) throw new Error("Prepared cart is unavailable/excessive; supply a ready anonymous cart.");
}

async function sample(browser, settings, cart, viewport, route, run) {
  const usesCart = ["cart", "checkout"].includes(route.name);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
    locale: "ar-EG", timezoneId: "Africa/Cairo", serviceWorkers: "block", reducedMotion: "no-preference",
    ...(usesCart ? { storageState: cart.state } : {}) });
  try {
    await context.addInitScript(installObservers);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: conditions.latency,
      downloadThroughput: conditions.downloadThroughput, uploadThroughput: conditions.uploadThroughput });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: conditions.cpuRate });
    const requests = new Map();
    let requestCount = 0, redirects = 0;
    const failures = [];
    cdp.on("Network.requestWillBeSent", ({ requestId, request, type, redirectResponse }) => {
      requestCount++;
      if (redirectResponse) redirects++;
      requests.set(requestId, { type, url: request.url, status: null, transferBytes: null, mime: null });
    });
    cdp.on("Network.responseReceived", ({ requestId, response }) => {
      const request = requests.get(requestId);
      if (request) Object.assign(request, { status: response.status, mime: response.mimeType, fromCache: Boolean(response.fromDiskCache || response.fromServiceWorker) });
    });
    cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
      if (requests.has(requestId)) requests.get(requestId).transferBytes = encodedDataLength;
    });
    cdp.on("Network.loadingFailed", ({ requestId }) => {
      if (requests.has(requestId)) failures.push({ kind: "request-failed", url: requests.get(requestId).url });
    });
    page.on("pageerror", () => failures.push({ kind: "page-error" }));
    // Preserve automatic visits/views. Block every other write, including order recovery.
    await page.route("**/*", async (handler) => {
      const request = handler.request();
      const url = new URL(request.url());
      const analytics = url.origin === settings.origin && url.pathname === "/api/public/analytics/events" && request.method() === "POST";
      let browsingEvent = false;
      if (analytics) {
        try { browsingEvent = ["visit", "product_view"].includes(request.postDataJSON().eventType); } catch { /* Fail closed. */ }
      }
      if (["GET", "HEAD"].includes(request.method()) || browsingEvent) await handler.continue();
      else { failures.push({ kind: "blocked-write", url: url.origin + url.pathname }); await handler.abort(); }
    });
    const response = await page.goto(settings.origin + route.path, { waitUntil: "load", timeout: conditions.timeoutMs });
    if (response?.status() !== 200 || page.url() !== settings.origin + route.path) throw new Error("Route did not load with HTTP 200 at the requested URL.");
    const loadedAt = Date.now();
    await ready(page, route.name, cart.lineCount);
    await page.waitForFunction(() => document.fonts.status === "loaded", undefined, { timeout: conditions.observationMs });
    const remaining = conditions.observationMs - (Date.now() - loadedAt);
    if (remaining <= 0) throw new Error("Route readiness exceeded the fixed 10s post-load observation window.");
    await page.waitForTimeout(remaining);
    // Recheck after hydration/revalidation, without clicks or extra navigations.
    await ready(page, route.name, cart.lineCount);
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const quality = window.__finishStorefrontLab();
      const resources = performance.getEntriesByType("resource").map((entry) => ({ url: entry.name, encodedBodyBytes: entry.encodedBodySize, decodedBodyBytes: entry.decodedBodySize }));
      return { ...quality, navigation: { responseStartMs: navigation.responseStart, domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd }, resources,
        visibleImages: [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
        }).map((image) => ({ url: image.currentSrc, loaded: image.complete && image.naturalWidth > 0 })),
        heroImages: [...document.querySelectorAll('main img[fetchpriority="high"]')].map((image) => image.currentSrc),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const network = [...requests.values()].map((entry) => ({ ...entry, ...metrics.resources.find((resource) => resource.url === entry.url) }));
    for (const entry of network) if (entry.status >= 400) failures.push({ kind: "http-error", url: entry.url, status: entry.status });
    if (!metrics.lcp || metrics.visibleImages.some((image) => !image.loaded) || network.some((entry) => entry.fromCache)) failures.push({ kind: "missing-lcp-image-or-cold-cache" });
    if (network.some((entry) => ["Document", "Image", "Script"].includes(entry.type) && entry.transferBytes === null)) failures.push({ kind: "incomplete-document-image-or-js-transfer" });
    const summarize = (entries) => ({ requestCount: entries.length, transferBytes: entries.reduce((sum, entry) => sum + (entry.transferBytes ?? 0), 0),
      encodedBodyBytes: entries.reduce((sum, entry) => sum + (entry.encodedBodyBytes ?? 0), 0), incompleteRequests: entries.filter((entry) => entry.transferBytes === null).length });
    const { resources, ...quality } = metrics;
    return { route: route.name, viewport: viewport.name, run, ...quality, cls: calculateCls(metrics.shifts), requestCount, redirects,
      images: summarize(network.filter((entry) => entry.type === "Image" || entry.mime?.startsWith("image/"))),
      js: summarize(network.filter((entry) => entry.type === "Script" || /javascript/.test(entry.mime ?? ""))),
      all: summarize(network), network, failures };
  } finally { await context.close(); }
}

async function main(args) {
  const settings = options(args);
  if (!settings) { console.log(help); return; }
  const cart = await anonymousCartState(settings["cart-state"], settings.origin);
  const output = await outputDirectory(settings.output);
  const report = { schemaVersion: 1, status: "incomplete", startedAt: new Date().toISOString(), origin: settings.origin,
    buildLabel: settings["build-label"], servedMode: "isolated production: operator-attested, not server-verified",
    photoKind: settings["photo-kind"], photoProvenance: settings["photo-provenance"], fixtureLabel: settings["fixture-label"], heroNote: settings["hero-note"],
    cart: { sha256: cart.sha256, lineCount: cart.lineCount, unitCount: cart.unitCount }, conditions: { ...conditions, viewports, deviceScaleFactor: 1,
      headless: true, phoneEmulation: "viewport only; desktop Chromium user agent", locale: "ar-EG", timezone: "Africa/Cairo", reducedMotion: "no-preference",
      browserCache: "disabled via CDP; fresh context per sample; service workers blocked", serverCache: "not cleared; server/CDN caches may be warm" },
    acceptance: "Not established: a single lab report does not verify representative-photo approval, matched 15fd366/final fixtures, hero parity, interactions, field p75 or physical devices.",
    samples: [] };
  const save = () => writeFile(join(output, "metrics.json"), JSON.stringify(report, null, 2));
  await save();
  let browser;
  try {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    const routes = [{ name: "home", path: "/" }, { name: "product", path: `/products/${settings["product-id"]}` }, { name: "cart", path: "/cart" }, { name: "checkout", path: "/checkout" }];
    for (const viewport of viewports) for (const route of routes) for (let run = 1; run <= 3; run++) {
      report.currentSample = { route: route.name, viewport: viewport.name, run };
      console.log(`Measuring ${route.name} ${viewport.name} run ${run}/3`);
      const result = await sample(browser, settings, cart, viewport, route, run);
      report.samples.push(result);
      await save();
      if (result.failures.length) throw new Error("Sample has runtime, network, image or blocked-write failures; see metrics.json.");
    }
    const median = (values) => [...values].sort((a, b) => a - b)[1];
    report.summary = viewports.flatMap((viewport) => routes.map((route) => {
      const samples = report.samples.filter((entry) => entry.viewport === viewport.name && entry.route === route.name);
      return { viewport: viewport.name, route: route.name, medianLcpMs: median(samples.map((entry) => entry.lcp.timeMs)),
        maximumCls: Math.max(...samples.map((entry) => entry.cls)), medianImageTransferBytes: median(samples.map((entry) => entry.images.transferBytes)),
        medianJsTransferBytes: median(samples.map((entry) => entry.js.transferBytes)), medianRequestCount: median(samples.map((entry) => entry.requestCount)) };
    }));
    report.status = "complete-lab-capture";
    delete report.currentSample;
    console.log(`Captured 24 samples: ${join(output, "metrics.json")}. SF-11 acceptance remains separate.`);
  } catch (error) {
    report.failure = `${report.currentSample ? JSON.stringify(report.currentSample) + ": " : ""}${error.message}`;
    throw new Error(`${report.failure} Partial evidence: ${join(output, "metrics.json")}`, { cause: error });
  } finally {
    report.finishedAt = new Date().toISOString();
    await save();
    await browser?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
