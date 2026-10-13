import { expect, test, type Page } from "@playwright/test";

test("manager corrects a posted Return in Arabic and the Returns payment uses the effective amount", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تصحيحات المتصفح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تصحيح المتصفح" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تصحيح المتصفح" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `COR-E2E-${crypto.randomUUID().slice(0, 6)}`,
    nameAr: "قطعة تصحيح الإرجاع",
    descriptionAr: "اختبار تصحيح التسجيل",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 10000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: workspace.body.activeBranch.id,
    receiptDate: "2026-09-01",
    lines: [{ variantId, quantity: 1, unitCostPiasters: 5000 }],
  });
  const sale = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  const source = (await staffApi(page, "GET", `/api/internal/returns/sources?reference=${sale.body.id}`)).body[0];
  const draft = await staffApi(page, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: source.originalBranch.id,
    authorizedRefundPiasters: 10000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await staffApi(page, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });

  await page.getByRole("link", { name: "تصحيح التسجيلات" }).click();
  await expect(page.getByRole("heading", { name: "تصحيح التسجيلات" })).toBeVisible();
  const openForm = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await openForm.getByLabel("نوع التسجيل").selectOption("return");
  await openForm.getByLabel("مرجع التسجيل").fill(draft.body.id);
  await openForm.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("correction-details")).toContainText("100 ج.م.");

  const correctionForm = page.getByRole("form", { name: "تصحيح أو إلغاء تسجيل" });
  await correctionForm.getByLabel("الإجراء").selectOption("cancellation");
  await expect(correctionForm).toContainText("الإلغاء وحده لا يعيد بضاعة إلى المخزون ولا يسجل دفعاً أو استرداداً للنقد");
  await correctionForm.getByLabel("الإجراء").selectOption("correction");
  await correctionForm.getByLabel("الاسترداد المعتمد المصحح بالجنيه").fill("80");
  await correctionForm.getByLabel("سبب التصحيح").fill("القيمة المعتمدة الصحيحة ثمانون جنيهاً");
  await correctionForm.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصحيح");
  await expect(page.getByTestId("correction-details")).toContainText("80 ج.م.");
  await expect(page.getByTestId("correction-details")).toContainText("القيمة المعتمدة الصحيحة ثمانون جنيهاً");

  await page.getByRole("link", { name: "مساحة العمل" }).click();
  await page.getByRole("link", { name: "المرتجعات" }).click();
  await page.locator(".return-history").getByRole("button", { name: new RegExp(draft.body.reference) }).click();
  const details = page.getByTestId("return-details");
  await expect(details).toContainText("المعتمد حالياً: 80 ج.م.");
  await expect(details).toContainText("المعتمد الأصلي المحفوظ: 100 ج.م.");
  await expect(details).toContainText("المتبقي للدفع: 80 ج.م.");
  await details.getByRole("button", { name: "تسجيل دفع 80 ج.م." }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل دفع الاسترداد النقدي");
  await expect(details).toContainText("دُفع 80 ج.م. فعلياً");
});

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  const text = await response.text();
  expect(response.status(), `${method} ${url} ${text}`).toBeLessThan(400);
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}
