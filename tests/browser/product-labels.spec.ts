import { BitArray, Code128Reader } from "@zxing/library";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

// This origin belongs to the disposable browser-test API (3011), never the preview API (3012).
const internal = "http://127.0.0.1:5174";
const shots = ".scratch/pos-hardware-20261027/screenshots";
type HardwarePrint = { kind: "labels" | "receipt"; text: string; labels: number; title: string; unsafeNodes: number };
type HardwareWindow = Window & { __hardwarePrints?: HardwarePrint[] };
type Sale = { id: string; finalTotalPiasters: number; lines: { variantId: string }[] };

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const response = await page.request.fetch(`${internal}${path}`, {
    method,
    headers: { origin: internal, ...(data ? { "content-type": "application/json" } : {}) },
    data,
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

async function login(page: Page) {
  await page.goto(`${internal}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function seed(page: Page) {
  await login(page);
  const tag = crypto.randomUUID().slice(0, 8);
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: `ملصقات ${tag}` });
  const size = await api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M-${tag}` });
  const color = await api(page, "POST", "/api/internal/catalog/colors", { nameAr: `أزرق-${tag}` });
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code: `BRV-LBL-${tag}`,
    nameAr: `قميص Bravos ${tag}`,
    descriptionAr: "",
    categoryId: category.id,
    defaultSellingPricePiasters: 12000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
  });
  const workspace = await api(page, "GET", "/api/internal/workspace");
  const variant = product.variants[0];
  await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: workspace.activeBranch.id, receiptDate: "2026-10-05",
    lines: [{ variantId: variant.id, quantity: 2, unitCostPiasters: 5000 }],
  });
  return { product, variant, size, color };
}

async function sales(page: Page, variantId: string): Promise<Sale[]> {
  const all = await api(page, "GET", "/api/internal/sales") as Sale[];
  return all.filter((sale) => sale.lines.some((line) => line.variantId === variantId));
}

async function stock(page: Page, code: string, variantId: string): Promise<number> {
  const product = await api(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(code)}`);
  return product.variants.find((variant: { id: string }) => variant.id === variantId).availableQuantity;
}

// Serialized by Playwright into every window, including subsequently created print iframes.
// Keep this callback self-contained; no application hooks or native printer are used.
function installPrintHarness() {
  const root = window.top as HardwareWindow;
  root.__hardwarePrints ??= [];
  window.print = () => {
    const labels = document.querySelectorAll(".label").length;
    root.__hardwarePrints!.push({
      kind: labels ? "labels" : "receipt",
      text: document.body.textContent ?? "",
      labels,
      title: document.title,
      unsafeNodes: document.querySelectorAll("script, nav, a, img").length,
    });
    window.dispatchEvent(new Event("afterprint"));
  };
}

async function prints(page: Page): Promise<HardwarePrint[]> {
  return page.evaluate(() => (window.top as HardwareWindow).__hardwarePrints ?? []);
}

async function lookup(page: Page, code: string) {
  const form = page.getByRole("form", { name: "البحث برمز المنتج" });
  await form.getByLabel("رمز المنتج").fill(code);
  await form.getByLabel("رمز المنتج").press("Enter");
  await expect(page.getByTestId("lookup-result")).toContainText(code);
}

async function openLabel(page: Page, code: string) {
  await page.getByRole("button", { name: `طباعة باركود ${code}`, exact: true }).click();
  const dialog = page.getByTestId("product-label-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("product-label-print")).toBeEnabled();
  return dialog;
}

function preview(page: Page) {
  return page.frameLocator('iframe[title="معاينة الملصق"]');
}

// Independently decode rasterized rendered SVG bars, rather than reading the code text,
// aria-label, or calling the application's encoder. ZXing stays in the test process.
async function decodeRenderedBarcode(svg: Locator): Promise<string> {
  const pixels = await svg.evaluate(async (element) => {
    const graphic = element as SVGSVGElement;
    const width = Math.ceil(graphic.viewBox.baseVal.width * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(graphic)], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      context.fillStyle = "white";
      context.fillRect(0, 0, width, 64);
      context.drawImage(image, 0, 0, width, 64);
      const rgba = context.getImageData(0, 32, width, 1).data;
      return Array.from({ length: width }, (_, x) => rgba[x * 4]! < 128);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  expect(pixels.slice(0, 20)).toEqual(Array(20).fill(false));
  expect(pixels.slice(-20)).toEqual(Array(20).fill(false));
  expect(pixels.some(Boolean)).toBe(true);
  const row = new BitArray(pixels.length);
  pixels.forEach((black, index) => { if (black) row.set(index); });
  return new Code128Reader().decodeRow(0, row).getText();
}

async function expectLabelBounds(label: Locator, widthMm: number, heightMm: number) {
  const measured = await label.evaluate(async (node) => {
    await node.ownerDocument.fonts.ready;
    const box = node.getBoundingClientRect();
    const style = node.ownerDocument.defaultView!.getComputedStyle(node);
    const left = box.left + Number.parseFloat(style.paddingLeft);
    const right = box.right - Number.parseFloat(style.paddingRight);
    const top = box.top + Number.parseFloat(style.paddingTop);
    const bottom = box.bottom - Number.parseFloat(style.paddingBottom);
    return {
      width: box.width, height: box.height,
      fits: [...node.children].every((child) => {
        const bounds = child.getBoundingClientRect();
        return bounds.left >= left - 1 && bounds.right <= right + 1 && bounds.top >= top - 1 && bounds.bottom <= bottom + 1;
      }),
      noOverflow: node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1,
    };
  });
  expect(measured.width).toBeCloseTo(widthMm * 96 / 25.4, 0);
  expect(measured.height).toBeCloseTo(heightMm * 96 / 25.4, 0);
  expect(measured.fits).toBe(true);
  expect(measured.noOverflow).toBe(true);
}

test("saved catalog identity prints three labels with fractional dimensions and no stock or sale effect", async ({ page }) => {
  await page.addInitScript(installPrintHarness);
  const data = await seed(page);
  await page.goto(`${internal}/catalog`);
  const item = page.locator("article.staff-item").filter({ hasText: data.product.code });
  await item.getByRole("button", { name: "تعديل", exact: true }).click();
  await page.getByLabel("اسم المنتج", { exact: true }).fill("UNSAVED editor name");
  const dialog = await openLabel(page, data.product.code);
  await expect(preview(page).locator(".name")).toHaveText(data.product.nameAr);
  expect(await decodeRenderedBarcode(preview(page).locator(".bars svg"))).toBe(data.product.code);

  await dialog.getByLabel("عدد النسخ").fill("3");
  await expect(preview(page).locator(".label")).toHaveCount(1);
  await dialog.getByLabel("عدد النسخ").fill("0");
  await expect(dialog.getByLabel("عدد النسخ")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByTestId("product-label-print")).toBeDisabled();
  await dialog.getByLabel("عدد النسخ").fill("1.5");
  await expect(dialog.getByLabel("عدد النسخ")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByTestId("product-label-print")).toBeDisabled();
  await dialog.getByLabel("عدد النسخ").fill("3");
  await dialog.locator("summary").click();
  await dialog.getByLabel("العرض بالملليمتر").fill("40");
  await expect(dialog.getByRole("alert")).toContainText(/بعرض .* مم على الأقل/);
  await expect(dialog.getByLabel("العرض بالملليمتر")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByTestId("product-label-print")).toBeDisabled();
  await dialog.getByLabel("العرض بالملليمتر").fill("80.5");
  await dialog.getByLabel("الارتفاع بالملليمتر").fill("40.5");
  await expect(dialog.getByTestId("product-label-print")).toBeEnabled();
  await expect(dialog.getByLabel("العرض بالملليمتر")).toHaveAttribute("aria-invalid", "false");
  await expect(dialog.getByLabel("الارتفاع بالملليمتر")).toHaveAttribute("aria-invalid", "false");
  await expectLabelBounds(preview(page).locator(".label"), 80.5, 40.5);
  await dialog.screenshot({ path: `${shots}/label-dialog-fractional.png` });
  await preview(page).locator(".label").screenshot({ path: `${shots}/label-preview-fractional.png` });
  await dialog.getByTestId("product-label-print").click();
  await expect(dialog.getByRole("status")).toContainText("تم طلب طباعة الملصقات");
  await expect.poll(async () => (await prints(page)).length).toBe(1);
  const [printed] = await prints(page);
  expect(printed).toMatchObject({ kind: "labels", labels: 3, title: "ملصق منتج", unsafeNodes: 0 });
  expect(printed!.text.split(data.product.nameAr)).toHaveLength(4);
  expect(printed!.text).not.toMatch(/UNSAVED|unitCostPiasters|تكلفة|تسجيل الخروج|تغيير الفرع/);
  expect(await sales(page, data.variant.id)).toHaveLength(0);
  expect(await stock(page, data.product.code, data.variant.id)).toBe(2);
});

test("offline label printer to scanner to receipt flow synchronizes one sale and one stock deduction", async ({ page, context }) => {
  await page.addInitScript(installPrintHarness);
  const data = await seed(page);
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toBeVisible();
  await lookup(page, data.product.code);
  expect(await sales(page, data.variant.id)).toHaveLength(0);
  expect(await stock(page, data.product.code, data.variant.id)).toBe(2);

  if (process.env.BRAVOS_HW_PRODUCTION === "1") {
    // Do not open/import the label dialog before disconnecting: this exercises its PWA precache.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
      }
    });
  } else {
    const warmDialog = await openLabel(page, data.product.code);
    await warmDialog.getByRole("button", { name: "إلغاء", exact: true }).click();
    // Development has no service worker. Cache actual online Cairo responses in
    // this test fixture to simulate the built PWA's precached font bytes offline.
    const fontCache = new Map(await Promise.all([
      "cairo-arabic.woff2", "cairo-latin-ext.woff2", "cairo-latin.woff2",
    ].map(async (file) => {
      const url = `${internal}/fonts/${file}`;
      const response = await page.request.get(url);
      expect(response.status(), `Cairo fixture ${url}`).toBe(200);
      return [url, { body: await response.body(), contentType: response.headers()["content-type"] ?? "font/woff2" }] as const;
    })));
    await page.route(/\/fonts\/cairo[^/]*\.woff2(?:\?.*)?$/, async (route) => {
      const cached = fontCache.get(route.request().url());
      if (!cached) throw new Error(`Uncached Cairo font requested: ${route.request().url()}`);
      await route.fulfill({ status: 200, contentType: cached.contentType, body: cached.body });
    });
  }

  await context.setOffline(true);
  try {
    const dialog = await openLabel(page, data.product.code);
    const scannedCode = await decodeRenderedBarcode(preview(page).locator(".bars svg"));
    expect(scannedCode).toBe(data.product.code);
    await dialog.getByTestId("product-label-print").click();
    await expect(dialog.getByRole("status")).toContainText("تم طلب طباعة الملصقات");
    await expect.poll(async () => (await prints(page)).map((entry) => entry.kind)).toEqual(["labels"]);
    // APIRequestContext is the test observer; the staff browser remains offline throughout.
    expect(await sales(page, data.variant.id)).toHaveLength(0);
    expect(await stock(page, data.product.code, data.variant.id)).toBe(2);
    await dialog.getByRole("button", { name: "إلغاء", exact: true }).click();

    // A scanner types the decoded product code and Enter; variant choice remains manual.
    await lookup(page, scannedCode);
    await expect(page.locator("#lookupSize")).toHaveValue("");
    await expect(page.locator("#lookupColor")).toHaveValue("");
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await expect(checkout).not.toContainText(data.product.nameAr);
    await openLookupLists(page);
    await page.locator("#lookupSize").selectOption(data.size.id);
    await page.locator("#lookupColor").selectOption(data.color.id);
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
    await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
    await page.getByTestId("complete-sale-print").click();
    await expect(page.getByTestId("sale-details")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع" })).toBeVisible();
    await expect(page.getByTestId("pos-receipt-status")).toContainText("تم طلب طباعة الإيصال");
    await expect.poll(async () => (await prints(page)).map((entry) => entry.kind)).toEqual(["labels", "receipt"]);
    const captured = await prints(page);
    expect(captured[0]).toMatchObject({ labels: 1, unsafeNodes: 0 });
    expect(captured[1]!.text).toContain(data.product.nameAr);
    expect(captured[1]!.text).not.toMatch(/unitCostPiasters|تكلفة|تسجيل الخروج|تغيير الفرع/);
    expect(await sales(page, data.variant.id)).toHaveLength(0);
    expect(await stock(page, data.product.code, data.variant.id)).toBe(2);
  } finally {
    await context.setOffline(false);
  }

  await expect.poll(async () => (await sales(page, data.variant.id)).length).toBe(1);
  await expect.poll(() => stock(page, data.product.code, data.variant.id)).toBe(1);
  expect((await sales(page, data.variant.id))[0]!.finalTotalPiasters).toBe(12000);
  await page.getByTestId("reprint-receipt").click();
  await expect.poll(async () => (await prints(page)).map((entry) => entry.kind)).toEqual(["labels", "receipt", "receipt"]);
  expect(await sales(page, data.variant.id)).toHaveLength(1);
  expect(await stock(page, data.product.code, data.variant.id)).toBe(1);
});

test("long mixed names and maximum codes fit real label pages without interpreting markup", async ({ page }) => {
  test.skip(process.env.BRAVOS_HW_PRODUCTION === "1", "Direct source-module document checks run on the dev server; the offline flow also runs against the built PWA.");
  await login(page);
  const product = {
    id: "isolated-label-document",
    code: "BrV-0123456789_AbCdEfGhIjKlMnOpQrStUvWxY",
    nameAr: 'قميص واسع Bravos WIDEWORDWWWWWWWWWWWWWWWWWWWW <script>literal</script> نسيج عربي طويل',
  };
  expect(product.code).toHaveLength(40);
  await page.evaluate(async (product) => {
    const labels = await import("/src/labels/index.ts");
    const host = document.createElement("div");
    host.id = "isolated-label-document";
    document.body.appendChild(host);
    await labels.mountProductLabelPreview(host, product, { widthMm: 160, heightMm: 100, copies: 1, dpi: 203 });
  }, product);
  const frame = preview(page);
  await expect(frame.locator(".name")).toHaveText(product.nameAr);
  await expect(frame.locator("script, img, nav, a")).toHaveCount(0);
  await expect(frame.locator("body")).not.toContainText("unitCostPiasters");
  await expectLabelBounds(frame.locator(".label"), 160, 100);
  expect(await decodeRenderedBarcode(frame.locator(".bars svg"))).toBe(product.code);
  await frame.locator(".label").screenshot({ path: `${shots}/label-long-name-max-code.png` });

  const overflow = await page.evaluate(async (product) => {
    const labels = await import("/src/labels/index.ts");
    const frame = document.querySelector<HTMLIFrameElement>('#isolated-label-document iframe');
    const doc = frame!.contentDocument!;
    await doc.fonts.ready;
    doc.querySelector<HTMLElement>(".name")!.style.fontSize = "100mm";
    try {
      labels.fitAndValidateLabelDocument(doc, labels.planLabelLayout(product, { widthMm: 160, heightMm: 100, copies: 1, dpi: 203 }));
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, product);
  expect(overflow).toMatch(/بارتفاع .* مم على الأقل/);
});

test("label font fetch failure can retry a fresh preview without changing sales or stock", async ({ page }) => {
  const data = await seed(page);
  await page.goto(`${internal}/catalog`);
  const action = page.getByRole("button", { name: `طباعة باركود ${data.product.code}`, exact: true });
  await expect(action).toBeVisible();
  const fontRequests = /\/fonts\/cairo[^/]*\.woff2(?:\?.*)?$/;
  let rejectedFetches = 0;
  // Target only this page's explicit label-font fetches. Ordinary CSS font loads
  // and other tests' pages continue normally; the dialog module is still cold.
  await page.route(fontRequests, async (route) => {
    if (route.request().resourceType() !== "fetch") {
      await route.continue();
      return;
    }
    rejectedFetches += 1;
    await route.fulfill({ status: 503, contentType: "text/plain", body: "Label font temporarily unavailable" });
  });

  await action.click();
  const dialog = page.getByTestId("product-label-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/خط/);
  await expect(dialog.getByRole("button", { name: "إعادة المحاولة", exact: true })).toBeVisible();
  await expect(dialog.getByTestId("product-label-print")).toBeDisabled();
  expect(rejectedFetches).toBeGreaterThan(0);
  expect(await sales(page, data.variant.id)).toHaveLength(0);
  expect(await stock(page, data.product.code, data.variant.id)).toBe(2);

  await page.unroute(fontRequests);
  await dialog.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(dialog.getByTestId("product-label-print")).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(await decodeRenderedBarcode(preview(page).locator(".bars svg"))).toBe(data.product.code);
  expect(await sales(page, data.variant.id)).toHaveLength(0);
  expect(await stock(page, data.product.code, data.variant.id)).toBe(2);
});
