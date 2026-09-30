import { expect, test, type Page } from "@playwright/test";

test("manager uses the separate Arabic Returns picker, posts inspection, and records cash payment", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "مرتجعات المتصفح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "L إرجاع" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "كحلي إرجاع" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "RET-E2E",
    nameAr: "قميص إرجاع المتصفح",
    descriptionAr: "تدفق إرجاع حقيقي",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 85000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-01",
    branchId,
    lines: [{ variantId, quantity: 2, unitCostPiasters: 40000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const original = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(original.status).toBe(201);

  await page.getByRole("link", { name: "المرتجعات" }).click();
  await expect(page.getByRole("heading", { name: "المرتجعات", exact: true })).toBeVisible();
  await expect(page.getByTestId("return-handling-branch")).toContainText("أبشواي");
  const search = page.getByRole("form", { name: /البحث عن المعاملة الأصلية/ });
  await search.getByLabel("رقم الطلب").fill(original.body.reference);
  await search.getByRole("button", { name: "بحث" }).click();
  const source = page.getByTestId("return-source-list").getByRole("button").filter({ hasText: original.body.reference });
  await expect(source).toHaveCount(1);
  await expect(source).toContainText("قميص إرجاع المتصفح");
  await source.click();

  const draftForm = page.getByRole("form", { name: "إنشاء مسودة إرجاع" });
  await draftForm.getByLabel("الكمية المستلمة").fill("1");
  await draftForm.getByLabel("منها قابلة للبيع بعد الفحص").fill("1");
  await expect(page.getByTestId("refund-suggestion")).toContainText("850 ج.م.");
  await draftForm.getByLabel("قيمة الاسترداد المعتمدة بالجنيه").fill("800");
  await draftForm.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(page.getByRole("status")).toContainText("حُفظت المسودة دون تغيير المخزون أو النقد");
  await expect(page.getByTestId("return-details")).toContainText("800 ج.م.");
  await expect(page.getByTestId("return-details")).toContainText("المسودة لا تنشئ التزاماً نقدياً");
  const afterDraft = await staffApi(page, "GET", "/api/internal/inventory/batches");
  expect(afterDraft.body.find((batch: { variantId: string }) => batch.variantId === variantId).remainingQuantity).toBe(1);

  await page.getByRole("button", { name: "تعديل المسودة" }).click();
  const editForm = page.getByRole("form", { name: "تعديل مسودة إرجاع" });
  await editForm.getByLabel("قيمة الاسترداد المعتمدة بالجنيه").fill("810");
  await editForm.getByRole("button", { name: "حفظ التعديلات" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المسودة دون تغيير المخزون أو النقد");
  await expect(page.getByTestId("return-details")).toContainText("810 ج.م.");
  expect((await staffApi(page, "GET", "/api/internal/inventory/batches")).body).toEqual(afterDraft.body);

  await page.getByRole("button", { name: "تأكيد الاستلام والفحص وترحيل الإرجاع" }).click();
  await expect(page.getByRole("status")).toContainText("تم ترحيل الإرجاع");
  await expect(page.getByTestId("return-details")).toContainText("الاسترداد النقدي مستحق");
  const afterPost = await staffApi(page, "GET", "/api/internal/inventory/batches");
  expect(afterPost.body.find((batch: { variantId: string }) => batch.variantId === variantId).remainingQuantity).toBe(2);

  await page.getByRole("button", { name: "تسجيل دفع 810 ج.م." }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل دفع الاسترداد النقدي");
  await expect(page.getByTestId("return-details")).toContainText("دُفع 810 ج.م.");
});

test("manager completes an exchange from Return details and sees only the actual cash difference", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "استبدال المتصفح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "L استبدال" });
  const originalColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أصلي استبدال" });
  const replacementColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "بديل استبدال" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "EXC-E2E",
    nameAr: "قميص استبدال المتصفح",
    descriptionAr: "تدفق استبدال حقيقي",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 28000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: size.body.id, colorId: originalColor.body.id, sellingPricePiastersOverride: 28000 },
      { sizeId: size.body.id, colorId: replacementColor.body.id, sellingPricePiastersOverride: 40000 },
    ],
  });
  const originalVariantId = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 28000).id;
  const replacementVariantId = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 40000).id;
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), receiptDate: "2026-09-01", branchId,
    lines: [
      { variantId: originalVariantId, quantity: 1, unitCostPiasters: 10000 },
      { variantId: replacementVariantId, quantity: 1, unitCostPiasters: 15000 },
    ],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const original = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    employeeDiscountPiasters: 0, lines: [{ variantId: originalVariantId, quantity: 1 }],
  });
  expect(original.status, JSON.stringify(original.body)).toBe(201);
  await staffApi(page, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض استبدال المتصفح",
    discountType: "percentage",
    percentageBasisPoints: 2000,
    fixedDiscountPiasters: null,
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    active: true,
    allowCoupon: true,
    productIds: [product.body.id],
    categoryIds: [],
  });
  const source = (await staffApi(page, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  const drafted = await staffApi(page, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: branchId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(drafted.status).toBe(201);

  await page.getByRole("link", { name: "المرتجعات" }).click();
  await page.locator(".return-history").getByRole("button", { name: new RegExp(drafted.body.reference) }).click();
  const exchangeForm = page.getByRole("form", { name: "إتمام استبدال" });
  await exchangeForm.getByLabel("صنف الاستبدال").selectOption(originalVariantId);
  await exchangeForm.getByRole("button", { name: "إضافة إلى سلة الاستبدال" }).click();
  const basket = exchangeForm.getByRole("list", { name: "أصناف سلة الاستبدال" });
  await expect(basket).toContainText("أصلي استبدال");
  await basket.getByRole("button", { name: "حذف" }).click();
  await expect(basket).not.toBeVisible();
  await exchangeForm.getByLabel("صنف الاستبدال").selectOption(replacementVariantId);
  await exchangeForm.getByLabel("كمية الاستبدال").fill("1");
  await exchangeForm.getByRole("button", { name: "إضافة إلى سلة الاستبدال" }).click();
  await exchangeForm.getByRole("button", { name: "عرض السعر والفرق" }).click();
  const quote = page.getByTestId("exchange-quote");
  await expect(quote).toContainText("320 ج.م.");
  await expect(quote).toContainText("280 ج.م.");
  await expect(quote).toContainText("40 ج.م.");
  const exchangeResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && /\/api\/internal\/returns\/[^/]+\/exchange$/.test(new URL(response.url()).pathname));
  await exchangeForm.getByRole("button", { name: "تأكيد الاستبدال بعد مراجعة فرق النقد" }).click();
  const exchanged = await (await exchangeResponse).json();

  await expect(page.getByRole("status")).toContainText("تم إتمام الاستبدال");
  const details = page.getByTestId("exchange-details");
  await expect(details).toContainText("320 ج.م.");
  await expect(details).toContainText("280 ج.م.");
  await expect(details).toContainText("40 ج.م.");
  const replacementSaleId = exchanged.exchange.replacementSaleId as string;
  const replacementSale = await staffApi(page, "GET", `/api/internal/sales/${replacementSaleId}`);
  expect(replacementSale.body).toMatchObject({ finalTotalPiasters: 32000, exchangeCreditAppliedPiasters: 28000, cashReceivedPiasters: 4000 });
});

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
