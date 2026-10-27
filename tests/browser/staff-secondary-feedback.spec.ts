import { expect, test, type Page } from "@playwright/test";
import type { OnlineOrderDto } from "@bravos/contracts";

const BASE = "http://127.0.0.1:5174";
const id = "61000000-0000-4000-8000-000000000001";
const date = "2026-09-30T10:00:00Z";

for (const read of [
  { path: "/offers", api: "/api/internal/pricing/offers", retry: "إعادة تحميل العروض", form: "إنشاء عرض تلقائي", body: [] },
  { path: "/offers", api: "/api/internal/pricing/coupons", retry: "إعادة تحميل الكوبونات", form: "إنشاء كوبون", body: [] },
  { path: "/storefront-settings", api: "/api/internal/storefront/contacts", retry: "إعادة تحميل روابط المتجر", form: "إعداد روابط التواصل في المتجر", body: { whatsappUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null } },
]) {
  test(`${read.retry} recovers a failed initial read without showing an empty editor`, async ({ page }) => {
    await signIn(page);
    let fail = true;
    await page.route(`**${read.api}`, (route) => route.fulfill({ status: fail ? 503 : 200, json: fail ? { messageAr: "تعذر التحميل" } : read.body }));
    await page.goto(`${BASE}${read.path}`);
    await expect(page.getByRole("button", { name: read.retry })).toBeVisible();
    await expect(page.getByRole("form", { name: read.form, exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: read.retry }).click();
    await expect(page.getByRole("form", { name: read.form, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: read.retry })).toHaveCount(0);
  });
}

test("branch selection locks both branch choices while its request is pending", async ({ page }) => {
  await signIn(page, false);
  const gate = deferred();
  let requests = 0;
  await page.route("**/api/internal/active-branch", async (route) => {
    requests += 1;
    await gate.promise;
    await route.continue();
  });
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByRole("button", { name: "جارٍ اختيار أبشواي…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "الفيوم", exact: true })).toBeDisabled();
  expect(requests).toBe(1);
  gate.resolve();
  await expect(page).toHaveURL(/\/workspace$/);
});

test("branch persistence failure after same-account publication releases the selection lock", async ({ page }) => {
  await signIn(page, false);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    sessionStorage.setItem("branch-persist-failures", "0");
    sessionStorage.setItem("branch-publish-count", "0");
    const published = () => sessionStorage.setItem("branch-publish-count", String(Number(sessionStorage.getItem("branch-publish-count")) + 1));
    window.addEventListener("bravos-account", published);
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "sessions") {
        sessionStorage.setItem("branch-persist-failures", String(Number(sessionStorage.getItem("branch-persist-failures")) + 1));
        throw new DOMException("Injected session persistence failure", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
    window.addEventListener("restore-test-idb", () => { IDBObjectStore.prototype.put = original; window.removeEventListener("bravos-account", published); }, { once: true });
  });
  const selectedResponse = page.waitForResponse((response) => response.url().endsWith("/api/internal/active-branch") && response.request().method() === "POST");
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  expect((await selectedResponse).status()).toBe(200);
  await expect(page.getByRole("alert").filter({ hasText: "تعذر اختيار الفرع" })).toBeVisible();
  expect(await page.evaluate(() => Number(sessionStorage.getItem("branch-persist-failures")))).toBeGreaterThan(0);
  expect(await page.evaluate(() => Number(sessionStorage.getItem("branch-publish-count")))).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "أبشواي", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "الفيوم", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "تسجيل الخروج", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("restore-test-idb")));
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
});

test("correction detail retry shows busy feedback and reveals a repeated explicit open", async ({ page }, testInfo) => {
  await signIn(page);
  let fail = true;
  let gate = deferred();
  await page.route(`**/api/internal/corrections/sales/${id}`, async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { messageAr: "تعذر تحميل التفاصيل" } });
    await gate.promise;
    await route.fulfill({ json: {
      id, reference: "POS-20260930-000061", targetType: "sale", status: "cancelled", revision: 1,
      original: { finalTotalPiasters: 10000, lines: [] }, effective: null, changes: [],
      actual: { originalCashReceivedPiasters: 10000, correctionCashPaidOutPiasters: 0, correctionCashRecoveredPiasters: 0, netCashReceivedPiasters: 10000, merchandiseRestoredQuantity: 0, merchandiseDeductedQuantity: 0 },
    } });
  });
  await page.goto(`${BASE}/corrections`);
  await page.getByLabel("مرجع التسجيل").fill(id);
  await page.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("button", { name: "إعادة تحميل تفاصيل التسجيل" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "إعادة تحميل تفاصيل التسجيل" }).click();
  await expect(page.getByRole("button", { name: "جارٍ فتح التفاصيل…" })).toBeDisabled();
  await expect(page.getByLabel("نوع التسجيل")).toBeDisabled();
  await expect(page.getByLabel("مرجع التسجيل")).toBeDisabled();
  gate.resolve();
  const detail = page.getByTestId("correction-details");
  const heading = detail.getByRole("heading", { name: "الأصل والقيمة المستخدمة حالياً" });
  await expect(heading).toBeFocused();
  await expect(detail).toHaveClass(/is-highlighted/);
  await testInfo.attach("correction-retry-reveal", { body: await page.screenshot(), contentType: "image/png" });
  gate = deferred();
  await page.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByLabel("نوع التسجيل")).toBeDisabled();
  await expect(page.getByLabel("مرجع التسجيل")).toHaveValue(id);
  gate.resolve();
  await expect(heading).toBeFocused();
});

test("restore history selection reveals the preview above it while polling preserves focus", async ({ page }, testInfo) => {
  await signIn(page);
  const preview = {
    id, operationId: id, status: "cancelled", backupId: "feedback-backup", totalRecordCount: 0,
    sourceGeneration: 0, expectedGeneration: 0, createdAt: date, differences: [], devices: [], blockingReasons: [],
  };
  await page.route("**/api/internal/restore/state", (route) => route.fulfill({ json: { currentGeneration: 0, pause: null } }));
  await page.route("**/api/internal/sales/restore-deferred", (route) => route.fulfill({ json: [] }));
  let reads = 0;
  let gate: ReturnType<typeof deferred> | null = null;
  await page.route("**/api/internal/restore/previews", async (route) => {
    reads += 1;
    if (gate) await gate.promise;
    await route.fulfill({ json: [preview] });
  });
  await page.goto(`${BASE}/restore`);
  const history = page.locator(".restore-history-item");
  await history.click();
  const region = page.getByRole("region", { name: "تفاصيل معاينة الاستعادة" });
  const heading = region.getByRole("heading", { name: "معاينة النسخة" });
  await expect(heading).toBeFocused();
  await expect(region).toHaveClass(/is-highlighted/);
  await testInfo.attach("restore-history-reveal", { body: await page.screenshot(), contentType: "image/png" });
  await history.focus();
  const before = reads;
  await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(history).toBeFocused();
  await expect(region).not.toHaveClass(/is-highlighted/);
  gate = deferred();
  await region.getByRole("button", { name: "تحديث الحالة", exact: true }).click();
  await expect(region.getByRole("button", { name: "جارٍ تحديث الحالة…" })).toBeDisabled();
  gate.resolve();
  gate = null;
  await expect(region.getByRole("button", { name: "تحديث الحالة", exact: true })).toBeEnabled();
});

test("restore explicit upload reveals the created preview after its form disappears", async ({ page }) => {
  await signIn(page);
  let created: Record<string, unknown> | null = null;
  const releaseCreate = deferred();
  const createStarted = deferred();
  await page.route("**/api/internal/restore/state", (route) => route.fulfill({ json: { currentGeneration: 0, pause: null } }));
  await page.route("**/api/internal/sales/restore-deferred", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/internal/restore/previews", async (route) => {
    if (route.request().method() === "POST") {
      const candidate = { id, operationId: route.request().postDataJSON().operationId, previewFingerprint: "a".repeat(64), status: "paused", backupId: "created-feedback-backup", totalRecordCount: 0, sourceGeneration: 0, expectedGeneration: 0, createdAt: date, differences: [], devices: [], blockingReasons: [] };
      createStarted.resolve();
      await releaseCreate.promise;
      created = candidate;
      await route.fulfill({ status: 201, json: created });
    } else await route.fulfill({ json: created ? [created] : [] });
  });
  await page.goto(`${BASE}/restore`);
  const upload = page.getByRole("form", { name: "إنشاء معاينة استعادة" });
  await upload.getByLabel("ملف النسخة المشفرة").setInputFiles({ name: "feedback.bravos-backup", mimeType: "application/vnd.bravos.backup", buffer: Buffer.from("UI fixture") });
  await upload.getByLabel("كلمة حماية النسخة المرفوعة").fill("feedback password 61");
  await upload.getByLabel("كلمة حماية نسخة البيانات الحالية", { exact: true }).fill("feedback password 61");
  await upload.getByLabel("تأكيد كلمة حماية نسخة البيانات الحالية").fill("feedback password 61");
  await upload.getByRole("button", { name: "فك النسخة وإنشاء المعاينة" }).click();
  await createStarted.promise;
  await expect(upload).toBeVisible();
  await expect(page.getByRole("heading", { name: "معاينة النسخة", exact: true })).toHaveCount(0);
  releaseCreate.resolve();
  await expect(upload).toHaveCount(0);
  const heading = page.getByRole("heading", { name: "معاينة النسخة", exact: true });
  await expect(heading).toBeFocused();
  const region = page.getByRole("region", { name: "تفاصيل معاينة الاستعادة" });
  await expect(region.getByRole("button", { name: "تحديث الحالة", exact: true })).toBeEnabled();
  const history = page.locator(".restore-history-item");
  await history.focus();
  created = { ...created, totalRecordCount: 1 };
  const recordCount = page.locator(".restore-metadata div").filter({ has: page.getByText("إجمالي السجلات", { exact: true }) }).locator("dd");
  await expect(recordCount).toHaveText("1");
  await expect(history).toBeFocused();
  await expect(heading).not.toBeFocused();
});

test("opening import explicit creation reveals its preview after the upload form disappears", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/internal/opening-import/previews", (route) => route.fulfill({ status: 201, json: openingPreview(route.request().postDataJSON().operationId) }));
  await page.goto(`${BASE}/opening-import`);
  const upload = page.getByRole("form", { name: "رفع ملفات بيانات البداية" });
  for (const label of ["ملف الكتالوج CSV", "ملف المخزون الافتتاحي CSV", "ملف الإعدادات CSV"]) {
    await upload.getByLabel(label).setInputFiles({ name: "feedback.csv", mimeType: "text/csv", buffer: Buffer.from("UI fixture") });
  }
  await upload.getByRole("button", { name: "مراجعة الملفات" }).click();
  await expect(upload).toHaveCount(0);
  const region = page.getByRole("region", { name: "معاينة الاستيراد" });
  await expect(region.locator("h2")).toBeFocused();
  await expect(region).toHaveClass(/is-highlighted/);
});

test("opening import explicit saved-preview recovery reveals current preview after a failed read", async ({ page }) => {
  await signIn(page);
  const workspace = await (await page.request.get(`${BASE}/api/internal/workspace`)).json();
  const fingerprint = "a".repeat(64);
  await page.evaluate(({ staffId, id, fingerprint }) => localStorage.setItem(`bravos.opening-import.pending.${staffId}`, JSON.stringify({ staffId, operationId: id, previewId: id, previewFingerprint: fingerprint })), { staffId: workspace.staff.id, id, fingerprint });
  let fail = true;
  const preview = openingPreview(id);
  await page.route(`**/api/internal/opening-import/previews/${id}`, (route) => route.fulfill({ status: fail ? 503 : 200, json: fail ? { messageAr: "تعذر تحميل المعاينة" } : preview }));
  await page.goto(`${BASE}/opening-import`);
  await expect(page.getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "إعادة تحميل المعاينة المحفوظة" }).click();
  const region = page.getByRole("region", { name: "معاينة الاستيراد" });
  await expect(region.locator("h2")).toBeFocused();
  await expect(region).toHaveClass(/is-highlighted/);
});

test("online detail failure has direct retry and focuses the loaded order heading", async ({ page }) => {
  await signIn(page);
  let fail = true;
  const order: OnlineOrderDto = {
    id, operationId: id, reference: "BRV-1000061", status: "cancelled_unreachable", revision: 1,
    customerName: "عميل اختبار", primaryPhone: "01012345678", detailedAddress: "عنوان اختبار", deliveryArea: { id, nameAr: "الفيوم", feePiasters: 0 },
    requestedFinalTotalPiasters: 10000, requestedMerchandiseOriginalPiasters: 10000, requestedMerchandiseTotalPiasters: 10000,
    requestedAutomaticOfferDiscountPiasters: 0, requestedCouponDiscountPiasters: 0, requestedDeliveryFeePiasters: 0,
    alternatePhone: null, landmark: null, notes: null, requestedCouponCode: null, requestedAppliedAutomaticOffer: null, requestedAppliedCoupon: null,
    agreedRevision: null, confirmedQuote: null, fulfillmentBranchId: null, confirmedByStaffId: null, confirmedAt: null,
    shippedAt: null, deliveredAt: null, deliveryFailedAt: null, cancelledByStaffId: id, cancelledAt: date,
    cancellationReason: "تعذر التواصل", preShipmentStockDisposition: null,
    lines: [], contactAttempts: [], lifecycle: [], failedReturnInspections: [],
    actionEligibility: { canShip: false, canDeliver: false, canMarkDeliveryFailed: false, canCancelBeforeShipment: false, canDraftFailedReturnInspection: false, canPostFailedReturnInspection: false, canAbandonFailedReturnInspection: false, canCloseFailedDelivery: false }, submittedAt: date,
  };
  await page.route(`**/api/internal/online-orders/${id}`, (route) => route.fulfill({ status: fail ? 503 : 200, json: fail ? { messageAr: "تعذر تحميل الطلب" } : order }));
  await page.goto(`${BASE}/online-orders/${id}`);
  await expect(page.getByRole("button", { name: "إعادة تحميل تفاصيل الطلب" })).toBeVisible();
  await expect(page.getByText("لم يتم العثور على الطلب.")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "إعادة تحميل تفاصيل الطلب" }).click();
  await expect(page.getByRole("heading", { name: order.reference, exact: true })).toBeFocused();
  await expect(page.locator(".order-heading")).toHaveClass(/is-highlighted/);
});

function openingPreview(operationId: string) {
  return {
    id, operationId, status: "invalid", inputFingerprint: "a".repeat(64), previewFingerprint: "a".repeat(64),
    counts: { categories: 0, sizes: 0, colors: 0, products: 0, variants: 0, batches: 0, openingQuantity: 0, expenseCategories: 0, deliveryAreas: 0, automaticOffers: 0, coupons: 0 },
    catalog: { categories: [], sizes: [], colors: [], products: [], variants: [] }, batches: [], configuration: [], errors: [],
    configurationDetails: { inventoryDefaultThreshold: null, variantThresholds: [], expenseCategories: [], deliveryAreas: [], contacts: null, onlineOrderSettings: null, offers: [], coupons: [] },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function signIn(page: Page, choose = true) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  if (choose) {
    await page.getByRole("button", { name: "أبشواي", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  }
}
