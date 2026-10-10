import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

test("manager selects a delivered online purchase and reviews refund components before an exchange", async ({ page }) => {
  await signInManager(page);

  const returned = await seedProduct(page, "مرتجع طلب أونلاين", 36_000, 2);
  const replacement = await seedProduct(page, "بديل مرتجع أونلاين", 80_000, 1);
  const refundOnly = await seedProduct(page, "مرتجع أونلاين باسترداد نقدي", 25_000, 1);
  const area = await staffApi(page, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة مرتجع ${crypto.randomUUID().slice(0, 6)}`,
    feePiasters: 4_000,
    active: true,
  });
  expect(area.status).toBe(201);

  const delivered = await submitConfirmAndDeliver(page, area.body.id, returned.variantId, 2);
  const deliveredForRefund = await submitConfirmAndDeliver(page, area.body.id, refundOnly.variantId, 1);

  await page.getByRole("link", { name: "المرتجعات" }).click();
  await expect(page.getByRole("heading", { name: "المرتجعات", exact: true })).toBeVisible();
  const search = page.getByRole("form", { name: /البحث عن المعاملة الأصلية/ });
  await expect(search).toBeVisible();
  await search.getByLabel("رقم الطلب").fill(delivered.reference);
  await search.getByRole("button", { name: "بحث" }).click();

  const source = page.getByTestId("return-source-list").getByRole("button").filter({ hasText: delivered.reference });
  await expect(source).toHaveCount(1);
  await expect(source).toContainText(`طلب ${delivered.reference}`);
  await expect(source).toContainText("760 ج.م.");
  await expect(source).toContainText("أونلاين · فرع التجهيز: أبشواي");
  await source.click();
  await expect(page.getByText(/العميل: عميل مرتجع أونلاين/)).toBeVisible();

  const draft = page.getByRole("form", { name: "إنشاء مسودة إرجاع" });
  await draft.getByLabel("الكمية المستلمة").fill("1");
  await draft.getByLabel("منها قابلة للبيع بعد الفحص").fill("1");
  const suggestion = page.getByTestId("refund-suggestion");
  await expect(suggestion).toContainText("قيمة البضاعة: 360 ج.م.");
  await expect(suggestion).toContainText("رسوم التوصيل: 0 ج.م.");
  await expect(suggestion).toContainText("الإجمالي: 360 ج.م.");

  await draft.getByLabel("الكمية المستلمة").fill("2");
  await draft.getByLabel("منها قابلة للبيع بعد الفحص").fill("2");
  await expect(suggestion).toContainText("قيمة البضاعة: 720 ج.م.");
  await expect(suggestion).toContainText("رسوم التوصيل: 40 ج.م.");
  await expect(suggestion).toContainText("الإجمالي: 760 ج.م.");

  await expect(draft.getByLabel("سبب المرتجع (اختياري)")).not.toHaveAttribute("required");
  await draft.getByLabel("سبب المرتجع (اختياري)").fill("العميل رجع الطلب");
  await draft.getByLabel("استرداد البضاعة المعتمد بالجنيه").fill("700");
  await draft.getByLabel("استرداد رسوم التوصيل المعتمد بالجنيه").fill("30");
  await draft.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت المسودة");

  const details = page.getByTestId("return-details");
  await expect(details).toContainText(`الطلب: ${delivered.reference}`);
  await expect(details).toContainText("فرع التجهيز: أبشواي · فرع الاستلام: أبشواي");
  await expect(details).toContainText("سبب الإرجاع: العميل رجع الطلب");
  const history = page.locator(".return-history").getByRole("button").filter({ hasText: delivered.reference });
  await expect(history).toContainText("مرتجع طلب أونلاين");
  await expect(history).toContainText("العميل رجع الطلب");
  await expect(details).toContainText("البضاعة 700 ج.م.");
  await expect(details).toContainText("رسوم التوصيل 30 ج.م.");
  await expect(details).toContainText("الإجمالي 730 ج.م.");
  await details.getByRole("button", { name: "تأكيد الاستلام والفحص وترحيل الإرجاع" }).click();
  await expect(page.getByRole("status")).toContainText("تم ترحيل الإرجاع");

  const exchange = page.getByRole("form", { name: "إتمام استبدال" });
  await exchange.getByLabel("صنف الاستبدال").selectOption(replacement.variantId);
  await exchange.getByRole("button", { name: "إضافة إلى سلة الاستبدال" }).click();
  await exchange.getByRole("button", { name: "عرض السعر والفرق" }).click();
  const quote = page.getByTestId("exchange-quote");
  await expect(quote).toContainText("800 ج.م.");
  await expect(quote).toContainText("730 ج.م.");
  await expect(quote).toContainText("70 ج.م.");
  await exchange.getByRole("button", { name: "تأكيد الاستبدال بعد مراجعة فرق النقد" }).click();
  await expect(page.getByRole("status")).toContainText("تم إتمام الاستبدال");
  await expect(page.getByTestId("exchange-details")).toContainText("النقد المحصل: 70 ج.م.");

  await page.goto("http://127.0.0.1:5174/returns");
  const refundSearch = page.getByRole("form", { name: /البحث عن المعاملة الأصلية/ });
  await expect(refundSearch).toBeVisible();
  await refundSearch.getByLabel("رقم الطلب").fill(deliveredForRefund.reference);
  await refundSearch.getByRole("button", { name: "بحث" }).click();
  await page.getByTestId("return-source-list").getByRole("button").filter({ hasText: deliveredForRefund.reference }).click();
  const refundDraft = page.getByRole("form", { name: "إنشاء مسودة إرجاع" });
  await refundDraft.getByLabel("الكمية المستلمة").fill("1");
  await expect(page.getByTestId("refund-suggestion")).toContainText("الإجمالي: 290 ج.م.");
  await refundDraft.getByRole("button", { name: "حفظ المسودة" }).click();
  await page.getByTestId("return-details").getByRole("button", { name: "تأكيد الاستلام والفحص وترحيل الإرجاع" }).click();
  await expect(page.getByTestId("return-details")).toContainText("الاسترداد النقدي مستحق");
  const paymentResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && /\/api\/internal\/returns\/[^/]+\/refund$/.test(new URL(response.url()).pathname)
  ));
  await page.getByTestId("return-details").getByRole("button", { name: "تسجيل دفع 290 ج.م." }).click();
  const paidReturn = await (await paymentResponse).json();
  expect(paidReturn.refund.recordedByDisplayName).toBeTruthy();
  expect(paidReturn.refund.recordedAt).toBeTruthy();
  await expect(page.getByTestId("return-details")).toContainText("دُفع 290 ج.م. فعلياً بواسطة المدير");
  await expect(page.getByTestId("return-details")).toContainText(paidReturn.refund.recordedByDisplayName);
  const cairoRecordedAt = await page.evaluate((value) => (
    new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
  ), paidReturn.refund.recordedAt);
  await expect(page.getByTestId("return-details")).toContainText(cairoRecordedAt);

  await page.goto(`http://127.0.0.1:5174/returns?returnId=${paidReturn.id}`);
  await expect(page.getByTestId("return-details")).toContainText(deliveredForRefund.reference);
  await expect(page.getByTestId("return-details")).toContainText("دُفع 290 ج.م. فعلياً");
});

async function signInManager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
}

async function seedProduct(page: Page, nameAr: string, pricePiasters: number, quantity: number) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `ONRET-${suffix}`,
    nameAr,
    descriptionAr: "تدفق مرتجع طلب أونلاين مُسلّم",
    categoryId: category.body.id,
    defaultSellingPricePiasters: pricePiasters,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  const branchId = await activeBranchId(page);
  expect((await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    branchId,
    lines: [{ variantId, quantity, unitCostPiasters: 10_000 }],
  })).status).toBe(201);
  return { variantId };
}

async function submitConfirmAndDeliver(page: Page, deliveryAreaId: string, variantId: string, quantity: number) {
  const branchId = await activeBranchId(page);
  const quote = await publicApi(page, "POST", "/api/public/checkout/quote", {
    deliveryAreaId,
    lines: [{ variantId, quantity }],
  });
  const submitted = await publicApi(page, "POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity }],
    customerName: "عميل مرتجع أونلاين",
    primaryPhone: "01012345678",
    detailedAddress: "شارع الجمهورية، الفيوم",
  });
  expect(submitted.status).toBe(201);
  const order = await staffApi(page, "GET", `/api/internal/online-orders/${submitted.body.orderId}`);
  const agreement = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/agreement-quotes`, {
    expectedRevision: order.body.revision,
    lines: [{ variantId, quantity }],
  });
  const agreed = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreement.body.orderRevision,
    quoteId: agreement.body.quoteId,
    reviewDigest: agreement.body.reviewDigest,
    customerAgreed: true,
  });
  const confirmed = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.agreedRevision.version,
    fulfillmentBranchId: branchId,
    itemsLocatedAndSetAside: true,
  });
  const shipped = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  await page.waitForTimeout(1_100);
  const customerReceivedAt = new Date().toISOString();
  const delivered = await staffApi(page, "POST", `/api/internal/online-orders/${submitted.body.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt,
  });
  expect(delivered.status, JSON.stringify({ customerReceivedAt, body: delivered.body })).toBe(201);
  return { orderId: submitted.body.orderId as string, reference: submitted.body.reference as string };
}

async function activeBranchId(page: Page): Promise<string> {
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  const branchId = workspace.body.activeBranch?.id as string | undefined;
  expect(branchId).toBeTruthy();
  return branchId!;
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  return api(page, method, url, payload, "http://127.0.0.1:5174");
}

async function publicApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  return api(page, method, url, payload, "http://127.0.0.1:3001");
}

async function api(page: Page, method: "GET" | "POST", url: string, payload: unknown, origin: string) {
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
