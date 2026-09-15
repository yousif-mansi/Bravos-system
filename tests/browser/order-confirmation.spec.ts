import { expect, test, type Page } from "@playwright/test";

test("a representative reviews a WhatsApp replacement and safely retries confirmation after a lost response", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const branchId = workspace.body.activeBranch.id as string;

  await page.getByRole("link", { name: "الطلبات الأونلاين" }).click();
  await expect(page.getByRole("heading", { name: "الطلبات الأونلاين" })).toBeVisible();
  const settings = page.getByRole("form", { name: "إعدادات تعذر الوصول" });
  await expect(settings.getByLabel("مهلة تعذر الوصول بالساعات")).toHaveValue("48");
  await expect(settings.getByLabel("الحد الأدنى لمحاولات التواصل")).toHaveValue("2");
  await settings.getByLabel("مهلة تعذر الوصول بالساعات").fill("72");
  await settings.getByRole("button", { name: "حفظ الإعدادات" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إعدادات الطلبات");

  const requested = await seedProduct(page, "ORDER-ORIGINAL-20", "قميص الطلب الأصلي", 30_000, 1);
  const replacement = await seedProduct(page, "ORDER-REPLACEMENT-20", "قميص بديل متفق عليه", 25_000, 2);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: "مدينة الفيوم للطلبات",
    feePiasters: 5_000,
    active: true,
  });
  expect(area.status).toBe(201);
  const order = await submitOrder(page, area.body.id, requested.variantId);
  const navigationOrder = await submitOrder(page, area.body.id, replacement.variantId, {
    customerName: "عميل التنقل الآمن",
    primaryPhone: "01000000020",
  });

  expect((await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    physicallyCompleted: true,
    lines: [{ variantId: requested.variantId, quantity: 1 }],
  })).status).toBe(201);

  const representativeLogin = `orders.rep.${crypto.randomUUID().slice(0, 8)}`;
  const representative = await staffApi(page, "POST", "/api/internal/staff", {
    loginName: representativeLogin,
    displayName: "ممثل طلبات المتصفح",
    password: "e2e-orders-rep-pass",
    grants: [{ branchId, cashier: false, orderRepresentative: true }],
  });
  expect(representative.status).toBe(201);

  await signOut(page);
  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "الطلبات الأونلاين" })).toHaveCount(0);
  expect((await staffApi(page, "GET", "/api/internal/online-orders")).status).toBe(403);
  await page.goto("http://127.0.0.1:5174/online-orders");
  await expect(page).toHaveURL(/\/workspace$/);

  await signOut(page);
  await signIn(page, representativeLogin, "e2e-orders-rep-pass");
  await page.getByRole("link", { name: "الطلبات الأونلاين" }).click();
  const row = page.getByTestId("online-order-row").filter({ hasText: order.reference });
  await expect(row).toContainText("بانتظار التأكيد");

  let releaseOldDetails: (() => void) | undefined;
  const oldDetailsGate = new Promise<void>((resolve) => { releaseOldDetails = resolve; });
  let oldDetailsStarted = false;
  let oldDetailsFinished = false;
  const oldDetailsPattern = `**/api/internal/online-orders/${order.orderId}`;
  await page.route(oldDetailsPattern, async (route) => {
    oldDetailsStarted = true;
    const response = await route.fetch();
    await oldDetailsGate;
    await route.fulfill({ response });
    oldDetailsFinished = true;
  }, { times: 1 });
  await row.getByRole("link", { name: "فتح التفاصيل" }).click();
  await expect(page).toHaveURL(new RegExp(`/online-orders/${order.orderId}$`));
  await expect.poll(() => oldDetailsStarted).toBe(true);
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/online-orders/${navigationOrder.orderId}`);
  await expect(page).toHaveURL(new RegExp(`/online-orders/${navigationOrder.orderId}$`));
  await expect(page.getByRole("region", { name: "الطلب الأصلي" })).toContainText("عميل التنقل الآمن");
  releaseOldDetails?.();
  await expect.poll(() => oldDetailsFinished).toBe(true);
  await page.unroute(oldDetailsPattern);
  await expect(page.getByRole("region", { name: "الطلب الأصلي" })).toContainText("عميل التنقل الآمن");
  await expect(page.getByRole("region", { name: "الطلب الأصلي" })).not.toContainText("عميل واتساب");

  const heldLockName = `bravos.online-order.lock.${representative.body.id}.${navigationOrder.orderId}`;
  await page.evaluate((lockName) => {
    const state = window as typeof window & { releaseOrderLock?: () => void; orderLockHeld?: boolean };
    void navigator.locks.request(lockName, async () => {
      state.orderLockHeld = true;
      await new Promise<void>((resolve) => { state.releaseOrderLock = resolve; });
      state.orderLockHeld = false;
    });
  }, heldLockName);
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { orderLockHeld?: boolean }).orderLockHeld))).toBe(true);
  await page.getByRole("form", { name: "تسجيل محاولة تواصل" }).getByRole("button", { name: "حفظ محاولة التواصل" }).click();
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending.some((lock) => lock.name === lockName);
  }, heldLockName)).toBe(true);
  await page.getByRole("link", { name: "مساحة العمل" }).click();
  await signOut(page);
  await signIn(page, "cashier", "e2e-cashier-pass");
  await page.evaluate(() => (window as typeof window & { releaseOrderLock?: () => void }).releaseOrderLock?.());
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.held.some((lock) => lock.name === lockName) || snapshot.pending.some((lock) => lock.name === lockName);
  }, heldLockName)).toBe(false);
  await signOut(page);
  await signIn(page, representativeLogin, "e2e-orders-rep-pass");
  await page.getByRole("link", { name: "الطلبات الأونلاين" }).click();
  await page.getByTestId("online-order-row").filter({ hasText: navigationOrder.reference }).getByRole("link", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("contact-attempts")).toContainText("لم تُسجل محاولة تواصل بعد");
  await page.getByRole("button", { name: "العودة إلى الطلبات" }).click();
  await page.getByTestId("online-order-row").filter({ hasText: order.reference }).getByRole("link", { name: "فتح التفاصيل" }).click();

  const original = page.getByRole("region", { name: "الطلب الأصلي" });
  await expect(original).toContainText("عميل واتساب");
  await expect(original).toContainText("01012345678");
  await expect(original).toContainText("01123456789");
  await expect(original).toContainText("شارع الجمهورية، منزل ٢٠");
  await expect(original).toContainText("بجوار المكتبة");
  await expect(original).toContainText("الاتصال بعد العصر");
  await expect(original).toContainText("قميص الطلب الأصلي");
  await expect(original).toContainText("الكمية المطلوبة: 1");
  await expect(original).toContainText("350 ج.م.");

  const contact = page.getByRole("form", { name: "تسجيل محاولة تواصل" });
  await contact.getByLabel("نتيجة التواصل").selectOption("reached");
  await contact.getByLabel("ملاحظة التواصل (اختياري)").fill("وافق العميل على القميص البديل");
  await contact.getByRole("button", { name: "حفظ محاولة التواصل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل محاولة التواصل");
  await expect(page.getByTestId("contact-attempts")).toContainText("تم التواصل");
  await expect(page.getByTestId("contact-attempts")).toContainText("وافق العميل على القميص البديل");

  const agreement = page.getByRole("form", { name: "مراجعة الاتفاق مع العميل" });
  await agreement.getByTestId(`agreement-quantity-${requested.variantId}`).fill("");
  await agreement.getByLabel("بحث عن منتج بديل").fill("قميص بديل متفق عليه");
  await agreement.getByRole("button", { name: "بحث" }).click();
  const searchResult = page.getByTestId("replacement-product").filter({ hasText: "قميص بديل متفق عليه" });
  await searchResult.getByRole("button", { name: "اختيار" }).click();
  await agreement.getByLabel("الصنف البديل", { exact: true }).selectOption(replacement.variantId);
  await agreement.getByLabel("كمية الصنف البديل").fill("1");
  await agreement.getByRole("button", { name: "إضافة الصنف البديل" }).click();
  await expect(agreement.getByTestId("agreement-quantity-error")).toContainText("أدخل كمية قميص الطلب الأصلي أو اكتب صفر");
  await expect(agreement.getByRole("button", { name: "مراجعة السعر" })).toBeDisabled();
  await agreement.getByTestId(`agreement-quantity-${requested.variantId}`).fill("0");
  await expect(agreement.getByTestId("agreement-quantity-error")).toHaveCount(0);
  await agreement.getByRole("button", { name: "مراجعة السعر" }).click();

  const priceReview = page.getByRole("region", { name: "مراجعة السعر المتفق عليه" });
  await expect(priceReview).toContainText("قميص بديل متفق عليه");
  await expect(priceReview).toContainText("250 ج.م.");
  await expect(priceReview).toContainText(/رسوم التوصيل:\s*50 ج\.م\./);
  await expect(priceReview).toContainText(/الإجمالي النهائي:\s*300 ج\.م\./);
  await agreement.getByLabel("وافق العميل على هذه المنتجات والأسعار").check();
  await agreement.getByRole("button", { name: "حفظ اتفاق العميل" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ الاتفاق مع العميل");

  const agreed = page.getByRole("region", { name: "الاتفاق الحالي مع العميل" });
  await expect(agreed).toContainText("قميص بديل متفق عليه");
  await expect(agreed).toContainText("الكمية: 1");
  await expect(agreed).toContainText("300 ج.م.");
  await expect(original).toContainText("قميص الطلب الأصلي");
  await expect(original).toContainText("350 ج.م.");
  await page.screenshot({ path: ".scratch/order-confirmation-detail.png", fullPage: true });

  const confirmationPayloads: unknown[] = [];
  await page.route(`**/api/internal/online-orders/${order.orderId}/confirm`, async (route) => {
    confirmationPayloads.push(route.request().postDataJSON());
    if (confirmationPayloads.length === 1) {
      await route.fetch();
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "CONFLICT", messageAr: "انقطع الرد بعد حفظ التأكيد." } }),
      });
      return;
    }
    await route.continue();
  });

  const confirmation = page.getByRole("form", { name: "تأكيد تجهيز الطلب" });
  await confirmation.getByLabel("وجدت الأصناف الفعلية وفصلتها لهذا الطلب").check();
  await confirmation.getByRole("button", { name: "تأكيد الطلب وخصم المخزون" }).click();
  await expect(page.getByRole("alert")).toContainText("قد يكون التأكيد حُفظ");

  await page.reload();
  await expect(page.getByText("توجد محاولة تأكيد لم نعرف نتيجتها")).toBeVisible();
  await page.getByRole("button", { name: "إعادة محاولة التأكيد بنفس العملية" }).click();
  await expect(page.getByRole("status")).toContainText("تم تأكيد الطلب وخصم المخزون مرة واحدة");
  await expect(page.getByTestId("order-status")).toContainText("مؤكد");
  expect(confirmationPayloads).toHaveLength(2);
  expect(confirmationPayloads[1]).toEqual(confirmationPayloads[0]);
  expect((confirmationPayloads[0] as { itemsLocatedAndSetAside: boolean }).itemsLocatedAndSetAside).toBe(true);

  const listed = await staffApi(page, "GET", `/api/internal/online-orders/${order.orderId}`);
  expect(listed.status).toBe(200);
  expect(listed.body.status).toBe("confirmed");
  expect(listed.body.lines[0].variantId).toBe(requested.variantId);
  expect(listed.body.agreedRevision.quote.lines).toEqual([
    expect.objectContaining({ variantId: replacement.variantId, quantity: 1, merchandiseTotalPiasters: 25_000 }),
  ]);
  expect(listed.body.confirmedQuote.finalTotalPiasters).toBe(30_000);
  expect((await publicApi(page, "GET", `/api/public/catalog/products/${replacement.productId}`)).body.variants[0].availableQuantity).toBe(1);
});

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function signOut(page: Page) {
  if (await page.getByRole("button", { name: "تسجيل الخروج" }).count() === 0) {
    await page.goto("http://127.0.0.1:5174/workspace");
  }
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
}

async function seedProduct(page: Page, code: string, nameAr: string, pricePiasters: number, quantity: number) {
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${code}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${code}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr,
    descriptionAr: "منتج لاختبار اتفاق طلب واتساب",
    categoryId: category.body.id,
    defaultSellingPricePiasters: pricePiasters,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id as string;
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 10_000 }],
  })).status).toBe(201);
  return { productId: product.body.id as string, variantId };
}

async function submitOrder(
  page: Page,
  deliveryAreaId: string,
  variantId: string,
  customer: { customerName: string; primaryPhone: string } = { customerName: "عميل واتساب", primaryPhone: "01012345678" },
) {
  const quote = await publicApi(page, "POST", "/api/public/checkout/quote", {
    deliveryAreaId,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(quote.status).toBe(200);
  const submitted = await publicApi(page, "POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity: 1 }],
    customerName: customer.customerName,
    primaryPhone: customer.primaryPhone,
    alternatePhone: "01123456789",
    detailedAddress: "شارع الجمهورية، منزل ٢٠",
    landmark: "بجوار المكتبة",
    notes: "الاتصال بعد العصر",
  });
  expect(submitted.status).toBe(201);
  return { orderId: submitted.body.orderId as string, reference: submitted.body.reference as string };
}

async function staffApi(page: Page, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return api(page, method, url, payload, "http://127.0.0.1:5174");
}

async function publicApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  return api(page, method, url, payload, "http://127.0.0.1:3001");
}

async function api(page: Page, method: "GET" | "POST" | "PUT", url: string, payload: unknown, origin: string) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin, ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
