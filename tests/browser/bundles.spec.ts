import { expect, test, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

test("manager maintains fixed bundles and Buy-X-Get-Y rules in the Arabic offer editor", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "حزم المتصفح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس حزم" });
  const firstColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون حزمة أول" });
  const secondColor = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون حزمة ثان" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "BUNDLE-E2E",
    nameAr: "منتج حزم المتصفح",
    descriptionAr: "اختبار محرر الحزم والمكافآت",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20_000,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [
      { sizeId: size.body.id, colorId: firstColor.body.id, sellingPricePiastersOverride: 10_000 },
      { sizeId: size.body.id, colorId: secondColor.body.id, sellingPricePiastersOverride: 20_000 },
    ],
  });
  expect(product.status).toBe(201);
  const cheapVariant = product.body.variants.find((variant: { sellingPricePiasters: number }) =>
    variant.sellingPricePiasters === 10_000);
  const expensiveVariant = product.body.variants.find((variant: { sellingPricePiasters: number }) =>
    variant.sellingPricePiasters === 20_000);
  expect(cheapVariant).toBeTruthy();
  expect(expensiveVariant).toBeTruthy();

  await page.getByRole("link", { name: "العروض" }).click();
  const form = page.getByRole("form", { name: "إنشاء عرض تلقائي" });
  await form.getByLabel("اسم العرض").fill("حزمة المتصفح");
  await form.getByLabel("نوع الخصم").selectOption("fixed_bundle");
  await form.getByLabel("سعر الحزمة بالجنيه").fill("250");
  let rows = form.getByTestId("bundle-item-row");
  await rows.nth(0).getByLabel("المتغير").selectOption(cheapVariant.id);
  await rows.nth(0).getByLabel("الكمية").fill("2");
  await form.getByRole("button", { name: "إضافة متغير للحزمة" }).click();
  rows = form.getByTestId("bundle-item-row");
  await rows.nth(1).getByLabel("المتغير").selectOption(expensiveVariant.id);
  await rows.nth(1).getByLabel("الكمية").fill("1");
  await form.getByRole("checkbox", { name: "مفعل", exact: true }).check();
  await form.getByRole("button", { name: "حفظ العرض" }).click();
  await expect(page.getByRole("status")).toContainText("تم إنشاء العرض.");
  const savedBundle = page.getByTestId("offer-row").filter({ hasText: "حزمة المتصفح" });
  await expect(savedBundle).toContainText("حزمة من 2 متغير — 250 ج.م.");
  await savedBundle.getByRole("button", { name: "تعديل" }).click();
  const editForm = page.getByRole("form", { name: "تعديل العرض التلقائي" });
  await expect(editForm.getByLabel("نوع الخصم")).toHaveValue("fixed_bundle");
  await editForm.getByLabel("سعر الحزمة بالجنيه").fill("260");
  const cheapBundleRow = editForm.getByTestId("bundle-item-row").filter({
    has: page.locator(`option[value="${cheapVariant.id}"]:checked`),
  });
  await expect(cheapBundleRow).toHaveCount(1);
  await cheapBundleRow.getByLabel("الكمية").fill("3");
  await editForm.getByRole("button", { name: "حفظ العرض" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث العرض.");
  await expect(page.getByTestId("offer-row").filter({ hasText: "حزمة المتصفح" })).toContainText("حزمة من 2 متغير — 260 ج.م.");

  const freshForm = page.getByRole("form", { name: "إنشاء عرض تلقائي" });
  await freshForm.getByLabel("اسم العرض").fill("مكافأة المتصفح");
  await freshForm.getByLabel("نوع الخصم").selectOption("buy_x_get_y");
  await freshForm.getByLabel("عدد وحدات الشراء").fill("2");
  await freshForm.getByLabel("عدد وحدات المكافأة").fill("1");
  await freshForm.getByLabel("نسبة خصم المكافأة").fill("50");
  await freshForm.getByRole("group", { name: "منتجات الشراء" }).getByRole("checkbox", { name: /BUNDLE-E2E/ }).check();
  await freshForm.getByRole("group", { name: "منتجات المكافأة" }).getByRole("checkbox", { name: /BUNDLE-E2E/ }).check();
  await freshForm.getByRole("checkbox", { name: "مفعل", exact: true }).check();
  await freshForm.getByRole("button", { name: "حفظ العرض" }).click();
  await expect(page.getByTestId("offer-row").filter({ hasText: "مكافأة المتصفح" })).toContainText("اشترِ 2 وخذ 1 بخصم 50٪");

  const received = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json()).activeBranch.id,
    receiptDate: "2026-09-15",
    lines: product.body.variants.map((variant: { id: string }) => ({
      variantId: variant.id,
      quantity: 5,
      unitCostPiasters: 5000,
    })),
  });
  expect(received.status).toBe(201);

  await page.getByRole("link", { name: "مساحة العمل" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("BUNDLE-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption(cheapVariant.size.id);
  await page.getByLabel("اللون").selectOption(cheapVariant.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await page.getByLabel("اللون").selectOption(expensiveVariant.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();

  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("الكمية").nth(0).fill("3");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toContainText("العرض التلقائي: حزمة المتصفح");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 260 ج.م.");

  await checkout.getByRole("button", { name: "إلغاء عرض السعر" }).click();
  await checkout.getByLabel("الكمية").nth(0).fill("2");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toContainText("العرض التلقائي: مكافأة المتصفح");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 350 ج.م.");
});

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function staffApi(page: Page, method: "POST", url: string, payload: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", "content-type": "application/json" },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
