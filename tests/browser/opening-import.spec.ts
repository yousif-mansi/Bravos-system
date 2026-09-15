import { expect, test, type Page } from "@playwright/test";

const CATALOG_HEADER =
  "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp";
const STOCK_HEADER = "batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order";
const CONFIGURATION_HEADER =
  "record_type,key,name_ar,value,variant_key,fee_egp,active,discount_type,percentage,amount_egp,starts_on,ends_on,allow_combination,usage_limit,product_keys,category_keys,buy_quantity,reward_quantity,reward_percentage,bundle_total_egp,offer_key,required_quantity,buy_product_keys,buy_category_keys,reward_product_keys,reward_category_keys";

const catalogCsv = [
  CATALOG_HEADER,
  csvRow(CATALOG_HEADER, { record_type: "category", key: "shirts", name_ar: "قمصان افتتاح 25" }),
  csvRow(CATALOG_HEADER, { record_type: "size", key: "l", name_ar: "كبير افتتاح 25" }),
  csvRow(CATALOG_HEADER, { record_type: "color", key: "black", name_ar: "أسود افتتاح 25" }),
  csvRow(CATALOG_HEADER, {
    record_type: "product",
    key: "shirt-1",
    name_ar: "قميص كلاسيك",
    product_code: "OPEN-25",
    description_ar: "قطن مصري",
    category_key: "shirts",
    default_price_egp: "500.00",
    publication: "available",
  }),
  csvRow(CATALOG_HEADER, {
    record_type: "variant",
    key: "shirt-1-l-black",
    product_key: "shirt-1",
    size_key: "l",
    color_key: "black",
  }),
].join("\n");

const validStockCsv = [
  STOCK_HEADER,
  "old-stock,shirt-1-l-black,2,200.00,2026-08-01,1",
  "new-stock,shirt-1-l-black,3,240.00,2026-09-01,2",
].join("\n");

const invalidStockCsv = [
  STOCK_HEADER,
  "old-stock,shirt-1-l-black,2,200.00,2026-08-01,1",
  "new-stock,shirt-1-l-black,3,240.00,2026-09-01,1",
].join("\n");

const configurationCsv = [
  CONFIGURATION_HEADER,
  csvRow(CONFIGURATION_HEADER, { record_type: "inventory_default_threshold", key: "default", value: "2" }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "expense_category",
    key: "shipping",
    name_ar: "شحن",
    active: "true",
  }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "delivery_area",
    key: "fayoum-city",
    name_ar: "منطقة افتتاح برافوس 25",
    fee_egp: "50.00",
    active: "true",
  }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "automatic_offer",
    key: "launch-bundle",
    name_ar: "حزمة الافتتاح",
    active: "true",
    discount_type: "fixed_bundle",
    starts_on: "2026-08-01",
    ends_on: "2026-12-31",
    allow_combination: "true",
    bundle_total_egp: "450.00",
  }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "bundle_item",
    key: "launch-bundle-shirt",
    variant_key: "shirt-1-l-black",
    offer_key: "launch-bundle",
    required_quantity: "2",
  }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "automatic_offer",
    key: "buy-two-get-one",
    name_ar: "اشتر اثنين واحصل على واحد",
    active: "true",
    discount_type: "buy_x_get_y",
    starts_on: "2026-08-01",
    ends_on: "2026-12-31",
    allow_combination: "false",
    buy_quantity: "2",
    reward_quantity: "1",
    reward_percentage: "100",
    buy_product_keys: "shirt-1",
    reward_product_keys: "shirt-1",
  }),
  csvRow(CONFIGURATION_HEADER, {
    record_type: "coupon",
    key: "welcome-10",
    name_ar: "START10",
    active: "true",
    discount_type: "percentage",
    percentage: "10",
    starts_on: "2026-08-01",
    ends_on: "2026-12-31",
    allow_combination: "true",
    usage_limit: "100",
    product_keys: "shirt-1",
  }),
].join("\n");

function csvRow(header: string, values: Record<string, string>): string {
  return header.split(",").map((column) => values[column] ?? "").join(",");
}

test("manager reviews every opening batch and configuration change before one recoverable acceptance", async ({
  page,
  context,
}) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const staffId = workspace.body.staff.id as string;

  await page.getByRole("link", { name: "استيراد بيانات البداية" }).click();
  await expect(page.getByRole("heading", { name: "استيراد بيانات البداية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تنزيل قالب الكتالوج" })).toHaveAttribute(
    "href",
    "/api/internal/opening-import/templates/catalog.csv",
  );
  await expect(page.getByRole("link", { name: "تنزيل قالب المخزون الافتتاحي" })).toHaveAttribute(
    "href",
    "/api/internal/opening-import/templates/opening-stock.csv",
  );
  await expect(page.getByRole("link", { name: "تنزيل قالب الإعدادات" })).toHaveAttribute(
    "href",
    "/api/internal/opening-import/templates/configuration.csv",
  );

  await uploadCsvFiles(page, invalidStockCsv);
  await page.getByRole("button", { name: "مراجعة الملفات" }).click();
  const invalidPreview = page.getByRole("region", { name: "معاينة الاستيراد" });
  await expect(invalidPreview).toContainText("تحتاج الملفات إلى تصحيح");
  const errors = invalidPreview.getByTestId("opening-import-errors");
  await expect(errors).toContainText("opening-stock.csv");
  await expect(errors).toContainText("السطر 3");
  await expect(errors).toContainText("ترتيب الدفعة مكرر");
  await expect(invalidPreview.getByRole("button", { name: "قبول الاستيراد" })).toHaveCount(0);
  await page.reload();
  await expect(invalidPreview).toContainText("تحتاج الملفات إلى تصحيح");
  await expect(invalidPreview.getByTestId("opening-import-errors")).toContainText("السطر 3");

  await invalidPreview.getByRole("button", { name: "اختيار ملفات جديدة" }).click();
  await uploadCsvFiles(page, validStockCsv);
  await page.getByRole("button", { name: "مراجعة الملفات" }).click();

  const preview = page.getByRole("region", { name: "معاينة الاستيراد" });
  await expect(preview).toContainText("المعاينة جاهزة للقبول");
  const counts = preview.getByTestId("opening-import-counts");
  await expect(counts).toContainText("التصنيفات: 1");
  await expect(counts).toContainText("المقاسات: 1");
  await expect(counts).toContainText("الألوان: 1");
  await expect(counts).toContainText("المنتجات: 1");
  await expect(counts).toContainText("المتغيرات: 1");
  await expect(counts).toContainText("دفعات التكلفة: 2");
  await expect(counts).toContainText("إجمالي الكمية الافتتاحية: 5");
  await expect(counts).toContainText("فئات المصروفات: 1");
  await expect(counts).toContainText("مناطق التوصيل: 1");
  await expect(counts).toContainText("العروض التلقائية: 2");
  await expect(counts).toContainText("الكوبونات: 1");

  const catalog = preview.getByTestId("opening-import-catalog");
  await expect(catalog).toContainText("shirts — قمصان افتتاح 25");
  await expect(catalog).toContainText("l — كبير افتتاح 25");
  await expect(catalog).toContainText("black — أسود افتتاح 25");
  const product = catalog.getByTestId("opening-import-product").filter({ hasText: "OPEN-25" });
  await expect(product).toContainText("shirt-1 — قميص كلاسيك");
  await expect(product).toContainText("قطن مصري");
  await expect(product).toContainText("التصنيف: shirts");
  await expect(product).toContainText("500 ج.م.");
  await expect(product).toContainText("متاح");
  const variant = catalog.getByTestId("opening-import-variant").filter({ hasText: "shirt-1-l-black" });
  await expect(variant).toContainText("المنتج: shirt-1");
  await expect(variant).toContainText("المقاس: l");
  await expect(variant).toContainText("اللون: black");

  const batches = preview.getByTestId("opening-import-batches");
  const oldBatch = batches.getByTestId("opening-import-batch").filter({ hasText: "old-stock" });
  await expect(oldBatch).toContainText("shirt-1-l-black");
  await expect(oldBatch).toContainText("الكمية: 2");
  await expect(oldBatch).toContainText("200 ج.م.");
  await expect(oldBatch).toContainText("2026-08-01");
  await expect(oldBatch).toContainText("الترتيب: 1");
  const newBatch = batches.getByTestId("opening-import-batch").filter({ hasText: "new-stock" });
  await expect(newBatch).toContainText("الكمية: 3");
  await expect(newBatch).toContainText("240 ج.م.");
  await expect(newBatch).toContainText("الترتيب: 2");

  const configuration = preview.getByTestId("opening-import-configuration");
  const threshold = configuration.getByTestId("opening-import-config-row").filter({ hasText: "default" });
  await expect(threshold).toContainText("القيمة الحالية: 3");
  await expect(threshold).toContainText("القيمة المقترحة: 2");
  await expect(configuration).toContainText("شحن");
  await expect(configuration).toContainText("منطقة افتتاح برافوس 25");

  const details = preview.getByTestId("opening-import-configuration-details");
  const bundle = details.getByTestId("opening-import-offer").filter({ hasText: "launch-bundle" });
  await expect(bundle).toContainText("حزمة الافتتاح");
  await expect(bundle).toContainText("حزمة بسعر ثابت");
  await expect(bundle).toContainText("450 ج.م.");
  await expect(bundle).toContainText("shirt-1-l-black × 2");
  await expect(bundle).toContainText("2026-08-01 إلى 2026-12-31");
  await expect(bundle).toContainText("يسمح بإضافة كوبون");
  const bxgy = details.getByTestId("opening-import-offer").filter({ hasText: "buy-two-get-one" });
  await expect(bxgy).toContainText("اشتر 2 واحصل على 1");
  await expect(bxgy).toContainText("خصم المكافأة: 100%");
  await expect(bxgy).toContainText("منتجات الشراء: shirt-1");
  await expect(bxgy).toContainText("منتجات المكافأة: shirt-1");
  await expect(bxgy).toContainText("لا يسمح بإضافة كوبون");
  const coupon = details.getByTestId("opening-import-coupon").filter({ hasText: "welcome-10" });
  await expect(coupon).toContainText("START10");
  await expect(coupon).toContainText("خصم نسبي: 10%");
  await expect(coupon).toContainText("حد الاستخدام: 100");
  await expect(coupon).toContainText("المنتجات: shirt-1");
  await expect(coupon).toContainText("يسمح بالجمع مع عرض تلقائي");

  const markerBeforeAccept = await readPendingMarker(page, staffId);
  expect(markerBeforeAccept).toMatchObject({
    staffId,
    previewId: expect.any(String),
    previewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    operationId: expect.stringMatching(/^[a-f0-9-]{36}$/),
  });
  expect(JSON.stringify(markerBeforeAccept)).not.toMatch(/20000|24000|unitCost|files|catalog|stock/i);
  const frozenPreview = await staffApi(
    page,
    "GET",
    `/api/internal/opening-import/previews/${markerBeforeAccept?.previewId}`,
  );
  expect(frozenPreview.body.operationId).toBe(markerBeforeAccept?.operationId);
  expect(frozenPreview.body.previewFingerprint).toBe(markerBeforeAccept?.previewFingerprint);

  const secondTab = await context.newPage();
  await secondTab.goto("http://127.0.0.1:5174/opening-import");
  await expect(secondTab.getByRole("region", { name: "معاينة الاستيراد" })).toContainText(
    "المعاينة جاهزة للقبول",
  );

  const lockName = `bravos.opening-import.lock.${staffId}`;
  await page.evaluate((name) => {
    const state = window as typeof window & { releaseOpeningImportLock?: () => void; openingImportLockHeld?: boolean };
    void navigator.locks.request(name, async () => {
      state.openingImportLockHeld = true;
      await new Promise<void>((resolve) => { state.releaseOpeningImportLock = resolve; });
      state.openingImportLockHeld = false;
    });
  }, lockName);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { openingImportLockHeld?: boolean }).openingImportLockHeld,
  ))).toBe(true);

  const acceptedPayloads: unknown[] = [];
  await secondTab.route("**/api/internal/opening-import/previews/*/accept", async (route) => {
    acceptedPayloads.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("connectionreset");
  }, { times: 1 });

  await secondTab.getByRole("button", { name: "قبول الاستيراد" }).click();
  await expect.poll(() => secondTab.evaluate(async (name) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending.some((lock) => lock.name === name);
  }, lockName)).toBe(true);
  await page.evaluate(() => {
    (window as typeof window & { releaseOpeningImportLock?: () => void }).releaseOpeningImportLock?.();
  });
  await expect(secondTab.getByRole("alert")).toContainText("نتيجة قبول الاستيراد غير مؤكدة");
  expect(await readPendingMarker(secondTab, staffId)).toEqual(markerBeforeAccept);

  await secondTab.reload();
  await expect(secondTab.getByRole("region", { name: "معاينة الاستيراد" })).toContainText(
    "تم قبول بيانات البداية",
  );
  await expect.poll(() => readPendingMarker(secondTab, staffId)).toBeNull();
  expect(acceptedPayloads).toEqual([{
    operationId: markerBeforeAccept?.operationId,
    previewFingerprint: markerBeforeAccept?.previewFingerprint,
  }]);

  const products = await staffApi(secondTab, "GET", "/api/internal/catalog/products");
  const imported = products.body.find((product: { code: string }) => product.code === "OPEN-25");
  expect(imported).toBeTruthy();
  const batchesAfterAccept = await staffApi(secondTab, "GET", "/api/internal/inventory/batches");
  const importedBatches = batchesAfterAccept.body.filter((batch: { variantId: string }) =>
    imported.variants.some((variant: { id: string }) => variant.id === batch.variantId),
  );
  expect(importedBatches).toHaveLength(2);
  expect(importedBatches.map((batch: { remainingQuantity: number; unitCostPiasters: number }) => ({
    quantity: batch.remainingQuantity,
    cost: batch.unitCostPiasters,
  }))).toEqual([
    { quantity: 2, cost: 20_000 },
    { quantity: 3, cost: 24_000 },
  ]);
});

test("opening import stays manager-only and never exposes cost previews to an employee", async ({ page }) => {
  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "استيراد بيانات البداية" })).toHaveCount(0);
  await page.goto("http://127.0.0.1:5174/opening-import");
  await expect(page).toHaveURL(/\/workspace$/);
  expect((await staffApi(page, "GET", "/api/internal/opening-import/templates/catalog.csv", false)).status).toBe(403);
});

async function uploadCsvFiles(page: Page, stockCsv: string) {
  const form = page.getByRole("form", { name: "رفع ملفات بيانات البداية" });
  await form.getByLabel("ملف الكتالوج CSV").setInputFiles({
    name: "catalog.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(catalogCsv, "utf8"),
  });
  await form.getByLabel("ملف المخزون الافتتاحي CSV").setInputFiles({
    name: "opening-stock.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(stockCsv, "utf8"),
  });
  await form.getByLabel("ملف الإعدادات CSV").setInputFiles({
    name: "configuration.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(configurationCsv, "utf8"),
  });
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
}

async function readPendingMarker(page: Page, staffId: string): Promise<{
  operationId: string;
  staffId: string;
  previewId: string;
  previewFingerprint: string;
} | null> {
  return page.evaluate((id) => {
    const raw = localStorage.getItem(`bravos.opening-import.pending.${id}`);
    return raw ? JSON.parse(raw) : null;
  }, staffId);
}

async function staffApi(
  page: Page,
  method: "GET" | "POST",
  url: string,
  parseJson = true,
  payload?: unknown,
) {
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
    body: parseJson && response.status() !== 403 ? await response.json() : null,
  };
}
