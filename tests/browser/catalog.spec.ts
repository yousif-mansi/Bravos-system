import { expect, test, type Page } from "@playwright/test";

test("manager maintains a product and cashier looks it up by code", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();

  const categoryForm = page.getByRole("form", { name: "إضافة تصنيف" });
  await categoryForm.getByLabel("اسم التصنيف").fill("تيشيرتات");
  await categoryForm.getByRole("button", { name: "حفظ التصنيف" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصنيف.");

  const sizeForm = page.getByRole("form", { name: "إضافة مقاس" });
  await sizeForm.getByLabel("اسم المقاس").fill("L");
  await sizeForm.getByRole("button", { name: "حفظ المقاس" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المقاس.");

  const colorForm = page.getByRole("form", { name: "إضافة لون" });
  await colorForm.getByLabel("اسم اللون").fill("أسود");
  await colorForm.getByRole("button", { name: "حفظ اللون" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ اللون.");

  const productForm = page.getByRole("form", { name: "إنشاء منتج" });
  await productForm.getByLabel("رمز المنتج").fill("TS-E2E");
  await productForm.getByLabel("اسم المنتج").fill("تيشيرت تجريبي");
  await productForm.getByLabel("الوصف").fill("قطن");
  await productForm.getByLabel("التصنيف").selectOption({ label: "تيشيرتات" });
  await productForm.getByLabel("سعر البيع الافتراضي بالجنيه").fill("250");
  await productForm.getByLabel("حالة الموقع").selectOption("hidden");
  await productForm.getByLabel("المقاس", { exact: true }).selectOption({ label: "L" });
  await productForm.getByLabel("اللون").selectOption({ label: "أسود" });
  await productForm.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(page.getByRole("heading", { name: "المنتجات" }).locator("..").getByText("تيشيرت تجريبي", { exact: true })).toBeVisible();
  await expect(page.getByText("رمز المنتج: TS-E2E", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("link", { name: "المنتجات" })).toHaveCount(0);
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  const lookupForm = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookupForm.getByRole("textbox", { name: "رمز المنتج" }).fill("TS-E2E");
  await lookupForm.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText("تيشيرت تجريبي");
  await page.getByLabel("المقاس").selectOption({ label: "L" });
  await page.getByLabel("اللون").selectOption({ label: "أسود" });
  await expect(page.getByTestId("selected-variant")).toContainText("سعر البيع: 250 ج.م.");
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 0");
  await expect(page.getByText("غير متوفر في المخزون حتى يتم الاستلام.")).toBeVisible();
  await expect(page.getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
});

test("manager renames taxonomy, removes a draft variant, and keeps existing image references", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();

  const categoryForm = page.getByRole("form", { name: "إضافة تصنيف" });
  await categoryForm.getByLabel("اسم التصنيف").fill("جاكيتات");
  await categoryForm.getByRole("button", { name: "حفظ التصنيف" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصنيف.");

  const sizeForm = page.getByRole("form", { name: "إضافة مقاس" });
  await sizeForm.getByLabel("اسم المقاس").fill("S");
  await sizeForm.getByRole("button", { name: "حفظ المقاس" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المقاس.");

  const colorForm = page.getByRole("form", { name: "إضافة لون" });
  await colorForm.getByLabel("اسم اللون").fill("أحمر");
  await colorForm.getByRole("button", { name: "حفظ اللون" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ اللون.");

  const createForm = page.getByRole("form", { name: "إنشاء منتج" });
  await createForm.getByRole("button", { name: "إضافة متغير" }).click();
  await expect(createForm.getByLabel("المقاس", { exact: true })).toHaveCount(2);
  await createForm.getByRole("button", { name: "حذف المتغير" }).nth(1).click();
  await expect(createForm.getByLabel("المقاس", { exact: true })).toHaveCount(1);
  await expect(createForm.getByRole("button", { name: "حذف المتغير" })).toBeDisabled();
  await createForm.getByLabel("رمز المنتج").fill("JK-E2E");
  await createForm.getByLabel("اسم المنتج").fill("جاكيت تجريبي");
  await createForm.getByLabel("الوصف").fill("صوف");
  await createForm.getByLabel("التصنيف").selectOption({ label: "جاكيتات" });
  await createForm.getByLabel("سعر البيع الافتراضي بالجنيه").fill("400");
  await createForm.getByLabel("المقاس", { exact: true }).selectOption({ label: "S" });
  await createForm.getByLabel("اللون").selectOption({ label: "أحمر" });
  await createForm.getByRole("button", { name: "حفظ المنتج" }).click();
  await expect(page.getByRole("heading", { name: "المنتجات" }).locator("..").getByText("جاكيت تجريبي", { exact: true })).toBeVisible();

  const renameCategory = page.getByRole("form", { name: "تعديل التصنيف جاكيتات" });
  await renameCategory.getByLabel("اسم التصنيف").fill("معاطف");
  await renameCategory.getByRole("button", { name: "حفظ الاسم" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث التصنيف.");

  const renameSize = page.getByRole("form", { name: "تعديل المقاس S" });
  await renameSize.getByLabel("اسم المقاس").fill("XS");
  await renameSize.getByRole("button", { name: "حفظ الاسم" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المقاس.");

  const renameColor = page.getByRole("form", { name: "تعديل اللون أحمر" });
  await renameColor.getByLabel("اسم اللون").fill("نبيتي");
  await renameColor.getByRole("button", { name: "حفظ الاسم" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث اللون.");

  const productCard = page.locator("article.staff-item").filter({ hasText: "جاكيت تجريبي" });
  await expect(productCard.getByText("رمز المنتج: JK-E2E — معاطف")).toBeVisible();
  await expect(productCard.getByText("XS / نبيتي", { exact: false })).toBeVisible();

  await productCard.getByRole("button", { name: "تعديل" }).click();
  const editForm = page.getByRole("form", { name: "تعديل منتج" });
  await expect(editForm.getByLabel("التصنيف").locator("option:checked")).toHaveText("معاطف");
  await expect(editForm.getByLabel("المقاس", { exact: true }).locator("option:checked")).toHaveText("XS");
  await expect(editForm.getByLabel("اللون").locator("option:checked")).toHaveText("نبيتي");
  await editForm.getByRole("button", { name: "إضافة متغير" }).click();
  await expect(editForm.getByLabel("المقاس", { exact: true })).toHaveCount(2);
  await editForm.getByRole("button", { name: "حذف المتغير" }).nth(1).click();
  await expect(editForm.getByLabel("المقاس", { exact: true })).toHaveCount(1);

  const listed = await staffApi(page, "GET", "/api/internal/catalog/products");
  expect(listed.status).toBe(200);
  const product = listed.body.find((item: { code: string }) => item.code === "JK-E2E");
  expect(product).toBeTruthy();
  const seeded = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, {
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    categoryId: product.category.id,
    defaultSellingPricePiasters: product.defaultSellingPricePiasters,
    publication: product.publication,
    imageRefs: ["products/jk-e2e.jpg"],
    variants: product.variants.map((variant: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(seeded.status).toBe(200);
  expect(seeded.body.imageRefs).toEqual(["products/jk-e2e.jpg"]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();
  const reloadedCard = page.locator("article.staff-item").filter({ hasText: "جاكيت تجريبي" });
  await reloadedCard.getByRole("button", { name: "تعديل" }).click();
  const reloadedForm = page.getByRole("form", { name: "تعديل منتج" });
  await reloadedForm.getByLabel("الوصف").fill("صوف ثقيل");
  await reloadedForm.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");

  const after = await staffApi(page, "GET", `/api/internal/catalog/products/${product.id}`);
  expect(after.status).toBe(200);
  expect(after.body.descriptionAr).toBe("صوف ثقيل");
  expect(after.body.imageRefs).toEqual(["products/jk-e2e.jpg"]);
  expect(after.body.category.nameAr).toBe("معاطف");
  expect(after.body.variants).toHaveLength(1);
  expect(after.body.variants[0]).toMatchObject({
    size: { nameAr: "XS" },
    color: { nameAr: "نبيتي" },
  });
});

async function staffApi(page: Page, method: "GET" | "PATCH", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  return {
    status: response.status(),
    body: await response.json(),
  };
}
