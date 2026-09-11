import { expect, test, type Page } from "@playwright/test";

test("manager receives separate cost batches and cashier sees central quantity without costs", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "بناطيل" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "32" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "رمادي" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "PT-E2E",
    nameAr: "بنطلون تجريبي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 40000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();

  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة صنف" }).click();
  const products = form.getByLabel("المنتج");
  const variants = form.getByLabel("المقاس واللون");
  const quantities = form.getByLabel("الكمية");
  const costs = form.getByLabel("تكلفة الشراء للجنيه");
  await products.nth(0).selectOption({ label: "PT-E2E — بنطلون تجريبي" });
  await variants.nth(0).selectOption({ label: "32 / رمادي" });
  await quantities.nth(0).fill("10");
  await costs.nth(0).fill("100");
  await products.nth(1).selectOption({ label: "PT-E2E — بنطلون تجريبي" });
  await variants.nth(1).selectOption({ label: "32 / رمادي" });
  await quantities.nth(1).fill("10");
  await costs.nth(1).fill("140");
  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  await expect(page.getByTestId("receipt-details")).toContainText("10 × 100 ج.م.");
  await expect(page.getByTestId("receipt-details")).toContainText("10 × 140 ج.م.");
  await expect(page.getByTestId("batch-list")).toContainText("تكلفة الشراء: 100 ج.م.");
  await expect(page.getByTestId("batch-list")).toContainText("تكلفة الشراء: 140 ج.م.");
  await expect(page.getByTestId("low-stock-list").getByText("PT-E2E")).toHaveCount(0);

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  expect(batches.body).toHaveLength(2);
  expect(batches.body.map((batch: { unitCostPiasters: number }) => batch.unitCostPiasters).sort((a: number, b: number) => a - b)).toEqual([
    10000, 14000,
  ]);
  expect(batches.body.every((batch: { variantId: string }) => batch.variantId === variantId)).toBe(true);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByRole("link", { name: "استلام المخزون" })).toHaveCount(0);
  await page.goto("http://127.0.0.1:5174/receiving");
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookupForm = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookupForm.getByRole("textbox", { name: "رمز المنتج" }).fill("PT-E2E");
  await lookupForm.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText("بنطلون تجريبي");
  await page.getByLabel("المقاس").selectOption({ label: "32" });
  await page.getByLabel("اللون").selectOption({ label: "رمادي" });
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 20");
  await expect(page.getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
});

test("lost receiving response retries the same operation without duplicating stock", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "أحذية" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "41" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "بني" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "SH-E2E",
    nameAr: "حذاء تجريبي",
    descriptionAr: "جلد",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 50000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "SH-E2E — حذاء تجريبي" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "41 / بني" });
  await form.getByLabel("الكمية").fill("5");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("80");

  const operationIds: string[] = [];
  let dropFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    if (dropFirst) {
      dropFirst = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await form.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  expect(operationIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(operationIds).size).toBe(1);

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  const received = batches.body.filter((batch: { variant: { product: { code: string } } }) => batch.variant.product.code === "SH-E2E");
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(5);
});

test("lost response then edit, reload and check result keep a single receiving effect", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "معاطف استلام" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "42R" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "زيتي استلام" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "CT-E2E",
    nameAr: "معطف تجريبي",
    descriptionAr: "صوف",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 60000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "CT-E2E — معطف تجريبي" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "42R / زيتي استلام" });
  await form.getByLabel("الكمية").fill("5");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("90");

  const operationIds: string[] = [];
  let dropFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string; lines: Array<{ quantity: number }> };
    operationIds.push(payload.operationId);
    expect(payload.lines[0]?.quantity).toBe(5);
    if (dropFirst) {
      dropFirst = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("pending-operation")).toBeVisible();
  await expect(form.getByLabel("الكمية")).toBeDisabled();
  await expect(form.getByLabel("تكلفة الشراء للجنيه")).toBeDisabled();
  await expect(form.getByLabel("الكمية")).toHaveValue("5");
  await expect(page.getByRole("button", { name: "التحقق من النتيجة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const checkResult = page.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(page.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(page.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await expect(page.getByTestId("receipt-details")).toContainText("5 × 90 ج.م.");

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  await expect(page.getByTestId("receipt-details")).toContainText("5 × 90 ج.م.");

  expect(new Set(operationIds).size).toBe(1);
  const receipts = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(200);
  const matching = receipts.body.filter((receipt: { lines: Array<{ variantId: string }> }) =>
    receipt.lines.some((line) => line.variantId === variantId),
  );
  expect(matching).toHaveLength(1);
  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantId);
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(5);
});

test("a rejected receiving operation keeps its identity and can be retried after correction", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "قبعات" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "واحد" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "بيج" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "HT-E2E",
    nameAr: "قبعة تجريبية",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 15000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "HT-E2E — قبعة تجريبية" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "واحد / بيج" });
  await form.getByLabel("الكمية").fill("2");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("40");

  const operationIds: string[] = [];
  let rejectFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    if (rejectFirst) {
      rejectFirst = false;
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "VALIDATION", messageAr: "الكمية غير صالحة." } }),
      });
      return;
    }
    await route.continue();
  });

  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toContainText("الكمية غير صالحة.");
  await expect(form.getByLabel("الكمية")).toBeEnabled();
  await form.getByLabel("الكمية").fill("3");
  await form.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  expect(operationIds).toHaveLength(2);
  expect(new Set(operationIds).size).toBe(1);

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variant: { product: { code: string } } }) => batch.variant.product.code === "HT-E2E");
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(3);
});

test("two synchronous submit events before digest settles keep one receiving effect", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "أحزمة مزدوجة" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "حزام" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "بني مزدوج" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "DS-E2E",
    nameAr: "حزام مزدوج",
    descriptionAr: "جلد",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 12000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "DS-E2E — حزام مزدوج" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "حزام / بني مزدوج" });
  await form.getByLabel("الكمية").fill("4");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("55");

  const operationIds: string[] = [];
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    await route.continue();
  });

  await page.evaluate(() => {
    const formElement = document.querySelector('form[aria-label="تسجيل إذن استلام"]');
    if (!(formElement instanceof HTMLFormElement)) {
      throw new Error("Receiving form is missing.");
    }
    formElement.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    formElement.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  expect(operationIds.length).toBeGreaterThanOrEqual(1);
  expect(new Set(operationIds).size).toBe(1);

  const receipts = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  const matching = receipts.body.filter((receipt: { lines: Array<{ variantId: string }> }) =>
    receipt.lines.some((line) => line.variantId === variantId),
  );
  expect(matching).toHaveLength(1);
  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantId);
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(4);
  expect(received[0].receivedQuantity).toBe(4);
});

test("lost request before send retries the same identity without duplicating stock", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "جوارب إرسال" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مراسل" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "رمادي إرسال" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "LB-E2E",
    nameAr: "جورب إرسال",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 8000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "LB-E2E — جورب إرسال" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "مراسل / رمادي إرسال" });
  await form.getByLabel("الكمية").fill("6");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("20");

  const operationIds: string[] = [];
  let dropFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    if (dropFirst) {
      dropFirst = false;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await form.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  expect(operationIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(operationIds).size).toBe(1);

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variant: { product: { code: string } } }) => batch.variant.product.code === "LB-E2E");
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(6);
});

test("pending receiving identity survives closing the page and reopening a fresh context page", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "أوشحة إغلاق" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "وشاح" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "كحلي إغلاق" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "CL-E2E",
    nameAr: "وشاح إغلاق",
    descriptionAr: "صوف",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 18000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "CL-E2E — وشاح إغلاق" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "وشاح / كحلي إغلاق" });
  await form.getByLabel("الكمية").fill("7");
  await form.getByLabel("تكلفة الشراء للجنيه").fill("30");

  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  });

  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const stored = await page.evaluate(() => {
    const values = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("bravos.receiving.pending.")) {
        values.push(localStorage.getItem(key));
      }
    }
    return values;
  });
  expect(stored.length).toBeGreaterThan(0);
  expect(JSON.stringify(stored)).not.toMatch(/unitCostPiasters|costEgp|purchase/i);

  await page.close();
  const next = await context.newPage();
  await next.goto("http://127.0.0.1:5174/receiving");
  await expect(next.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const checkResult = next.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(next.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(next.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await expect(next.getByTestId("receipt-details")).toContainText("7 × 30 ج.م.");

  const receipts = await staffApi(next, "GET", "/api/internal/receiving/receipts");
  const matching = receipts.body.filter((receipt: { lines: Array<{ variantId: string }> }) =>
    receipt.lines.some((line) => line.variantId === variantId),
  );
  expect(matching).toHaveLength(1);
  const batches = await staffApi(next, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantId);
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(7);
});

test("an already-open second tab cannot overwrite or clear another tab's uncertain receiving marker", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تبويب مزدوج" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "تبويب" });
  expect(size.status).toBe(201);
  const colorA = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أحمر تبويب" });
  expect(colorA.status).toBe(201);
  const colorB = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أزرق تبويب" });
  expect(colorB.status).toBe(201);
  const productA = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "TA-E2E",
    nameAr: "منتج التبويب أ",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 22000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: colorA.body.id, sellingPricePiastersOverride: null }],
  });
  expect(productA.status).toBe(201);
  const productB = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "TB-E2E",
    nameAr: "منتج التبويب ب",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 23000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: colorB.body.id, sellingPricePiastersOverride: null }],
  });
  expect(productB.status).toBe(201);
  const variantA = productA.body.variants[0].id;
  const variantB = productB.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();

  const formA = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await formA.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formA.getByLabel("المنتج").selectOption({ label: "TA-E2E — منتج التبويب أ" });
  await formA.getByLabel("المقاس واللون").selectOption({ label: "تبويب / أحمر تبويب" });
  await formA.getByLabel("الكمية").fill("5");
  await formA.getByLabel("تكلفة الشراء للجنيه").fill("70");

  const formB = pageB.getByRole("form", { name: "تسجيل إذن استلام" });
  await formB.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formB.getByLabel("المنتج").selectOption({ label: "TB-E2E — منتج التبويب ب" });
  await formB.getByLabel("المقاس واللون").selectOption({ label: "تبويب / أزرق تبويب" });
  await formB.getByLabel("الكمية").fill("8");
  await formB.getByLabel("تكلفة الشراء للجنيه").fill("80");

  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  });

  await formA.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const markerAfterA = await readPendingMarker(page);
  expect(markerAfterA?.operationId).toEqual(expect.any(String));

  await formB.getByRole("button", { name: /حفظ الاستلام|إعادة المحاولة/ }).click();
  await expect(pageB.getByRole("alert")).toContainText("توجد عملية استلام غير مؤكدة");

  await pageB.evaluate((wrongId) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("bravos.receiving.pending.")) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      const current = JSON.parse(raw) as { operationId?: string };
      if (current.operationId === wrongId) {
        localStorage.removeItem(key);
      }
    }
  }, crypto.randomUUID());

  const markerAfterB = await readPendingMarker(pageB);
  expect(markerAfterB?.operationId).toBe(markerAfterA?.operationId);
  expect(JSON.stringify(markerAfterB)).not.toMatch(/unitCostPiasters|costEgp|purchase/i);

  await page.close();
  await pageB.close();
  const reopened = await context.newPage();
  await reopened.goto("http://127.0.0.1:5174/receiving");
  await expect(reopened.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const checkResult = reopened.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(reopened.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(reopened.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await expect(reopened.getByTestId("receipt-details")).toContainText("5 × 70 ج.م.");

  const batches = await staffApi(reopened, "GET", "/api/internal/inventory/batches");
  const receivedA = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantA);
  const receivedB = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantB);
  expect(receivedA).toHaveLength(1);
  expect(receivedA[0].remainingQuantity).toBe(5);
  expect(receivedB).toHaveLength(0);
});

test("tab A keeps its frozen operation after tab B recovers and clears the shared marker", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تجميد محلي" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مجمد" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "ذهبي مجمد" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "FA-E2E",
    nameAr: "منتج التجميد",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 26000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();

  const formA = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await formA.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formA.getByLabel("المنتج").selectOption({ label: "FA-E2E — منتج التجميد" });
  await formA.getByLabel("المقاس واللون").selectOption({ label: "مجمد / ذهبي مجمد" });
  await formA.getByLabel("الكمية").fill("6");
  await formA.getByLabel("تكلفة الشراء للجنيه").fill("45");

  const operationIds: string[] = [];
  let dropFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    if (dropFirst) {
      dropFirst = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await formA.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(formA.getByLabel("الكمية")).toBeDisabled();
  const originalId = operationIds[0];
  expect(originalId).toEqual(expect.any(String));
  const markerKey = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("bravos.receiving.pending.")) {
        return key;
      }
    }
    return null;
  });
  expect(markerKey).toBeTruthy();

  const checkB = pageB.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkB).toBeVisible();
  await checkB.click();
  await expect(pageB.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");

  await pageB.evaluate((key) => {
    if (!key) {
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        operationId: "11111111-1111-4111-8111-111111111111",
        staffId: "foreign-staff",
        phase: "uncertain",
        digest: "ffffffffffffffff",
      }),
    );
  }, markerKey);

  await formA.getByRole("button", { name: /حفظ الاستلام|إعادة المحاولة/ }).click();
  await expect(page.getByRole("status")).toContainText(/تم حفظ إذن الاستلام|تم العثور على إذن الاستلام المحفوظ/);
  await expect(page.getByTestId("receipt-details")).toContainText("6 × 45 ج.م.");
  expect(new Set(operationIds).size).toBe(1);
  expect(operationIds.every((id) => id === originalId)).toBe(true);

  const receipts = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  const matching = receipts.body.filter((receipt: { lines: Array<{ variantId: string }> }) =>
    receipt.lines.some((line) => line.variantId === variantId),
  );
  expect(matching).toHaveLength(1);
  expect(matching[0].operationId).toBe(originalId);
  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantId);
  expect(received).toHaveLength(1);
  expect(received[0].remainingQuantity).toBe(6);
});

test("a later same-account receive keeps its marker when the recovered tab retries", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "فئة نفس الحساب" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس نفس الحساب" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون نفس الحساب" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "SS-E2E",
    nameAr: "تحقق الحساب المشترك",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 26000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون" })).toBeVisible();

  const operationIdsA: string[] = [];
  const operationIdsB: string[] = [];
  await dropFirstCommittedReceiptResponse(page, operationIdsA);
  await dropFirstCommittedReceiptResponse(pageB, operationIdsB);

  const formA = await fillSameAccountReceive(page, "6");
  await formA.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const markerA = await readPendingMarker(page);
  expect(markerA?.operationId).toBe(operationIdsA[0]);
  expect(markerA?.staffId).toEqual(expect.any(String));
  expect(markerA?.phase).toBe("uncertain");

  const checkB = pageB.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkB).toBeVisible();
  await checkB.click();
  await expect(pageB.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  expect(await readPendingMarker(pageB)).toBeNull();
  await expect(formA.getByLabel("الكمية")).toBeDisabled();

  const formB = await fillSameAccountReceive(pageB, "2");
  await formB.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(pageB.getByRole("alert")).toBeVisible();
  const markerB = await readPendingMarker(pageB);
  expect(markerB?.staffId).toBe(markerA?.staffId);
  expect(markerB?.operationId).not.toBe(markerA?.operationId);
  expect(markerB?.operationId).toBe(operationIdsB[0]);
  expect(markerB?.phase).toBe("uncertain");
  expect(markerB?.digest).toMatch(/^[a-f0-9]{64}$/);

  await formA.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.getByRole("status")).toContainText(/تم حفظ إذن الاستلام|تم العثور على إذن الاستلام المحفوظ/);
  expect(operationIdsA).toEqual([markerA?.operationId, markerA?.operationId]);
  expect(await readPendingMarker(page)).toEqual(markerB);

  await pageB.getByRole("button", { name: "التحقق من النتيجة" }).click();
  await expect(pageB.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  expect(await readPendingMarker(pageB)).toBeNull();

  const receipts = await staffApi(page, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(200);
  const matching = receipts.body.filter((receipt: { lines: Array<{ variantId: string }> }) =>
    receipt.lines.some((line) => line.variantId === variantId),
  );
  expect(matching).toHaveLength(2);
  expect(matching.map((receipt: { operationId: string }) => receipt.operationId).sort()).toEqual(
    [markerA?.operationId, markerB?.operationId].sort(),
  );
  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const received = batches.body.filter((batch: { variantId: string }) => batch.variantId === variantId);
  expect(received).toHaveLength(2);
  expect(received.map((batch: { remainingQuantity: number }) => batch.remainingQuantity).sort((left: number, right: number) => left - right)).toEqual([
    2, 6,
  ]);
});

async function fillSameAccountReceive(target: Page, quantity: string) {
  const form = target.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByLabel("المنتج").selectOption({ label: "SS-E2E — تحقق الحساب المشترك" });
  await form.getByLabel("المقاس واللون").selectOption({ label: "مقاس نفس الحساب / لون نفس الحساب" });
  await form.getByLabel("الكمية").fill(quantity);
  await form.getByLabel("تكلفة الشراء للجنيه").fill("45");
  return form;
}

async function dropFirstCommittedReceiptResponse(page: Page, operationIds: string[]) {
  let dropFirst = true;
  await page.route("**/api/internal/receiving/receipts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    operationIds.push(payload.operationId);
    if (dropFirst) {
      dropFirst = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
}

async function readPendingMarker(
  page: Page,
): Promise<{ operationId: string; staffId: string; phase: string; digest: string | null } | null> {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("bravos.receiving.pending.")) {
        continue;
      }
      const raw = localStorage.getItem(key);
      return raw
        ? (JSON.parse(raw) as { operationId: string; staffId: string; phase: string; digest: string | null })
        : null;
    }
    return null;
  });
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
  return {
    status: response.status(),
    body: await response.json(),
  };
}
