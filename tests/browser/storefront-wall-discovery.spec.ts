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
  const browseUrl = `${STORE}/?category=${category.body.id}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(browseUrl);
  const wall = page.getByRole("region", { name: "Products" });
  const cards = wall.locator("a.product-card");
  await expect(cards).toHaveCount(5);
  await expect(page.getByText("اختبار واجهة مخفي", { exact: true })).toHaveCount(0);
  await expect(page.getByText("اختبار واجهة معطف", { exact: true })).toHaveCount(0);
  await expect(cards.filter({ hasText: "اختبار واجهة ألف" })).toContainText("From");
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).toContainText(/[٠۰0]/);
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).not.toContainText("Price on selection");
  await expect(cards.filter({ hasText: "اختبار واجهة جيم" }).locator("p[data-availability='coming_soon']")).toHaveText("Coming Soon");
  await expect(cards.filter({ hasText: "اختبار واجهة دال" }).locator("p[data-availability='in_stock']")).toHaveText("In Stock");
  await expect(cards.filter({ hasText: "اختبار واجهة ألف" }).locator("p[data-availability='out_of_stock']")).toHaveText("Out of Stock");
  await expect(cards.filter({ hasText: "اختبار واجهة باء" })).toContainText("Image unavailable");
  const brokenCard = cards.filter({ hasText: "اختبار واجهة دال" });
  await brokenCard.scrollIntoViewIfNeeded();
  await expect(brokenCard).toContainText("Image unavailable");
  await expect(brokenCard.locator("[data-product-media]")).toBeVisible();
  await expect(brokenCard).toHaveAttribute("href", `/products/${created[3].id}`);
  await cards.first().focus();
  await expect(cards.first()).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("wall-1440.png"), fullPage: true });

  for (const [width, columns] of [[1440, 4], [768, 2], [390, 2], [320, 1]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => cards.first().locator("..").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
    const metrics = await cards.evaluateAll((elements) => elements.map((card) => {
      const media = card.querySelector("[data-product-media]");
      const price = card.querySelector("p:not([data-availability])");
      const status = card.querySelector("p[data-availability]");
      const title = card.querySelector("h3");
      if (!media || !price || !status || !title || !price.parentElement) throw new Error("Product card is missing media, price, status, or title.");
      const mediaBox = media.getBoundingClientRect();
      const priceBox = price.getBoundingClientRect();
      const statusBox = status.getBoundingClientRect();
      const meta = getComputedStyle(price.parentElement);
      const match = getComputedStyle(status).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return {
        width: mediaBox.width,
        height: mediaBox.height,
        top: mediaBox.top,
        aspect: getComputedStyle(media).aspectRatio,
        priceCenter: priceBox.top + priceBox.height / 2,
        statusCenter: statusBox.top + statusBox.height / 2,
        metaDisplay: meta.display,
        metaDirection: meta.flexDirection,
        availability: status.getAttribute("data-availability"),
        red: match ? Number(match[1]) : 0,
        green: match ? Number(match[2]) : 0,
        blue: match ? Number(match[3]) : 0,
        name: title.textContent,
        titleAttr: title.getAttribute("title"),
        titleAlign: getComputedStyle(title).textAlign,
        mediaRadius: getComputedStyle(media).borderRadius,
      };
    }));
    expect(metrics).toHaveLength(5);
    expect(metrics.some((item) => item.availability === "in_stock")).toBe(true);
    expect(metrics.some((item) => item.availability === "out_of_stock")).toBe(true);
    const rowKeys: number[] = [];
    const rows = new Map<number, typeof metrics>();
    for (const item of metrics) {
      const key = rowKeys.find((candidate) => Math.abs(candidate - item.top) <= 2) ?? item.top;
      if (!rowKeys.includes(key)) rowKeys.push(key);
      rows.set(key, [...(rows.get(key) ?? []), item]);
    }
    expect(rows.size).toBe(Math.ceil(metrics.length / columns));
    for (const row of rows.values()) {
      const widths = row.map((item) => item.width);
      const heights = row.map((item) => item.height);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    }
    for (const item of metrics) {
      expect(item.aspect).toBe("4 / 5");
      expect(Math.abs(item.height * 4 - item.width * 5)).toBeLessThanOrEqual(2);
      expect(item.titleAlign).toBe("center");
      expect(item.mediaRadius).toBe("12px");
      expect(item.metaDisplay).toBe("flex");
      expect(item.metaDirection).toBe("row");
      expect(Math.abs(item.priceCenter - item.statusCenter)).toBeLessThanOrEqual(1);
      expect(item.titleAttr).toBe(item.name);
      if (item.availability === "in_stock") {
        expect(item.green).toBeGreaterThan(item.red + 20);
        expect(item.green).toBeGreaterThan(item.blue);
      }
      if (item.availability === "out_of_stock") {
        expect(item.red).toBeGreaterThan(item.green + 20);
        expect(item.red).toBeGreaterThan(item.blue);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("wall-390.png"), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.getByLabel("Search", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^\d+ products?$/ })).toHaveCount(0);
  await expect(page.getByLabel("Sort").locator("option")).toHaveText([
    "Default order", "Price: low to high", "Price: high to low",
  ]);
  await expect(page.getByRole("link", { name: "Remove category: اختبار واجهة المجموعة" })).toBeVisible();
  await page.getByLabel("Sort").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect(page).toHaveURL(/category=/);
  await expect(page).not.toHaveURL(/q=/);
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual([
    "اختبار واجهة باء", "اختبار واجهة دال", "اختبار واجهة هاء", "اختبار واجهة ألف", "اختبار واجهة جيم",
  ]);
  await page.screenshot({ path: testInfo.outputPath("filtered-price-asc-390.png"), fullPage: true });
  await page.getByLabel("Sort").selectOption("price-desc");
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
  await expect.poll(() => wall.locator("a.product-card h3").allTextContents()).toEqual([
    "اختبار واجهة جيم", "اختبار واجهة ألف", "اختبار واجهة هاء", "اختبار واجهة دال", "اختبار واجهة باء",
  ]);
  await page.getByLabel("Sort").selectOption("default");
  await expect(page).not.toHaveURL(/sort=/);
  await expect(cards).toHaveCount(5);
  for (const product of products.filter((candidate) => candidate.publication !== "hidden")) {
    await expect(cards.filter({ hasText: product.name })).toBeVisible();
  }
  await expect(cards.filter({ hasText: "اختبار واجهة مخفي" })).toHaveCount(0);

  await page.getByLabel("Sort").selectOption("price-desc");
  await expect(page).toHaveURL(/sort=price-desc/);
  const clearCategory = page.getByRole("link", { name: "Remove category: اختبار واجهة المجموعة", exact: true });
  await expect(clearCategory).toHaveAttribute("href", "/?sort=price-desc#catalog-title");
  await clearCategory.click();
  await expect(page).not.toHaveURL(/category=|q=/);
  await expect(page).toHaveURL(/sort=price-desc/);
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  await expect(page.getByRole("region", { name: "Products", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^\d+ products?$/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Filter by category" })
    .getByRole("link", { name: "اختبار واجهة أخرى", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`category=${otherCategory.body.id}`));
  await expect(page).toHaveURL(/sort=price-desc/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("اختبار واجهة معطف");
  await page.getByRole("link", { name: "Remove category: اختبار واجهة أخرى", exact: true }).click();
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  await expect(page.getByLabel("Sort")).toBeEnabled();
  await page.getByLabel("Sort").selectOption("default");
  await expect(page).toHaveURL(STORE + "/");
  const homeTitle = page.locator("#home-title");
  await expect(homeTitle).toHaveText("Bravos Menswear");
  await expect(homeTitle).toHaveClass(/sr-only/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const hero = page.locator("section").filter({ has: homeTitle });
  await expect(hero.locator("img")).toHaveAttribute("alt", "");
  await expect(hero.locator("a, button, p")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Filter by category" })).toBeVisible();
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
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
