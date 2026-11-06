import { expect, test, type Page } from "@playwright/test";
import type { ManagerProductDto } from "@bravos/contracts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const BROKEN_PNG = Buffer.concat([PNG.subarray(0, 12), Buffer.alloc(12)]);

test("manager publishes product media and customers see only selectable stocked variants", async ({ page }) => {
  await signInManager(page);
  await createTaxonomy(page);

  const categories = await staffApi(page, "GET", "/api/internal/catalog/categories");
  const sizes = await staffApi(page, "GET", "/api/internal/catalog/sizes");
  const colors = await staffApi(page, "GET", "/api/internal/catalog/colors");
  const category = categories.body.find((item: { nameAr: string }) => item.nameAr === "قمصان 17");
  const size = sizes.body.find((item: { nameAr: string }) => item.nameAr === "XL17");
  const green = colors.body.find((item: { nameAr: string }) => item.nameAr === "أخضر 17");
  const sand = colors.body.find((item: { nameAr: string }) => item.nameAr === "رملي 17");
  const created = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "MEDIA-E2E-17", nameAr: "قميص برافوس المصور", descriptionAr: "", categoryId: category.id,
    defaultSellingPricePiasters: 32000, publication: "available", imageRefs: [], sizeGuideAr: null,
    variants: [
      { sizeId: size.id, colorId: green.id, sellingPricePiastersOverride: null },
      { sizeId: size.id, colorId: sand.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(created.status).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "قميص برافوس المصور", exact: true }).click();
  await page.getByRole("tab", { name: "المتجر الإلكتروني" }).click();
  const form = page.getByRole("form", { name: "تعديل منتج" });
  await form.getByLabel("الوصف").fill("قميص قطني بصورة حقيقية");
  await form.getByLabel("دليل المقاسات (اختياري)").fill("XL17 — عرض الصدر 54 سم");
  const uploadInput = form.getByLabel(/رفع صور JPG/);
  let uploadRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/internal/catalog/media")) {
      uploadRequests += 1;
    }
  });
  await uploadInput.setInputFiles({
    name: "too-large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole("alert")).toContainText("الحد الأقصى 5 ميجابايت");
  expect(uploadRequests).toBe(0);

  let releaseUpload = () => {};
  let markUploadObserved = () => {};
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  const uploadObserved = new Promise<void>((resolve) => { markUploadObserved = resolve; });
  await page.route("**/api/internal/catalog/media", async (route) => {
    markUploadObserved();
    await uploadGate;
    await route.continue();
  }, { times: 1 });
  await uploadInput.setInputFiles([
    { name: "shirt-17.png", mimeType: "image/png", buffer: PNG },
    { name: "broken-17.png", mimeType: "image/png", buffer: BROKEN_PNG },
  ]);
  await uploadObserved;
  await expect(form.getByRole("button", { name: "حفظ التعديل" })).toBeDisabled();
  await openCatalogTaxonomy(page);
  const categoryDuringUpload = page.getByRole("form", { name: "إضافة تصنيف" });
  await categoryDuringUpload.getByLabel("اسم التصنيف").fill("تصنيف أثناء الرفع 17");
  await categoryDuringUpload.getByRole("button", { name: "حفظ التصنيف" }).click();
  await closeCatalogTaxonomy(page);
  await expect(page.getByText("تم حفظ التصنيف.", { exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "حفظ التعديل" })).toBeDisabled();
  releaseUpload();
  await expect(page.getByRole("alert")).toContainText("ملف الصورة تالف أو غير قابل للقراءة");
  await expect(page.getByRole("status")).toContainText("تم رفع 1 من 2 صورة");
  await expect(form.getByRole("button", { name: "حفظ التعديل" })).toBeEnabled();
  await expect.poll(() => uploadRequests).toBe(2);
  await expect(form.getByRole("img", { name: "صورة المنتج 1" })).toBeVisible();

  await page.getByRole("tab", { name: "البيانات الأساسية" }).click();
  await form.getByLabel("سعر البيع بالجنيه").fill("340");
  await form.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج");

  const products = await staffApi(page, "GET", "/api/internal/catalog/products");
  const product = (products.body as ManagerProductDto[]).find((item) => item.code === "MEDIA-E2E-17");
  expect(product).toBeTruthy();
  if (!product) throw new Error("Expected the media test product.");
  expect(product.defaultSellingPricePiasters).toBe(34000);

  await page.goto("http://127.0.0.1:3001");
  await expect(async () => {
    const rail = page.locator(`[data-category-rail="${product.category.id}"]`);
    await expect(rail).toHaveCount(1);
    await expect(rail).toBeVisible();
    await rail.scrollIntoViewIfNeeded();
  }).toPass({ timeout: 15000 });
  const outOfStockCard = page.getByRole("link", { name: /قميص برافوس المصور/ });
  await expect(outOfStockCard).toContainText("Out of Stock");
  await outOfStockCard.click();
  await expect(page.getByRole("heading", { name: "قميص برافوس المصور" })).toBeVisible();
  await expect(page.getByText("Out of stock. Product details are still available.")).toBeVisible();
  await expect(page.locator(".purchase-panel input[type='radio']")).toHaveCount(0);
  const unavailablePairs = page.getByRole("list", { name: "Unavailable size and color pairs" });
  await expect(unavailablePairs.getByRole("listitem")).toHaveCount(2);
  await expect(unavailablePairs).toContainText("XL17");
  await expect(unavailablePairs).toContainText("أخضر 17");
  await expect(unavailablePairs).toContainText("رملي 17");
  for (const pair of await unavailablePairs.getByRole("listitem").all()) {
    await expect(pair).toContainText(/EGP\s*340/);
  }
  await expect(unavailablePairs).toContainText("Unavailable");
  await expect(page.getByRole("button", { name: "Add to bag" })).toHaveCount(0);

  const warehouseId = "33333333-3333-4333-8333-333333333333";
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id;
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: warehouseId,
    receiptDate: "2026-09-14",
    lines: [{ productId: product.id, quantity: 2, unitCostPiasters: 18000 }],
  });
  expect(receipt.status).toBe(201);
  const transfer = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: warehouseId,
    destinationBranchId: branchId,
    productId: product.id,
    quantity: 2,
  });
  expect(transfer.status).toBe(201);

  await page.goto("http://127.0.0.1:3001");
  await expect(async () => {
    const rail = page.locator(`[data-category-rail="${product.category.id}"]`);
    await expect(rail).toHaveCount(1);
    await expect(rail).toBeVisible();
    await rail.scrollIntoViewIfNeeded();
  }).toPass({ timeout: 15000 });
  const card = page.getByRole("link", { name: /قميص برافوس المصور/ });
  await expect(card).toContainText("In Stock");
  await card.click();
  await expect(page.getByRole("heading", { name: "قميص برافوس المصور" })).toBeVisible();
  await expect(page.getByText("XL17 — عرض الصدر 54 سم")).toBeVisible();
  const productImage = page.getByRole("img", { name: /قميص برافوس المصور — photo 1/ });
  await expect(productImage).toBeVisible();
  const renderedImageUrl = await productImage.getAttribute("src");
  expect(renderedImageUrl).not.toBeNull();
  const renderedImage = new URL(renderedImageUrl ?? "", page.url());
  expect(renderedImage.origin).toBe("http://127.0.0.1:3001");
  const renderedImagePath = renderedImage.pathname;
  expect(renderedImagePath).toBe(`/api/public/catalog/media/${product.imageRefs[0]}`);
  const publicImage = await page.request.get(`http://127.0.0.1:3001${renderedImagePath}`);
  expect(publicImage.status()).toBe(200);
  const optimizerAttempt = await page.request.get(
    `http://127.0.0.1:3001/_next/image?url=${encodeURIComponent(renderedImagePath)}&w=640&q=75`,
  );
  expect(optimizerAttempt.status()).toBe(404);
  const colorGroup = page.getByRole("group", { name: "Color" });
  const sizeGroup = page.getByRole("group", { name: "Size" });
  const stockedChoice = colorGroup.getByRole("radio", { name: /أخضر 17/ });
  const emptyChoice = colorGroup.getByRole("radio", { name: /رملي 17/ });
  await expect(stockedChoice).toBeEnabled();
  await expect(stockedChoice).toBeChecked();
  await expect(emptyChoice).toBeEnabled();
  await emptyChoice.check();
  await expect(emptyChoice).toBeChecked();
  await expect(page.locator("p", { hasText: "Selected price" }).locator("strong")).toContainText(/EGP\s*340/);
  await expect(sizeGroup.getByRole("radio", { name: /XL17/ })).toBeEnabled();
  await expect(sizeGroup.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Unavailable size and color pairs" })).toHaveCount(0);
  await expect(page.getByText(/تكلفة|ربح|شراء|موظف/)).toHaveCount(0);

  const withoutMedia = await staffApi(
    page,
    "PATCH",
    `/api/internal/catalog/products/${product.id}`,
    productWrite(product, "available", []),
  );
  expect(withoutMedia.status).toBe(200);
  const removedMedia = await page.request.get(`http://127.0.0.1:3001${renderedImagePath}`);
  expect(removedMedia.status()).toBe(404);
  await page.reload();
  await expect(page.getByRole("img", { name: /قميص برافوس المصور/ })).toHaveCount(0);

  const reattached = await staffApi(
    page,
    "PATCH",
    `/api/internal/catalog/products/${product.id}`,
    productWrite(withoutMedia.body as ManagerProductDto, "available", product.imageRefs),
  );
  expect(reattached.status).toBe(200);
  await page.reload();
  await expect(page.getByRole("img", { name: /قميص برافوس المصور — photo 1/ })).toBeVisible();

  const comingSoon = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, productWrite(reattached.body as ManagerProductDto, "coming_soon"));
  expect(comingSoon.status).toBe(200);
  await page.reload();
  await expect(page.getByRole("main").getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(page.locator(".purchase-panel input[type='radio']")).toHaveCount(0);
  const previewPairs = page.getByRole("list", { name: "Unavailable size and color pairs" });
  await expect(previewPairs.getByRole("listitem")).toHaveCount(2);
  await expect(previewPairs).toContainText("XL17");
  await expect(previewPairs).toContainText("أخضر 17");
  await expect(previewPairs).toContainText("رملي 17");
  for (const pair of await previewPairs.getByRole("listitem").all()) {
    await expect(pair).toContainText(/EGP\s*340/);
  }
  await expect(previewPairs).toContainText("Unavailable");
  await expect(page.getByText("Size and color share one price and one available quantity. None can be ordered.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to bag" })).toHaveCount(0);

  const hidden = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, productWrite(comingSoon.body as ManagerProductDto, "hidden"));
  expect(hidden.status).toBe(200);
  const mediaRef = product.imageRefs[0];
  if (!mediaRef) throw new Error("Expected the uploaded product image reference.");
  await page.goto("http://127.0.0.1:3001");
  await expect(page.getByText("قميص برافوس المصور", { exact: true })).toHaveCount(0);
  await page.goto(`http://127.0.0.1:3001/products/${product.id}`);
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
  const hiddenMedia = await page.request.get(`http://127.0.0.1:3001${renderedImagePath}`);
  expect(hiddenMedia.status()).toBe(404);
});

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();
}

async function createTaxonomy(page: Page) {
  await openCatalogTaxonomy(page);
  const category = page.getByRole("form", { name: "إضافة تصنيف" });
  await category.getByLabel("اسم التصنيف").fill("قمصان 17");
  await category.getByRole("button", { name: "حفظ التصنيف" }).click();
  await closeCatalogTaxonomy(page);
  await expect(page.getByRole("status")).toContainText("تم حفظ التصنيف");
  await openCatalogTaxonomy(page);
  const size = page.getByRole("form", { name: "إضافة مقاس" });
  await size.getByLabel("اسم المقاس").fill("XL17");
  await size.getByRole("button", { name: "حفظ المقاس" }).click();
  await closeCatalogTaxonomy(page);
  await expect(page.getByText("تم حفظ المقاس.", { exact: true })).toBeVisible();
  await openCatalogTaxonomy(page);
  const color = page.getByRole("form", { name: "إضافة لون" });
  await color.getByLabel("اسم اللون").fill("أخضر 17");
  await color.getByRole("button", { name: "حفظ اللون" }).click();
  await closeCatalogTaxonomy(page);
  await expect(page.getByText("تم حفظ اللون.", { exact: true })).toBeVisible();
  await openCatalogTaxonomy(page);
  await color.getByLabel("اسم اللون").fill("رملي 17");
  await color.getByRole("button", { name: "حفظ اللون" }).click();
  await closeCatalogTaxonomy(page);
  await expect(page.getByText("تم حفظ اللون.", { exact: true })).toBeVisible();
}

async function openCatalogTaxonomy(page: Page) {
  await page.getByRole("button", { name: "إدارة التصنيفات والمقاسات والألوان" }).click();
}

async function closeCatalogTaxonomy(page: Page) {
  await page.getByRole("button", { name: "إغلاق التصنيفات والمقاسات والألوان" }).click();
}

function productWrite(
  product: ManagerProductDto,
  publication: "available" | "coming_soon" | "hidden",
  imageRefs = product.imageRefs,
) {
  return {
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    categoryId: product.category.id,
    defaultSellingPricePiasters: product.defaultSellingPricePiasters,
    publication,
    imageRefs,
    sizeGuideAr: product.sizeGuideAr,
    variants: product.variants.map((variant) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      onlineVisible: variant.onlineVisible,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  };
}

async function staffApi(page: Page, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
