import { expect, test, type Page } from "@playwright/test";

test("receiving, cash sale and authorized sales view form one connected workflow", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "قمصان نقطة البيع" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "أزرق" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "POS-E2E",
    nameAr: "قميص نقطة البيع",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  const receive = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await receive.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await receive.getByLabel("المنتج").selectOption({ label: "POS-E2E — قميص نقطة البيع" });
  await receive.getByLabel("المقاس واللون").selectOption({ label: "M / أزرق" });
  await receive.getByLabel("الكمية").fill("10");
  await receive.getByLabel("تكلفة الشراء للجنيه").fill("100");
  await receive.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  await receive.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await receive.getByLabel("المنتج").selectOption({ label: "POS-E2E — قميص نقطة البيع" });
  await receive.getByLabel("المقاس واللون").selectOption({ label: "M / أزرق" });
  await receive.getByLabel("الكمية").fill("10");
  await receive.getByLabel("تكلفة الشراء للجنيه").fill("140");
  await receive.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("POS-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText("قميص نقطة البيع");
  await page.getByLabel("المقاس").selectOption({ label: "M" });
  await page.getByLabel("اللون").selectOption({ label: "أزرق" });
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 20");
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByLabel("الكمية").fill("3");
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("50");
  await checkout.getByLabel("سبب الخصم (اختياري)").fill("اتفاق الصندوق");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي");
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  await expect(page.getByTestId("sale-details")).toContainText("كاشير تجريبي");
  await expect(page.getByTestId("sale-details")).toContainText("أبشواي");
  await expect(page.getByTestId("sale-details")).toContainText("بدون اسم زبون");
  await expect(page.getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);

  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect(page.getByRole("heading", { name: "المبيعات", exact: true })).toBeVisible();
  await expect(page.getByTestId("sale-list")).toContainText("كاشير تجريبي");
  await expect(page.getByTestId("sale-costs")).toHaveCount(0);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect(page.getByTestId("sale-list")).toContainText("كاشير تجريبي");
  await expect(page.getByTestId("sale-details")).toContainText("أبشواي");
  await expect(page.getByTestId("sale-costs")).toContainText("تكلفة الدفعات");

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const remaining = batches.body
    .filter((batch: { variantId: string }) => batch.variantId === variantId)
    .map((batch: { remainingQuantity: number; unitCostPiasters: number }) => ({
      remainingQuantity: batch.remainingQuantity,
      unitCostPiasters: batch.unitCostPiasters,
    }));
  expect(remaining).toEqual([
    { remainingQuantity: 7, unitCostPiasters: 10000 },
    { remainingQuantity: 10, unitCostPiasters: 14000 },
  ]);
});

test("lost complete response retries the same sale without charging the customer again", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "بيع مفقود" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس مفقود" });
  expect(size.status).toBe(201);
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون مفقود" });
  expect(color.status).toBe(201);
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "LOST-E2E",
    nameAr: "بيع مفقود الاستجابة",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 4, unitCostPiasters: 8000 }],
  });

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("LOST-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس مفقود" });
  await page.getByLabel("اللون").selectOption({ label: "لون مفقود" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();

  const saleIds: string[] = [];
  const operationIds: string[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "POST" || url.pathname !== "/api/internal/sales") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { saleId: string; operationId: string };
    saleIds.push(payload.saleId);
    operationIds.push(payload.operationId);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  });

  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  const local = (await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readonly");
    const rows = await new Promise<Array<{ id: string; operationId: string }>>((resolve, reject) => {
      const req = tx.objectStore("sales").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows[0];
  })) as { id: string; operationId: string };
  expect(local.id).toBeTruthy();
  await page.unroute("**/api/internal/sales");
  const retryIds: string[] = [];
  const retryOps: string[] = [];
  const retryStatuses: number[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as { saleId: string; operationId: string };
      retryIds.push(payload.saleId);
      retryOps.push(payload.operationId);
      const response = await route.fetch();
      retryStatuses.push(response.status());
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByTestId("unsynced-count")).toBeVisible();
  await expect.poll(() => retryStatuses.at(-1) ?? 0).toBe(200);
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  expect(retryIds).toContain(local.id);
  expect(retryOps).toContain(local.operationId);
  expect(new Set([...saleIds, ...retryIds])).toEqual(new Set([local.id]));
  expect(retryStatuses.every((status) => status === 200)).toBe(true);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  expect(listed.status).toBe(200);
  const lostSales = listed.body.filter((sale: { id: string; lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "LOST-E2E"),
  );
  expect(lostSales).toHaveLength(1);
  expect(lostSales[0].id).toBe(local.id);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("LOST-E2E")}`);
  expect(lookupAfter.status).toBe(200);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(3);
});

test("an unpaid price quote can be abandoned without recording a sale", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "إلغاء عرض" });
  expect(category.status).toBe(201);
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس إلغاء" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون إلغاء" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "ABANDON-E2E",
    nameAr: "بيع يُلغى عرضه",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 15000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 5, unitCostPiasters: 4000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("ABANDON-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس إلغاء" });
  await page.getByLabel("اللون").selectOption({ label: "لون إلغاء" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByRole("button", { name: "إلغاء عرض السعر" }).click();
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await checkout.getByLabel("الكمية").fill("2");
  const saleIds: string[] = [];
  await page.route("**/api/internal/sales/prepare", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { saleId: string; lines: Array<{ quantity: number }> };
      saleIds.push(payload.saleId);
      expect(payload.lines[0]?.quantity).toBe(2);
    }
    await route.continue();
  });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  expect(saleIds.length).toBeGreaterThan(0);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const recorded = listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "ABANDON-E2E"),
  );
  expect(recorded).toHaveLength(0);
});

test("lost complete before send recovers the prepared sale after stock is taken", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "بيع قبل الإرسال" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس قبل الإرسال" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون قبل الإرسال" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "BEFORE-E2E",
    nameAr: "بيع قبل وصول الطلب",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 22000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 1, unitCostPiasters: 7000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("BEFORE-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس قبل الإرسال" });
  await page.getByLabel("اللون").selectOption({ label: "لون قبل الإرسال" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  await page.unroute("**/api/internal/sales");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  const competing = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  expect(competing.status).toBe(201);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toBeVisible();
  await expect
    .poll(async () => {
      const listed = await staffApi(page, "GET", "/api/internal/sales");
      return listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
        sale.lines.some((line) => line.variant.product.code === "BEFORE-E2E"),
      ).length;
    })
    .toBe(1);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const recovered = listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "BEFORE-E2E"),
  );
  expect(recovered[0].discrepancy.unallocatedQuantity).toBe(1);
  expect(recovered[0].lines[0].paidPiasters).toBe(22000);
});

test("check result completes a physically paid preparation instead of accepting an unpaid quote", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تحقق النتيجة" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تحقق" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تحقق" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "CHECK-E2E",
    nameAr: "بيع تحقق النتيجة",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 18000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 3, unitCostPiasters: 5000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("CHECK-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس تحقق" });
  await page.getByLabel("اللون").selectOption({ label: "لون تحقق" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  await page.unroute("**/api/internal/sales");
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByTestId("active-branch")).toBeVisible();
  await expect
    .poll(async () => {
      const listed = await staffApi(page, "GET", "/api/internal/sales");
      return listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
        sale.lines.some((line) => line.variant.product.code === "CHECK-E2E"),
      ).length;
    })
    .toBe(1);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "CHECK-E2E"),
  );
  expect(saved[0].physicallyCompleted).toBe(true);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("CHECK-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(2);
  await page.reload();
  await expect(page.getByTestId("sale-details")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toHaveCount(0);
  const listedAgain = await staffApi(page, "GET", "/api/internal/sales");
  const savedAgain = listedAgain.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "CHECK-E2E"),
  );
  expect(savedAgain).toHaveLength(1);
  expect(savedAgain[0].physicallyCompleted).toBe(true);
});

test("invalid employee discount stays editable then completes after correction", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "خصم غير صالح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس خصم" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون خصم" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "DISCOUNT-E2E",
    nameAr: "بيع خصم قابل للتصحيح",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 4, unitCostPiasters: 6000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("DISCOUNT-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس خصم" });
  await page.getByLabel("اللون").selectOption({ label: "لون خصم" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("abc");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByRole("alert")).toContainText("قيمة الخصم غير صالحة.");
  await expect(checkout.getByLabel("الكمية")).toBeEnabled();
  await expect(checkout.getByLabel("خصم الموظف بالجنيه")).toBeEnabled();
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("10");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { employeeDiscountPiasters: number; lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "DISCOUNT-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].employeeDiscountPiasters).toBe(1000);
  expect(saved[0].physicallyCompleted).toBe(true);
});

test("two open tabs keep a physically completed marker and save that sale once", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تبويبان" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تبويب" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تبويب" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "TWOTAB-E2E",
    nameAr: "بيع تبويبين",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 16000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 5, unitCostPiasters: 4500 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const page2 = await context.newPage();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page2.goto("http://127.0.0.1:5174/lookup");
  await expect(page2.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  async function searchAndAdd(target: Page, sizeLabel: string, colorLabel: string) {
    const lookup = target.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("TWOTAB-E2E");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await target.getByLabel("المقاس").selectOption({ label: sizeLabel });
    await target.getByLabel("اللون").selectOption({ label: colorLabel });
    await target.getByRole("button", { name: "إضافة إلى السلة" }).click();
  }
  await searchAndAdd(page2, "مقاس تبويب", "لون تبويب");
  await searchAndAdd(page, "مقاس تبويب", "لون تبويب");
  const completedIds: string[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "POST" || url.pathname !== "/api/internal/sales") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { saleId: string };
    completedIds.push(payload.saleId);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  });
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  expect(completedIds).toHaveLength(1);
  const originalId = completedIds[0];
  const originalLocal = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sales = await new Promise<
      Array<{
        id: string;
        operationId: string;
        staffId: string;
        syncStatus: string;
        soldByDisplayName: string;
        originalTotalPiasters: number;
        finalTotalPiasters: number;
        branch: { code: string };
        lines: Array<{ quantity: number; paidPiasters: number }>;
      }>
    >((resolve, reject) => {
      const req = db.transaction("sales", "readonly").objectStore("sales").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return sales[0];
  });
  expect(originalLocal?.id).toBe(originalId);
  expect(originalLocal?.lines[0]?.quantity).toBe(1);
  expect(originalLocal?.finalTotalPiasters).toBe(16000);
  await page2.getByRole("form", { name: "إتمام البيع النقدي" }).getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page2.getByTestId("accepted-prices")).toBeVisible();
  await expect(page2.getByTestId("sale-details")).toHaveCount(0);
  const afterB = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function all<T>(name: string): Promise<T[]> {
      const req = db.transaction(name, "readonly").objectStore(name).getAll();
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      });
    }
    const sales = await all<{
      id: string;
      operationId: string;
      staffId: string;
      syncStatus: string;
      soldByDisplayName: string;
      originalTotalPiasters: number;
      finalTotalPiasters: number;
      branch: { code: string };
      lines: Array<{ quantity: number; paidPiasters: number }>;
    }>("sales");
    const pending = await all<{ saleId: string; operationId: string; staffId: string }>("pending");
    db.close();
    return { sales, pending };
  });
  expect(afterB.sales).toHaveLength(1);
  expect(afterB.sales[0]?.id).toBe(originalLocal?.id);
  expect(afterB.sales[0]?.operationId).toBe(originalLocal?.operationId);
  expect(afterB.sales[0]?.staffId).toBe(originalLocal?.staffId);
  expect(afterB.sales[0]?.syncStatus).toBe("pending");
  expect(afterB.sales[0]?.soldByDisplayName).toBe(originalLocal?.soldByDisplayName);
  expect(afterB.sales[0]?.branch.code).toBe(originalLocal?.branch.code);
  expect(afterB.sales[0]?.originalTotalPiasters).toBe(16000);
  expect(afterB.sales[0]?.finalTotalPiasters).toBe(16000);
  expect(afterB.sales[0]?.lines[0]?.quantity).toBe(1);
  expect(afterB.sales[0]?.lines[0]?.paidPiasters).toBe(16000);
  await page.unroute("**/api/internal/sales");
  const retryIds: string[] = [];
  const retryStatuses: number[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as { saleId: string; operationId: string };
      retryIds.push(payload.saleId);
      expect(payload.saleId).toBe(originalLocal?.id);
      expect(payload.operationId).toBe(originalLocal?.operationId);
      const response = await route.fetch();
      retryStatuses.push(response.status());
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect.poll(() => retryStatuses.at(-1) ?? 0).toBe(200);
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  expect(retryIds).toEqual([originalId]);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { id: string; lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "TWOTAB-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].id).toBe(originalId);
  expect(saved[0].physicallyCompleted).toBe(true);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TWOTAB-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(4);
  await page2.close();
});

test("rapid cart edit disables completion of the old quote until prices are accepted again", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تعديل سريع" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس سريع" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون سريع" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "RAPID-E2E",
    nameAr: "بيع تعديل سريع",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 14000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 6, unitCostPiasters: 3500 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("RAPID-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس سريع" });
  await page.getByLabel("اللون").selectOption({ label: "لون سريع" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const staffId = workspace.body.staff.id as string;
  expect(staffId.length).toBeGreaterThan(0);
  const locker = await context.newPage();
  await locker.goto("http://127.0.0.1:5174/lookup");
  await locker.evaluate(async (id) => {
    await new Promise<void>((held) => {
      void navigator.locks.request(`bravos.sales.lock.${id}`, { mode: "exclusive" }, async () => {
        held();
        await new Promise<void>((release) => {
          (window as unknown as { releasePendingLock: () => void }).releasePendingLock = () => release();
        });
      });
    });
  }, staffId);
  const completeBodies: Array<{ quantity: number }> = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as { lines: Array<{ quantity: number }> };
      completeBodies.push({ quantity: payload.lines[0]?.quantity ?? 0 });
    }
    await route.continue();
  });
  await checkout.getByLabel("الكمية").fill("2");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await expect(checkout.getByRole("button", { name: "إتمام البيع" })).toBeDisabled();
  await locker.evaluate(() => {
    (window as unknown as { releasePendingLock: () => void }).releasePendingLock();
  });
  await locker.close();
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  expect(completeBodies).toEqual([{ quantity: 2 }]);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "RAPID-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].lines[0].quantity).toBe(2);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("RAPID-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(4);
});

test("cart edits during delayed prepare cannot complete a stale quote", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تعديل أثناء القبول" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس أثناء" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون أثناء" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "DURING-E2E",
    nameAr: "بيع تعديل أثناء القبول",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 14000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 6, unitCostPiasters: 3500 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const staffId = workspace.body.staff.id as string;
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("DURING-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس أثناء" });
  await page.getByLabel("اللون").selectOption({ label: "لون أثناء" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const locker = await context.newPage();
  await locker.goto("http://127.0.0.1:5174/workspace");
  await locker.evaluate(async (id) => {
    await new Promise<void>((held) => {
      void navigator.locks.request(`bravos.sales.lock.${id}`, { mode: "exclusive" }, async () => {
        held();
        await new Promise<void>((release) => {
          (window as unknown as { releasePendingLock: () => void }).releasePendingLock = () => release();
        });
      });
    });
  }, staffId);
  let releasePrepare: () => void = () => undefined;
  const prepareGate = new Promise<void>((resolve) => {
    releasePrepare = resolve;
  });
  const prepareBodies: Array<{ quantity: number; discount: number }> = [];
  const completeBodies: Array<{ quantity: number; discount: number }> = [];
  await page.route("**/api/internal/sales/prepare", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as {
        employeeDiscountPiasters: number;
        lines: Array<{ quantity: number }>;
      };
      prepareBodies.push({
        quantity: payload.lines[0]?.quantity ?? 0,
        discount: payload.employeeDiscountPiasters,
      });
      await prepareGate;
    }
    await route.continue();
  });
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as {
        employeeDiscountPiasters: number;
        lines: Array<{ quantity: number }>;
      };
      completeBodies.push({
        quantity: payload.lines[0]?.quantity ?? 0,
        discount: payload.employeeDiscountPiasters,
      });
    }
    await route.continue();
  });
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(checkout.getByRole("button", { name: "جارٍ قبول الأسعار…" })).toBeVisible();
  await expect(checkout.getByLabel("الكمية")).toBeDisabled();
  await expect(checkout.getByLabel("خصم الموظف بالجنيه")).toBeDisabled();
  await checkout.getByLabel("الكمية").fill("2", { timeout: 1000 }).catch(() => undefined);
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("10", { timeout: 1000 }).catch(() => undefined);
  await expect(checkout.getByLabel("الكمية")).toHaveValue("1");
  await expect(checkout.getByLabel("خصم الموظف بالجنيه")).toHaveValue("0");
  await locker.evaluate(() => {
    (window as unknown as { releasePendingLock: () => void }).releasePendingLock();
  });
  await locker.close();
  releasePrepare();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await expect(checkout.getByLabel("الكمية")).toHaveValue("1");
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي: 140 ج.م.");
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  expect(prepareBodies).toEqual([{ quantity: 1, discount: 0 }]);
  expect(completeBodies).toEqual([{ quantity: 1, discount: 0 }]);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "DURING-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].lines[0].quantity).toBe(1);
  expect(saved[0].employeeDiscountPiasters).toBe(0);
  expect(saved[0].finalTotalPiasters).toBe(14000);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("DURING-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(5);
});

test("blocked tab recovers the other tab's sale then continues its own cart", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "استرداد أجنبي" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس أجنبي" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون أجنبي" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "FOREIGN-E2E",
    nameAr: "بيع استرداد أجنبي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 15000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 5, unitCostPiasters: 4000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const page2 = await context.newPage();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page2.goto("http://127.0.0.1:5174/lookup");
  await expect(page2.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  async function searchAndAdd(target: Page) {
    const lookup = target.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("FOREIGN-E2E");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await target.getByLabel("المقاس").selectOption({ label: "مقاس أجنبي" });
    await target.getByLabel("اللون").selectOption({ label: "لون أجنبي" });
    await target.getByRole("button", { name: "إضافة إلى السلة" }).click();
  }
  await searchAndAdd(page2);
  await page2.getByRole("form", { name: "إتمام البيع النقدي" }).getByLabel("الكمية").fill("2");
  await searchAndAdd(page);
  const completedIds: string[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "POST" || url.pathname !== "/api/internal/sales") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { saleId: string; lines: Array<{ quantity: number }> };
    completedIds.push(payload.saleId);
    expect(payload.lines[0]?.quantity).toBe(1);
    await route.abort("connectionreset");
  });
  const checkoutA = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkoutA.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkoutA.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkoutA.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  expect(completedIds).toHaveLength(1);
  const checkoutB = page2.getByRole("form", { name: "إتمام البيع النقدي" });
  await expect(checkoutB.getByLabel("الكمية")).toHaveValue("2");
  await expect(page2.getByTestId("sale-details")).toHaveCount(0);
  await page.unroute("**/api/internal/sales");
  await expect
    .poll(async () => {
      const rows = await page2.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("bravos-pos");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction("sales", "readonly");
        const all = await new Promise<Array<{ id: string; lines: Array<{ quantity: number }> }>>((resolve, reject) => {
          const req = tx.objectStore("sales").getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        return all;
      });
      return rows.filter((sale) => sale.id === completedIds[0]).length;
    })
    .toBe(1);
  await page.close();
  await expect(checkoutB.getByLabel("الكمية")).toHaveValue("2");
  const savedA = await page2.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readonly");
    const all = await new Promise<Array<{ id: string; operationId: string; lines: Array<{ quantity: number }> }>>((resolve, reject) => {
      const req = tx.objectStore("sales").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all;
  });
  const recoveredA = savedA.find((sale) => sale.id === completedIds[0]);
  expect(recoveredA?.lines[0]?.quantity).toBe(1);
  const recoveredIds: string[] = [];
  await page2.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as { saleId: string; operationId: string };
      recoveredIds.push(payload.saleId);
      expect(payload.saleId).toBe(recoveredA?.id);
      expect(payload.operationId).toBe(recoveredA?.operationId);
    }
    await route.continue();
  });
  await page2.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => {
      const listedNow = await staffApi(page2, "GET", "/api/internal/sales");
      return listedNow.body.filter((sale: { id: string }) => sale.id === completedIds[0]).length;
    })
    .toBe(1);
  expect(recoveredIds).toEqual([completedIds[0]]);
  await expect(checkoutB.getByLabel("الكمية")).toHaveValue("2");
  await page2.unroute("**/api/internal/sales");
  const bPrepareIds: string[] = [];
  await page2.route("**/api/internal/sales/prepare", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { saleId: string; lines: Array<{ quantity: number }> };
      bPrepareIds.push(payload.saleId);
      expect(payload.saleId).not.toBe(completedIds[0]);
      expect(payload.lines[0]?.quantity).toBe(2);
    }
    await route.continue();
  });
  await checkoutB.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page2.getByTestId("accepted-prices")).toBeVisible();
  await checkoutB.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  await checkoutB.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page2.getByRole("status")).toContainText("تم حفظ البيع النقدي.");
  expect(bPrepareIds).toHaveLength(1);
  const listed = await staffApi(page2, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { id: string; lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "FOREIGN-E2E"),
  );
  expect(saved).toHaveLength(2);
  const quantities = saved.map((sale: { lines: Array<{ quantity: number }> }) => sale.lines[0].quantity).sort();
  expect(quantities).toEqual([1, 2]);
  expect(saved.some((sale: { id: string }) => sale.id === completedIds[0])).toBe(true);
  expect(saved.some((sale: { id: string }) => sale.id === bPrepareIds[0])).toBe(true);
  const lookupAfter = await staffApi(page2, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("FOREIGN-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(2);
  await page2.close();
});

test("synchronous double complete keeps a single sale identity", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "بيع مزدوج" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس مزدوج" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون مزدوج" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "DOUBLE-E2E",
    nameAr: "بيع نقر مزدوج",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 12000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 3, unitCostPiasters: 3000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("DOUBLE-E2E");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByLabel("المقاس").selectOption({ label: "مقاس مزدوج" });
  await page.getByLabel("اللون").selectOption({ label: "لون مزدوج" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع النقدي" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة ودفع نقداً").check();
  const lookupBefore = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("DOUBLE-E2E")}`);
  expect(lookupBefore.body.variants[0].availableQuantity).toBe(3);
  const saleIds: string[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      saleIds.push((route.request().postDataJSON() as { saleId: string }).saleId);
    }
    await route.continue();
  });
  await checkout.getByRole("button", { name: "إتمام البيع" }).evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Completion button is missing.");
    }
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("status")).toContainText(/تم حفظ البيع النقدي|تم العثور على البيع المحفوظ/);
  expect(saleIds).toHaveLength(1);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const doubles = listed.body.filter((sale: {
    id: string;
    physicallyCompleted: boolean;
    finalTotalPiasters: number;
    lines: Array<{ quantity: number; variant: { product: { code: string } } }>;
  }) => sale.lines.some((line) => line.variant.product.code === "DOUBLE-E2E"));
  expect(doubles).toHaveLength(1);
  expect(doubles[0].id).toBe(saleIds[0]);
  expect(doubles[0].physicallyCompleted).toBe(true);
  expect(doubles[0].finalTotalPiasters).toBe(12000);
  expect(doubles[0].lines[0].quantity).toBe(1);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("DOUBLE-E2E")}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(2);
});

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
