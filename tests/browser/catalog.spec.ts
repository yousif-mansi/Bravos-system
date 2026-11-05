import { expect, test, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

test("manager maintains a product and cashier looks it up by code", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await page.locator("summary").filter({ hasText: "تجهيز التصنيف" }).click();
  const categoryForm = page.getByRole("form", { name: "إضافة تصنيف للمخزون" });
  await categoryForm.getByLabel("تصنيف جديد").fill("تيشيرتات");
  await categoryForm.getByRole("button", { name: "إضافة التصنيف" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصنيف");
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  expect(color.status).toBe(201);
  await page.getByRole("button", { name: "إضافة منتج جديد" }).click();
  const intake = page.getByRole("form", { name: "إضافة منتج إلى المخزون" });
  await intake.getByLabel("رمز المنتج / SKU").fill("TS-E2E");
  await intake.getByLabel("اسم المنتج").fill("تيشيرت تجريبي");
  await intake.getByLabel("التصنيف").selectOption({ label: "تيشيرتات" });
  await intake.getByLabel("سعر البيع الافتراضي بالجنيه").fill("250");
  await intake.getByLabel("الكمية").fill("3");
  await intake.getByLabel("تكلفة الشراء بالجنيه").fill("100");
  await intake.getByRole("button", { name: "حفظ المنتج وإضافته إلى الإذن" }).click();
  await expect(intake).toHaveCount(0);
  await page.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ إذن الاستلام." })).toBeVisible();
  const receivedProduct = await seedHiddenWebsiteOption(page, "TS-E2E", "L", "أسود");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  const transfer = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: "33333333-3333-4333-8333-333333333333",
    destinationBranchId: workspace.body.activeBranch.id,
    productId: receivedProduct.id,
    quantity: 3,
  });
  expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page.getByRole("heading", { name: "المنتجات" }).locator("..").getByText("تيشيرت تجريبي", { exact: true })).toBeVisible();
  await expect(page.getByText("رمز المنتج: TS-E2E", { exact: false })).toBeVisible();
  await page.getByLabel("رمز المنتج", { exact: true }).first().fill("TS-E");
  await page.getByLabel("رمز المنتج", { exact: true }).first().fill("TS-E2E");
  await page.getByRole("button", { name: "عرض المنتج" }).click();
  const productForm = page.getByRole("form", { name: "تعديل منتج" });
  await expect(productForm).toBeVisible();
  await expect(productForm.getByRole("checkbox", { name: "عرض هذه التركيبة" })).not.toBeChecked();
  await productForm.getByRole("checkbox", { name: "عرض هذه التركيبة" }).check();
  await productForm.getByLabel("حالة الموقع").selectOption("available");
  await productForm.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");

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
  await expect(page.getByTestId("selected-variant")).toContainText("سعر البيع: 250 ج.م.");
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة في الفرع: 3");
  await expect(page.getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
});

test("manager renames taxonomy, selects an inventory SKU, and keeps existing image references", async ({
  page,
}, testInfo) => {
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

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await page.getByRole("button", { name: "إضافة منتج جديد" }).click();
  const intake = page.getByRole("form", { name: "إضافة منتج إلى المخزون" });
  await intake.getByLabel("رمز المنتج / SKU").fill("JK-E2E");
  await intake.getByLabel("اسم المنتج").fill("جاكيت تجريبي");
  await intake.getByLabel("التصنيف").selectOption({ label: "جاكيتات" });
  await intake.getByLabel("سعر البيع الافتراضي بالجنيه").fill("400");
  await intake.getByLabel("الكمية").fill("2");
  await intake.getByLabel("تكلفة الشراء بالجنيه").fill("180");
  await intake.getByRole("button", { name: "حفظ المنتج وإضافته إلى الإذن" }).click();
  await expect(intake).toHaveCount(0);
  await page.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ إذن الاستلام." })).toBeVisible();
  await seedHiddenWebsiteOption(page, "JK-E2E", "S", "أحمر");
  await page.getByRole("link", { name: "المنتجات" }).click();
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
  await expect(editForm.getByLabel("اللون", { exact: true }).locator("option:checked")).toHaveText("نبيتي");
  await editForm.getByRole("checkbox", { name: "عرض هذه التركيبة" }).uncheck();
  await editForm.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");

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
    variants: product.variants.map((variant: { size: { id: string }; color: { id: string }; onlineVisible: boolean; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      onlineVisible: variant.onlineVisible,
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
    onlineVisible: false,
  });

  await sizeForm.getByLabel("اسم المقاس").fill("XL");
  await sizeForm.getByRole("button", { name: "حفظ المقاس" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المقاس.");
  await page.locator("article.staff-item").filter({ hasText: "جاكيت تجريبي" }).getByRole("button", { name: "تعديل" }).click();
  const configureOptions = page.getByRole("form", { name: "تعديل منتج" });
  await configureOptions.getByRole("button", { name: "إضافة خيار للموقع" }).click();
  const draftOption = configureOptions.locator(".variant-row").last();
  await draftOption.getByLabel("المقاس", { exact: true }).selectOption({ label: "XL" });
  await draftOption.getByLabel("اللون", { exact: true }).selectOption({ label: "نبيتي" });
  await draftOption.getByRole("checkbox", { name: "عرض هذه التركيبة" }).uncheck();
  await configureOptions.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  const receive = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await receive.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await receive.getByLabel("المنتج", { exact: true }).selectOption({ label: "JK-E2E — جاكيت تجريبي" });
  await receive.getByLabel("الكمية").fill("4");
  await receive.getByLabel("تكلفة الشراء للجنيه").fill("180");
  await receive.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ إذن الاستلام." })).toBeVisible();
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 4 — تكلفة شراء الوحدة: 180 ج.م.");
  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByLabel("رمز المنتج", { exact: true }).first().fill("JK-E2E");
  await page.getByRole("button", { name: "عرض المنتج" }).click();
  const extendedForm = page.getByRole("form", { name: "تعديل منتج" });
  await expect(extendedForm.getByRole("checkbox", { name: "عرض هذه التركيبة" })).toHaveCount(2);
  const newPair = extendedForm.locator(".variant-row").filter({ has: page.locator('select[id^="variant-size-"] option:checked', { hasText: "XL" }) });
  await expect(newPair.getByRole("checkbox", { name: "عرض هذه التركيبة" })).not.toBeChecked();
  await newPair.getByRole("checkbox", { name: "عرض هذه التركيبة" }).check();
  await extendedForm.getByLabel("حالة الموقع").selectOption("available");
  const savedPublication = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "PATCH"
      && url.pathname === `/api/internal/catalog/products/${product.id}`;
  });
  await extendedForm.getByRole("button", { name: "حفظ التعديل" }).click();
  const saved = await savedPublication;
  const savedBody = await saved.json() as { publication?: string };
  expect(saved.status(), JSON.stringify(savedBody)).toBe(200);
  expect(savedBody.publication, JSON.stringify(savedBody)).toBe("available");
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");
  const published = await page.request.get(`http://127.0.0.1:5174/api/public/catalog/products/${product.id}`);
  expect(published.status()).toBe(200);
  const publishedBody = await published.json();
  expect(publishedBody.variants).toHaveLength(1);
  expect(publishedBody.variants[0].size.nameAr).toBe("XL");

  const parentCategoryId = after.body.category.id as string;
  const childCategory = await staffApi(page, "POST", "/api/internal/catalog/categories", {
    nameAr: "جاكيتات فرعية",
    parentId: parentCategoryId,
  });
  expect(childCategory.status).toBe(201);
  const childProduct = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "JK-CHILD-E2E",
    nameAr: "جاكيت فرعي",
    descriptionAr: "",
    categoryId: childCategory.body.id,
    defaultSellingPricePiasters: after.body.defaultSellingPricePiasters,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{
      sizeId: after.body.variants[0].size.id,
      colorId: after.body.variants[0].color.id,
      sellingPricePiastersOverride: null,
    }],
  });
  expect(childProduct.status).toBe(201);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "إدارة المنتجات" })).toBeVisible();
  const count = page.getByTestId("catalog-browse-count");
  await expect(count).toBeVisible();
  const unfiltered = (await count.innerText()).trim();
  const unfilteredMatch = unfiltered.match(/^المطابق: (\d+) من (\d+)$/);
  expect(unfilteredMatch?.[1]).toBe(unfilteredMatch?.[2]);
  const total = Number(unfilteredMatch?.[2]);
  expect(total).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("catalog-desktop-1440.png"), fullPage: true });

  const filters = page.getByTestId("catalog-browse-filters");
  const parentCard = page.locator("article.staff-item").filter({ hasText: "جاكيت تجريبي" });
  const childCard = page.locator("article.staff-item").filter({ hasText: "جاكيت فرعي" });
  await filters.locator("#catalog-browse-category").selectOption(parentCategoryId);
  await expect(parentCard).toBeVisible();
  await expect(childCard).toBeVisible();
  const parentMatch = (await count.innerText()).trim().match(/^المطابق: (\d+) من (\d+)$/);
  expect(parentMatch?.[2]).toBe(String(total));
  const parentMatched = Number(parentMatch?.[1]);
  expect(parentMatched).toBeGreaterThanOrEqual(2);
  expect(parentMatched).toBeLessThanOrEqual(total);

  await filters.locator("#catalog-browse-category").selectOption(childCategory.body.id as string);
  await expect(childCard).toBeVisible();
  await expect(parentCard).toHaveCount(0);
  const childMatch = (await count.innerText()).trim().match(/^المطابق: (\d+) من (\d+)$/);
  expect(childMatch?.[2]).toBe(String(total));
  const childMatched = Number(childMatch?.[1]);
  expect(childMatched).toBeGreaterThanOrEqual(1);
  expect(childMatched).toBeLessThan(parentMatched);

  await filters.getByRole("button", { name: "مسح التصفية" }).click();
  await expect(filters.locator("#catalog-browse-category")).toHaveValue("");
  await expect(filters.locator("#catalog-browse-query")).toHaveValue("");
  await expect(count).toHaveText(`المطابق: ${total} من ${total}`);

  await filters.locator("#catalog-browse-query").fill("JK-E2E");
  await expect(parentCard).toBeVisible();
  await expect(childCard).toHaveCount(0);
  await filters.locator("#catalog-browse-query").fill("جاكيت فرعي");
  await expect(childCard).toBeVisible();
  await expect(parentCard).toHaveCount(0);
  await filters.locator("#catalog-browse-query").fill("لا-يطابق-تصنيف-999");
  await expect(page.getByTestId("catalog-browse-empty")).toHaveText("لا توجد منتجات مطابقة.");
  await expect(count).toHaveText(`المطابق: 0 من ${total}`);

  await filters.getByRole("button", { name: "مسح التصفية" }).click();
  await parentCard.getByRole("button", { name: "تعديل" }).click();
  await expect(page.locator("#productCode")).toHaveValue("JK-E2E");
  await expect(page.locator("#productName")).toHaveValue("جاكيت تجريبي");
  await filters.locator("#catalog-browse-query").fill("JK-CHILD-E2E");
  await expect(parentCard).toHaveCount(0);
  await expect(page.locator("#productCode")).toHaveValue("JK-E2E");
  await expect(page.locator("#productName")).toHaveValue("جاكيت تجريبي");
});

test("bulk size and color visibility preserves sparse inventory pairs and POS availability", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await chooseAbshway(page);

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تركيبات متفرقة" });
  const medium = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "متوسط متفرق" });
  const large = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "كبير متفرق" });
  const red = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أحمر متفرق" });
  const blue = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أزرق متفرق" });
  const created = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "SPARSE-E2E",
    nameAr: "منتج التركيبات المتفرقة",
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "available",
    imageRefs: [],
    variants: [
      { sizeId: medium.body.id, colorId: red.body.id, onlineVisible: false, sellingPricePiastersOverride: null },
      { sizeId: medium.body.id, colorId: blue.body.id, onlineVisible: false, sellingPricePiastersOverride: null },
      { sizeId: large.body.id, colorId: red.body.id, onlineVisible: false, sellingPricePiastersOverride: null },
    ],
  });
  expect(created.status).toBe(201);
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: workspace.body.activeBranch.id,
    receiptDate: "2026-09-15",
    lines: created.body.variants.map((variant: { id: string }) => ({ variantId: variant.id, quantity: 2, unitCostPiasters: 10000 })),
  });
  expect(received.status).toBe(201);

  await page.getByRole("link", { name: "المنتجات" }).click();
  await page.getByLabel("رمز المنتج", { exact: true }).first().fill("SPARSE-E2E");
  await page.getByRole("button", { name: "عرض المنتج" }).click();
  const form = page.getByRole("form", { name: "تعديل منتج" });
  await form.locator("summary").filter({ hasText: "تحديد جماعي حسب المقاس أو اللون" }).click();
  const sizeChoices = form.getByRole("group", { name: "المقاسات المعروضة على الموقع", exact: true });
  const colorChoices = form.getByRole("group", { name: "الألوان المعروضة على الموقع", exact: true });
  const pairs = form.getByRole("checkbox", { name: "عرض هذه التركيبة" });
  await expect(pairs).toHaveCount(3);
  await sizeChoices.getByRole("checkbox", { name: /متوسط متفرق/ }).check();
  await expect(sizeChoices.getByRole("checkbox", { name: /متوسط متفرق/ })).toHaveAccessibleName("متوسط متفرق (2/2)");
  await colorChoices.getByRole("checkbox", { name: /أحمر متفرق/ }).check();
  await expect(colorChoices.getByRole("checkbox", { name: /أحمر متفرق/ })).toHaveAccessibleName("أحمر متفرق (2/2)");
  await sizeChoices.getByRole("checkbox", { name: /متوسط متفرق/ }).uncheck();
  await colorChoices.getByRole("checkbox", { name: /أزرق متفرق/ }).check();
  await expect(pairs).toHaveCount(3);
  await form.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث المنتج.");

  const after = await staffApi(page, "GET", `/api/internal/catalog/products/${created.body.id}`);
  expect(after.status).toBe(200);
  type Pair = { id: string; size: { id: string }; color: { id: string }; onlineVisible: boolean };
  const identities = (variants: Pair[]) => variants.map((variant) => `${variant.id}:${variant.size.id}:${variant.color.id}`).sort();
  expect(identities(after.body.variants)).toEqual(identities(created.body.variants));
  expect(after.body.variants.filter((variant: Pair) => variant.onlineVisible).map((variant: Pair) => `${variant.size.id}:${variant.color.id}`).sort()).toEqual([
    `${medium.body.id}:${blue.body.id}`, `${large.body.id}:${red.body.id}`,
  ].sort());
  const published = await page.request.get(`http://127.0.0.1:5174/api/public/catalog/products/${created.body.id}`);
  expect(published.status()).toBe(200);
  expect((await published.json()).variants).toHaveLength(2);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await chooseAbshway(page);
  const lookup = await staffApi(page, "GET", "/api/internal/catalog/lookup?code=SPARSE-E2E");
  expect(lookup.status).toBe(200);
  expect(lookup.body.variants.map((variant: { id: string }) => variant.id).sort()).toEqual(created.body.variants.map((variant: { id: string }) => variant.id).sort());
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookupForm = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookupForm.getByRole("textbox", { name: "رمز المنتج" }).fill("SPARSE-E2E");
  await lookupForm.getByRole("button", { name: "بحث" }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس", { exact: true }).selectOption({ label: "متوسط متفرق" });
  await page.getByLabel("اللون", { exact: true }).selectOption({ label: "أحمر متفرق" });
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 2");
});

// selectActiveBranch returns WorkspaceDto. activeBranch is { id, code, nameAr } once the session branch is stored.
async function chooseAbshway(page: Page) {
  const selected = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/internal/active-branch";
  });
  await page.getByRole("button", { name: "أبشواي" }).click();
  const response = await selected;
  const body = await response.json() as { activeBranch?: { id?: string; code?: string; nameAr?: string } | null };
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.activeBranch, JSON.stringify(body)).toEqual({
    id: expect.any(String),
    code: "abshway",
    nameAr: "أبشواي",
  });
  await expect(page.getByTestId("active-branch")).toHaveText("أبشواي");
}

async function seedHiddenWebsiteOption(page: Page, code: string, sizeName: string, colorName: string) {
  const [products, sizes, colors] = await Promise.all([
    staffApi(page, "GET", "/api/internal/catalog/products"),
    staffApi(page, "GET", "/api/internal/catalog/sizes"),
    staffApi(page, "GET", "/api/internal/catalog/colors"),
  ]);
  expect(products.status).toBe(200);
  expect(sizes.status).toBe(200);
  expect(colors.status).toBe(200);
  const product = products.body.find((item: { code: string }) => item.code === code);
  const size = sizes.body.find((item: { nameAr: string }) => item.nameAr === sizeName);
  const color = colors.body.find((item: { nameAr: string }) => item.nameAr === colorName);
  expect(product).toBeTruthy();
  expect(size).toBeTruthy();
  expect(color).toBeTruthy();
  const seeded = await staffApi(page, "PATCH", `/api/internal/catalog/products/${product.id}`, {
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    categoryId: product.category.id,
    defaultSellingPricePiasters: product.defaultSellingPricePiasters,
    publication: product.publication,
    imageRefs: product.imageRefs,
    variants: [{ sizeId: size.id, colorId: color.id, onlineVisible: false }],
  });
  expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
  return seeded.body;
}

async function staffApi(page: Page, method: "GET" | "PATCH" | "POST", url: string, payload?: unknown) {
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
