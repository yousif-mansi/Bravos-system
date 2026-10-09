import { expect, test, type Page } from "@playwright/test";

const STORE = "http://127.0.0.1:3001";
const API = "http://127.0.0.1:5174";

test("storefront route presentation remains reachable across supported widths and zoom equivalent", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signInManager(page);
  const category = await staffApi(page, "/api/internal/catalog/categories", { nameAr: "قمصان تجربة الوصول" });
  const size = await staffApi(page, "/api/internal/catalog/sizes", { nameAr: "L تجربة" });
  const color = await staffApi(page, "/api/internal/catalog/colors", { nameAr: "أسود تجربة" });
  for (const response of [category, size, color]) expect(response.status).toBe(201);
  const product = await staffApi(page, "/api/internal/catalog/products", {
    code: "ACCESS-25-LATIN", nameAr: "قميص BRAVOS Classic طويل الاسم للتأكد من التفاف النص العربي واللاتيني 2026",
    descriptionAr: "وصف طويل للاختبار مع اسم BRAVOS Classic وأرقام 2026 و ٣٥٠ للتحقق من اتجاه النص والتفافه.",
    categoryId: category.body.id, defaultSellingPricePiasters: 35000, publication: "available",
    imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  expect((await staffApi(page, "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await (await page.request.get(`${API}/api/internal/workspace`)).json()).activeBranch.id,
    receiptDate: "2026-09-25",
    lines: [{ variantId: product.body.variants[0].id, quantity: 3, unitCostPiasters: 12000 }],
  })).status).toBe(201);
  const area = await staffApi(page, "/api/internal/delivery-areas", { nameAr: "مدينة الفيوم تجربة الوصول", feePiasters: 2500, active: true });
  expect(area.status).toBe(201);

  const findings: unknown[] = [];
  const routes = [
    { name: "home", url: `${STORE}/?q=BRAVOS`, ready: "a.product-card" },
    { name: "product", url: `${STORE}/products/${product.body.id}`, ready: "#product-quantity" },
    { name: "cart", url: `${STORE}/cart`, ready: ".cart-line" },
    { name: "checkout", url: `${STORE}/checkout`, ready: "form.checkout-form" },
    { name: "not-found", url: `${STORE}/products/00000000-0000-4000-8000-000000000000`, ready: "#main-content h1" },
  ];
  const cartEvents: unknown[] = [];
  await page.route("**/api/public/analytics/events", async (route) => {
    const event = route.request().postDataJSON() as { eventType: string };
    if (event.eventType === "cart_addition") cartEvents.push(event);
    await route.continue();
  });
  await page.goto(routes[1].url);
  await page.getByRole("button", { name: "أضف إلى السلة" }).first().click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await page.goto(route.url);
      await expect(page.locator(route.ready).first()).toBeVisible();
      const metrics = await page.evaluate(() => {
        const all = [...document.querySelectorAll<HTMLElement>("a, button, input, select, textarea, summary, label.variant-option")];
        const small = all.filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
        }).map((element) => ({ tag: element.tagName, type: element.getAttribute("type"), text: element.textContent?.trim().slice(0, 70), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height), labelHeight: Math.round(element.closest("label")?.getBoundingClientRect().height ?? 0) }));
        const skip = document.querySelector<HTMLElement>(".skip-link")!;
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small, skipTop: Math.round(skip.getBoundingClientRect().top), active: document.activeElement?.tagName };
      });
      findings.push({ route: route.name, width, ...metrics });
      expect(metrics.scrollWidth, `${route.name} at ${width}px must not overflow horizontally`).toBeLessThanOrEqual(width);
      expect(metrics.skipTop, "unfocused skip link stays offscreen").toBeLessThan(0);
      expect(metrics.small.filter((item) => !(item.tag === "INPUT" && (item.type === "radio" || item.type === "checkbox") && item.labelHeight >= 44)), `${route.name} at ${width}px has no small standalone targets`).toEqual([]);
      if (route.name === "product") {
        const label = await page.getByRole("radio").first().locator("..").boundingBox();
        expect(label?.height, "variant radio has a full-size label target").toBeGreaterThanOrEqual(44);
      }
      if (route.name === "checkout" || route.name === "not-found") {
        const recoveryLinks = route.name === "checkout"
          ? page.getByRole("link", { name: "تعديل السلة" })
          : page.getByRole("link", { name: "العودة إلى المنتجات" });
        let visibleRecoveryLinks = 0;
        for (const recoveryLink of await recoveryLinks.all()) {
          if (!await recoveryLink.isVisible()) continue;
          visibleRecoveryLinks += 1;
          const box = await recoveryLink.boundingBox();
          expect(box, `${route.name} recovery link ${visibleRecoveryLinks} at ${width}px`).not.toBeNull();
          expect(box!.width, `${route.name} recovery link ${visibleRecoveryLinks} width at ${width}px`).toBeGreaterThanOrEqual(44);
          expect(box!.height, `${route.name} recovery link ${visibleRecoveryLinks} height at ${width}px`).toBeGreaterThanOrEqual(44);
        }
        expect(visibleRecoveryLinks, `${route.name} has a visible recovery link at ${width}px`).toBeGreaterThanOrEqual(1);
      }
      if (width === 320 || width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`${route.name}-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 640, height: 844 });
  await page.goto(routes[1].url);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const zoom = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, mainWidth: document.querySelector("#main-content")?.getBoundingClientRect().width, stickyBar: document.querySelector("[aria-label='إضافة المنتج إلى السلة']")?.getBoundingClientRect().toJSON() }));
  expect(zoom.scrollWidth).toBeLessThanOrEqual(zoom.viewportWidth);
  expect(zoom.stickyBar?.left).toBeGreaterThanOrEqual(0);
  expect(zoom.stickyBar?.right).toBeLessThanOrEqual(zoom.viewportWidth);
  expect(zoom.stickyBar?.bottom).toBeLessThanOrEqual(844);
  findings.push({ route: "product", width: "640 at CSS zoom 2", ...zoom });
  await page.screenshot({ path: testInfo.outputPath("product-zoom-equivalent.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => ({ behavior: getComputedStyle(document.documentElement).scrollBehavior, transition: getComputedStyle(document.querySelector("button")!).transitionDuration }));
  expect(reducedMotion.behavior).toBe("auto");
  expect(reducedMotion.transition).toBe("0s");
  findings.push({ route: "product", reducedMotion });

  await page.goto(routes[0].url);
  const skip = page.getByRole("link", { name: "انتقل إلى المحتوى" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  const skipFocus = await skip.evaluate((element) => ({ top: element.getBoundingClientRect().top, outline: getComputedStyle(element).outlineStyle }));
  expect(skipFocus.top).toBeGreaterThanOrEqual(0);
  expect(skipFocus.outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  findings.push({ route: "home", skipFocus, afterSkip: await page.evaluate(() => ({ active: document.activeElement?.tagName, hash: location.hash })) });

  await page.goto(routes[1].url);
  const tabOrder: unknown[] = [];
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press("Tab");
    tabOrder.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      return { tag: active.tagName, text: active.textContent?.trim().slice(0, 36), name: active.getAttribute("aria-label"), type: active.getAttribute("type"), outline: getComputedStyle(active).outlineStyle, top: Math.round(active.getBoundingClientRect().top) };
    }));
  }
  findings.push({ route: "product", tabOrder });

  await page.goto(routes[0].url);
  findings.push({ route: "home", contrast: await page.evaluate(() => {
    const parse = (color: string) => [...color.matchAll(/[\d.]+/g)].slice(0, 3).map((match) => Number(match[0]));
    const luminance = (rgb: number[]) => rgb.map((channel) => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const ratio = (a: string, b: string) => { const values = [luminance(parse(a)), luminance(parse(b))].sort((left, right) => right - left); return Number(((values[0] + .05) / (values[1] + .05)).toFixed(2)); };
    const samples = [".eyebrow", ".count", ".available", ".note", "a.product-card", "select"];
    return samples.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return { selector, missing: true };
      const style = getComputedStyle(element);
      let parent: Element | null = element;
      let background = "rgb(255, 255, 255)";
      while (parent) { const candidate = getComputedStyle(parent).backgroundColor; if (candidate !== "rgba(0, 0, 0, 0)") { background = candidate; break; } parent = parent.parentElement; }
      return { selector, color: style.color, background, textRatio: ratio(style.color, background), border: style.borderColor, borderRatio: ratio(style.borderColor, background) };
    });
  }) });
  for (const selector of ["input#product-search", "select#collection-sort"]) {
    expect(await controlBorderContrast(page, selector), `${selector} boundary contrast`).toBeGreaterThanOrEqual(3);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(STORE);
  await page.getByLabel("ابحث عن منتج").fill("BRAVOS");
  await page.getByRole("button", { name: "بحث" }).click();
  await expect(page).toHaveURL(/q=BRAVOS/);
  await page.getByRole("link", { name: category.body.nameAr, exact: true }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("link", { name: category.body.nameAr, exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.getByLabel("ترتيب المنتجات").evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")))).toBe(true);
  await page.getByLabel("ترتيب المنتجات").selectOption("price-asc");
  await expect(page).toHaveURL(/sort=price-asc/);
  await page.locator("a.product-card").filter({ hasText: product.body.nameAr }).click();
  await expect(page.getByRole("heading", { name: product.body.nameAr })).toBeVisible();
  await expect(page.getByRole("radio")).toBeChecked();
  expect(await controlBorderContrast(page, "#product-quantity"), "product quantity boundary contrast").toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "أضف إلى السلة" }).last().click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة");
  await expect.poll(() => cartEvents.length).toBe(2);
  await page.getByRole("link", { name: "تمت الإضافة · عرض السلة" }).click();
  await expect(page.locator(".cart-line output")).toHaveText("2");
  expect(await controlBorderContrast(page, ".cart-line [role='group']"), "cart quantity boundary contrast").toBeGreaterThanOrEqual(3);
  await page.getByRole("link", { name: "متابعة إتمام الطلب" }).click();
  const checkout = page.getByRole("form", { name: "بيانات طلب التوصيل" });
  await checkout.getByLabel("الاسم").fill("عميل اختبار الوصول");
  await checkout.getByLabel("رقم الموبايل الأساسي").fill("01001234567");
  await checkout.getByLabel("منطقة التوصيل").selectOption(area.body.id);
  await checkout.getByLabel("العنوان بالتفصيل").fill("الفيوم، شارع الاختبار بجوار BRAVOS 2026");
  await checkout.getByRole("button", { name: "مراجعة السعر" }).click();
  await expect(page.getByRole("region", { name: "تفاصيل السعر" })).toContainText("رسوم التوصيل");
  await checkout.getByRole("button", { name: "إرسال طلب التوصيل" }).click();
  await expect(page.getByRole("heading", { name: "تم استلام طلبك" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.");
  findings.push({ route: "customer-journey", cartAdditionEvents: cartEvents.length, orderStatus: "pending" });
  console.log(JSON.stringify(findings, null, 2));
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

async function staffApi(page: Page, url: string, payload: unknown) {
  const response = await page.request.fetch(`${API}${url}`, {
    method: "POST", headers: { origin: API, "content-type": "application/json" }, data: payload,
  });
  return { status: response.status(), body: await response.json() };
}

async function controlBorderContrast(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const luminance = (color: string) => {
      const channels = [...color.matchAll(/[\d.]+/g)].slice(0, 3).map((match) => Number(match[0]) / 255);
      const linear = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    };
    let backgroundElement: Element | null = element;
    let backgroundColor = "rgb(255, 255, 255)";
    while (backgroundElement) {
      const candidate = getComputedStyle(backgroundElement).backgroundColor;
      if (candidate !== "rgba(0, 0, 0, 0)") { backgroundColor = candidate; break; }
      backgroundElement = backgroundElement.parentElement;
    }
    const values = [luminance(getComputedStyle(element).borderTopColor), luminance(backgroundColor)]
      .sort((left, right) => right - left);
    return Number(((values[0] + .05) / (values[1] + .05)).toFixed(2));
  });
}
