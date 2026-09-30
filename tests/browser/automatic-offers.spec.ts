import { expect, test, type Page } from "@playwright/test";

test("manager creates an offer and the connected cashier keeps its accepted value through completion", async ({
  browser,
  page,
}) => {
  await signIn(page, "owner", "e2e-owner-pass");

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", {
    nameAr: "عروض متصفح تلقائية",
  });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس عرض متصفح" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون عرض متصفح" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "OFFER-E2E",
    nameAr: "منتج عرض متصفح",
    descriptionAr: "اختبار العرض المتصل",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const receiving = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    receiptDate: cairoDate(),
    lines: [{ variantId: product.body.variants[0].id, quantity: 5, unitCostPiasters: 12000 }],
  });
  expect(receiving.status).toBe(201);

  await page.getByRole("link", { name: "العروض" }).click();
  await expect(page.getByRole("heading", { name: "العروض التلقائية" })).toBeVisible();
  const offerForm = page.getByRole("form", { name: "إنشاء عرض تلقائي" });
  await offerForm.getByLabel("اسم العرض").fill("خمسون جنيهاً للمتصفح");
  await offerForm.getByLabel("نوع الخصم").selectOption("fixed");
  await offerForm.getByLabel("الخصم بالجنيه").fill("50");
  await offerForm.getByLabel("من تاريخ (القاهرة)").fill(cairoDate());
  await offerForm.getByLabel("إلى تاريخ (القاهرة)").fill(cairoDate());
  await offerForm.getByRole("checkbox", { name: /عروض متصفح تلقائية/ }).check();
  await offerForm.getByRole("checkbox", { name: "مفعل", exact: true }).check();
  await offerForm.getByRole("button", { name: "حفظ العرض" }).click();
  await expect(page.getByRole("status")).toContainText("تم إنشاء العرض.");
  await expect(page.getByTestId("offer-row").filter({ hasText: "خمسون جنيهاً للمتصفح" })).toContainText("50 ج.م.");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  await page.goto("http://127.0.0.1:5174/offers");
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("link", { name: "العروض" })).toHaveCount(0);

  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFFER-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس عرض متصفح" });
  await page.getByLabel("اللون").selectOption({ label: "لون عرض متصفح" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();

  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("الكمية").fill("2");
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("20");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  const quote = page.getByTestId("accepted-prices");
  await expect(quote).toContainText("الأصلي: 600 ج.م.");
  await expect(quote.getByTestId("automatic-offer-breakdown")).toContainText("خمسون جنيهاً للمتصفح — 50 ج.م.");
  await expect(quote).toContainText("خصم الموظف: 20 ج.م.");
  await expect(quote).toContainText("الإجمالي: 530 ج.م.");

  const managerContext = await browser.newContext({ locale: "ar-EG" });
  try {
    const managerPage = await managerContext.newPage();
    await signIn(managerPage, "owner", "e2e-owner-pass");
    await managerPage.getByRole("link", { name: "العروض" }).click();
    const offerRow = managerPage.getByTestId("offer-row").filter({ hasText: "خمسون جنيهاً للمتصفح" });
    await offerRow.getByRole("button", { name: "تعديل" }).click();
    const editForm = managerPage.getByRole("form", { name: "تعديل العرض التلقائي" });
    await editForm.getByLabel("الخصم بالجنيه").fill("100");
    await editForm.getByRole("button", { name: "حفظ العرض" }).click();
    await expect(managerPage.getByRole("status")).toContainText("تم تحديث العرض.");
  } finally {
    await managerContext.close();
  }

  await expect(quote.getByTestId("automatic-offer-breakdown")).toContainText("50 ج.م.");
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  const completed = page.getByTestId("sale-details");
  await expect(completed).toContainText("خمسون جنيهاً للمتصفح — 50 ج.م.");
  await expect(completed).toContainText("خصم الموظف: 20 ج.م.");
  await expect(completed).toContainText("الإجمالي: 530 ج.م.");
});

async function signIn(page: Page, loginName: string, password: string, navigate = true) {
  if (navigate) await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
