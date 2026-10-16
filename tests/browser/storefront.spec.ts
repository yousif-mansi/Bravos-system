import { expect, test, type Page } from "@playwright/test";

test("English storefront browses, persists an aggregated guest cart and handles changed availability", async ({ page }, testInfo) => {
  await signInManager(page);
  await page.getByRole("link", { name: "روابط المتجر" }).click();
  await expect(page.getByRole("heading", { name: "روابط المتجر" })).toBeVisible();
  await page.getByLabel("رابط واتساب").fill("https://wa.me/201000000018");
  await page.getByLabel("رابط فيسبوك").fill("https://www.facebook.com/bravos-ticket-18");
  await page.getByRole("button", { name: "حفظ الروابط" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ روابط المتجر");

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "قمصان متجر 18" });
  const jackets = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "جاكيتات متجر 18" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "M18" });
  const large = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "L18" });
  const black = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أسود متجر 18" });
  const sand = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "رملي متجر 18" });
  const shirt = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "STORE-E2E-18",
    nameAr: "قميص برافوس اليومي",
    descriptionAr: "قميص قطني بقصة مريحة للاستخدام اليومي.",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 42000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: "M18 — عرض الصدر 50 سم\nL18 — عرض الصدر 54 سم",
    variants: [
      { sizeId: size.body.id, colorId: black.body.id, sellingPricePiastersOverride: null },
      { sizeId: large.body.id, colorId: sand.body.id, sellingPricePiastersOverride: 45000 },
    ],
  });
  const comingSoon = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "SOON-E2E-18", nameAr: "جاكيت الموسم القادم", descriptionAr: "عرض مسبق",
    categoryId: jackets.body.id, defaultSellingPricePiasters: 70000, publication: "coming_soon",
    imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: black.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "HIDDEN-E2E-18", nameAr: "منتج داخلي مخفي 18", descriptionAr: "لا يظهر",
    categoryId: category.body.id, defaultSellingPricePiasters: 10000, publication: "hidden",
    imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: sand.body.id, sellingPricePiastersOverride: null }],
  });
  const stockedVariant = shirt.body.variants.find((variant: { size: { nameAr: string } }) => variant.size.nameAr === "M18");
  const emptyVariant = shirt.body.variants.find((variant: { size: { nameAr: string } }) => variant.size.nameAr === "L18");
  if (!stockedVariant || !emptyVariant) throw new Error("Expected storefront variants.");
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    receiptDate: "2026-09-15",
    lines: [{ variantId: stockedVariant.id, quantity: 2, unitCostPiasters: 21000 }],
  })).status).toBe(201);

  await page.goto("http://127.0.0.1:3001");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const homeTitle = page.locator("#home-title");
  await expect(homeTitle).toHaveText("Bravos Menswear");
  await expect(homeTitle).toHaveClass(/sr-only/);
  const hero = page.locator("section").filter({ has: homeTitle });
  const cover = hero.locator("img");
  await expect(cover).toHaveCount(1);
  await expect(cover).toHaveAttribute("alt", "");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([2048, 774]);
  await expect(hero.locator("a, button, p")).toHaveCount(0);
  expect(await hero.evaluate((section) => {
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
  })).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/201000000018");
  await expect(page.getByRole("link", { name: "Facebook" })).toHaveAttribute("href", "https://www.facebook.com/bravos-ticket-18");
  await expect(page.getByRole("link", { name: /إدارة|الموظفين|المصروفات|المرتجعات/ })).toHaveCount(0);
  await expect(page.getByText("منتج داخلي مخفي 18")).toHaveCount(0);

  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  await expect(page.getByRole("search")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Filter by category" })
    .getByRole("link", { name: category.body.nameAr, exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:3001/?category=${category.body.id}`);
  await expect(page.getByRole("link", { name: /قميص برافوس اليومي/ })).toBeVisible();
  await expect(page.getByText("جاكيت الموسم القادم")).toHaveCount(0);
  await page.getByRole("link", { name: /قميص برافوس اليومي/ }).click();
  await expect(page.getByRole("heading", { name: "قميص برافوس اليومي" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("product.png"), fullPage: true });
  await expect(page.getByText("قميص قطني بقصة مريحة للاستخدام اليومي.")).toBeVisible();
  await expect(page.getByText("M18 — عرض الصدر 50 سم")).toBeVisible();
  const colors = page.getByRole("group", { name: "Color" });
  const sizes = page.getByRole("group", { name: "Size" });
  await expect(sizes.getByRole("radio", { name: /M18/ })).toBeEnabled();
  await expect(sizes.getByRole("radio", { name: /L18/ })).toHaveCount(0);
  const sandColor = colors.getByRole("radio", { name: "رملي متجر 18" });
  await expect(sandColor).toBeDisabled();
  await expect(sandColor.locator("xpath=ancestor::label[1]")).toContainText("Unavailable");

  await page.getByLabel("Quantity").fill("3");
  await expect(page.getByRole("button", { name: "Add to bag" })).toBeDisabled();
  await page.getByLabel("Quantity").fill("1");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("status")).toContainText("Added to your bag.");
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("button", { name: "Available quantity is in your bag" })).toBeDisabled();
  const headerCart = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Bag/ });
  await expect(headerCart).toContainText("2");
  await headerCart.click();
  await expect(page.getByRole("heading", { name: "Bag", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("bag.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "قميص برافوس اليومي" })).toHaveCount(1);
  await expect(page.locator(".cart-line output")).toHaveText("2");
  await page.reload();
  await expect(page.locator(".cart-line output")).toHaveText("2");
  await expect(page.getByRole("button", { name: /Place order request|Pay|Confirm order/ })).toHaveCount(0);

  const sale = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), employeeDiscountPiasters: 0,
    lines: [{ variantId: stockedVariant.id, quantity: 1 }], physicallyCompleted: true,
  });
  expect(sale.status).toBe(201);
  await page.getByRole("button", { name: "Refresh product details" }).click();
  await expect(page.getByText("Only 1 available now.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fit to available" }).click();
  await expect(page.locator(".cart-line output")).toHaveText("1");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3001");
  const categoryFilter = page.getByRole("navigation", { name: "Filter by category" }).getByRole("link", { name: "جاكيتات متجر 18", exact: true });
  await expect(categoryFilter).toBeVisible();
  await categoryFilter.click();
  await expect(page.getByRole("link", { name: /جاكيت الموسم القادم/ })).toContainText("Coming Soon");
  await page.goto(`http://127.0.0.1:3001/products/${comingSoon.body.id}`);
  const previewNote = page.getByRole("paragraph").filter({ hasText: "Coming soon. Not available to order yet." });
  await expect(previewNote).toHaveCount(1);
  await expect(previewNote).toBeVisible();
  await expect(page.locator(".purchase-panel input[type='radio']")).toHaveCount(0);
  const unavailablePairs = page.getByRole("list", { name: "Unavailable size and color pairs" });
  await expect(unavailablePairs).toContainText("M18");
  await expect(unavailablePairs).toContainText("أسود متجر 18");
  await expect(unavailablePairs).toContainText(/EGP\s*700/);
  await expect(unavailablePairs).toContainText("Unavailable");
  await expect(page.getByText("Each size and color keeps its own price. None can be ordered.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to bag" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("cart migrates legacy storage and reconciles a newer cart from another tab", async ({ page, context }) => {
  const storageKey = "bravos-guest-cart-v1";
  const legacyLine = cartLine("legacy-variant", "اختيار قديم");
  await page.addInitScript(({ key, line }) => {
    window.localStorage.setItem(key, JSON.stringify([line]));
  }, { key: storageKey, line: legacyLine });

  await page.goto("http://127.0.0.1:3001/cart");
  await expect(page.getByRole("heading", { name: legacyLine.productNameAr })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw).version : null;
  }, storageKey)).toBe(1);

  const otherTab = await context.newPage();
  await otherTab.goto("http://127.0.0.1:3001/cart");
  const remoteLine = cartLine("remote-variant", "اختيار من تبويب آخر");
  await otherTab.evaluate(({ key, line }) => {
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      revision: `remote-${Date.now()}`,
      items: [line],
    }));
  }, { key: storageKey, line: remoteLine });

  await expect(page.getByRole("heading", { name: remoteLine.productNameAr })).toBeVisible();
  await expect(page.getByRole("heading", { name: legacyLine.productNameAr })).toHaveCount(0);
  await otherTab.close();
});

test("cart preserves corrupt storage and reports unavailable persistence", async ({ page, context }) => {
  const storageKey = "bravos-guest-cart-v1";
  const corruptValue = "{broken-cart";
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value);
  }, { key: storageKey, value: corruptValue });
  await page.goto("http://127.0.0.1:3001/cart");
  await expect(page.locator("p[role='alert']")).toContainText("The original data was left unchanged");
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), storageKey)).toBe(corruptValue);
  await expect(page.getByText("Review your selections, then add delivery details to see the final price.", { exact: true })).toHaveCount(0);

  const blockedPage = await context.newPage();
  await blockedPage.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
  });
  await blockedPage.goto("http://127.0.0.1:3001/cart");
  await expect(blockedPage.locator("p[role='alert']")).toContainText("This browser can't save the bag right now");
  await expect(blockedPage.getByLabel("Bag not saved")).toBeVisible();
  await expect(blockedPage.getByText("Review your selections, then add delivery details to see the final price.", { exact: true })).toHaveCount(0);
  await blockedPage.close();
});

function cartLine(variantId: string, productNameAr: string) {
  return {
    productId: `${variantId}-product`,
    variantId,
    productNameAr,
    sizeNameAr: "M",
    colorNameAr: "أسود",
    unitPricePiasters: 10000,
    imageRef: null,
    quantity: 1,
    knownAvailableQuantity: 1,
    orderable: true,
  };
}

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
}

async function staffApi(page: Page, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
