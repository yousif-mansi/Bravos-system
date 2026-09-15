import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

test("staff fulfill orders in Arabic and a manager closes a partially inspected failed parcel", async ({ page }) => {
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("America/New_York");
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const branchId = workspace.body.activeBranch.id as string;
  const product = await seedProduct(page, `FULFILL-${crypto.randomUUID().slice(0, 8)}`, "قميص تنفيذ الطلب", 42_000, 5);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة تنفيذ ${crypto.randomUUID().slice(0, 6)}`,
    feePiasters: 4_000,
    active: true,
  });
  expect(area.status).toBe(201);
  const deliveredOrder = await submitAndConfirmOrder(page, area.body.id, product.variantId, 1, "عميل استلام");
  const failedOrder = await submitAndConfirmOrder(page, area.body.id, product.variantId, 2, "عميل تعذر توصيله");
  const cancelledOrder = await submitAndConfirmOrder(page, area.body.id, product.variantId, 1, "عميل إلغاء قبل الشحن");

  const representativeLogin = `fulfill.rep.${crypto.randomUUID().slice(0, 8)}`;
  const representative = await staffApi(page, "POST", "/api/internal/staff", {
    loginName: representativeLogin,
    displayName: "ممثل تنفيذ الطلبات",
    password: "e2e-fulfill-rep-pass",
    grants: [{ branchId, cashier: false, orderRepresentative: true }],
  });
  expect(representative.status).toBe(201);

  await signOut(page);
  await signIn(page, representativeLogin, "e2e-fulfill-rep-pass");
  const representativeDetail = page.waitForResponse((response) => (
    response.request().method() === "GET"
    && new URL(response.url()).pathname === `/api/internal/online-orders/${deliveredOrder.orderId}`
  ));
  await openOrder(page, deliveredOrder.orderId);
  const representativeDto = await (await representativeDetail).json();
  expect(JSON.stringify(representativeDto)).not.toMatch(/unitCost|costPiasters|batchId|inventoryValue|profit/i);

  const shippingPayloads: unknown[] = [];
  await page.route(`**/api/internal/online-orders/${deliveredOrder.orderId}/ship`, async (route) => {
    shippingPayloads.push(route.request().postDataJSON());
    if (shippingPayloads.length === 1) {
      await route.fetch();
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UPSTREAM_FAILURE", messageAr: "انقطع الرد بعد حفظ التسليم لشركة الشحن." } }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "تسليم الطلب لشركة الشحن" }).click();
  await expect(page.getByRole("alert")).toContainText("قد يكون تسليم الطلب لشركة الشحن قد حُفظ");
  await page.reload();
  await expect(page.getByText("توجد محاولة تسليم لشركة الشحن لم نعرف نتيجتها")).toBeVisible();
  await page.getByRole("button", { name: "إعادة محاولة التسليم لشركة الشحن بنفس العملية" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل تسليم الطلب لشركة الشحن من دون خصم جديد للمخزون");
  await expect(page.getByTestId("order-status")).toContainText("تم الشحن");
  await expect.poll(() => shippingPayloads.length).toBe(2);
  expect(shippingPayloads).toHaveLength(2);
  expect(shippingPayloads[1]).toEqual(shippingPayloads[0]);

  const deliveredForm = page.getByRole("form", { name: "تسجيل استلام العميل" });
  await page.waitForTimeout(1_100);
  await deliveredForm.getByLabel("وقت استلام العميل بتوقيت القاهرة").fill(await currentCairoDateTime(page));
  await deliveredForm.getByRole("button", { name: "تسجيل الطلب كمُسلّم" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل استلام العميل");
  await expect(page.getByTestId("order-status")).toContainText("تم التسليم");

  await openOrder(page, cancelledOrder.orderId);
  const cancelForm = page.getByRole("form", { name: "إلغاء طلب مؤكد قبل الشحن" });
  await cancelForm.getByLabel("سبب الإلغاء قبل الشحن").fill("طلب العميل الإلغاء قبل تسليم الشحنة");
  await cancelForm.getByRole("button", { name: "إلغاء الطلب وإعادة الكمية المتاحة" }).click();
  await expect(page.getByTestId("order-status")).toContainText("ملغي قبل الشحن");

  await openOrder(page, failedOrder.orderId);
  await page.getByRole("button", { name: "تسليم الطلب لشركة الشحن" }).click();
  const failureForm = page.getByRole("form", { name: "تسجيل تعذر التوصيل" });
  await failureForm.getByLabel("سبب تعذر التوصيل (اختياري)").fill("تعذر الوصول إلى عنوان العميل");
  await failureForm.getByRole("button", { name: "تسجيل تعذر التوصيل وانتظار رجوع الشحنة" }).click();
  await expect(page.getByTestId("order-status")).toContainText("تعذر التوصيل — بانتظار رجوع الشحنة");

  const firstInspection = page.getByRole("form", { name: "تسجيل استلام وفحص الشحنة المرتجعة" });
  await firstInspection.getByLabel("الكمية المستلمة").fill("1");
  await firstInspection.getByLabel("منها قابلة للبيع").fill("1");
  await firstInspection.getByRole("button", { name: "حفظ مسودة الفحص" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت مسودة الفحص دون إعادة أي كمية للمخزون");
  const inspections = page.getByRole("region", { name: "فحوصات الشحنة المرتجعة" });
  await expect(inspections).toContainText("مسودة بانتظار الترحيل أو الإلغاء");
  await expect(page.getByRole("button", { name: "ترحيل الفحص واستعادة القابل للبيع" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "إغلاق الطلب المتعذر نهائياً" })).toHaveCount(0);

  const abandonForm = page.getByRole("form", { name: "إلغاء مسودة الفحص واستبدالها" });
  await abandonForm.getByLabel("سبب إلغاء مسودة الفحص").fill("سُجلت الكمية على الصنف الخطأ");
  await abandonForm.getByRole("button", { name: "إلغاء المسودة وتسجيل فحص بديل" }).click();
  await expect(page.getByRole("status")).toContainText("أُلغيت مسودة الفحص مع حفظها في السجل");
  await expect(inspections).toContainText("مسودة ملغاة");
  await expect(page.getByTestId("failed-return-remaining")).toHaveText("المتبقي خارج المحل: 2");

  const replacementInspection = page.getByRole("form", { name: "تسجيل استلام وفحص الشحنة المرتجعة" });
  await replacementInspection.getByLabel("الكمية المستلمة").fill("1");
  await replacementInspection.getByLabel("منها قابلة للبيع").fill("1");
  await replacementInspection.getByRole("button", { name: "حفظ مسودة الفحص" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت مسودة الفحص دون إعادة أي كمية للمخزون");

  await signOut(page);
  await signIn(page, "owner", "e2e-owner-pass");
  await openOrder(page, failedOrder.orderId);
  await page.getByRole("button", { name: "ترحيل الفحص واستعادة القابل للبيع" }).click();
  await expect(page.getByRole("status")).toContainText("رُحّل الفحص واستُعيدت الكمية القابلة للبيع فقط");
  await expect(page.getByTestId("failed-return-remaining")).toHaveText("المتبقي خارج المحل: 1");

  const secondInspection = page.getByRole("form", { name: "تسجيل استلام وفحص الشحنة المرتجعة" });
  await secondInspection.getByLabel("الكمية المستلمة").fill("1");
  await secondInspection.getByLabel("منها قابلة للبيع").fill("0");
  await secondInspection.getByRole("button", { name: "حفظ مسودة الفحص" }).click();
  await page.getByRole("button", { name: "ترحيل الفحص واستعادة القابل للبيع" }).click();
  await expect(page.getByTestId("failed-return-remaining")).toHaveText("المتبقي خارج المحل: 0");

  const closeForm = page.getByRole("form", { name: "إغلاق الطلب المتعذر نهائياً" });
  await closeForm.getByLabel("سبب الإغلاق النهائي").fill("استلمنا كامل الشحنة وفُحصت الأصناف");
  await closeForm.getByRole("button", { name: "إغلاق الطلب نهائياً" }).click();
  await expect(page.getByTestId("order-status")).toContainText("ملغي بعد رجوع الشحنة وفحصها");

  const timeline = page.getByRole("region", { name: "سجل تنفيذ الطلب" });
  await expect(timeline).toContainText("تم الشحن");
  await expect(timeline).toContainText("تعذر التوصيل");
  await expect(timeline).toContainText("حفظ مسودة فحص الشحنة");
  await expect(timeline).toContainText("إلغاء مسودة فحص الشحنة");
  await expect(timeline).toContainText("ترحيل فحص الشحنة");
  await expect(timeline).toContainText("إغلاق الطلب بعد رجوع الشحنة");
});

async function openOrder(page: Page, orderId: string) {
  await page.goto(`http://127.0.0.1:5174/online-orders/${orderId}`);
  await expect(page.getByRole("heading", { name: /^BRV-/ })).toBeVisible();
}

async function currentCairoDateTime(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
  });
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
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
    descriptionAr: "منتج لاختبار تنفيذ الطلب",
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

async function submitAndConfirmOrder(
  page: Page,
  deliveryAreaId: string,
  variantId: string,
  quantity: number,
  customerName: string,
) {
  const quote = await publicApi(page, "POST", "/api/public/checkout/quote", {
    deliveryAreaId,
    lines: [{ variantId, quantity }],
  });
  expect(quote.status).toBe(200);
  const submitted = await publicApi(page, "POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity }],
    customerName,
    primaryPhone: "01012345678",
    detailedAddress: "شارع الجمهورية، الفيوم",
  });
  expect(submitted.status).toBe(201);
  const order = await staffApi(page, "GET", `/api/internal/online-orders/${submitted.body.orderId}`);
  const agreementQuote = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/agreement-quotes`, {
    expectedRevision: order.body.revision,
    lines: [{ variantId, quantity }],
  });
  expect(agreementQuote.status).toBe(201);
  const agreed = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreementQuote.body.orderRevision,
    quoteId: agreementQuote.body.quoteId,
    reviewDigest: agreementQuote.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status).toBe(201);
  const confirmed = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.agreedRevision.version,
    itemsLocatedAndSetAside: true,
  });
  expect(confirmed.status).toBe(201);
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
