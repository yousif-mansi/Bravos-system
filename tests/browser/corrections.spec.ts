import { expect, test, type Page } from "@playwright/test";

test("manager corrects a posted Return in Arabic and the Returns payment uses the effective amount", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();

  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تصحيحات المتصفح" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تصحيح المتصفح" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تصحيح المتصفح" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `COR-E2E-${crypto.randomUUID().slice(0, 6)}`,
    nameAr: "قطعة تصحيح الإرجاع",
    descriptionAr: "اختبار تصحيح التسجيل",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 10000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: workspace.body.activeBranch.id,
    receiptDate: "2026-09-01",
    lines: [{ variantId, quantity: 1, unitCostPiasters: 5000 }],
  });
  const sale = await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  const source = (await staffApi(page, "GET", `/api/internal/returns/sources?reference=${sale.body.id}`)).body[0];
  const draft = await staffApi(page, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: source.originalBranch.id,
    authorizedRefundPiasters: 10000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await staffApi(page, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });

  await page.getByRole("link", { name: "تصحيح التسجيلات" }).click();
  await expect(page.getByRole("heading", { name: "تصحيح التسجيلات" })).toBeVisible();
  const openForm = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await openForm.getByLabel("نوع التسجيل").selectOption("return");
  await openForm.getByLabel("مرجع التسجيل").fill(draft.body.id);
  await openForm.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("correction-details")).toContainText("100 ج.م.");

  const correctionForm = page.getByRole("form", { name: "تصحيح أو إلغاء تسجيل" });
  await correctionForm.getByLabel("الإجراء").selectOption("cancellation");
  await expect(correctionForm).toContainText("الإلغاء وحده لا يعيد بضاعة إلى المخزون ولا يسجل دفعاً أو استرداداً للنقد");
  await correctionForm.getByLabel("الإجراء").selectOption("correction");
  await correctionForm.getByLabel("الاسترداد المعتمد المصحح بالجنيه").fill("80");
  await correctionForm.getByLabel("سبب التصحيح").fill("القيمة المعتمدة الصحيحة ثمانون جنيهاً");
  await correctionForm.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصحيح");
  await expect(page.getByTestId("correction-details")).toContainText("80 ج.م.");
  await expect(page.getByTestId("correction-details")).toContainText("القيمة المعتمدة الصحيحة ثمانون جنيهاً");

  await page.getByRole("link", { name: "مساحة العمل" }).click();
  await page.getByRole("link", { name: "المرتجعات" }).click();
  await page.locator(".return-history").getByRole("button", { name: new RegExp(draft.body.reference) }).click();
  const details = page.getByTestId("return-details");
  await expect(details).toContainText("المعتمد حالياً: 80 ج.م.");
  await expect(details).toContainText("المعتمد الأصلي المحفوظ: 100 ج.م.");
  await expect(details).toContainText("المتبقي للدفع: 80 ج.م.");
  await details.getByRole("button", { name: "تسجيل دفع 80 ج.م." }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل دفع الاسترداد النقدي");
  await expect(details).toContainText("دُفع 80 ج.م. فعلياً");

  expect(sale.body.reference).toMatch(/^POS-\d+$/);
  expect(draft.body.reference).toMatch(/^RET-\d+$/);
  await page.getByRole("link", { name: "تصحيح التسجيلات" }).click();
  const referenceForm = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await referenceForm.getByLabel("نوع التسجيل").selectOption("sale");
  await referenceForm.getByLabel("مرجع التسجيل").fill(sale.body.reference);
  await referenceForm.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText(`المرجع: ${sale.body.reference}`);
  await expect(referenceForm.getByLabel("مرجع التسجيل")).toHaveValue(sale.body.reference);

  await referenceForm.getByLabel("نوع التسجيل").selectOption("return");
  await referenceForm.getByLabel("مرجع التسجيل").fill(draft.body.reference);
  await referenceForm.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText(`المرجع: ${draft.body.reference}`);
  await expect(referenceForm.getByLabel("مرجع التسجيل")).toHaveValue(draft.body.reference);

  await page.goto(`http://127.0.0.1:5174/corrections?target=sale&id=${sale.body.id}`);
  await expect(page.getByTestId("correction-reference")).toHaveText(`المرجع: ${sale.body.reference}`);
  await expect(page.getByLabel("مرجع التسجيل")).toHaveValue(sale.body.reference);
});

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  const text = await response.text();
  expect(response.status(), `${method} ${url} ${text}`).toBeLessThan(400);
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

const BASE = "http://127.0.0.1:5174";
const saleShortId = "61100000-0000-4000-8000-000000000042";
const saleLongId = "61100000-0000-4000-8000-000000000420";
const saleDeepId = "61100000-0000-4000-8000-000000000061";
const returnId = "61200000-0000-4000-8000-000000000088";
const returnDecoyId = "61200000-0000-4000-8000-000000000880";
const returnOtherId = "61200000-0000-4000-8000-000000000008";
const returnCursor = "61200000-0000-4000-8000-0000000000c1";
const ambiguousReturnA = "61200000-0000-4000-8000-0000000000a1";
const ambiguousReturnB = "61200000-0000-4000-8000-0000000000b2";

test("sale correction resolves an exact readable reference and retries a miss", async ({ page }) => {
  await signIn(page);
  let sales: Array<{ id: string; reference: string }> = [
    { id: saleLongId, reference: "POS-420" },
    { id: saleShortId, reference: "POS-42" },
  ];
  const calls: string[] = [];
  await mockSaleList(page, () => sales);
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });

  await form.getByLabel("مرجع التسجيل").fill("pos-42");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("لا يوجد بيع مكتمل بهذا المرجع");
  expect(calls).toEqual([]);

  await form.getByLabel("مرجع التسجيل").fill("POS-420");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-420");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue("POS-420");
  expect(calls).toEqual([saleLongId]);

  await form.getByLabel("مرجع التسجيل").fill("POS-42");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-42");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue("POS-42");
  expect(calls).toEqual([saleLongId, saleShortId]);

  sales = [];
  calls.length = 0;
  await form.getByLabel("مرجع التسجيل").fill("POS-15");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("لا يوجد بيع مكتمل بهذا المرجع");
  await expect(page.getByRole("button", { name: "إعادة تحميل تفاصيل التسجيل" })).toBeVisible();
  expect(calls).toEqual([]);
  sales = [{ id: saleShortId, reference: "POS-15" }];
  await page.getByRole("button", { name: "إعادة تحميل تفاصيل التسجيل" }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-15");
  expect(calls).toEqual([saleShortId]);
});

test("two sales with the same reference are not silently chosen", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  await mockSaleList(page, () => [
    { id: saleShortId, reference: "POS-7" },
    { id: saleLongId, reference: "POS-7" },
  ]);
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("مرجع التسجيل").fill("POS-7");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("يطابق أكثر من تسجيل");
  await expect(page.getByTestId("correction-details")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("a sale deep link loads by id and shows the list reference", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  await mockSaleList(page, () => [{ id: saleDeepId, reference: "POS-61" }]);
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections?target=sale&id=${saleDeepId}`);
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-61");
  await expect(page.getByLabel("مرجع التسجيل")).toHaveValue("POS-61");
  expect(calls.length).toBeGreaterThan(0);
  expect(new Set(calls)).toEqual(new Set([saleDeepId]));
});

test("return correction reads the next page for an exact reference", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  const cursors: Array<string | null> = [];
  await mockReturnPages(page, (cursor) => {
    cursors.push(cursor);
    if (!cursor) {
      return { items: [{ id: returnDecoyId, reference: "RET-880" }, { id: returnOtherId, reference: "RET-8" }], nextCursor: returnCursor };
    }
    return { items: [{ id: returnId, reference: "RET-88" }], nextCursor: null };
  });
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("نوع التسجيل").selectOption("return");
  await form.getByLabel("مرجع التسجيل").fill("RET-88");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: RET-88");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue("RET-88");
  expect(calls).toEqual([returnId]);
  expect(cursors[0]).toBeNull();
  expect(cursors).toContain(returnCursor);
});

test("the same return reference on a later page is not chosen from the first page", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  await mockReturnPages(page, (cursor) => cursor
    ? { items: [{ id: ambiguousReturnB, reference: "RET-5" }], nextCursor: null }
    : { items: [{ id: ambiguousReturnA, reference: "RET-5" }], nextCursor: returnCursor });
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("نوع التسجيل").selectOption("return");
  await form.getByLabel("مرجع التسجيل").fill("RET-5");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("يطابق أكثر من تسجيل");
  await expect(page.getByTestId("correction-details")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("a repeated return cursor does not open a partial match", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  await mockReturnPages(page, (cursor) => cursor
    ? { items: [{ id: returnId, reference: "RET-77" }], nextCursor: returnCursor }
    : { items: [{ id: returnOtherId, reference: "RET-1" }], nextCursor: returnCursor });
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("نوع التسجيل").selectOption("return");
  await form.getByLabel("مرجع التسجيل").fill("RET-77");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("تعذر متابعة صفحات المرتجعات");
  await expect(page.getByTestId("correction-details")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("a cached readable reference stays on its record and is not applied to a retried correction", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  const writes: Array<{ id: string; operationId: string }> = [];
  const operationId = "61300000-0000-4000-8000-0000000000b2";
  await mockSaleList(page, () => [{ id: saleShortId, reference: "POS-42" }]);
  await mockCorrectionDetails(page, calls);
  await page.route(/\/api\/internal\/corrections\/(?:sales|returns)\//, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const body = route.request().postDataJSON() as { operationId?: string };
    writes.push({ id, operationId: body.operationId ?? "" });
    await route.fulfill({ json: saleDetail(id) });
  });
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("مرجع التسجيل").fill("POS-42");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-42");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue("POS-42");

  await page.getByLabel("سبب التصحيح").fill("تصحيح نفس التسجيل");
  await page.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصحيح");
  await expect(page.getByTestId("correction-reference")).toHaveText("المرجع: POS-42");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue("POS-42");
  expect(writes.map((write) => write.id)).toEqual([saleShortId]);
  expect(writes[0]?.operationId).toMatch(/^[0-9a-f-]{36}$/i);

  const staffId = await page.evaluate(() => {
    const raw = localStorage.getItem("bravos.account");
    const current = raw ? JSON.parse(raw) as { staffId?: string } : {};
    return current.staffId ?? "";
  });
  expect(staffId).not.toBe("");
  await page.evaluate(({ staffId: id, recordId, operationId: savedOperationId }) => {
    const attempt = {
      staffId: id,
      target: "sale",
      recordId,
      operationId: savedOperationId,
      input: {
        operationId: savedOperationId,
        expectedRevision: 0,
        type: "correction",
        reason: "تصحيح سابق غير مؤكد",
        effective: { finalTotalPiasters: 15000, lines: [] },
        merchandise: [],
        cash: null,
      },
    };
    const key = `bravos.corrections.pending.${id}`;
    localStorage.setItem(key, JSON.stringify(attempt));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, { staffId, recordId: saleLongId, operationId });
  await expect(page.getByTestId("pending-correction-attempt")).toBeVisible();
  await page.getByRole("button", { name: "إعادة محاولة التصحيح السابق نفسه" }).click();
  await expect(page.getByRole("status")).toContainText("تم العثور على نتيجة عملية التصحيح السابقة");
  await expect(page.getByTestId("correction-reference")).toHaveText(`المرجع: ${saleLongId}`);
  await expect(page.getByTestId("correction-reference")).not.toContainText("POS-42");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue(saleLongId);
  await expect(form.getByLabel("مرجع التسجيل")).not.toHaveValue("POS-42");
  expect(writes[1]).toEqual({ id: saleLongId, operationId });

  await page.getByLabel("سبب التصحيح").fill("تصحيح التسجيل الثاني");
  await page.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصحيح");
  await expect(page.getByTestId("correction-reference")).not.toContainText("POS-42");
  await expect(form.getByLabel("مرجع التسجيل")).toHaveValue(saleLongId);
  expect(writes[2]?.id).toBe(saleLongId);
  expect(writes[2]?.operationId).not.toBe(operationId);
  expect(writes.map((write) => write.id)).toEqual([saleShortId, saleLongId, saleLongId]);
});

test("a late return page is ignored after the account generation changes", async ({ page }) => {
  await signIn(page);
  const calls: string[] = [];
  const pageTwo = deferred();
  await mockReturnPages(page, async (cursor) => {
    if (!cursor) return { items: [{ id: returnOtherId, reference: "RET-1" }], nextCursor: returnCursor };
    pageTwo.seen();
    await pageTwo.promise;
    return { items: [{ id: returnId, reference: "RET-50" }], nextCursor: null };
  });
  await mockCorrectionDetails(page, calls);
  await page.goto(`${BASE}/corrections`);
  const form = page.getByRole("form", { name: "فتح تسجيل للتصحيح" });
  await form.getByLabel("نوع التسجيل").selectOption("return");
  await form.getByLabel("مرجع التسجيل").fill("RET-50");
  await form.getByRole("button", { name: "فتح التفاصيل", exact: true }).click();
  await pageTwo.seenPromise;
  await bumpSameAccount(page);
  pageTwo.resolve();
  await expect(form.getByRole("button", { name: "فتح التفاصيل", exact: true })).toBeEnabled();
  await expect(page.getByTestId("correction-details")).toHaveCount(0);
  expect(calls).toEqual([]);
});

function deferred() {
  let resolve!: () => void;
  let seen!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  const seenPromise = new Promise<void>((accept) => { seen = accept; });
  return { promise, resolve, seen, seenPromise };
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function bumpSameAccount(page: Page) {
  const staffId = await page.evaluate(() => {
    const raw = localStorage.getItem("bravos.account");
    const current = raw ? JSON.parse(raw) as { staffId?: string | null } : {};
    if (typeof current.staffId !== "string" || current.staffId.length === 0) return null;
    window.dispatchEvent(new CustomEvent("bravos-account", {
      detail: { eventId: crypto.randomUUID(), generation: 0, staffId: current.staffId },
    }));
    return current.staffId;
  });
  expect(staffId, "account isolation needs the signed-in staff id").toBeTruthy();
}

async function mockSaleList(page: Page, sales: () => Array<{ id: string; reference: string }>) {
  await page.route(/\/api\/internal\/sales(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/internal/sales") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: sales() });
  });
}

async function mockReturnPages(
  page: Page,
  pageFor: (cursor: string | null) => Promise<{ items: Array<{ id: string; reference: string }>; nextCursor: string | null }> | { items: Array<{ id: string; reference: string }>; nextCursor: string | null },
) {
  await page.route(/\/api\/internal\/returns(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/internal/returns") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: await pageFor(url.searchParams.get("cursor")) });
  });
}

async function mockCorrectionDetails(page: Page, calls: string[]) {
  await page.route(/\/api\/internal\/corrections\/(?:sales|returns)\//, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    calls.push(id);
    const isReturn = url.pathname.includes("/returns/");
    await route.fulfill({ json: isReturn ? returnDetail(id) : saleDetail(id) });
  });
}

function saleDetail(id: string) {
  return {
    targetType: "sale",
    id,
    reference: id,
    revision: 0,
    status: "active",
    original: { finalTotalPiasters: 15000, lines: [] },
    effective: { finalTotalPiasters: 15000, lines: [] },
    relationships: { returns: [] },
    actual: {
      originalCashReceivedPiasters: 15000,
      correctionCashPaidOutPiasters: 0,
      correctionCashRecoveredPiasters: 0,
      netCashReceivedPiasters: 15000,
      merchandiseRestoredQuantity: 0,
      merchandiseDeductedQuantity: 0,
    },
    changes: [],
  };
}

function returnDetail(id: string) {
  return {
    targetType: "return",
    id,
    reference: id,
    source: { kind: "physical_sale", id: saleDeepId },
    revision: 0,
    status: "active",
    original: {
      authorizedRefund: { merchandisePiasters: 8000, checkoutChargePiasters: 0, totalPiasters: 8000 },
      authorizedRefundPiasters: 8000,
      paidPiasters: 0,
      lines: [],
    },
    effective: {
      authorizedRefund: { merchandisePiasters: 8000, checkoutChargePiasters: 0, totalPiasters: 8000 },
      authorizedRefundPiasters: 8000,
      paidPiasters: 0,
      lines: [],
    },
    actual: {
      originalRefundPaidPiasters: 0,
      exchangeCreditAppliedPiasters: 0,
      correctionCashPaidOutPiasters: 0,
      correctionCashRecoveredPiasters: 0,
      netRefundPaidPiasters: 0,
      merchandiseRestoredQuantity: 0,
      merchandiseDeductedQuantity: 0,
    },
    changes: [],
  };
}
