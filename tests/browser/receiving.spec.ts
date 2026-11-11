import { expect, test, type Page } from "@playwright/test";

const WAREHOUSE_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

async function showHistory(page: Page, code?: string) {
  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  if (code) {
    await page.getByLabel("بحث بالمورد أو الرمز أو التاريخ").fill(code);
    await page.getByTestId("receipt-list").getByRole("row").filter({ hasText: code }).getByRole("button", { name: "عرض التفاصيل" }).click();
  }
}

test("receiving keeps draft tabs, ordered intake fields, compact history facts, and correction close protection", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ترتيب ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ترتيب ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ترتيب ${suffix}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `ORD-${suffix}`,
    nameAr: `منتج ترتيب ${suffix}`,
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    receiptDate: "2026-09-20",
    lines: [{ variantId: product.body.variants[0].id, quantity: 3, unitCostPiasters: 8000 }],
  });
  expect(receipt.status).toBe(201);

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  const receive = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await receive.getByRole("button", { name: "إضافة منتج جديد" }).click();
  const newProduct = page.getByRole("form", { name: "إضافة منتج إلى المخزون" });
  await expect.poll(async () => newProduct.locator("label").allTextContents()).toEqual([
    "التصنيف",
    "رمز المنتج / SKU",
    "اسم المنتج",
    "تكلفة الشراء بالجنيه",
    "سعر البيع الافتراضي بالجنيه",
    "الحد الأدنى للبيع بالجنيه (اختياري)",
    "الكمية",
  ]);
  await newProduct.locator("#newInventoryCategory").selectOption(category.body.id);
  await newProduct.locator("#newInventoryCode").fill(`DRAFT-${suffix}`);
  await newProduct.locator("#newInventoryName").fill("مسودة التبويب");
  await newProduct.locator("#newInventoryCost").fill("70");
  await newProduct.locator("#newInventoryPrice").fill("180");
  await newProduct.locator("#newInventoryMinimum").fill("150");
  await newProduct.locator("#newInventoryQuantity").fill("6");

  const unexpected: string[] = [];
  const rejectTabDialog = (dialog: import("@playwright/test").Dialog) => {
    unexpected.push(dialog.message());
    void dialog.dismiss();
  };
  page.on("dialog", rejectTabDialog);
  for (const tab of ["أرصدة المخازن", "تحويل مخزون", "المخزون المنخفض", "سجل الاستلام", "استلام بضاعة"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  page.off("dialog", rejectTabDialog);
  expect(unexpected).toEqual([]);
  await expect(newProduct.locator("#newInventoryCode")).toHaveValue(`DRAFT-${suffix}`);
  await expect(newProduct.locator("#newInventoryName")).toHaveValue("مسودة التبويب");
  await expect(newProduct.locator("#newInventoryQuantity")).toHaveValue("6");
  await expect(newProduct.locator("#newInventoryCost")).toHaveValue("70");

  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  await page.getByLabel("بحث بالمورد أو الرمز أو التاريخ").fill(`ORD-${suffix}`);
  await page.getByTestId("receipt-list").getByRole("row").filter({ hasText: `ORD-${suffix}` }).getByRole("button", { name: "عرض التفاصيل" }).click();
  const details = page.getByTestId("receipt-details");
  const meta = details.locator("dl.receiving-receipt-meta");
  await expect(meta.locator("dt")).toHaveText(["تاريخ الاستلام", "المورد", "الفرع"]);
  await expect(meta.locator("dd").nth(0)).toHaveText("2026-09-20");
  await expect(meta.locator("dd").nth(2)).toHaveText("أبشواي");
  await expect(details.getByText("الكمية المستلمة: 3 — تكلفة شراء الوحدة: 80 ج.م.", { exact: true })).toHaveCount(1);
  await expect(details.getByRole("button", { name: "تصحيح الإذن" })).toBeVisible();

  await details.getByRole("button", { name: "تصحيح الإذن" }).click();
  const correction = page.getByRole("form", { name: "تصحيح إذن الاستلام" });
  await correction.getByLabel("سبب التصحيح").fill("لم يُحفظ");
  page.removeAllListeners("dialog");
  let closeMessage = "";
  page.once("dialog", (dialog) => {
    closeMessage = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "إغلاق تفاصيل الإذن" }).click();
  await expect.poll(() => closeMessage).toContain("تصحيح غير محفوظ");
  await expect(correction).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "إغلاق تفاصيل الإذن" }).click();
  await expect(details).toHaveCount(0);
});

test("manager sees concise receipt facts and expands correction audit after a safe retry", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تصحيح الاستلام" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تصحيح" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تصحيح" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "RC-E2E",
    nameAr: "منتج تصحيح الاستلام",
    descriptionAr: "اختبار واجهة التصحيح",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    receiptDate: "2026-09-15",
    lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 10000 }],
  });
  expect(receipt.status).toBe(201);

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await page.getByRole("tab", { name: "سجل الاستلام" }).click();
  await page.getByLabel("بحث بالمورد أو الرمز أو التاريخ").fill("RC-E2E");
  const receiptCard = page.getByTestId("receipt-list").getByRole("row").filter({ hasText: "RC-E2E" });
  await receiptCard.getByRole("button", { name: "عرض التفاصيل" }).click();
  const details = page.getByTestId("receipt-details");
  await expect(details.getByText("الكمية المستلمة: 2 — تكلفة شراء الوحدة: 100 ج.م.", { exact: true })).toHaveCount(1);
  await expect(details).toContainText("المتبقي بالمخزون بكل الفروع: 2");
  await expect(details.locator("details")).toHaveCount(0);
  await details.getByRole("button", { name: "تصحيح الإذن" }).click();

  const correction = page.getByRole("form", { name: "تصحيح إذن الاستلام" });
  await expect(correction.getByRole("heading", { name: "تصحيح إذن الاستلام" })).toBeFocused();
  await expect(correction).toHaveClass(/is-highlighted/);
  await correction.getByLabel("سبب التصحيح").fill("تصحيح فاتورة المورد");
  await correction.getByLabel("الكمية", { exact: true }).fill("2");
  await correction.getByLabel("تكلفة الشراء بالجنيه").fill("140");
  const correctionOperationIds: string[] = [];
  let dropFirstCorrectionResponse = true;
  await page.route("**/api/internal/receiving/receipts/*/corrections", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { operationId: string };
    correctionOperationIds.push(payload.operationId);
    if (dropFirstCorrectionResponse) {
      dropFirstCorrectionResponse = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await correction.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(page.getByRole("alert")).toContainText("تعذر حفظ تصحيح إذن الاستلام.");
  await correction.getByRole("button", { name: "إعادة محاولة التصحيح" }).click();

  await expect(page.getByRole("status")).toContainText("تم حفظ تصحيح إذن الاستلام.");
  expect(correctionOperationIds).toHaveLength(2);
  expect(new Set(correctionOperationIds).size).toBe(1);
  await expect(details.getByText("الكمية المستلمة: 2 — تكلفة شراء الوحدة: 140 ج.م.", { exact: true })).toHaveCount(1);
  const audit = details.locator("details");
  await expect(audit).not.toHaveAttribute("open", "");
  await expect(audit.getByText("قبل التصحيح: 2 × 100 ج.م.")).not.toBeVisible();
  await audit.locator("summary").click();
  await expect(audit.getByText("عند تسجيل الإذن: 2 × 100 ج.م.")).toBeVisible();
  await expect(audit.getByText("قبل التصحيح: 2 × 100 ج.م.")).toBeVisible();
  await expect(audit.getByText("بعد التصحيح: 2 × 140 ج.م.")).toBeVisible();
  await expect(details).toContainText("تصحيح فاتورة المورد");
  await expect(details.getByText("التصحيح 1: تصحيح فاتورة المورد")).toHaveCount(1);
  await expect(audit.getByText(/نفّذه مالك برافوس — .+/)).toBeVisible();
  await page.locator("summary").filter({ hasText: "تفاصيل دفعات الشراء" }).click();
  const batch = page.getByTestId("batch-list").getByText("RC-E2E").locator("..");
  await expect(batch.getByText("تكلفة شراء الوحدة: 140 ج.م.", { exact: true })).toBeVisible();
  await expect(batch).toContainText("المتبقي بالمخزون: 2");
  await expect(batch).toContainText("أبشواي: 2");
  await expect(batch).not.toContainText("الأصلية");
  await expect(batch).not.toContainText("الفعالة");
});

test("manager receives separate cost batches and cashier sees their branch quantity without costs", async ({
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

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();

  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  const products = form.getByLabel("المنتج", { exact: true });
  const quantities = form.getByLabel("الكمية");
  const costs = form.getByLabel("تكلفة الشراء بالجنيه");
  await products.nth(0).selectOption({ label: "PT-E2E — بنطلون تجريبي" });
  await quantities.nth(0).fill("10");
  await costs.nth(0).fill("100");
  await products.nth(1).selectOption({ label: "PT-E2E — بنطلون تجريبي" });
  await quantities.nth(1).fill("10");
  await costs.nth(1).fill("140");
  await form.getByRole("button", { name: "حفظ الاستلام" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ إذن الاستلام.");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("tab", { name: "أرصدة المخازن" }).click();
  await expect(page.getByRole("button", { name: "كل المخزون" })).toHaveAttribute("aria-pressed", "true");
  const stockedRow = page.getByTestId("stock-location-table").getByRole("row", { name: /PT-E2E/ });
  await expect(stockedRow).toBeVisible();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByTestId("stock-location-table").getByRole("row", { name: /PT-E2E/ })).toHaveCount(0);
  await page.getByRole("button", { name: "كل المخزون" }).click();
  await expect(stockedRow).toBeVisible();
  await showHistory(page);
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 10 — تكلفة شراء الوحدة: 100 ج.م.");
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 10 — تكلفة شراء الوحدة: 140 ج.م.");
  await page.locator("summary").filter({ hasText: "تفاصيل دفعات الشراء" }).click();
  const costBatches = page.getByTestId("batch-list").locator("article").filter({ hasText: "PT-E2E" });
  await expect(costBatches).toHaveCount(2);
  await expect(costBatches.getByText("تكلفة شراء الوحدة: 100 ج.م.", { exact: true })).toBeVisible();
  await expect(costBatches.getByText("تكلفة شراء الوحدة: 140 ج.م.", { exact: true })).toBeVisible();
  await expect(costBatches.getByText(/^المتبقي بالمخزون: 10 · حسب الفرع:/)).toHaveCount(2);
  await expect(costBatches.getByText(/الأصلية|الفعالة/)).toHaveCount(0);
  await page.getByRole("tab", { name: "المخزون المنخفض" }).click();
  const lowStockRows = page.getByTestId("low-stock-list").getByRole("row").filter({ hasText: "PT-E2E" });
  await expect(lowStockRows).toHaveCount(0);

  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  const ownBatches = batches.body.filter((batch: { variant: { product: { code: string } } }) => batch.variant.product.code === "PT-E2E");
  expect(ownBatches).toHaveLength(2);
  expect(ownBatches.map((batch: { unitCostPiasters: number }) => batch.unitCostPiasters).sort((a: number, b: number) => a - b)).toEqual([
    10000, 14000,
  ]);
  const transferred = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id,
    productId: product.body.id,
    quantity: 20,
  });
  expect(transferred.status, JSON.stringify(transferred.body)).toBe(201);

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
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة في الفرع: 20");
  await expect(page.getByTestId("lookup-result").getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
  const costLabels = page.getByText(/تكلفة شراء|تكلفة الوحدة|تكلفة الدفعات|دفعات التكلفة|مجمل ربح|ربح التشغيل/);
  await expect(costLabels, (await costLabels.allInnerTexts()).join(" | ")).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "SH-E2E — حذاء تجريبي" });
  await form.getByLabel("الكمية").fill("5");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("80");

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
  const variantId = product.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "CT-E2E — معطف تجريبي" });
  await form.getByLabel("الكمية").fill("5");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("90");

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
  await expect(form.getByLabel("تكلفة الشراء بالجنيه")).toBeDisabled();
  await expect(form.getByLabel("الكمية")).toHaveValue("5");
  await expect(page.getByRole("button", { name: "التحقق من النتيجة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const checkResult = page.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(page.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(page.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await showHistory(page);
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 5 — تكلفة شراء الوحدة: 90 ج.م.");

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  await showHistory(page, "CT-E2E");
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 5 — تكلفة شراء الوحدة: 90 ج.م.");

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
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "HT-E2E — قبعة تجريبية" });
  await form.getByLabel("الكمية").fill("2");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("40");

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
  const variantId = product.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "DS-E2E — حزام مزدوج" });
  await form.getByLabel("الكمية").fill("4");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("55");

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
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "LB-E2E — جورب إرسال" });
  await form.getByLabel("الكمية").fill("6");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("20");

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
  const variantId = product.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await form.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "CL-E2E — وشاح إغلاق" });
  await form.getByLabel("الكمية").fill("7");
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("30");

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
  await expect(next.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const checkResult = next.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(next.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(next.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await showHistory(next);
  await expect(next.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 7 — تكلفة شراء الوحدة: 30 ج.م.");

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
  const variantA = productA.body.operationalVariantId as string;
  const variantB = productB.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();

  const formA = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await formA.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formA.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await formA.getByLabel("المنتج", { exact: true }).selectOption({ label: "TA-E2E — منتج التبويب أ" });
  await formA.getByLabel("الكمية").fill("5");
  await formA.getByLabel("تكلفة الشراء بالجنيه").fill("70");

  const formB = pageB.getByRole("form", { name: "تسجيل إذن استلام" });
  await formB.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formB.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await formB.getByLabel("المنتج", { exact: true }).selectOption({ label: "TB-E2E — منتج التبويب ب" });
  await formB.getByLabel("الكمية").fill("8");
  await formB.getByLabel("تكلفة الشراء بالجنيه").fill("80");

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
  await expect(reopened.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const checkResult = reopened.getByRole("button", { name: "التحقق من النتيجة" });
  await expect(checkResult.or(reopened.getByRole("status"))).toBeVisible();
  if (await checkResult.isVisible()) {
    await checkResult.click();
  }
  await expect(reopened.getByRole("status")).toContainText("تم العثور على إذن الاستلام المحفوظ.");
  await showHistory(reopened);
  await expect(reopened.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 5 — تكلفة شراء الوحدة: 70 ج.م.");

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
}, testInfo) => {
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
  const variantId = product.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await armNativeSubmitCounter(page);
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();

  const formA = page.getByRole("form", { name: "تسجيل إذن استلام" });
  await formA.getByLabel("تاريخ الاستلام").fill("2026-09-11");
  await formA.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await formA.getByLabel("المنتج", { exact: true }).selectOption({ label: "FA-E2E — منتج التجميد" });
  await formA.getByLabel("الكمية").fill("6");
  await formA.getByLabel("تكلفة الشراء بالجنيه").fill("45");
  await page.locator("#receipt-browse-query").fill("لا-يطابق-FA");
  await expect(formA.getByRole("button", { name: "حفظ الاستلام" })).toBeEnabled();
  const receiptSubmits = await nativeSubmitCount(page, "تسجيل إذن استلام");
  await page.locator("#receipt-browse-query").press("Enter");
  expect(await nativeSubmitCount(page, "تسجيل إذن استلام")).toBe(receiptSubmits);
  await expect(formA.getByLabel("المنتج", { exact: true })).toHaveValue(product.body.id);
  await expect(formA.getByLabel("الكمية")).toHaveValue("6");
  await expect(formA.getByLabel("المنتج", { exact: true }).locator("optgroup[label='الاختيار الحالي'] option")).toHaveAttribute("value", product.body.id);
  await page.getByTestId("receipt-browse-filters").getByRole("button", { name: "مسح التصفية" }).click();
  await expect(page.locator("#receipt-browse-query")).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("receiving-desktop-1440.png"), fullPage: true });

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
  await page.locator("#receipt-browse-query").fill("لا-يطابق-FA");
  await expect(formA.getByLabel("المنتج", { exact: true })).toBeDisabled();
  await expect(formA.getByLabel("المنتج", { exact: true })).toHaveValue(product.body.id);
  await expect(formA.getByLabel("الكمية")).toHaveValue("6");
  await expect(page.getByTestId("pending-operation")).toBeVisible();
  await expect(formA.getByRole("button", { name: "إعادة المحاولة" })).toBeEnabled();
  const frozenSubmits = await nativeSubmitCount(page, "تسجيل إذن استلام");
  const operationsBeforeEnter = operationIds.length;
  const markerBeforeEnter = await readPendingMarkerSnapshot(page);
  await page.locator("#receipt-browse-query").press("Enter");
  expect(await nativeSubmitCount(page, "تسجيل إذن استلام")).toBe(frozenSubmits);
  expect(operationIds).toHaveLength(operationsBeforeEnter);
  expect(await readPendingMarkerSnapshot(page)).toEqual(markerBeforeEnter);
  await expect(formA.getByLabel("المنتج", { exact: true })).toHaveValue(product.body.id);
  await expect(formA.getByLabel("الكمية")).toBeDisabled();
  await expect(formA.getByLabel("الكمية")).toHaveValue("6");
  await expect(page.getByTestId("pending-operation")).toBeVisible();
  await page.getByTestId("receipt-browse-filters").getByRole("button", { name: "مسح التصفية" }).click();
  await expect(page.locator("#receipt-browse-query")).toHaveValue("");
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
  await showHistory(page);
  await expect(page.getByTestId("receipt-details")).toContainText("الكمية المستلمة: 6 — تكلفة شراء الوحدة: 45 ج.م.");
  expect(operationIds).toHaveLength(2);
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
  const variantId = product.body.operationalVariantId as string;

  await page.getByRole("link", { name: "استلام المخزون" }).click();
  await expect(page.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/receiving");
  await expect(pageB.getByRole("heading", { name: "استلام المخزون", exact: true })).toBeVisible();

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
  await form.getByRole("button", { name: "إضافة منتج موجود" }).click();
  await form.getByLabel("المنتج", { exact: true }).selectOption({ label: "SS-E2E — تحقق الحساب المشترك" });
  await form.getByLabel("الكمية").fill(quantity);
  await form.getByLabel("تكلفة الشراء بالجنيه").fill("45");
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

async function armNativeSubmitCounter(page: Page) {
  await page.evaluate(() => {
    const host = window as Window & { __bravosNativeSubmitCounts?: Record<string, number> };
    if (host.__bravosNativeSubmitCounts) return;
    const counts: Record<string, number> = {};
    host.__bravosNativeSubmitCounts = counts;
    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const name = form.getAttribute("aria-label") ?? "";
      counts[name] = (counts[name] ?? 0) + 1;
    }, true);
  });
}

async function nativeSubmitCount(page: Page, formName: string) {
  return page.evaluate((name) => {
    const counts = (window as Window & { __bravosNativeSubmitCounts?: Record<string, number> }).__bravosNativeSubmitCounts;
    return counts?.[name] ?? 0;
  }, formName);
}

async function readPendingMarkerSnapshot(page: Page) {
  return page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("bravos.receiving.pending.")) {
        return { key, value: localStorage.getItem(key) };
      }
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
