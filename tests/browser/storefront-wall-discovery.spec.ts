import { expect, test, type Page } from "@playwright/test";

const STORE = "http://127.0.0.1:3001";
const API = "http://127.0.0.1:5174";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("product wall keeps honest prices, publication states, media space, and responsive columns", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signInManager(page);
  const category = await createCategory(page, "اختبار واجهة المجموعة");
  const otherCategory = await createCategory(page, "اختبار واجهة أخرى");
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس واجهة" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون واجهة" });
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);
  const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
    fileName: "wall.png", contentType: "image/png", base64: PNG_BASE64,
  });
  expect(uploaded.status).toBe(201);
  const imageRef = uploaded.body.ref as string;
  const products = [
    { code: "WALL-A-25", name: "اختبار واجهة ألف", price: 30000, publication: "available", imageRefs: [] },
    { code: "WALL-B-25", name: "اختبار واجهة باء", price: 0, publication: "available", imageRefs: [] },
    { code: "WALL-C-25", name: "اختبار واجهة جيم", price: 50000, publication: "coming_soon", imageRefs: [] },
    { code: "WALL-D-25", name: "اختبار واجهة دال", price: 10000, publication: "available", imageRefs: [imageRef] },
    { code: "WALL-E-25", name: "اختبار واجهة هاء", price: 20000, publication: "available", imageRefs: [] },
    { code: "WALL-H-25", name: "اختبار واجهة مخفي", price: 90000, publication: "hidden", imageRefs: [] },
  ] as const;
  const created = [];
  for (const product of products) {
    const response = await createProduct(page, category.body.id, size.body.id, color.body.id, product);
    expect(response.status).toBe(201);
    created.push(response.body);
  }
  expect((await createProduct(page, otherCategory.body.id, size.body.id, color.body.id, {
    code: "WALL-OTHER-25", name: "اختبار واجهة معطف", price: 40000, publication: "available", imageRefs: [],
  })).status).toBe(201);
  const stockedVariantId = created[3].variants[0].id as string;
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json()).activeBranch.id,
    receiptDate: "2026-09-25",
    lines: [{ variantId: stockedVariantId, quantity: 2, unitCostPiasters: 5000 }],
  })).status).toBe(201);

  await page.route(`**/api/public/catalog/media/${imageRef}`, (route) => route.abort());
  const browseUrl = `${STORE}/?q=${encodeURIComponent("اختبار واجهة")}&category=${category.body.id}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(browseUrl);
  const wall = page.getByRole("region", { name: "المنتجات" });
  const cards = wall.locator("a.product-card");
  await expect(cards).toHaveCount(5);
  await expect(page.getByText("اختبار واجهة مخفي", { exact: true })).toHaveCount(0);
  await expect(page.getByText("اختبار واجهة معطف", { exact: true })).toHaveCount(0);
  await expect(cards.filter({ hasText: "اختبار واجهة ألف" })).toContainText("يبدأ من");
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).toContainText(/[٠۰0]/);
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).not.toContainText("السعر عند الاختيار");
  await expect(cards.filter({ hasText: "اختبار واجهة جيم" })).toContainText("قريباً");
  await expect(cards.filter({ hasText: "اختبار واجهة دال" })).toContainText("متوفر");
  await expect(cards.filter({ hasText: "اختبار واجهة ألف" })).toContainText("غير متوفر");
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).toContainText("الصورة غير متاحة");
  const brokenCard = cards.filter({ hasText: "اختبار واجهة دال" });
  await brokenCard.scrollIntoViewIfNeeded();
  await expect(brokenCard).toContainText("الصورة غير متاحة");
  await expect(brokenCard.locator("[data-product-media]")).toBeVisible();
  await expect(brokenCard).toHaveAttribute("href", `/products/${created[3].id}`);
  await cards.first().focus();
  await expect(cards.first()).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("wall-1440.png"), fullPage: true });

  for (const [width, columns] of [[1440, 4], [768, 2], [390, 2], [320, 1]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => cards.first().locator("..").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
    const dimensions = await cards.first().locator("[data-product-media]").boundingBox();
    expect(dimensions).not.toBeNull();
    if (dimensions) expect(dimensions.height / dimensions.width).toBeCloseTo(width >= 900 ? .625 : 1.25, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("wall-390.png"), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "إزالة البحث: اختبار واجهة" })).toBeVisible();
  await expect(page.getByRole("link", { name: "إزالة التصنيف: اختبار واجهة المجموعة" })).toBeVisible();
  await page.getByLabel("ترتيب المنتجات").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect(page).toHaveURL(/category=/);
  await expect(page).toHaveURL(/q=/);
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual([
    "اختبار واجهة باء", "اختبار واجهة دال", "اختبار واجهة هاء", "اختبار واجهة ألف", "اختبار واجهة جيم",
  ]);
  await page.screenshot({ path: testInfo.outputPath("filtered-price-asc-390.png"), fullPage: true });
  await page.getByLabel("ترتيب المنتجات").selectOption("price-desc");
  await expect(page).toHaveURL(/sort=price-desc/);
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual([
    "اختبار واجهة جيم", "اختبار واجهة ألف", "اختبار واجهة هاء", "اختبار واجهة دال", "اختبار واجهة باء",
  ]);
  await page.goBack();
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual([
    "اختبار واجهة باء", "اختبار واجهة دال", "اختبار واجهة هاء", "اختبار واجهة ألف", "اختبار واجهة جيم",
  ]);
  await page.goForward();
  await expect(page).toHaveURL(/sort=price-desc/);
  await page.getByLabel("ترتيب المنتجات").selectOption("name");
  await expect(page).toHaveURL(/sort=name/);
  const expectedArabicNames = products.filter((product) => product.publication !== "hidden")
    .map((product) => product.name).sort((left, right) => left.localeCompare(right, "ar"));
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual(expectedArabicNames);

  await page.getByRole("link", { name: "إزالة التصنيف: اختبار واجهة المجموعة" }).click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/sort=name/);
  await expect(wall.locator("a.product-card")).toHaveCount(6);
  await page.getByRole("link", { name: "إزالة البحث: اختبار واجهة" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(page).toHaveURL(/sort=name/);
  await page.getByLabel("ابحث عن منتج").fill("كلمة غير موجودة 999");
  await page.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByRole("heading", { name: "لا توجد منتجات مطابقة" })).toBeVisible();
  await expect(page.getByRole("link", { name: "إزالة البحث: كلمة غير موجودة 999" })).toBeVisible();
  await expect(page.getByRole("link", { name: "مسح كل التصفية" })).toBeVisible();
  await page.getByRole("link", { name: "مسح كل التصفية" }).click();
  await expect(page).not.toHaveURL(/q=|category=/);
  for (const product of products.filter((candidate) => candidate.publication !== "hidden")) {
    await expect(wall.locator("a.product-card").filter({ hasText: product.name })).toBeVisible();
  }
  await expect(wall.locator("a.product-card").filter({ hasText: "اختبار واجهة معطف" })).toBeVisible();
  await expect(wall.locator("a.product-card").filter({ hasText: "اختبار واجهة مخفي" })).toHaveCount(0);
  await expect(page.getByLabel("ترتيب المنتجات")).toBeEnabled();
  await page.getByLabel("ترتيب المنتجات").selectOption("default");
  await expect(page).toHaveURL(STORE + "/");
  await expect(page.getByRole("heading", { name: "اختيارات هادئة. حضور واضح." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "اكتشف تصنيفات المتجر" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "كل المنتجات", exact: true })).toBeVisible();
});

async function signInManager(page: Page) {
  await page.goto(`${API}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
}

async function createCategory(page: Page, nameAr: string) {
  const response = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr });
  expect(response.status).toBe(201);
  return response;
}

async function createProduct(
  page: Page, categoryId: string, sizeId: string, colorId: string,
  product: { code: string; name: string; price: number; publication: string; imageRefs: readonly string[] },
) {
  return staffApi(page, "POST", "/api/internal/catalog/products", {
    code: product.code, nameAr: product.name, descriptionAr: "اختبار التصفح",
    categoryId, defaultSellingPricePiasters: product.price, publication: product.publication,
    imageRefs: [...product.imageRefs], sizeGuideAr: null,
    variants: [{ sizeId, colorId, sellingPricePiastersOverride: null }],
  });
}

async function staffApi(page: Page, method: "POST", url: string, payload: unknown) {
  const response = await page.request.fetch(`${API}${url}`, {
    method, headers: { origin: API, "content-type": "application/json" }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
