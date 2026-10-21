import { expect, test, type Locator, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3011";
const STAFF = "http://127.0.0.1:5174";
const STORE = "http://127.0.0.1:3001";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type CatalogProduct = {
  id: string;
  nameAr: string;
  category: { id: string; nameAr: string };
  lowestSellingPricePiasters: number | null;
  availability: string;
  previewImageRef: string | null;
};

test("flagship home keeps its image hero and ticker while category rows include every public state", async ({ page }) => {
  test.setTimeout(240_000);
  const seeded = await seedPhotographedPair(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${STORE}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const fonts = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const normalize = (value: string) => value.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").toLowerCase();
    const families = (value: string) => value.split(",").map((part) => normalize(part)).filter(Boolean);
    return {
      clash: families(root.getPropertyValue("--font-clash-display"))[0] ?? "",
      rose: families(root.getPropertyValue("--font-rose"))[0] ?? "",
      stacks: ["--font-commerce", "--font-editorial", "--font-display", "--font-metadata"].map((name) => families(root.getPropertyValue(name))),
      bodyFamily: families(getComputedStyle(document.body).fontFamily),
      bodyWeight: getComputedStyle(document.body).fontWeight,
    };
  });
  expect(fonts.clash.length).toBeGreaterThan(0);
  expect(fonts.rose.length).toBeGreaterThan(0);
  expect(fonts.clash).not.toBe(fonts.rose);
  for (const stack of fonts.stacks) {
    const clashIndex = stack.indexOf(fonts.clash);
    const roseIndex = stack.indexOf(fonts.rose);
    expect(clashIndex).toBeGreaterThanOrEqual(0);
    expect(roseIndex).toBeGreaterThan(clashIndex);
  }
  expect(fonts.bodyFamily[0]).toBe(fonts.clash);
  expect(fonts.bodyWeight).toBe("400");
  await expectSettledHomeHero(page);
  const hero = page.locator("section").filter({ has: page.locator("#home-title") });
  await expect(hero.locator("img")).toHaveCount(1);
  await expect(hero.locator("img")).toHaveAttribute("alt", "");
  await expect(hero.locator("img")).toHaveAttribute("src", /(?:%2F|\/)brand(?:%2F|\/)cover\.jpg/);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFullBleed(page, width);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const marquee = page.locator("section[data-paused]");
  const pause = marquee.getByRole("button", { name: "Pause ticker" });
  await expect(pause).toBeEnabled();
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  const copies = marquee.locator("p");
  await expect(copies).toHaveCount(2);
  await expect(copies.nth(1)).toHaveAttribute("aria-hidden", "true");
  expect(await copies.nth(0).innerText()).toBe(await copies.nth(1).innerText());
  const tickerText = (await copies.nth(0).textContent() ?? "").replace(/\s+/g, "");
  const tickerPhrase = "Bravos Menswear".replace(/\s+/g, "");
  expect(tickerPhrase).toBe("BravosMenswear");
  expect(tickerText.split(tickerPhrase).join("")).toBe("");
  expect(tickerText.length / tickerPhrase.length).toBeGreaterThan(1);
  expect(Number.isInteger(tickerText.length / tickerPhrase.length)).toBe(true);
  expect(tickerText).not.toMatch(/Wardrobe|Fayoum|Cloth|Layer|Cut/);
  await page.locator(".store-header").hover();
  await blurActive(page);
  await expect.poll(() => trackPlayState(page)).toBe("running");
  await marquee.hover();
  await expect.poll(() => trackPlayState(page)).toBe("paused");
  await page.locator(".store-header").hover();
  await expect.poll(() => trackPlayState(page)).toBe("running");
  await pause.focus();
  await expect(pause).toBeFocused();
  await expect.poll(() => trackPlayState(page)).toBe("paused");
  await pause.click();
  const resume = marquee.getByRole("button", { name: "Resume ticker" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");
  await expect(marquee).toHaveAttribute("data-paused", "true");
  await page.locator(".store-header").hover();
  await blurActive(page);
  await expect.poll(() => trackPlayState(page)).toBe("paused");
  await resume.click();
  await expect(pause).toHaveAttribute("aria-pressed", "false");
  await expect(marquee).toHaveAttribute("data-paused", "false");
  await page.locator(".store-header").hover();
  await blurActive(page);
  await expect.poll(() => trackPlayState(page)).toBe("running");

  await expect(page.getByRole("heading", { name: "Selected pieces", exact: true })).toHaveCount(0);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.locator('input[name="q"]')).toHaveCount(0);
  await expect(page.locator("#catalog-title")).toHaveText("Shop by category");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Categories" })).toHaveAttribute("href", "/#catalog-title");
  const sort = page.getByLabel("Sort", { exact: true });
  await expect(sort.locator("option")).toHaveText(["Default order", "Price: low to high", "Price: high to low"]);
  await expect(page.locator(".browse-panel .eyebrow")).toHaveCount(0);
  await expect(page.locator(".browse-panel")).not.toContainText(/\b\d+ products?\b/i);
  for (const text of ["The rotation", "A few pieces to start your next rotation", "Find your next piece", "Start with a category"]) await expect(page.locator(".browse-panel")).not.toContainText(text);
  await expect(page.locator(".browse-panel")).not.toContainText(/trending|best seller|bestseller|staff pick|popular now/i);
  const categories = page.getByRole("navigation", { name: "Filter by category" });
  const decorativeCategoryNumbers = await categories.locator("span").evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()).filter((text) => /^\d{2}$/.test(text)));
  expect(decorativeCategoryNumbers).toEqual([]);
  const ordering = page.getByRole("region", { name: "How an order works" });
  await expect(ordering.getByRole("heading", { name: "How an order works" })).toBeVisible();
  await expect(ordering.getByRole("heading", { name: "WhatsApp confirmation" })).toBeVisible();
  await expect(ordering.getByRole("heading", { name: "Pay on delivery" })).toBeVisible();
  for (const text of ["Your order starts as a request.", "Items are not reserved until confirmation.", "We confirm availability with you on WhatsApp.", "See the delivery fee and total before you submit.", "Pay cash on delivery."]) {
    await expect(ordering).toContainText(text);
  }
  for (const text of ["Choose a piece", "01", "02", "03"]) await expect(ordering).not.toContainText(text);

  const catalogResponse = await page.request.get(API + "/api/public/storefront/catalog");
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = await catalogResponse.json() as { products: CatalogProduct[] };
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
  expect(byId.get(seeded.longId)?.availability).toBe("in_stock");
  expect(byId.get(seeded.longId)?.previewImageRef).toBeTruthy();
  expect(byId.get(seeded.shortId)?.availability).toBe("in_stock");
  expect(byId.get(seeded.shortId)?.previewImageRef).toBeTruthy();
  expect(byId.get(seeded.plainId)?.previewImageRef ?? null).toBeFalsy();
  expect(byId.get(seeded.soonId)?.availability).toBe("coming_soon");
  expect(byId.get(seeded.unstockedId)?.availability).toBe("out_of_stock");
  expect(byId.has(seeded.hiddenId)).toBe(false);

  // Inspect the actual document response, including inline flight data: lower product
  // summaries must not be hidden in client props or an unmounted catalog payload.
  const documentResponse = await page.request.get(STORE + "/");
  expect(documentResponse.ok()).toBeTruthy();
  const html = await documentResponse.text();
  const initial = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return [...doc.querySelectorAll("a.product-card")].map((card) => card.getAttribute("href")?.split("/").at(-1));
  }, html);
  expect(initial.length).toBeGreaterThan(0);
  expect(initial.length).toBeLessThanOrEqual(4);
  expect(new Set(initial).size).toBe(initial.length);
  for (const product of catalog.products) {
    if (!initial.includes(product.id)) expect(html, "unmounted product summary " + product.id).not.toContain(product.id);
  }
  expect(html).not.toContain(seeded.hiddenName);

  const row = categoryRow(page, seeded.categoryName);
  await expect(categoryRow(page, seeded.emptyCategoryName)).toHaveCount(0);
  await revealAllCards(row, 5);
  const cards = row.locator("a.product-card");
  await expect(cards).toHaveCount(5);
  for (const name of [seeded.longName, seeded.shortName, seeded.plainName, seeded.soonName, seeded.unstockedName]) {
    await expect(cards.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(cards.filter({ hasText: seeded.hiddenName })).toHaveCount(0);
  await expect(cards.filter({ hasText: seeded.plainName }).locator("img")).toHaveCount(0);
  await expect(cards.filter({ hasText: seeded.plainName })).toContainText("Image unavailable");
  await expect(cards.filter({ hasText: seeded.soonName })).toContainText("Coming Soon");
  await expect(cards.filter({ hasText: seeded.unstockedName })).toContainText("Out of Stock");
  await expect(row).not.toContainText("Size, color, price, and availability are on the product page.");
  const rowIds = await cards.evaluateAll((links) => links.map((link) => link.getAttribute("href")?.split("/").at(-1)));
  expect(new Set(rowIds).size).toBe(5);
  expect(rowIds.every((id) => byId.get(id ?? "")?.category.id === seeded.categoryId)).toBe(true);

  const longCard = cards.filter({ hasText: seeded.longName });
  const shortCard = cards.filter({ hasText: seeded.shortName });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const titles = await Promise.all([longCard, shortCard].map(async (card) => card.locator("h3").evaluate((title) => {
      const style = getComputedStyle(title);
      return {
        text: title.textContent, title: title.getAttribute("title"), dir: title.getAttribute("dir"),
        clamp: style.getPropertyValue("-webkit-line-clamp") || style.lineClamp,
        height: title.getBoundingClientRect().height, maxHeight: Number.parseFloat(style.maxHeight), align: style.textAlign,
      };
    })));
    for (const [index, name] of [seeded.longName, seeded.shortName].entries()) {
      expect(titles[index]).toMatchObject({ text: name, title: name, dir: "auto", clamp: "2", align: "center" });
      expect(Number.isFinite(titles[index]!.maxHeight)).toBe(true);
      expect(Math.abs(titles[index]!.height - titles[index]!.maxHeight)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(titles[0]!.height - titles[1]!.height)).toBeLessThanOrEqual(1);
    const media = await longCard.locator("[data-product-media]").evaluate((frame) => {
      const image = frame.querySelector("img");
      if (!image) return null;
      const box = frame.getBoundingClientRect();
      const style = getComputedStyle(image);
      return {
        aspect: box.width / box.height, radius: getComputedStyle(frame).borderRadius,
        fit: style.objectFit, x: image.offsetLeft, y: image.offsetTop,
        width: image.offsetWidth - frame.clientWidth, height: image.offsetHeight - frame.clientHeight,
        spacing: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft, style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      };
    });
    expect(media).not.toBeNull();
    expect(media!.aspect).toBeCloseTo(4 / 5, 2);
    expect(media!.radius).toBe("12px");
    expect(media!.fit).toBe("cover");
    expect(media!.spacing).toEqual(Array(8).fill("0px"));
    for (const delta of [media!.x, media!.y, media!.width, media!.height]) expect(Math.abs(delta)).toBeLessThanOrEqual(1);
  }
  await expectRenderedGlyphs(page, shortCard.locator("h3"), fonts.rose, "rose");
  await expectRenderedGlyphs(page, longCard.locator("h3"), fonts.clash, "clash");

  await page.goto(STORE + "/?q=" + encodeURIComponent(seeded.suffix));
  await expectSettledHomeHero(page);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(categoryRow(page, seeded.categoryName)).toHaveCount(1);
  await page.goto(STORE + "/?category=" + seeded.categoryId);
  await expect(page.locator("#home-title")).toHaveCount(0);
  const wall = page.getByRole("region", { name: "Products" });
  await expect(wall.locator("a.product-card")).toHaveCount(5);
  expect(await wall.locator("a.product-card").evaluateAll((links) => links.map((link) => link.getAttribute("href")?.split("/").at(-1)))).toEqual(expect.arrayContaining([seeded.longId, seeded.shortId, seeded.plainId, seeded.soonId, seeded.unstockedId]));
  await expect(wall.locator("a.product-card").filter({ hasText: seeded.hiddenName })).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${STORE}/`);
  await expectSettledHomeHero(page);
  const reducedPause = page.locator("section[data-paused]").getByRole("button", { name: "Motion paused" });
  await expect(reducedPause).toBeDisabled();
  await expect(reducedPause).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("section[data-paused]")).toHaveAttribute("data-paused", "true");
  await expect(page.locator("section[data-paused] p[aria-hidden='true']")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => page.locator("section[data-paused]").evaluate((section) => {
    const track = section.querySelector("p")?.parentElement;
    return track ? getComputedStyle(track).animationName : "";
  })).toBe("none");
  await page.setViewportSize({ width: 320, height: 900 });
  await expectFullBleed(page, 320);
});

test("category rows keep native keyboard focus clear after horizontal scrolling", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const seeded = await seedCategoryPieces(page, 6);
  await page.goto(STORE + "/");
  const row = categoryRow(page, seeded.categoryName);
  await revealAllCards(row, seeded.ids.length);
  const rail = row.locator("ul[role='list']");
  const cards = rail.locator("a.product-card");
  await expect(cards).toHaveCount(seeded.ids.length);
  const catalogResponse = await page.request.get(API + "/api/public/storefront/catalog?categoryId=" + seeded.categoryId);
  expect(catalogResponse.ok()).toBeTruthy();
  const catalog = await catalogResponse.json() as { products: CatalogProduct[] };
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
  for (const id of seeded.ids) {
    expect(byId.get(id)?.availability).toBe("in_stock");
    expect(byId.get(id)?.previewImageRef).toBeTruthy();
  }
  const hrefs = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  expect(hrefs.every((href) => typeof href === "string" && href.length > 0)).toBe(true);
  expect(new Set(hrefs).size).toBe(seeded.ids.length);

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await row.scrollIntoViewIfNeeded();
    for (const position of ["start", "mid", "end"] as const) {
      await focusCategoryEntry(page, rail, position);
      const documentY = await page.evaluate(() => window.scrollY);
      for (let index = 0; index < hrefs.length; index += 1) {
        await page.keyboard.press("Tab");
        await expectRailCardFullyVisible(page, rail, hrefs[index]!, documentY);
        if (width === 390 && position === "start" && index === 0) await page.screenshot({ path: testInfo.outputPath("rail-focus-390-leading.png") });
        if (width === 390 && position === "end" && index === hrefs.length - 1) await page.screenshot({ path: testInfo.outputPath("rail-focus-390-trailing.png") });
      }
      for (let index = hrefs.length - 2; index >= 0; index -= 1) {
        await page.keyboard.press("Shift+Tab");
        await expectRailCardFullyVisible(page, rail, hrefs[index]!, documentY);
      }
    }
    await focusCategoryEntry(page, rail, "start");
    await page.keyboard.press("Tab");
    await expectRailCardFullyVisible(page, rail, hrefs[0]!);
    const overflow = await rail.evaluate((element) => element.scrollWidth - element.clientWidth);
    if (overflow > 0) {
      const before = await rail.evaluate((element) => element.scrollLeft);
      const documentY = await page.evaluate(() => window.scrollY);
      const box = await rail.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(40, box!.height / 2));
      await page.mouse.wheel(Math.max(80, overflow / 2), 0);
      const minimumWheelPosition = before + Math.min(40, overflow / 4);
      // Let native wheel scrolling settle while the same card retains focus.
      // An immediate Tab can hide a focus correction that pulls the rail back.
      await expect.poll(() => rail.evaluate(async (element, minimumLeft) => {
        const positions: number[] = [];
        for (let frame = 0; frame < 12; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          positions.push(element.scrollLeft);
        }
        return positions.every((position) => position > minimumLeft)
          && Math.max(...positions) - Math.min(...positions) < 0.5;
      }, minimumWheelPosition)).toBe(true);
      await expect(cards.nth(0)).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(documentY);
      await page.keyboard.press("Tab");
      await expectRailCardFullyVisible(page, rail, hrefs[1]!, documentY);
    }
  }

  const touchContext = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 900 } });
  try {
    const touchPage = await touchContext.newPage();
    await touchPage.goto(STORE + "/");
    const touchRow = categoryRow(touchPage, seeded.categoryName);
    await revealAllCards(touchRow, seeded.ids.length);
    const touchRail = touchRow.locator("ul[role='list']");
    const session = await touchContext.newCDPSession(touchPage);
    try {
      for (const width of [320, 390]) {
        await touchPage.setViewportSize({ width, height: 900 });
        await touchRow.scrollIntoViewIfNeeded();
        await focusCategoryEntry(touchPage, touchRail, "start");
        const box = await touchRail.boundingBox();
        expect(box).not.toBeNull();
        const documentY = await touchPage.evaluate(() => window.scrollY);
        const y = box!.y + Math.min(80, box!.height / 2);
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box!.x + box!.width - 25, y }] });
        for (const fraction of [0.75, 0.5, 0.25]) {
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box!.x + box!.width * fraction, y }] });
        }
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(() => touchRail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await expect.poll(() => touchPage.evaluate(() => window.scrollY)).toBe(documentY);

        // Keep the actual swipe position and residual native scrolling. Enter
        // the cards with Tab; resetting the rail here would mask the regression.
        await touchPage.keyboard.press("Tab");
        await expectRailCardFullyVisible(touchPage, touchRail, hrefs[0]!, documentY);
        await expect.poll(async () => {
          const before = await touchRail.evaluate((element) => element.scrollLeft);
          await touchPage.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          return before === await touchRail.evaluate((element) => element.scrollLeft);
        }).toBe(true);
        await expectRailCardFullyVisible(touchPage, touchRail, hrefs[0]!, documentY);
        await touchPage.screenshot({ path: testInfo.outputPath("rail-touch-keyboard-" + width + "-leading.png") });
        for (let index = 1; index < hrefs.length; index += 1) {
          await touchPage.keyboard.press("Tab");
          await expectRailCardFullyVisible(touchPage, touchRail, hrefs[index]!, documentY);
        }
      }
    } finally { await session.detach(); }
  } finally { await touchContext.close(); }
});

test("category rows progressively reach every product, retry failed reads, and preserve price order", async ({ page }) => {
  test.setTimeout(240_000);
  const seeded = await seedCategoryPieces(page, 9);
  const response = await page.request.get(API + "/api/public/storefront/catalog?categoryId=" + seeded.categoryId);
  expect(response.ok()).toBeTruthy();
  const catalog = await response.json() as { products: CatalogProduct[] };
  expect(catalog.products.map((product) => product.id).sort()).toEqual([...seeded.ids].sort());
  await page.addInitScript(() => { Object.defineProperty(window, "IntersectionObserver", { value: undefined, configurable: true }); });

  let requests = 0;
  let failFirst!: () => void;
  const failedRead = new Promise<void>((resolve) => { failFirst = resolve; });
  await page.route("**/api/public/storefront/catalog?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("categoryId") !== seeded.categoryId) return route.continue();
    requests += 1;
    if (requests === 1) {
      await failedRead;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily unavailable" }) });
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(STORE + "/");
  const row = categoryRow(page, seeded.categoryName);
  const cards = row.locator("a.product-card");
  await row.scrollIntoViewIfNeeded();
  expect(await cards.count()).toBeLessThanOrEqual(4);
  await beginRowRead(row, () => requests > 0);
  await expect.poll(() => requests).toBe(1);
  await expect(row.getByRole("status")).toContainText(/Loading/i);
  expect(await cards.count()).toBeLessThanOrEqual(4);
  // Native explicit fallback controls can be used repeatedly during this slow
  // read. They must share the pending request rather than start parallel reads.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await row.getByRole("button", { name: "Load products", exact: true }).click();
    await row.getByRole("button", { name: /^Next/ }).click();
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(requests).toBe(1);
  failFirst();
  await expect(row.getByRole("alert")).toBeVisible();
  const retry = row.getByRole("button", { name: /Retry/i });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => requests).toBe(2);
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  const afterRetry = await cards.count();
  expect(afterRetry).toBeLessThan(9);
  await expect(row.getByRole("button", { name: /Add to bag|Quick add/i })).toHaveCount(0);
  await expect(row.locator("input, select")).toHaveCount(0);
  let mounted = afterRetry;
  const next = row.getByRole("button", { name: /^Next/ });
  const previous = row.getByRole("button", { name: /^Previous/ });
  for (let step = 0; step < 12 && mounted < 9; step += 1) {
    await expect(next).toBeEnabled();
    await next.click();
    await expect(next).toBeFocused();
    const now = await cards.count();
    expect(now).toBeGreaterThanOrEqual(mounted);
    expect(now - mounted).toBeLessThanOrEqual(4);
    mounted = now;
  }
  await expect(cards).toHaveCount(9);
  expect(requests).toBe(2);
  const links = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")?.split("/").at(-1)));
  expect(links).toEqual(catalog.products.map((product) => product.id));
  expect(new Set(links).size).toBe(9);
  for (let step = 0; step < 12 && await next.isEnabled(); step += 1) await next.click();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  const rail = row.locator("ul[role='list']");
  const end = await rail.evaluate((element) => element.scrollLeft);
  await previous.click();
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeLessThan(end);
  for (const control of [next, previous]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(control).toHaveAttribute("aria-controls", await rail.getAttribute("id") ?? "missing rail id");
  }

  for (const order of ["price-asc", "price-desc"] as const) {
    await page.getByLabel("Sort", { exact: true }).selectOption(order);
    await expect(page).toHaveURL(new RegExp("[?&]sort=" + order));
    const sortedRow = categoryRow(page, seeded.categoryName);
    // The URL can update before React commits the replacement row. The old
    // row has nine cards; wait for the bounded replacement before loading it.
    await expect.poll(() => sortedRow.locator("a.product-card").count()).toBeLessThanOrEqual(4);
    if (order === "price-asc") {
      // Reuse this category at desktop width: four cards fit without overflow,
      // so its first Next must append one batch and move into that new content.
      await revealAllCards(sortedRow, 4);
      const sortedRail = sortedRow.locator("ul[role='list']");
      await expect.poll(() => sortedRail.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      expect(await sortedRail.evaluate((element) => element.scrollLeft)).toBe(0);
      const sortedNext = sortedRow.getByRole("button", { name: /^Next/ });
      await sortedNext.click();
      await expect(sortedRow.locator("a.product-card")).toHaveCount(8);
      await expect.poll(() => sortedRail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect(sortedNext).toBeFocused();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(sortedRow.locator("a.product-card")).toHaveCount(8);
    }
    await revealAllCards(sortedRow, 9);
    const expected = [...catalog.products].sort((left, right) => {
      if (left.lowestSellingPricePiasters === null) return right.lowestSellingPricePiasters === null ? 0 : 1;
      if (right.lowestSellingPricePiasters === null) return -1;
      return order === "price-asc" ? left.lowestSellingPricePiasters - right.lowestSellingPricePiasters : right.lowestSellingPricePiasters - left.lowestSellingPricePiasters;
    }).map((product) => product.id);
    await expect.poll(() => sortedRow.locator("a.product-card").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")?.split("/").at(-1)))).toEqual(expected);
    await expect(page.getByRole("search")).toHaveCount(0);
    await expect(page.locator(".browse-panel")).not.toContainText(/\b\d+ products?\b/i);
    const focused = await sortedRow.getByRole("heading").getByRole("link").getAttribute("href");
    expect(focused).toContain("category=" + seeded.categoryId);
    expect(focused).toContain("sort=" + order);
  }
});

test("bag preview reads the real cart and returns to the bag without quoting", async ({ page }) => {
  test.setTimeout(240_000);
  const checkoutCalls: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/public\/checkout\/(?:quote|orders)(?:\?|$)/.test(request.url())) checkoutCalls.push(`${request.method()} ${request.url()}`);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const product = await seedBagProduct(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${STORE}/products/${product.id}`);
  const bag = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Bag/ });
  await expect(bag).toHaveAttribute("href", "/cart");
  const preview = page.getByRole("button", { name: "Preview bag" });
  await expect(preview).toBeEnabled();
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Your bag" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close bag preview" })).toBeFocused();
  await expect(dialog.getByText("Your bag is empty")).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  })).toEqual({ name: "none", duration: "0s" });
  await dialog.getByRole("button", { name: "Close bag preview" }).click();
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();

  const panel = page.locator(".purchase-panel");
  const quantity = panel.getByLabel("Quantity");
  await expect(quantity).toBeVisible();
  await expect(quantity).toBeEnabled();
  const add = panel.getByRole("button", { name: "Add to bag", exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(panel.getByRole("status")).toContainText("Added to your bag.");
  const scrollY = await page.evaluate(() => {
    const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: Math.min(640, limit), left: 0, behavior: "instant" });
    return window.scrollY;
  });
  expect(scrollY).toBeGreaterThan(120);
  await preview.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
  await expect(dialog.getByRole("link", { name: product.name })).toBeVisible();
  await expect(dialog).toContainText(product.sizeName);
  await expect(dialog).toContainText(product.colorName);
  await expect(dialog.locator("p").filter({ hasText: "Qty" })).toHaveText("Qty 1");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("bravos-guest-cart-v1") ?? "null")) as { items: Array<{ quantity: number; unitPricePiasters: number; productNameAr: string }> };
  expect(stored.items).toMatchObject([{ productNameAr: product.name, quantity: 1, unitPricePiasters: 32550 }]);
  const estimated = await page.evaluate((piasters) => new Intl.NumberFormat("en-EG", {
    style: "currency", currency: "EGP", currencyDisplay: "code", minimumFractionDigits: piasters % 100 === 0 ? 0 : 2,
  }).format(piasters / 100), stored.items[0].unitPricePiasters * stored.items[0].quantity);
  await expect(dialog.locator("dd")).toHaveText(estimated);
  await expect(dialog.locator("input, textarea, select")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Place order|Review price|Pay|Confirm order/ })).toHaveCount(0);
  const review = dialog.getByRole("link", { name: "Review bag & checkout" });
  await expect(review).toHaveAttribute("href", "/cart");
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press(step === 5 ? "Shift+Tab" : "Tab");
    expect(await focusInsideOpenDialog(page)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  await preview.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThan(40);
  await page.mouse.click(12, 180);
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

  await preview.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await review.click();
  await expect(page).toHaveURL(`${STORE}/cart`);
  await expect(page.getByRole("heading", { name: "Bag", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: product.name, exact: true })).toBeVisible();
  await expect(bag).toHaveAttribute("href", "/cart");
  expect(checkoutCalls).toEqual([]);
});

async function expectSettledHomeHero(page: Page) {
  const title = page.locator("#home-title");
  await expect.poll(() => page.evaluate(() => {
    return [...document.querySelectorAll("#home-title")].map((node) => {
      const element = node as HTMLElement;
      let displayNone = false;
      let visibilityHidden = false;
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none") displayNone = true;
        if (style.visibility === "hidden") visibilityHidden = true;
      }
      return {
        connected: element.isConnected,
        text: element.textContent,
        srOnly: element.classList.contains("sr-only"),
        hiddenAncestor: Boolean(element.closest("[hidden]")),
        inertAncestor: Boolean(element.closest("[inert]")),
        ariaHiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
        displayNone,
        visibilityHidden,
        outerHTML: element.outerHTML,
      };
    });
  })).toEqual([{
    connected: true,
    text: "Bravos Menswear",
    srOnly: true,
    hiddenAncestor: false,
    inertAncestor: false,
    ariaHiddenAncestor: false,
    displayNone: false,
    visibilityHidden: false,
    outerHTML: expect.stringContaining('id="home-title"'),
  }]);
  await expect(title).toHaveCount(1);
  await expect(title).toHaveText("Bravos Menswear");
  await expect(title).toHaveClass(/sr-only/);
  await expect(page.getByRole("heading", { name: "Bravos Menswear", level: 1 })).toHaveCount(1);
}

async function expectFullBleed(page: Page, width: number) {
  await expect(page.locator("#home-title")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const titles = document.querySelectorAll("#home-title");
    if (titles.length !== 1) return Number.POSITIVE_INFINITY;
    const hero = titles[0]?.closest("section");
    const image = hero?.querySelector("img");
    if (!hero || !image) return Number.POSITIVE_INFINITY;
    return Math.abs(image.getBoundingClientRect().width - hero.getBoundingClientRect().width);
  })).toBeLessThanOrEqual(1);
  const shell = await page.evaluate(() => {
    const header = document.querySelector(".store-header");
    const titles = document.querySelectorAll("#home-title");
    const hero = titles.length === 1 ? titles[0]?.closest("section") : null;
    const image = hero?.querySelector("img");
    if (!header || !hero || !image) return null;
    const headerBox = header.getBoundingClientRect();
    const heroBox = hero.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    const visibleText: string[] = [];
    const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const value = node.textContent?.trim() ?? "";
      if (value && parent && !parent.closest(".sr-only")) visibleText.push(value);
      node = walker.nextNode();
    }
    return {
      headerX: headerBox.x,
      headerWidth: headerBox.width,
      headerHeight: headerBox.height,
      heroX: heroBox.x,
      heroWidth: heroBox.width,
      imageWidth: imageBox.width,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      controls: hero.querySelectorAll("a, button, p").length,
      images: hero.querySelectorAll("img").length,
      imageAlt: image.getAttribute("alt"),
      visibleText,
    };
  });
  expect(shell).not.toBeNull();
  expect(shell!.scrollWidth).toBeLessThanOrEqual(shell!.innerWidth);
  expect(Math.abs(shell!.headerWidth - shell!.clientWidth)).toBeLessThanOrEqual(1);
  expect(shell!.headerX).toBeLessThanOrEqual(1);
  expect(shell!.headerHeight).toBe(width <= 700 ? 64 : 72);
  expect(Math.abs(shell!.heroWidth - shell!.clientWidth)).toBeLessThanOrEqual(1);
  expect(shell!.heroX).toBeLessThanOrEqual(1);
  expect(Math.abs(shell!.imageWidth - shell!.heroWidth)).toBeLessThanOrEqual(1);
  expect(shell!.images).toBe(1);
  expect(shell!.imageAlt).toBe("");
  expect(shell!.controls).toBe(0);
  expect(shell!.visibleText).toEqual([]);
}

async function trackPlayState(page: Page) {
  return page.locator("section[data-paused]").evaluate((section) => {
    const track = section.querySelector("p")?.parentElement;
    return track ? getComputedStyle(track).animationPlayState : "";
  });
}

async function blurActive(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function focusInsideOpenDialog(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
  });
}

async function expectRenderedGlyphs(page: Page, title: Locator, familyName: string, fontToken: "rose" | "clash") {
  await expect(title).toHaveCount(1);
  await title.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const marker = `data-rose-glyph-${crypto.randomUUID()}`;
  await title.evaluate((element, name) => {
    element.setAttribute(name, "");
  }, marker);
  try {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("DOM.enable");
      await session.send("CSS.enable");
      const documentNode = await session.send("DOM.getDocument") as { root: { nodeId: number } };
      const located = await session.send("DOM.querySelector", {
        nodeId: documentNode.root.nodeId,
        selector: `[${marker}]`,
      }) as { nodeId: number };
      expect(located.nodeId).toBeGreaterThan(0);
      const described = await session.send("DOM.describeNode", { nodeId: located.nodeId }) as { node: { nodeName: string } };
      expect(described.node.nodeName).toBe("H3");
      const platform = await session.send("CSS.getPlatformFontsForNode", { nodeId: located.nodeId }) as {
        fonts: Array<{ familyName: string; postScriptName: string; glyphCount: number }>;
      };
      const normalize = (value: string) => value.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").toLowerCase();
      const expectedFamily = normalize(familyName);
      const used = platform.fonts.filter((font) => font.glyphCount > 0);
      expect(used.some((font) => {
        const family = normalize(font.familyName);
        const postScript = normalize(font.postScriptName);
        return family === expectedFamily || family.includes(fontToken) || postScript.includes(fontToken);
      })).toBe(true);
    } finally {
      await session.detach();
    }
  } finally {
    await title.evaluate((element, name) => {
      element.removeAttribute(name);
    }, marker);
  }
}

async function seedCategoryPieces(page: Page, count: number) {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const categoryName = "Category rail " + suffix;
  const category = await createCategory(page, categoryName);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس سكة " + suffix });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون سكة " + suffix });
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);
  const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
    fileName: "rail.png", contentType: "image/png", base64: PNG_BASE64,
  });
  expect(uploaded.status).toBe(201);
  const ids: string[] = [];
  const variantIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const product = await createProduct(page, category.body.id, size.body.id, color.body.id, {
      code: "RAIL-" + (index + 1) + "-" + suffix, name: "Rail piece " + (index + 1) + " " + suffix,
      // Deliberately disagree with intake order, including a genuine free price.
      price: index === 0 ? 0 : (count - index) * 1000,
      publication: "available", imageRefs: [uploaded.body.ref as string],
    });
    ids.push(product.body.id as string);
    variantIds.push(product.body.variants[0].id as string);
  }
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;
  for (const variantId of variantIds) {
    expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), branchId, receiptDate: "2026-09-25",
      lines: [{ variantId, quantity: 2, unitCostPiasters: 4000 }],
    })).status).toBe(201);
  }
  return { suffix, categoryName, categoryId: category.body.id as string, ids };
}

function categoryRow(page: Page, categoryName: string) {
  return page.getByRole("heading", { name: categoryName, exact: true }).locator("xpath=ancestor::section[1]");
}

async function beginRowRead(row: Locator, started: () => boolean) {
  const load = row.getByRole("button", { name: "Load products", exact: true });
  if (await load.isVisible()) await load.click();
  for (let step = 0; step < 6 && !started(); step += 1) {
    const next = row.getByRole("button", { name: /^Next/ });
    if (await next.isEnabled()) await next.click();
  }
}

async function revealAllCards(row: Locator, count: number) {
  await row.scrollIntoViewIfNeeded();
  const cards = row.locator("a.product-card");
  const observesViewport = await row.evaluate(() => typeof IntersectionObserver !== "undefined");
  if (!observesViewport && await cards.count() === 0) {
    await row.getByRole("button", { name: "Load products", exact: true }).click();
  }
  // With an observer, approaching the row owns the initial read. Clicking its
  // transient loader races the successful response and can wait on a removed node.
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  for (let step = 0; step < count && await cards.count() < count; step += 1) {
    const mounted = await cards.count();
    const more = row.getByRole("button", { name: "Load more", exact: true });
    await expect(more).toBeVisible();
    await more.click();
    await expect.poll(() => cards.count()).toBeGreaterThan(mounted);
  }
  await expect(cards).toHaveCount(count);
}

async function settleRailScroll(page: Page, rail: Locator, position: "start" | "mid" | "end") {
  await rail.evaluate((element, next) => {
    const max = Math.max(0, element.scrollWidth - element.clientWidth);
    element.scrollLeft = next === "start" ? 0 : next === "end" ? max : max / 2;
  }, position);
  await expect.poll(async () => {
    const first = await rail.evaluate((element) => ({ left: element.scrollLeft, top: window.scrollY }));
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const second = await rail.evaluate((element) => ({ left: element.scrollLeft, top: window.scrollY }));
    return first.left === second.left && first.top === second.top;
  }).toBe(true);
}

async function focusCategoryEntry(page: Page, rail: Locator, position: "start" | "mid" | "end") {
  // Start from the stable category link using native tab order. Set the scroll
  // boundary before traversing whichever Previous/Next controls are enabled,
  // so disabling a focused boundary button cannot change our entry point.
  const row = rail.locator("xpath=ancestor::section[1]");
  const entry = row.locator("h3 > a").first();
  const bound = await page.evaluate(() => [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")].filter((element) => {
    if (!(element instanceof HTMLElement) || element.tabIndex < 0 || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    if (element.closest("[hidden], [inert]")) return false;
    if (element instanceof HTMLInputElement && element.type === "hidden") return false;
    if (element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }).length + document.querySelectorAll("ul[role='list']").length * 4);
  expect(bound, "rendered and approaching-row tabbable controls").toBeGreaterThan(0);
  const key = await rail.evaluate((element) => element.contains(document.activeElement)) ? "Shift+Tab" : "Tab";
  for (let presses = 0; presses < bound + 8; presses += 1) {
    if (await entry.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press(key);
  }
  await expect(entry).toBeFocused();
  await settleRailScroll(page, rail, position);
  // Synchronize the boundary controls with the settled native scroll position.
  const atStart = await rail.evaluate((element) => element.scrollLeft <= 1);
  const atEnd = await rail.evaluate((element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1);
  const previous = row.getByRole("button", { name: /^Previous/ });
  const next = row.getByRole("button", { name: /^Next/ });
  if (atStart) await expect(previous).toBeDisabled();
  else await expect(previous).toBeEnabled();
  if (atEnd) await expect(next).toBeDisabled();
  else await expect(next).toBeEnabled();
  for (const control of [previous, next]) {
    if (!await control.isEnabled()) continue;
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
}

async function expectRailCardFullyVisible(page: Page, rail: Locator, href: string, documentY?: number) {
  await expect.poll(() => rail.evaluate((element, expectedHref) => {
    const active = document.activeElement;
    const anchor = active instanceof HTMLAnchorElement ? active : null;
    if (!anchor || !element.contains(anchor)) return { insideRail: false };
    const card = anchor.getBoundingClientRect();
    const style = getComputedStyle(anchor);
    const extent = Math.max(0, Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset));
    const innerLeft = element.getBoundingClientRect().left + element.clientLeft;
    const innerRight = innerLeft + element.clientWidth;
    return {
      href: anchor.getAttribute("href"), expectedHref,
      insideRail: true, sameNode: document.activeElement === anchor,
      focusVisible: anchor.matches(":focus-visible"),
      leftClear: card.left - extent >= innerLeft,
      rightClear: card.right + extent <= innerRight,
    };
  }, href)).toMatchObject({ href, expectedHref: href, insideRail: true, sameNode: true, focusVisible: true, leftClear: true, rightClear: true });
  if (documentY !== undefined) await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(documentY);
}

async function seedPhotographedPair(page: Page) {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const categoryName = `تصنيف علم ${suffix}`;
  const category = await createCategory(page, categoryName);
  const emptyCategoryName = `Empty category ${suffix}`;
  await createCategory(page, emptyCategoryName);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس علم ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون علم ${suffix}` });
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);
  const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
    fileName: "flagship.png", contentType: "image/png", base64: PNG_BASE64,
  });
  expect(uploaded.status).toBe(201);
  const imageRef = uploaded.body.ref as string;
  const longName = `Flagship layered cloth with extra panels for the wall card title rows ${suffix}`;
  const shortName = `قميص قصير ${suffix}`;
  const plainName = `Flagship plain ${suffix}`;
  const soonName = `Flagship soon ${suffix}`;
  const short = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: `FLAG-S-${suffix}`, name: shortName, price: 18000, publication: "available", imageRefs: [imageRef],
  });
  const long = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: `FLAG-L-${suffix}`, name: longName, price: 26000, publication: "available", imageRefs: [imageRef],
  });
  const plain = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: `FLAG-P-${suffix}`, name: plainName, price: 15000, publication: "available", imageRefs: [],
  });
  const soon = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: `FLAG-C-${suffix}`, name: soonName, price: 21000, publication: "coming_soon", imageRefs: [imageRef],
  });
  const unstockedName = "Flagship no stock " + suffix;
  const hiddenName = "Flagship hidden " + suffix;
  const unstocked = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: "FLAG-O-" + suffix, name: unstockedName, price: 19000, publication: "available", imageRefs: [imageRef],
  });
  const hidden = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: "FLAG-H-" + suffix, name: hiddenName, price: 19000, publication: "hidden", imageRefs: [imageRef],
  });
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;
  for (const variantId of [short.body.variants[0].id, long.body.variants[0].id, plain.body.variants[0].id]) {
    expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), branchId, receiptDate: "2026-09-25",
      lines: [{ variantId, quantity: 2, unitCostPiasters: 4000 }],
    })).status).toBe(201);
  }
  return {
    suffix, categoryId: category.body.id as string, categoryName, emptyCategoryName, longName, shortName, plainName, soonName, unstockedName, hiddenName,
    unstockedId: unstocked.body.id as string, hiddenId: hidden.body.id as string,
    longId: long.body.id as string, shortId: short.body.id as string, plainId: plain.body.id as string, soonId: soon.body.id as string,
  };
}

async function seedBagProduct(page: Page) {
  await signInManager(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await createCategory(page, `تصنيف حقيبة ${suffix}`);
  const sizeName = `مقاس حقيبة ${suffix}`;
  const colorName = `لون حقيبة ${suffix}`;
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: sizeName });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: colorName });
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);
  const uploaded = await staffApi(page, "POST", "/api/internal/catalog/media", {
    fileName: "bag-preview.png", contentType: "image/png", base64: PNG_BASE64,
  });
  expect(uploaded.status).toBe(201);
  const name = `Flagship bag ${suffix}`;
  const product = await createProduct(page, category.body.id, size.body.id, color.body.id, {
    code: `FLAG-BAG-${suffix}`, name, price: 32550, publication: "available", imageRefs: [uploaded.body.ref as string],
    description: `وصف طويل للتمرير ${"قماش ".repeat(396)}`.trim(),
    sizeGuide: Array.from({ length: 40 }, (_, index) => `سطر ${index} دليل المقاس للتمرير`).join("\n"),
  });
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId, receiptDate: "2026-09-25",
    lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 4000 }],
  })).status).toBe(201);
  return { id: product.body.id as string, name, sizeName, colorName };
}

async function signInManager(page: Page) {
  await page.goto(`${STAFF}/login`);
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
  product: { code: string; name: string; price: number; publication: string; imageRefs: readonly string[]; description?: string; sizeGuide?: string },
) {
  const response = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: product.code, nameAr: product.name, descriptionAr: product.description ?? "اختبار الواجهة الرئيسية",
    categoryId, defaultSellingPricePiasters: product.price, publication: product.publication,
    imageRefs: [...product.imageRefs], sizeGuideAr: product.sizeGuide ?? null,
    variants: [{ sizeId, colorId, sellingPricePiastersOverride: null, onlineVisible: true }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response;
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${STAFF}${url}`, {
    method, headers: { origin: STAFF, ...(payload ? { "content-type": "application/json" } : {}) }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
