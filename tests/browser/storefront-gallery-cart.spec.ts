import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

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
  const emptyGallery = page.getByRole("region", { name: "صور منتج بلا صور" });
  await expect(emptyGallery.getByText("لا توجد صورة لهذا المنتج")).toBeVisible();
  await expect(emptyGallery.getByRole("img")).toHaveCount(0);
  await expect(emptyGallery.getByRole("button")).toHaveCount(0);

  await page.goto(`http://127.0.0.1:3001/products/${single.id}`);
  const singleGallery = page.getByRole("region", { name: "صور منتج بصورة واحدة" });
  await expect(singleGallery.getByRole("img", { name: "منتج بصورة واحدة — صورة 1" })).toHaveAttribute(
    "src", mediaSrc(imageRefs[0]),
  );
  await expect(singleGallery.getByRole("button")).toHaveCount(0);

  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/public/catalog/media/")) mediaRequests.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:3001/products/${multiple.id}`);
  const gallery = page.getByRole("region", { name: "صور منتج بثلاث صور" });
  const activeImage = gallery.getByRole("img");
  await expect(activeImage).toHaveCount(1);
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[0]));
  await expect(activeImage).toHaveAttribute("alt", "منتج بثلاث صور — صورة 1");
  await expect(gallery.getByText("الصورة 1 من 3")).toBeVisible();
  await expect(gallery.getByRole("button", { name: "عرض الصورة 1 من 3" })).toHaveAttribute("aria-current", "true");
  expect(mediaRequests.some((url) => url.includes(imageRefs[1]))).toBe(false);
  expect(mediaRequests.some((url) => url.includes(imageRefs[2]))).toBe(false);

  const secondSelector = gallery.getByRole("button", { name: "عرض الصورة 2 من 3" });
  await secondSelector.focus();
  await expect(secondSelector).toBeFocused();
  await secondSelector.press("Enter");
  await expect(secondSelector).toHaveAttribute("aria-current", "true");
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[1]));
  await expect(gallery.getByText("الصورة 2 من 3")).toBeVisible();
  await gallery.getByRole("button", { name: "الصورة التالية" }).click();
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[2]));
  await expect(gallery.getByText("الصورة 3 من 3")).toBeVisible();
  await gallery.getByRole("button", { name: "الصورة السابقة" }).focus();
  await gallery.getByRole("button", { name: "الصورة السابقة" }).press("Space");
  await expect(activeImage).toHaveAttribute("src", mediaSrc(imageRefs[1]));
  const nextButton = gallery.getByRole("button", { name: "الصورة التالية" });
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
  await gallery.getByRole("button", { name: "عرض الصورة 3 من 3" }).click();
  await expect(gallery.getByText("هذه الصورة غير متاحة حالياً")).toBeVisible();
  await expect(gallery.getByRole("img")).toHaveCount(0);
  const afterFailure = await gallery.boundingBox();
  expect(beforeFailure).not.toBeNull();
  expect(afterFailure).not.toBeNull();
  expect(Math.abs((afterFailure?.height ?? 0) - (beforeFailure?.height ?? 0))).toBeLessThan(3);
  await gallery.getByRole("button", { name: "الصورة السابقة" }).click();
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
  await expect(lines.first()).toContainText(`سعر القطعة ${money(25_000)}`);
  await expect(lines.first()).toContainText(`إجمالي الاختيار${money(50_000)}`);
  await expect(lines.first().locator("output")).toHaveText("2");
  await expect(lines.nth(1)).toContainText("رملي للسلة");
  await expect(lines.nth(1)).toContainText(`إجمالي الاختيار${money(30_000)}`);
  const summary = page.getByRole("complementary", { name: "ملخص السلة" });
  await expect(summary).toContainText("عدد القطع3");
  await expect(summary).toContainText(`مجموع مبدئي${money(80_000)}`);
  await expect(summary).toContainText("للمنتجات فقط، قبل الخصومات والتوصيل. راجع المبلغ النهائي في الخطوة التالية.");
  await expect(summary).toContainText("نراجع توفر السلة كاملة عند مراجعة السعر");
  await expect(summary).toContainText("السلة لا تحجز القطع.");
  const checkoutLink = page.getByRole("link", { name: "متابعة إتمام الطلب" });
  await expect(checkoutLink).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cart-phone-390.png"), fullPage: true });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);

  const note = summary.getByText("للمنتجات فقط، قبل الخصومات والتوصيل. راجع المبلغ النهائي في الخطوة التالية.");
  const noteColor = await note.evaluate((element) => getComputedStyle(element).color);
  const summaryBackground = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
  const increase = lines.first().getByRole("button", { name: "زيادة الكمية" });
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

  await lines.first().getByRole("button", { name: "تقليل الكمية" }).focus();
  await lines.first().getByRole("button", { name: "تقليل الكمية" }).press("Enter");
  await expect(lines.first().locator("output")).toHaveText("1");
  await expect(summary).toContainText(`مجموع مبدئي${money(55_000)}`);
  await page.reload();
  await expect(lines.first().locator("output")).toHaveText("1");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null"));
  expect(saved.items.map((item: { quantity: number }) => item.quantity)).toEqual([1, 1]);

  const sale = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), employeeDiscountPiasters: 0,
    lines: [{ variantId: second.id, quantity: 1 }], physicallyCompleted: true,
  });
  expect(sale.status).toBe(201);
  await page.getByRole("button", { name: "تحديث بيانات المنتجات" }).click();
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1).getByRole("alert")).toContainText("غير متوفر");
  await expect(page.getByRole("link", { name: "متابعة إتمام الطلب" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("cart-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await hasNoHorizontalOverflow(page)).toBe(true);
});

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function seedTaxonomy(page: Page, suffix: string) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M ${suffix === "cart" ? "للسلة" : "للمعرض"}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: suffix === "cart" ? "أسود للسلة" : "أسود للمعرض" });
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
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", minimumFractionDigits: 0 }).format(piasters / 100);
}

function mediaSrc(ref: string) {
  return new RegExp(`/api/public/catalog/media/${ref.replaceAll(".", "\\.")}$`);
}
