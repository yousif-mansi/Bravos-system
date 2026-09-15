import { expect, test, type Page } from "@playwright/test";

test("manager uses the separate Arabic Returns picker, posts inspection, and records cash payment", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

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
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-01",
    lines: [{ variantId, quantity: 2, unitCostPiasters: 40000 }],
  });
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
  const search = page.getByRole("form", { name: "البحث عن البيع الأصلي" });
  await search.getByLabel("المرجع").fill(original.body.id);
  await search.getByRole("button", { name: "بحث" }).click();
  const source = page.getByTestId("return-source-list").getByRole("button").filter({ hasText: original.body.id });
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

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
