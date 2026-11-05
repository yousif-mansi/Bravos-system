import { stageUnpaidPosQuote } from "./support/pos-checkout";
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

const BASE_URL = "http://127.0.0.1:5174";
const ARCHIVE_TYPE = "application/vnd.bravos.backup";

test("a paid offline sale crosses restore generations through durable custody and manager recovery exactly once", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const managerContext = await browser.newContext();
  const cashierContext = await browser.newContext();
  const manager = await managerContext.newPage();
  const cashier = await cashierContext.newPage();
  try {
    const seed = await seedSingleProduct(manager, { quantity: 2, price: 19500, code: "RESTORE-QUEUE" });
    const backupPassword = "Restore source archive pass 27";
    const checkpointPassword = "Restore checkpoint pass 27";
    const archive = await createBackup(manager, backupPassword);

    await signIn(cashier, "cashier", "e2e-cashier-pass");
    await expect(cashier.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await cashier.getByRole("link", { name: "البحث عن منتج" }).click();
    await addAndPrice(cashier, seed);
    await cashier.route("**/api/internal/sales/pos-snapshots", (route) => route.abort("failed"));

    await manager.goto(`${BASE_URL}/restore`);
    const upload = manager.getByRole("form", { name: "إنشاء معاينة استعادة" });
    await upload.getByLabel("ملف النسخة المشفرة").setInputFiles({
      name: "restore-generation-zero.bravos-backup",
      mimeType: ARCHIVE_TYPE,
      buffer: archive,
    });
    await upload.getByLabel("كلمة حماية النسخة المرفوعة").fill(backupPassword);
    await upload.getByLabel("كلمة حماية نسخة البيانات الحالية", { exact: true }).fill(checkpointPassword);
    await upload.getByLabel("تأكيد كلمة حماية نسخة البيانات الحالية").fill(checkpointPassword);
    const previewCreated = manager.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/internal/restore/previews"
      && response.request().method() === "POST"
    ));
    await upload.getByRole("button", { name: "فك النسخة وإنشاء المعاينة" }).click();
    const previewResponse = await previewCreated;
    expect(previewResponse.ok(), `${previewResponse.status()} ${await previewResponse.text()}`).toBe(true);
    await expect(manager.getByTestId("restore-differences")).toBeVisible();
    await expect(manager.getByTestId("restore-validation-summary")).toContainText("تحقق الروابط وأعداد السجلات");
    // The differences panel is rendered while the preview is still staged. Acknowledgement
    // is rejected until the server marks that same preview paused or ready.
    await expect(manager.getByRole("region", { name: "تفاصيل معاينة الاستعادة" }).getByText(/الحالة: (متوقفة للمراجعة|جاهزة للتفعيل)/)).toBeVisible({ timeout: 30_000 });
    await expect(upload.getByLabel("كلمة حماية النسخة المرفوعة")).toHaveCount(0);

    const managerTill = await managerContext.newPage();
    const cashierTill = await cashierContext.newPage();
    await Promise.all([
      managerTill.goto(`${BASE_URL}/workspace`),
      cashierTill.goto(`${BASE_URL}/workspace`),
    ]);
    await acknowledgePausedTill(managerTill);
    await acknowledgePausedTill(cashierTill);

    await manager.getByRole("button", { name: "تحديث الحالة" }).click();
    await expect(manager.getByText("أُقر التوقف:").first()).toBeVisible({ timeout: 30_000 });
    const downloadPromise = manager.waitForEvent("download");
    await manager.getByRole("button", { name: "تحقق ونزّل نسخة البيانات الحالية" }).click();
    const checkpoint = await downloadPromise;
    expect(checkpoint.suggestedFilename()).toMatch(/\.bravos-backup$/);
    const acknowledgeCheckpoint = manager.getByRole("button", { name: "أؤكد حفظ الملف المتحقق منه" });
    await expect(acknowledgeCheckpoint).toBeEnabled();
    await acknowledgeCheckpoint.click();

    await cashierContext.setOffline(true);
    const checkout = cashier.getByRole("form", { name: "إتمام البيع" });
    const completePaidSale = checkout.getByRole("button", { name: "إتمام البيع" });
    await expect(completePaidSale).toBeEnabled();
    await completePaidSale.click();
    await expect(cashier.getByRole("status")).toContainText("تم حفظ البيع");
    const offline = await readQueueState(cashier);
    expect(offline.sales).toHaveLength(1);
    expect(offline.sales[0]).toMatchObject({ syncStatus: "pending", restoreGeneration: 0 });
    expect(offline.effects).toHaveLength(1);

    await cashierContext.setOffline(false);
    await expect(cashierTill.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1", { timeout: 30_000 });
    await expect.poll(async () => (await readQueueState(cashierTill)).stockCache.restoreGeneration).toBe(0);
    await acknowledgePausedTill(cashierTill);
    await acknowledgeAnyEarlierTestTills(manager);

    await manager.getByRole("button", { name: "تحديث الحالة" }).click();
    const ready = await activePreview(manager);
    expect(ready, JSON.stringify(ready)).toMatchObject({ status: "ready", previewFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(manager.getByTestId("restore-fingerprint")).toHaveText(ready.previewFingerprint, { timeout: 30_000 });
    await manager.getByLabel("تأكيد بصمة المعاينة").fill(ready.previewFingerprint);
    await manager.getByLabel("أفهم أن التفعيل سيرفع جيل البيانات ويلغي كل الجلسات، وسأعيد تسجيل الدخول.").check();
    await manager.getByRole("button", { name: "تفعيل هذه البصمة فقط" }).click();
    await expect(manager).toHaveURL(/\/login$/, { timeout: 30_000 });

    await signIn(cashierTill, "cashier", "e2e-cashier-pass");
    await expect(cashierTill.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1", { timeout: 30_000 });
    await expect.poll(async () => (await readQueueState(cashierTill)).stockCache.restoreGeneration).toBe(1);
    const retained = await readQueueState(cashierTill);
    expect(retained.sales[0]).toMatchObject({ syncStatus: "pending", restoreGeneration: 0 });
    expect(retained.effects).toHaveLength(1);

    await signIn(manager, "owner", "e2e-owner-pass");
    await manager.goto(`${BASE_URL}/restore`);
    const recover = manager.getByRole("button", { name: "استعادة البيع مرة واحدة" });
    await expect(recover).toHaveCount(1, { timeout: 30_000 });
    const recovery = manager.waitForResponse(
      (response) => response.url().includes("/api/internal/sales/recover") && response.request().method() === "POST",
      { timeout: 15_000 },
    );
    await recover.click();
    const recoveryResponse = await recovery;
    expect(recoveryResponse.ok(), `${recoveryResponse.status()} ${await recoveryResponse.text()}`).toBe(true);
    await expect(manager.getByRole("status")).toContainText("تمت استعادة البيع المتأخر مرة واحدة");
    await expect(manager.getByRole("button", { name: "استعادة البيع مرة واحدة" })).toHaveCount(0);

    await cashierTill.getByTestId("retry-sync").click();
    await expect.poll(async () => (await readQueueState(cashierTill)).sales[0]?.syncStatus).toBe("acknowledged");
    const reconciled = await readQueueState(cashierTill);
    expect(reconciled.effects).toHaveLength(0);
    expect(reconciled.stockCache.restoreGeneration).toBe(1);
    const listed = await staffApi(manager, "GET", "/api/internal/sales");
    const recoveredSales = salesForCode(listed.body, seed.code);
    expect(recoveredSales).toHaveLength(1);
    expect(recoveredSales[0]).toMatchObject({
      originalTotalPiasters: 19500,
      finalTotalPiasters: 19500,
      physicallyCompleted: true,
    });
    expect(recoveredSales[0]?.lines?.[0]).toMatchObject({ allocatedQuantity: 1, unallocatedQuantity: 0 });
    const availability = await staffApi(
      manager,
      "GET",
      `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`,
    );
    expect(availability.body.variants[0].availableQuantity).toBe(1);
  } finally {
    await cashierContext.setOffline(false).catch(() => undefined);
    await cancelActiveRestore(managerContext).catch(() => undefined);
    await cashierContext.close();
    await managerContext.close();
  }
});

test("restore rejects a wrong archive password without pausing or changing the generation", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const before = await staffApi(page, "GET", "/api/internal/restore/state");
  const archive = await createBackup(page, "Correct restore archive password");
  await page.goto(`${BASE_URL}/restore`);
  const form = page.getByRole("form", { name: "إنشاء معاينة استعادة" });
  await form.getByLabel("ملف النسخة المشفرة").setInputFiles({
    name: "wrong-password.bravos-backup",
    mimeType: ARCHIVE_TYPE,
    buffer: archive,
  });
  await form.getByLabel("كلمة حماية النسخة المرفوعة").fill("Wrong restore archive password");
  await form.getByLabel("كلمة حماية نسخة البيانات الحالية", { exact: true }).fill("Safe checkpoint password 27");
  await form.getByLabel("تأكيد كلمة حماية نسخة البيانات الحالية").fill("Safe checkpoint password 27");
  await form.getByRole("button", { name: "فك النسخة وإنشاء المعاينة" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const after = await staffApi(page, "GET", "/api/internal/restore/state");
  expect(after.body).toEqual(before.body);
  expect(after.body.pause).toBeNull();
});

test("restore UI and APIs remain private from an employee", async ({ page }) => {
  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "استعادة البيانات" })).toHaveCount(0);
  await page.goto(`${BASE_URL}/restore`);
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "استعادة نسخة البيانات" })).toHaveCount(0);
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(resources.some((url) => url.includes("manager-restore-") || url.includes("/RestorePage."))).toBe(false);
  expect((await staffApi(page, "GET", "/api/internal/restore/state")).status).toBe(403);
  expect((await staffApi(page, "GET", "/api/internal/restore/previews")).status).toBe(403);
  expect((await staffApi(page, "GET", "/api/internal/sales/restore-deferred")).status).toBe(403);
});

// Tills created by earlier browser specs share this database and must confirm the pause too.
async function acknowledgeAnyEarlierTestTills(manager: Page) {
  const preview = await activePreview(manager);
  for (const device of preview.devices) {
    if (device.acknowledgedAt) continue;
    const snapshot = await staffApi(manager, "POST", "/api/internal/sales/pos-snapshots", {
      deviceId: device.deviceId,
      pendingOperationIds: [],
    });
    expect(snapshot.status).toBe(201);
    const acknowledged = await staffApi(manager, "POST", `/api/internal/restore/previews/${preview.id}/acknowledgements`, {
      deviceId: device.deviceId,
      snapshotId: snapshot.body.snapshotId,
    });
    expect(acknowledged.status).toBe(200);
  }
}

// Browser specs share one database; a failed run must not leave business writes paused for later specs.
async function cancelActiveRestore(context: BrowserContext) {
  const page = await context.newPage();
  try {
    const state = await staffApi(page, "GET", "/api/internal/restore/state");
    if (state.status !== 200 || !state.body.pause) return;
    await staffApi(page, "POST", `/api/internal/restore/previews/${state.body.pause.previewId}/cancel`);
  } finally {
    await page.close();
  }
}

async function activePreview(page: Page) {
  const state = await staffApi(page, "GET", "/api/internal/restore/state");
  expect(state.body.pause).not.toBeNull();
  const preview = await staffApi(page, "GET", `/api/internal/restore/previews/${state.body.pause.previewId}`);
  return preview.body as {
    id: string;
    status: string;
    previewFingerprint: string;
    devices: Array<{ deviceId: string; acknowledgedAt: string | null }>;
  };
}

async function acknowledgePausedTill(page: Page) {
  await expect(page.getByTestId("restore-pause")).toBeVisible({ timeout: 30_000 });
  const acknowledge = page.getByTestId("acknowledge-restore-pause");
  await expect(acknowledge).toBeEnabled({ timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/internal/restore/previews/") && response.url().endsWith("/acknowledgements") && response.request().method() === "POST" && response.ok(),
    { timeout: 15_000 },
  );
  await acknowledge.click();
  let responseInfo = "no successful acknowledgement POST";
  try {
    const response = await responsePromise;
    responseInfo = `${response.status()} ${await response.text()}`;
  } catch (error) {
    const alerts = (await page.getByRole("alert").allInnerTexts()).join(" | ");
    const enabled = await acknowledge.isEnabled().catch(() => false);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${responseInfo}; enabled=${enabled}; alerts=${alerts}; ${message}`);
  }
  await expect(page.getByTestId("restore-pause-acknowledged"), responseInfo).toBeVisible();
}

async function createBackup(page: Page, password: string) {
  const response = await page.request.post(`${BASE_URL}/api/internal/backups`, {
    headers: { origin: BASE_URL, "content-type": "application/json" },
    data: { password },
  });
  expect(response.status()).toBe(201);
  expect(response.headers()["content-type"]).toContain(ARCHIVE_TYPE);
  const bytes = await response.body();
  expect(response.headers()["x-bravos-backup-sha256"]).toBe(createHash("sha256").update(bytes).digest("hex"));
  return bytes;
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await Promise.all([
    page.waitForURL(/\/workspace$/),
    page.getByRole("button", { name: "أبشواي" }).click(),
  ]);
}

async function seedSingleProduct(page: Page, options: { quantity: number; price: number; code: string }) {
  await signIn(page, "owner", "e2e-owner-pass");
  const sizeName = `مقاس ${options.code}`;
  const colorName = `لون ${options.code}`;
  const nameAr = `منتج ${options.code}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${options.code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: sizeName });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: colorName });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: options.code,
    nameAr,
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: options.price,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: randomUUID(),
    branchId: workspace.body.activeBranch.id,
    receiptDate: "2026-09-16",
    lines: [{ variantId, quantity: options.quantity, unitCostPiasters: 5000 }],
  });
  expect(receipt.status).toBe(201);
  return { code: options.code, nameAr, sizeName, colorName };
}

async function addAndPrice(
  page: Page,
  seed: { code: string; nameAr: string; sizeName: string; colorName: string },
) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.locator('button[type="submit"]').click();
  await expect(page.getByTestId("lookup-result")).toContainText(seed.nameAr);
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption({ label: seed.sizeName });
  await page.getByLabel("اللون").selectOption({ label: seed.colorName });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
}

async function readQueueState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function all<T>(name: string): Promise<T[]> {
      const tx = db.transaction(name, "readonly");
      return new Promise((resolve, reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    }
    const sales = await all<{ id: string; operationId: string; syncStatus: string; restoreGeneration?: number }>("sales");
    const effects = await all<{ operationId: string }>("effects");
    const meta = await all<{ key: string; value: string }>("meta");
    const cache = meta.find((row) => row.key === "stockCache")?.value;
    const stockCache = cache ? JSON.parse(cache) as { restoreGeneration?: number } : {};
    db.close();
    return { sales, effects, stockCache };
  });
}

function salesForCode(
  body: Array<{
    originalTotalPiasters?: number;
    finalTotalPiasters?: number;
    physicallyCompleted?: boolean;
    lines?: Array<{
      allocatedQuantity?: number;
      unallocatedQuantity?: number;
      variant?: { product?: { code?: string } };
    }>;
  }>,
  code: string,
) {
  return body.filter((sale) => sale.lines?.some((line) => line.variant?.product?.code === code));
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${BASE_URL}${url}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  const contentType = response.headers()["content-type"] ?? "";
  return {
    status: response.status(),
    body: contentType.includes("application/json") ? await response.json() : null,
  };
}
