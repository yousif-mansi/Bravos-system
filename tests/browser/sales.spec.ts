import { expect, test, type Page, type Route } from "@playwright/test";
import type { SaleDto, SalePaymentDto } from "@bravos/contracts";
import type { OfflineCompletedSale } from "@bravos/sales/browser";

test("receiving, split sale and authorized sales view form one connected workflow", async ({ page }) => {
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("الكمية").fill("3");
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("50");
  await checkout.getByLabel("سبب الخصم (اختياري)").fill("اتفاق الصندوق");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toContainText("الإجمالي");
  await checkout.getByRole("radio", { name: "دفع مقسّم" }).check();
  await expect(checkout.getByRole("radio", { name: "دفع مقسّم" })).toBeChecked();
  await expect(checkout.getByRole("radio", { name: "نقداً بالكامل" })).not.toBeChecked();
  await expect(checkout.getByRole("radio", { name: /إلكترونياً بالكامل/ })).not.toBeChecked();
  await expect(checkout.getByRole("radio", { name: "دفع مقسّم" })).toHaveCSS("accent-color", /rgb\((22, 128, 82|38, 162, 105)\)/);
  await checkout.getByLabel("المبلغ النقدي بالجنيه").fill("400");
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("350");
  await expect(page.getByTestId("payment-remaining")).toContainText("100");
  await expect(page.getByTestId("payment-remaining")).toHaveText("المتبقي: 100 ج.م.");
  const completions: Array<{
    request: { saleId: string; operationId: string; payment: SalePaymentDto; pendingOperationIds?: string[]; [key: string]: unknown };
    status?: number;
    response?: SaleDto;
  }> = [];
  let releaseFirstCompletion: () => void = () => undefined;
  const firstCompletionGate = new Promise<void>((resolve) => { releaseFirstCompletion = resolve; });
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const completion: (typeof completions)[number] = { request: route.request().postDataJSON() };
      completions.push(completion);
      if (completions.length === 1) await firstCompletionGate;
      const response = await route.fetch();
      completion.response = await response.json();
      await route.fulfill({ response });
      completion.status = response.status();
      return;
    }
    await route.continue();
  });
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("alert")).toContainText("أدخل مبلغ النقد والدفع الإلكتروني");
  expect(completions).toHaveLength(0);
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("450.25");
  await expect(page.getByTestId("payment-remaining")).toHaveText("المبلغ الزائد: 0.25 ج.م.");
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("alert")).toContainText("أدخل مبلغ النقد والدفع الإلكتروني");
  expect(completions).toHaveLength(0);
  await expect(page.getByTestId("sale-details")).toHaveCount(0);
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("450");
  await expect(page.getByTestId("payment-remaining")).toContainText("0");
  await expect(page.getByTestId("payment-remaining")).toHaveText("المتبقي: 0 ج.م.");
  try {
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    await expect.poll(() => completions.length).toBeGreaterThanOrEqual(1);
    // Hold the direct upload before send while reconnection retries the durable sale.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => completions.length).toBeGreaterThanOrEqual(2);
  } finally {
    releaseFirstCompletion();
  }
  await expect.poll(() => completions.filter((completion) => completion.status === undefined).length).toBe(0);
  await test.info().attach("split-sale-overlapping-completions", {
    body: JSON.stringify(completions, null, 2), contentType: "application/json",
  });
  const originalCompletion = completions[0]!.request;
  expect(originalCompletion.saleId).toBeTruthy();
  expect(originalCompletion.operationId).toBeTruthy();
  const { pendingOperationIds: _originalPendingIds, ...originalFacts } = originalCompletion;
  for (const completion of completions) {
    // Pending-operation proof context can change after acknowledgement; paid facts cannot.
    const { pendingOperationIds: _pendingIds, ...facts } = completion.request;
    expect(facts).toEqual(originalFacts);
    expect(completion.request.payment).toEqual({ method: "split", cashPiasters: 40000, onlinePiasters: 45000 });
    expect([200, 201]).toContain(completion.status);
    expect(completion.response).toMatchObject({
      id: originalCompletion.saleId, operationId: originalCompletion.operationId,
      payment: { method: "split", cashPiasters: 40000, onlinePiasters: 45000 }, finalTotalPiasters: 85000,
    });
  }
  expect(completions.filter((completion) => completion.status === 201)).toHaveLength(1);
  await page.unroute("**/api/internal/sales");
  await expect(page.getByTestId("sale-details")).toContainText("كاشير تجريبي");
  await expect(page.getByTestId("sale-details")).toContainText("أبشواي");
  await expect(page.getByTestId("sale-details")).toContainText("بدون اسم زبون");
  // User-defined names elsewhere in the catalog may contain these words.
  await expect(page.getByTestId("lookup-result").getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
  await expect(page.getByTestId("sale-details").getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
  const splitSales = await staffApi(page, "GET", "/api/internal/sales");
  expect(splitSales.status).toBe(200);
  expect(JSON.stringify(splitSales.body)).not.toMatch(/"[^"\s]*(?:cost|profit|purchase|batch|inventoryValue|allocations)[^"\s]*"\s*:/i);
  expect(splitSales.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "POS-E2E"))).toHaveLength(1);
  expect(splitSales.body.find((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "POS-E2E"))?.payment).toEqual({
    method: "split", cashPiasters: 40000, onlinePiasters: 45000,
  });
  expect(splitSales.body.filter((sale: SaleDto) => sale.id === originalCompletion.saleId ||
    sale.operationId === originalCompletion.operationId)).toHaveLength(1);
  expect(splitSales.body.find((sale: SaleDto) => sale.id === originalCompletion.saleId)).toMatchObject({
    operationId: originalCompletion.operationId, originalTotalPiasters: 90000,
    employeeDiscountPiasters: 5000, finalTotalPiasters: 85000,
    discountReason: "اتفاق الصندوق", physicallyCompleted: true,
    lines: [expect.objectContaining({ variantId, quantity: 3, paidPiasters: 85000 })],
  });

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
  const receiving = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 4, unitCostPiasters: 8000 }],
  });
  expect(receiving.status, JSON.stringify(receiving.body)).toBe(201);

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
  let lostResponseCompleted = false;
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
    lostResponseCompleted = true;
  });

  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByRole("radio", { name: /إلكترونياً بالكامل/ }).check();
  await expect(page.getByTestId("payment-remaining")).toContainText("0");
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
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
  await expect.poll(() => lostResponseCompleted, { timeout: 15_000 }).toBe(true);
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
  expect(lostSales[0].payment).toEqual({ method: "online", cashPiasters: 0, onlinePiasters: 20000 });
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
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
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
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
  const receiving = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 4, unitCostPiasters: 6000 }],
  });
  expect(receiving.status, JSON.stringify(receiving.body)).toBe(201);
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("abc");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByRole("alert")).toContainText("قيمة الخصم غير صالحة.");
  await expect(checkout.getByLabel("الكمية")).toBeEnabled();
  await expect(checkout.getByLabel("خصم الموظف بالجنيه")).toBeEnabled();
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("10");
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(async () => {
    const listed = await staffApi(page, "GET", "/api/internal/sales");
    return listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
      sale.lines.some((line) => line.variant.product.code === "DISCOUNT-E2E"),
    ).length;
  }).toBe(1);
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
  const retryIds: string[] = [];
  const retryStatuses: number[] = [];
  let initialOperationId: string | null = null;
  let lostResponseGateClosed = true;
  const observeCompletion = async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "POST" || url.pathname !== "/api/internal/sales") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { saleId: string; operationId: string };
    if (completedIds.length === 0) {
      completedIds.push(payload.saleId);
      initialOperationId = payload.operationId;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    expect(payload.saleId).toBe(completedIds[0]);
    expect(payload.operationId).toBe(initialOperationId);
    if (lostResponseGateClosed) {
      await route.abort("connectionreset");
      return;
    }
    retryIds.push(payload.saleId);
    const response = await route.fetch();
    retryStatuses.push(response.status());
    await route.fulfill({ response });
  };
  await context.route("**/api/internal/sales", observeCompletion);
  try {
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
    await expect(page.getByTestId("accepted-prices")).toBeVisible();
    await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    await expect.poll(() => completedIds.length).toBe(1);
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
    expect(originalLocal?.operationId).toBe(initialOperationId);
    expect(originalLocal?.lines[0]?.quantity).toBe(1);
    expect(originalLocal?.finalTotalPiasters).toBe(16000);
    await page2.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "قبول الأسعار" }).click();
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
    lostResponseGateClosed = false;
    await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
    await expect.poll(() => retryStatuses.at(-1) ?? 0).toBe(200);
    await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
    expect(retryIds.length).toBeGreaterThan(0);
    expect(retryIds.every((saleId) => saleId === originalId)).toBe(true);
    expect(retryStatuses.every((status) => status === 200)).toBe(true);
    const listed = await staffApi(page, "GET", "/api/internal/sales");
    const saved = listed.body.filter((sale: { id: string; lines: Array<{ variant: { product: { code: string } } }> }) =>
      sale.lines.some((line) => line.variant.product.code === "TWOTAB-E2E"),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(originalId);
    expect(saved[0].operationId).toBe(originalLocal?.operationId);
    expect(saved[0].physicallyCompleted).toBe(true);
    expect(saved[0].originalTotalPiasters).toBe(16000);
    expect(saved[0].employeeDiscountPiasters).toBe(0);
    expect(saved[0].finalTotalPiasters).toBe(16000);
    expect(saved[0].discrepancy).toBeNull();
    expect(saved[0].lines).toHaveLength(1);
    expect(saved[0].lines[0]).toMatchObject({
      quantity: 1,
      paidPiasters: 16000,
      allocatedQuantity: 1,
      unallocatedQuantity: 0,
    });
    const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TWOTAB-E2E")}`);
    expect(lookupAfter.body.variants[0].availableQuantity).toBe(4);
    await page2.close();
  } finally {
    await context.unroute("**/api/internal/sales", observeCompletion);
  }
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  const preparations: Array<{ saleId: string; operationId: string; lines: Array<{ variantId: string; quantity: number }> }> = [];
  await context.route("**/api/internal/sales/prepare", async (route) => {
    if (route.request().method() === "POST") preparations.push(route.request().postDataJSON());
    await route.continue();
  });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  expect(preparations).toHaveLength(1);
  const oldQuote = preparations[0]!;
  expect(oldQuote.lines).toEqual([{ variantId, quantity: 1 }]);
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
  const completions: Array<{
    request: { saleId: string; operationId: string; payment: SalePaymentDto; lines: Array<{ variantId: string; quantity: number }> };
    status?: number;
    response?: SaleDto;
  }> = [];
  await context.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const completion: (typeof completions)[number] = { request: route.request().postDataJSON() };
      completions.push(completion);
      const response = await route.fetch();
      completion.response = await response.json();
      await route.fulfill({ response });
      completion.status = response.status();
      return;
    }
    await route.continue();
  });
  await checkout.getByLabel("الكمية").fill("2");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await expect(checkout.getByRole("button", { name: "إتمام البيع" })).toBeDisabled();
  expect(completions).toHaveLength(0);
  await locker.evaluate(() => {
    (window as unknown as { releasePendingLock: () => void }).releasePendingLock();
  });
  await locker.close();
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  expect(preparations).toHaveLength(2);
  const newQuote = preparations[1]!;
  expect(newQuote.saleId).not.toBe(oldQuote.saleId);
  expect(newQuote.operationId).not.toBe(oldQuote.operationId);
  expect(newQuote.lines).toEqual([{ variantId, quantity: 2 }]);
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(async () => {
    const current = await staffApi(page, "GET", "/api/internal/sales");
    expect(current.status).toBe(200);
    return current.body.filter((sale: SaleDto) => sale.id === newQuote.saleId &&
      sale.operationId === newQuote.operationId).length;
  }).toBe(1);
  await expect.poll(async () => page.evaluate(async (identity) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const request = db.transaction("sales", "readonly").objectStore("sales").get(identity.saleId);
      const sale = await new Promise<OfflineCompletedSale | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return sale && { id: sale.id, operationId: sale.operationId, syncStatus: sale.syncStatus,
        finalTotalPiasters: sale.finalTotalPiasters, payment: sale.payment,
        lines: sale.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, paidPiasters: line.paidPiasters })) };
    } finally { db.close(); }
  }, newQuote)).toEqual({
    id: newQuote.saleId, operationId: newQuote.operationId, syncStatus: "acknowledged",
    finalTotalPiasters: 28000, payment: { method: "cash", cashPiasters: 28000, onlinePiasters: 0 },
    lines: [{ variantId, quantity: 2, paidPiasters: 28000 }],
  });
  await expect.poll(() => completions.length).toBeGreaterThanOrEqual(1);
  await expect.poll(() => completions.filter((completion) => completion.status === undefined).length).toBe(0);
  expect(completions.filter((completion) => completion.request.saleId === oldQuote.saleId ||
    completion.request.operationId === oldQuote.operationId)).toHaveLength(0);
  for (const completion of completions) {
    expect(completion.request).toMatchObject({ saleId: newQuote.saleId, operationId: newQuote.operationId,
      payment: { method: "cash", cashPiasters: 28000, onlinePiasters: 0 }, lines: [{ variantId, quantity: 2 }] });
    expect([200, 201]).toContain(completion.status);
    expect(completion.response).toMatchObject({ id: newQuote.saleId, operationId: newQuote.operationId,
      finalTotalPiasters: 28000, lines: [expect.objectContaining({ variantId, quantity: 2, paidPiasters: 28000 })] });
  }
  expect(completions.filter((completion) => completion.status === 201)).toHaveLength(1);
  await test.info().attach("rapid-cart-quote-and-completion-identities", {
    body: JSON.stringify({ preparations, completions }, null, 2), contentType: "application/json",
  });
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "RAPID-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id: newQuote.saleId, operationId: newQuote.operationId, finalTotalPiasters: 28000 });
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
  const completeBodies: Array<{ saleId: string; operationId: string; quantity: number; discount: number }> = [];
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
        saleId: string;
        operationId: string;
        employeeDiscountPiasters: number;
        lines: Array<{ quantity: number }>;
      };
      completeBodies.push({
        saleId: payload.saleId,
        operationId: payload.operationId,
        quantity: payload.lines[0]?.quantity ?? 0,
        discount: payload.employeeDiscountPiasters,
      });
    }
    await route.continue();
  });
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
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
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  expect(prepareBodies).toEqual([{ quantity: 1, discount: 0 }]);
  await expect.poll(() => completeBodies.length).toBe(1);
  expect(completeBodies[0]).toMatchObject({ quantity: 1, discount: 0 });
  await expect.poll(async () => {
    const listed = await staffApi(page, "GET", "/api/internal/sales");
    return listed.body.filter((sale: { lines: Array<{ variant: { product: { code: string } } }> }) =>
      sale.lines.some((line) => line.variant.product.code === "DURING-E2E"),
    ).length;
  }).toBe(1);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const saved = listed.body.filter((sale: { lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "DURING-E2E"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].id).toBe(completeBodies[0].saleId);
  expect(saved[0].operationId).toBe(completeBodies[0].operationId);
  expect(saved[0].lines).toHaveLength(1);
  expect(saved[0].lines[0]).toMatchObject({ quantity: 1, paidPiasters: 14000, allocatedQuantity: 1, unallocatedQuantity: 0 });
  expect(saved[0].employeeDiscountPiasters).toBe(0);
  expect(saved[0].originalTotalPiasters).toBe(14000);
  expect(saved[0].finalTotalPiasters).toBe(14000);
  expect(saved[0].physicallyCompleted).toBe(true);
  expect(saved[0].discrepancy).toBeNull();
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
  await page2.getByRole("form", { name: "إتمام البيع" }).getByLabel("الكمية").fill("2");
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
  const checkoutA = page.getByRole("form", { name: "إتمام البيع" });
  await checkoutA.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkoutA.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkoutA.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(() => completedIds.length).toBe(1);
  const checkoutB = page2.getByRole("form", { name: "إتمام البيع" });
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
  const readCompletedSales = () => page2.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readonly");
    const all = await new Promise<OfflineCompletedSale[]>((resolve, reject) => {
      const req = tx.objectStore("sales").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all;
  });
  const savedA = await readCompletedSales();
  const recoveredA = savedA.find((sale) => sale.id === completedIds[0]);
  if (!recoveredA) throw new Error("The completed sale must remain durable before recovery.");
  expect(recoveredA?.lines[0]?.quantity).toBe(1);
  expect(recoveredA.payment).toEqual({ method: "cash", cashPiasters: 15000, onlinePiasters: 0 });
  const recoveredIds: string[] = [];
  const recoveredReplies: Array<{ status: number; body: SaleDto & { acknowledgement: { acknowledgedOperationIds: string[] } } }> = [];
  await page2.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
      const payload = route.request().postDataJSON() as { saleId: string; operationId: string; payment: SalePaymentDto };
      recoveredIds.push(payload.saleId);
      expect(payload.saleId).toBe(recoveredA?.id);
      expect(payload.operationId).toBe(recoveredA?.operationId);
      expect(payload.payment).toEqual(recoveredA.payment);
      const response = await route.fetch();
      recoveredReplies.push({ status: response.status(), body: await response.json() });
      await route.fulfill({ response });
      return;
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
  await expect.poll(() => recoveredReplies.length).toBe(1);
  expect([200, 201]).toContain(recoveredReplies[0]!.status);
  expect(recoveredReplies[0]!.body).toMatchObject({
    id: recoveredA.id, operationId: recoveredA.operationId, payment: recoveredA.payment,
    soldByStaffId: recoveredA.soldByStaffId, branch: recoveredA.branch,
    finalTotalPiasters: recoveredA.finalTotalPiasters,
    lines: [expect.objectContaining({ variantId, quantity: 1, paidPiasters: 15000 })],
  });
  expect(recoveredReplies[0]!.body.acknowledgement.acknowledgedOperationIds).toContain(recoveredA.operationId);
  await expect(checkoutB.getByLabel("الكمية")).toHaveValue("2");
  await page2.unroute("**/api/internal/sales");
  const bPrepareIds: string[] = [];
  const bPrepareOperationIds: string[] = [];
  await page2.route("**/api/internal/sales/prepare", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { saleId: string; operationId: string; lines: Array<{ quantity: number }> };
      bPrepareIds.push(payload.saleId);
      bPrepareOperationIds.push(payload.operationId);
      expect(payload.saleId).not.toBe(completedIds[0]);
      expect(payload.operationId).not.toBe(recoveredA.operationId);
      expect(payload.lines[0]?.quantity).toBe(2);
    }
    await route.continue();
  });
  await checkoutB.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page2.getByTestId("accepted-prices")).toBeVisible();
  await checkoutB.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkoutB.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page2.getByRole("status")).toContainText("تم حفظ البيع.");
  expect(bPrepareIds).toHaveLength(1);
  expect(bPrepareOperationIds).toHaveLength(1);
  // Completion feedback means durable local completion, not a finished server upload.
  await expect.poll(async () => {
    const current = await staffApi(page2, "GET", "/api/internal/sales");
    expect(current.status).toBe(200);
    return current.body.filter((sale: SaleDto) =>
      (sale.id === recoveredA.id && sale.operationId === recoveredA.operationId) ||
      (sale.id === bPrepareIds[0] && sale.operationId === bPrepareOperationIds[0]),
    ).length;
  }).toBe(2);
  const listed = await staffApi(page2, "GET", "/api/internal/sales");
  expect(listed.status).toBe(200);
  const saved = listed.body.filter((sale: { id: string; lines: Array<{ quantity: number; variant: { product: { code: string } } }> }) =>
    sale.lines.some((line) => line.variant.product.code === "FOREIGN-E2E"),
  );
  expect(saved).toHaveLength(2);
  const quantities = saved.map((sale: { lines: Array<{ quantity: number }> }) => sale.lines[0].quantity).sort();
  expect(quantities).toEqual([1, 2]);
  expect(saved.some((sale: { id: string }) => sale.id === completedIds[0])).toBe(true);
  expect(saved.some((sale: { id: string }) => sale.id === bPrepareIds[0])).toBe(true);
  expect(saved.find((sale: SaleDto) => sale.id === bPrepareIds[0])).toMatchObject({
    operationId: bPrepareOperationIds[0], soldByStaffId: recoveredA.soldByStaffId,
    branch: recoveredA.branch, finalTotalPiasters: 30000,
    payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 }, physicallyCompleted: true,
  });
  const localFacts = (sale: OfflineCompletedSale) => ({
    id: sale.id, operationId: sale.operationId, staffId: sale.staffId, deviceId: sale.deviceId,
    branch: sale.branch, soldByStaffId: sale.soldByStaffId, soldByDisplayName: sale.soldByDisplayName,
    occurredAt: sale.occurredAt, customerName: sale.customerName, customerPhone: sale.customerPhone,
    originalTotalPiasters: sale.originalTotalPiasters, employeeDiscountPiasters: sale.employeeDiscountPiasters,
    discountReason: sale.discountReason, finalTotalPiasters: sale.finalTotalPiasters,
    payment: sale.payment, physicallyCompleted: sale.physicallyCompleted,
    lines: sale.lines.map((line) => ({
      variantId: line.variantId, quantity: line.quantity, listedUnitPricePiasters: line.listedUnitPricePiasters,
      originalPiasters: line.originalPiasters, discountPiasters: line.discountPiasters, paidPiasters: line.paidPiasters,
      units: line.units,
    })),
  });
  await expect.poll(async () => (await readCompletedSales()).filter((sale) =>
    [recoveredA.id, bPrepareIds[0]].includes(sale.id) && sale.syncStatus === "acknowledged",
  ).length).toBe(2);
  const localAfter = await readCompletedSales();
  const acknowledgedA = localAfter.find((sale) => sale.id === recoveredA.id);
  const acknowledgedB = localAfter.find((sale) => sale.id === bPrepareIds[0]);
  if (!acknowledgedA || !acknowledgedB) throw new Error("Both completed sales must remain locally recoverable.");
  expect(localFacts(acknowledgedA)).toEqual(localFacts(recoveredA));
  expect(acknowledgedB).toMatchObject({
    operationId: bPrepareOperationIds[0], payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 },
    branch: recoveredA.branch, soldByStaffId: recoveredA.soldByStaffId, physicallyCompleted: true,
    lines: [expect.objectContaining({ variantId, quantity: 2, paidPiasters: 30000 })],
  });
  await test.info().attach("recovered-and-new-sale-proof", {
    body: JSON.stringify({ recoveredReplies, originalA: localFacts(recoveredA),
      acknowledgedA: localFacts(acknowledgedA), acknowledgedB: localFacts(acknowledgedB), saved }, null, 2),
    contentType: "application/json",
  });
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
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
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
  const posted = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/internal/sales"
    && response.status() < 400);
  await checkout.getByRole("button", { name: "إتمام البيع" }).evaluate((element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Completion button is missing.");
    }
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("status")).toContainText(/تم حفظ البيع|تم العثور على البيع المحفوظ/);
  expect(saleIds).toHaveLength(1);
  expect((await posted).ok()).toBe(true);
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
  if (method === "POST" && url === "/api/internal/receiving/receipts" && payload && typeof payload === "object" && !("branchId" in payload)) {
    const current = await staffApi(page, "GET", "/api/internal/workspace");
    payload = { ...payload, branchId: current.body.activeBranch?.id };
  }
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
