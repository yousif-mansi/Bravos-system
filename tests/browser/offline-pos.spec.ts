import { stageUnpaidPosQuote } from "./support/pos-checkout";
import { expect, test, type Page } from "@playwright/test";

test("cashier completes an offline cash sale from an issued snapshot and keeps 275/175", async ({ page }) => {
  const seed = await seedTwoPriceProduct(page);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  await page.route("**/api/internal/**", async (route) => {
    if (route.request().url().includes("/api/internal/sales/pos-snapshots")) {
      await route.continue();
      return;
    }
    await route.abort("failed");
  });

  await addTwoPricedProducts(page, seed);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("50");
  await expect(checkout).toContainText("450");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect(page.getByTestId("sale-details")).toContainText("275");
  await expect(page.getByTestId("sale-details")).toContainText("175");
  await expect(page.getByTestId("sale-details")).toContainText(/رقم الإيصال: BRV-\d+-\d+/);
  await expect(page.getByTestId("sale-details")).not.toContainText("عملية محلية");

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
});

test("local stock effects reject selling three of two remaining units across repeated rows", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 12000, code: "OFF-QTY" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/catalog/lookup**", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));

  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("الكمية").first().fill("3");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("alert")).toContainText("الكمية المتاحة غير كافية.");
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await expect(checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة")).toHaveCount(0);
  await expect(checkout.getByRole("button", { name: "إتمام البيع", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toHaveCount(0);
  const state = await readPosState(page);
  expect(state.sales).toEqual([]);
  expect(state.effects).toEqual([]);
});

test("two tabs cannot sell the same remaining cached unit", async ({ context }) => {
  const page = await context.newPage();
  const seed = await seedSingleProduct(page, { quantity: 1, price: 15000, code: "OFF-TAB" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const page2 = await context.newPage();
  await page2.goto("http://127.0.0.1:5174/lookup");
  await expect(page2.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  for (const tab of [page, page2]) {
    await tab.route("**/api/internal/catalog/lookup**", (route) => route.abort("failed"));
    await tab.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
    await tab.route("**/api/internal/sales", (route) => route.abort("failed"));
    await tab.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  }
  for (const tab of [page, page2]) {
    const lookup = tab.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
    await lookup.getByRole("button", { name: "بحث" }).click();
    await tab.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = tab.getByRole("form", { name: "إتمام البيع" });
    await stageUnpaidPosQuote(checkout);
  }
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await page2.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  const shortage = page2.getByRole("alert").filter({ hasText: "الكمية المتاحة غير كافية." });
  await expect(shortage).toContainText("الكمية المتاحة غير كافية.");
  await expect(page2.getByRole("status").filter({ hasText: "تم حفظ البيع." })).toHaveCount(0);
  await expect(page2.getByTestId("sale-cart")).toContainText(seed.code);
  await expect(page2.getByTestId("complete-sale")).toBeVisible();
  const state = await readPosState(page);
  expect(state.sales).toHaveLength(1);
  const saved = state.sales[0];
  expect(saved?.lines[0]?.quantity).toBe(1);
  expect(saved?.finalTotalPiasters).toBe(15000);
  expect(saved?.id).toBeTruthy();
  expect(saved?.operationId).toBeTruthy();
  expect(state.effects).toHaveLength(1);
  expect(state.effects[0]).toMatchObject({
    id: `${saved?.operationId}:${state.effects[0]?.variantId}`,
    operationId: saved?.operationId,
    quantity: 1,
  });
});

test("storage failure does not claim a saved sale", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 18000, code: "OFF-FAIL" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await stageUnpaidPosQuote(checkout);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    const put = IDBObjectStore.prototype.put;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosAdd?: typeof add }).__bravosAdd = add;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosPut?: typeof put }).__bravosPut = put;
    const fail = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    IDBObjectStore.prototype.add = fail as typeof add;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === "sales" || this.name === "effects") {
        fail();
      }
      return put.apply(this, args as [IDBValidKey]);
    };
  });
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("alert")).toContainText(/تعذر حفظ البيع محلياً|لم تكتمل جاهزية/);
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع." })).toHaveCount(0);
  await expect(page.getByTestId("sale-cart")).toContainText(seed.code);
  const state = await readPosState(page);
  expect(state.sales).toEqual([]);
  expect(state.effects).toEqual([]);
});

test("aborted IndexedDB writes roll back and retry the same completed sale identity", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 19000, code: "OFF-ABORT" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await stageUnpaidPosQuote(checkout);
  const pendingBefore = await readPosState(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    const put = IDBObjectStore.prototype.put;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosAdd?: typeof add }).__bravosAdd = add;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosPut?: typeof put }).__bravosPut = put;
    const aborting = function (this: IDBObjectStore, ...args: unknown[]) {
      const request = add.apply(this, args as [IDBValidKey]);
      this.transaction.abort();
      return request;
    };
    IDBObjectStore.prototype.add = aborting as typeof add;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === "sales" || this.name === "effects") {
        const request = put.apply(this, args as [IDBValidKey]);
        this.transaction.abort();
        return request;
      }
      return put.apply(this, args as [IDBValidKey]);
    };
  });
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("alert")).toContainText("تعذر حفظ البيع محلياً");
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع." })).toHaveCount(0);
  const afterAbort = await readPosState(page);
  expect(afterAbort.sales).toEqual([]);
  expect(afterAbort.effects).toEqual([]);
  expect(afterAbort.numberingRaw).toBe(pendingBefore.numberingRaw);
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as IDBObjectStore & {
      __bravosAdd?: typeof IDBObjectStore.prototype.add;
      __bravosPut?: typeof IDBObjectStore.prototype.put;
    };
    if (proto.__bravosAdd) {
      proto.add = proto.__bravosAdd;
    }
    if (proto.__bravosPut) {
      proto.put = proto.__bravosPut;
    }
  });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const saved = await readPosState(page);
  expect(saved.sales).toHaveLength(1);
  expect(saved.sales[0]?.receiptReference).toMatch(/^BRV-\d+-\d+$/);
  expect(saved.sales[0]?.receiptClaim?.reference).toBe(saved.sales[0]?.receiptReference);
  if (pendingBefore.numbering && typeof pendingBefore.numbering === "object" && pendingBefore.numbering.nextSequence) {
    expect(saved.numbering && typeof saved.numbering === "object" ? saved.numbering.nextSequence : "").not.toBe(pendingBefore.numbering.nextSequence);
  }
  expect(saved.sales[0]?.id).toBe(pendingBefore.pending[0]?.saleId ?? saved.sales[0]?.id);
  expect(saved.sales[0]?.operationId).toBe(pendingBefore.pending[0]?.operationId ?? saved.sales[0]?.operationId);
  expect(saved.sales[0]?.finalTotalPiasters).toBe(19000);
  expect(saved.effects).toHaveLength(1);
});

test("sign-out preserves queued sales and another cashier cannot read or submit them", async ({ page, context }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 22000, code: "OFF-PRIV" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPosState(page)).sales[0];
  expect(original?.soldByDisplayName).toBe("كاشير تجريبي");
  const lookupForm = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookupForm.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  let releaseLookup: () => void = () => undefined;
  const heldLookup = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  let markLookupStarted: () => void = () => undefined;
  const lookupStarted = new Promise<void>((resolve) => {
    markLookupStarted = resolve;
  });
  await page.route("**/api/internal/catalog/lookup**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/api/internal/catalog/lookup" && url.searchParams.get("code") === seed.code) {
      markLookupStarted();
      await heldLookup;
    }
    await route.continue();
  });
  try {
    await lookupForm.getByRole("button", { name: "بحث" }).click();
    await lookupStarted;
    await expect(lookupForm.getByRole("button", { name: "جارٍ البحث…" })).toBeVisible();
  } finally {
    releaseLookup();
    await page.unroute("**/api/internal/catalog/lookup**");
  }
  await expect(lookupForm.getByRole("button", { name: "بحث" })).toBeEnabled();
  const again = page.getByTestId("lookup-result");
  await expect(again).toContainText(seed.nameAr);
  await again.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const openTab = page;
  const pageB = await context.newPage();
  const submittedIds: string[] = [];
  for (const tab of [openTab, pageB]) {
    await tab.route("**/api/internal/sales/accepted", async (route) => {
      const payload = route.request().postDataJSON() as { saleId?: string };
      if (payload.saleId) {
        submittedIds.push(payload.saleId);
      }
      await route.abort("failed");
    });
    await tab.route("**/api/internal/sales", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST" && url.pathname === "/api/internal/sales") {
        const payload = route.request().postDataJSON() as { saleId?: string };
        if (payload.saleId) {
          submittedIds.push(payload.saleId);
        }
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
  }
  await pageB.goto("http://127.0.0.1:5174/workspace");
  await pageB.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(pageB.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  submittedIds.length = 0;
  await pageB.getByLabel("اسم الدخول").fill("cashier-b");
  await pageB.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await pageB.getByRole("button", { name: "دخول" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await expect(pageB.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await waitForPosWriteQueue(pageB);
  await expect.poll(async () => openTab.getByTestId("sale-details").count()).toBe(0);
  await pageB.getByRole("link", { name: "المبيعات" }).click();
  await expect(pageB.getByText("كاشير تجريبي")).toHaveCount(0);
  await expect(pageB.getByTestId("sale-list")).toHaveCount(0);
  expect(submittedIds).not.toContain(original?.id);
  const preserved = (await readPosState(openTab)).sales.find((sale) => sale.id === original?.id);
  expect(preserved?.operationId).toBe(original?.operationId);
  expect(preserved?.finalTotalPiasters).toBe(original?.finalTotalPiasters);
  await pageB.getByRole("button", { name: "تسجيل الخروج" }).click();
  await pageB.getByLabel("اسم الدخول").fill("cashier");
  await pageB.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await pageB.getByRole("button", { name: "دخول" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  await pageB.getByRole("link", { name: "المبيعات" }).click();
  await expect(pageB.getByTestId("sale-list")).toContainText("كاشير تجريبي");
  await expect(pageB.getByTestId("sale-details")).toContainText("220");
  const recovered = (await readPosState(pageB)).sales.find((sale) => sale.id === original?.id);
  expect(recovered?.operationId).toBe(original?.operationId);
  expect(recovered?.finalTotalPiasters).toBe(22000);
  await pageB.close();
});

test("a delayed manager sales response cannot overwrite a cashier after another tab switches", async ({
  page,
  context,
}) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تكلفة مؤجلة" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تكلفة" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تكلفة" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "OFF-DELAY-COST",
    nameAr: "بيع تكلفة مؤجلة",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 18000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 7000 }],
  });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-DELAY-COST");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  let releaseSales: () => void = () => undefined;
  const heldSales = new Promise<void>((resolve) => {
    releaseSales = resolve;
  });
  let capturingSales = false;
  let deliveredSales = false;
  const capturedSales: string[] = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname === "/api/internal/sales" && capturedSales.length === 0 && !capturingSales) {
      capturingSales = true;
      const response = await route.fetch();
      const body = await response.text();
      capturedSales.push(body);
      await heldSales;
      await route.fulfill({
        status: response.status(),
        headers: { "content-type": "application/json" },
        body,
      });
      deliveredSales = true;
      return;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect.poll(() => capturedSales.length).toBe(1);
  expect(capturedSales[0]).toContain("allocations");
  const capturedManagerSales = JSON.parse(capturedSales[0]) as Array<{
    id: string;
    soldByDisplayName: string;
    soldByStaffId: string;
    allocations: unknown[];
    lines: Array<{ variant: { product: { code: string; nameAr: string } } }>;
  }>;
  expect(capturedManagerSales.length).toBeGreaterThan(0);
  const managerSale = capturedManagerSales[0];
  if (!managerSale) {
    throw new Error("captured manager sale missing");
  }
  expect(managerSale.id).toBeTruthy();
  expect(managerSale.allocations.length).toBeGreaterThan(0);
  expect(managerSale.lines[0]?.variant.product.code).toBe("OFF-DELAY-COST");
  expect(managerSale.lines[0]?.variant.product.nameAr).toBe("بيع تكلفة مؤجلة");
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/workspace");
  await pageB.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(pageB.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await pageB.getByLabel("اسم الدخول").fill("cashier");
  await pageB.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await pageB.getByRole("button", { name: "دخول" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const currentId = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return currentId ?? "";
    });
  }).not.toBe("");
  const staffB = (await staffApi(pageB, "GET", "/api/internal/workspace")).body.staff.id as string;
  await expect.poll(async () => {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const currentId = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return currentId ?? "";
    });
  }).toBe(staffB);
  releaseSales();
  await expect.poll(() => deliveredSales).toBe(true);
  await waitForPosWriteQueue(page);
  await expect(page.getByText("جارٍ التحميل…")).toHaveCount(0);
  await expect(page.getByTestId("sale-costs")).toHaveCount(0);
  await expect(page.getByText("تكلفة الدفعات")).toHaveCount(0);
  await expect(page.getByText(managerSale.id)).toHaveCount(0);
  await expect(page.getByText("بيع تكلفة مؤجلة")).toHaveCount(0);
  await expect(page.getByText("OFF-DELAY-COST")).toHaveCount(0);
  await expect(page.getByTestId("sale-list")).toHaveCount(0);
  await expect(page.getByTestId("sale-details")).toHaveCount(0);
  const pageStaff = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentId = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return currentId ?? "";
  });
  expect(pageStaff).toBe(staffB);
  await pageB.close();
});

test("a delayed explicit workspace persist cannot adopt a newer login revision", async ({ page, context }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/workspace");
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await holdSessionRevisionReads(page);
  await page.getByRole("button", { name: "الفيوم" }).click();
  await expect.poll(() => page.evaluate(() => window.__bravosSessionRevisionReadStarted === true)).toBe(true);
  await pageB.getByRole("link", { name: "تغيير الفرع" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await waitForPosWriteQueue(pageB);
  const afterB = await readCurrentWorkspace(pageB);
  expect(afterB.branchName).toBe("أبشواي");
  expect(afterB.branchCode).toBe("abshway");
  await releaseSessionRevisionReads(page);
  await waitForPosWriteQueue(page);
  await waitForPosWriteQueue(pageB);
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await expect(pageB.getByTestId("active-branch")).not.toContainText("الفيوم");
  const stored = await readCurrentWorkspace(pageB);
  expect(stored.branchName).toBe("أبشواي");
  expect(stored.branchCode).toBe("abshway");
  const storedOnA = await readCurrentWorkspace(page);
  expect(storedOnA.currentId).toBe(stored.currentId);
  expect(storedOnA.branchCode).toBe("abshway");
  expect(storedOnA.branchName).toBe("أبشواي");
  await pageB.close();
});

test("a delayed workspace response after sign-out cannot restore the previous session", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  let releaseWorkspace: () => void = () => undefined;
  const heldWorkspace = new Promise<void>((resolve) => {
    releaseWorkspace = resolve;
  });
  let capturingWorkspace = false;
  let deliveredWorkspace = false;
  const capturedWorkspace: string[] = [];
  await page.route("**/api/internal/workspace", async (route) => {
    if (capturedWorkspace.length === 0 && !capturingWorkspace) {
      capturingWorkspace = true;
      const response = await route.fetch();
      const body = await response.text();
      capturedWorkspace.push(body);
      await heldWorkspace;
      await route.fulfill({
        status: response.status(),
        headers: { "content-type": "application/json" },
        body,
      });
      deliveredWorkspace = true;
      return;
    }
    await route.continue();
  });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect.poll(() => capturedWorkspace.length).toBe(1);
  expect(capturedWorkspace[0]).toContain("كاشير تجريبي");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  releaseWorkspace();
  await expect.poll(() => deliveredWorkspace).toBe(true);
  await waitForPosWriteQueue(page);
  await expect(page.getByText("جارٍ التحميل…")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByRole("link", { name: "البحث عن منتج" })).toHaveCount(0);
  const current = await readPosSession(page);
  expect(current.currentId).toBeNull();
});

test("logout after reload still signs out so an offline restart cannot restore the account", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  const current = await readPosSession(page);
  expect(current.currentId).toBeNull();
  expect(current.rows.every((row) => row.signedOut)).toBe(true);
  await expect(page.getByRole("link", { name: "البحث عن منتج" })).toHaveCount(0);
});

test("explicit logout from catalog, staff and receiving pages marks the session signed out", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  for (const [linkName, heading] of [
    ["المنتجات", "إدارة المنتجات"],
    ["الموظفون", "إدارة الموظفين"],
    ["استلام المخزون", "استلام المخزون"],
  ] as const) {
    await page.getByRole("link", { name: linkName }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    const current = await readPosSession(page);
    expect(current.currentId).toBeNull();
    expect(current.rows.every((row) => row.signedOut)).toBe(true);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
  }
});

test("a fresh cashier login keeps an old cached session from becoming current", async ({ page, context }) => {
  const seed = await seedSingleProduct(page, { quantity: 1, price: 14000, code: "OFF-SESS" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPosState(page)).sales[0];
  expect(original?.staffId).toBeTruthy();
  const expired = await page.request.fetch("http://127.0.0.1:5174/api/auth/sign-out", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:5174",
      "content-type": "application/json",
    },
    data: {},
  });
  expect(expired.ok()).toBe(true);
  const beforeB = await readPosSession(page);
  expect(beforeB.currentId).toBe(original?.staffId);
  expect(beforeB.rows.find((row) => row.staffId === original?.staffId)?.signedOut).toBe(false);
  const pageB = await context.newPage();
  await pageB.goto("http://127.0.0.1:5174/login");
  await expect(pageB.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await pageB.getByLabel("اسم الدخول").fill("cashier-b");
  await pageB.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await pageB.getByRole("button", { name: "دخول" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  const sessions = await readPosSession(pageB);
  const sales = (await readPosState(pageB)).sales;
  expect(sales.some((sale) => sale.id === original?.id)).toBe(true);
  const workspaceB = await staffApi(pageB, "GET", "/api/internal/workspace");
  const staffB = workspaceB.body.staff.id as string;
  expect(staffB.length).toBeGreaterThan(0);
  expect(sessions.currentId).toBe(staffB);
  expect(sessions.currentId).not.toBe(original?.staffId);
  expect(sessions.rows.find((row) => row.staffId === original?.staffId)?.signedOut).toBe(false);
  expect(sessions.rows.find((row) => row.staffId === staffB)?.signedOut).toBe(false);
  await expect(pageB.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await pageB.getByRole("link", { name: "المبيعات" }).click();
  await expect(pageB.getByText("كاشير تجريبي")).toHaveCount(0);
  await pageB.close();
});

test("cached availability stays distinct from local effects so 5 then 1 then 4 sells to zero", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 5, price: 11000, code: "OFF-BASE" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/catalog/lookup**", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  async function sell(quantity: number) {
    const result = await searchProduct(page, seed.code);
    await expect(result).toContainText(seed.nameAr);
    await result.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByLabel("الكمية").fill(String(quantity));
    await checkout.getByTestId("complete-sale").click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  }
  await sell(1);
  const afterFirst = await searchProduct(page, seed.code);
  await expect(afterFirst).toContainText(seed.nameAr);
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 4");
  await sell(4);
  const state = await readPosState(page);
  expect(state.sales).toHaveLength(2);
  expect(state.effects.reduce((sum, effect) => sum + effect.quantity, 0)).toBe(5);
  const afterAll = await searchProduct(page, seed.code);
  await expect(afterAll).toContainText(seed.nameAr);
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 0");
});

test("retrying a committed last-unit sale recovers the original fact", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 1, price: 16500, code: "OFF-LAST" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const first = (await readPosState(page)).sales[0];
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sale = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction("sales", "readonly");
      const req = tx.objectStore("sales").getAll();
      req.onsuccess = () => resolve(req.result[0] as Record<string, unknown>);
      req.onerror = () => reject(req.error);
    });
    const snapshotRow = await new Promise<{ snapshot: unknown }>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly");
      const req = tx.objectStore("snapshots").get(String(sale.staffId));
      req.onsuccess = () => resolve(req.result as { snapshot: unknown });
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("pending", "readwrite");
    tx.objectStore("pending").put({
      staffId: sale.staffId,
      saleId: sale.id,
      operationId: sale.operationId,
      phase: "uncertain",
      physicallyCompleted: true,
      digest: null,
      payload: {
        customerName: sale.customerName ?? null,
        customerPhone: sale.customerPhone ?? null,
        employeeDiscountPiasters: sale.employeeDiscountPiasters,
        discountReason: sale.discountReason ?? null,
        lines: (sale.lines as Array<{ variantId: string; quantity: number }>).map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
        })),
      },
      occurredAt: sale.occurredAt,
      pricingOccurredAt: sale.pricingOccurredAt ?? null,
      quote: { ...sale, physicallyCompleted: true },
      snapshot: snapshotRow.snapshot,
      quoteOrigin: "snapshot",
      cachedByVariant: Object.fromEntries(
        ((snapshotRow.snapshot as { products: Array<{ variants: Array<{ id: string; availableQuantity: number }> }> }).products ?? []).flatMap(
          (product) => product.variants.map((variant) => [variant.id, variant.availableQuantity]),
        ),
      ),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  await page.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText(/تم حفظ البيع|تم العثور على البيع المحفوظ/);
  const after = await readPosState(page);
  expect(after.sales).toHaveLength(1);
  expect(after.sales[0]?.id).toBe(first?.id);
  expect(after.sales[0]?.finalTotalPiasters).toBe(16500);
  expect(after.effects).toHaveLength(1);
});

test("another tab replacing the snapshot cannot reprice an accepted quote", async ({ page, context }) => {
  const seed = await seedTwoPriceProduct(page);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addTwoPricedProducts(page, seed);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("50");
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("accepted-prices")).toContainText("450");
  const page2 = await context.newPage();
  await page2.goto("http://127.0.0.1:5174/workspace");
  await page2.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("snapshots", "readwrite");
    const store = tx.objectStore("snapshots");
    const rows = await new Promise<Array<{ staffId: string; snapshot: { snapshotId: string; branch: { id: string; code: string; nameAr: string }; products: Array<{ variants: Array<{ id: string; sellingPricePiasters: number; availableQuantity: number }> }> } }>>(
      (resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      },
    );
    const row = rows[0];
    if (row) {
      row.snapshot.snapshotId = crypto.randomUUID();
      row.snapshot.branch = { id: row.snapshot.branch.id, code: "fayoum", nameAr: "الفيوم" };
      for (const product of row.snapshot.products) {
        for (const variant of product.variants) {
          variant.sellingPricePiasters = 90000;
        }
      }
      store.put(row);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page2.close();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect(page.getByTestId("sale-details")).toContainText("أبشواي");
  await expect(page.getByTestId("sale-details")).toContainText("275");
  await expect(page.getByTestId("sale-details")).toContainText("175");
  const saved = (await readPosState(page)).sales[0];
  expect(saved?.branch.code).toBe("abshway");
  expect(saved?.originalTotalPiasters).toBe(50000);
  expect(saved?.finalTotalPiasters).toBe(45000);
});

test("legacy pending markers survive failed writes and colliding staff rows", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 13000, code: "OFF-LEG" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  const staffId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["meta", "sessions"], "readonly");
    const currentId = await new Promise<string>((resolve, reject) => {
      const req = tx.objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value ?? "");
      req.onerror = () => reject(req.error);
    });
    db.close();
    return currentId;
  });
  expect(staffId).not.toBe("");
  const firstSale = crypto.randomUUID();
  const firstOp = crypto.randomUUID();
  const secondSale = crypto.randomUUID();
  const secondOp = crypto.randomUUID();
  await page.evaluate(
    ({ staffId: id, firstSale: saleA, firstOp: opA, secondSale: saleB, secondOp: opB }) => {
      localStorage.setItem(
        `bravos.sales.pending.${id}`,
        JSON.stringify({
          staffId: id,
          saleId: saleA,
          operationId: opA,
          phase: "uncertain",
          physicallyCompleted: true,
          digest: null,
          payload: null,
          occurredAt: "2026-09-11T08:00:00.000Z",
          quote: null,
        }),
      );
      localStorage.setItem(
        `bravos.sales.pending.${id}-extra`,
        JSON.stringify({
          staffId: id,
          saleId: saleB,
          operationId: opB,
          phase: "uncertain",
          physicallyCompleted: true,
          digest: null,
          payload: null,
          occurredAt: "2026-09-11T08:05:00.000Z",
          quote: null,
        }),
      );
    },
    { staffId, firstSale, firstOp, secondSale, secondOp },
  );
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const add = IDBObjectStore.prototype.add;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosPut?: typeof put; __bravosAdd?: typeof add }).__bravosPut = put;
    (IDBObjectStore.prototype as IDBObjectStore & { __bravosAdd?: typeof add }).__bravosAdd = add;
    const fail = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === "pending" || this.name === "legacyPending") {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return put.apply(this, args as [IDBValidKey]);
    };
    IDBObjectStore.prototype.put = fail as typeof put;
    IDBObjectStore.prototype.add = fail as typeof add;
  });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  const leftover = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("bravos.sales.pending.")).map((key) => localStorage.getItem(key)),
  );
  expect(leftover.some(Boolean)).toBe(true);
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as IDBObjectStore & {
      __bravosPut?: typeof IDBObjectStore.prototype.put;
      __bravosAdd?: typeof IDBObjectStore.prototype.add;
    };
    if (proto.__bravosPut) {
      proto.put = proto.__bravosPut;
    }
    if (proto.__bravosAdd) {
      proto.add = proto.__bravosAdd;
    }
  });
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  const migrated = await readPosState(page);
  const pendingIds = [...migrated.pending, ...migrated.legacyPending].map((row) => row.saleId).sort();
  expect(pendingIds).toContain(firstSale);
  expect(pendingIds).toContain(secondSale);
  await expect(page.getByTestId("complete-sale")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("تم تسليم البضاعة واستلام المبلغ");
  void seed;
});

test("manager cost views do not become cashier offline cache", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 3, price: 14000, code: "OFF-COST" });
  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect(page.getByRole("heading", { name: "المبيعات", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  const leaked = await page.evaluate(async () => {
    const haystacks: string[] = [];
    const dbNames = (await indexedDB.databases()).map((item) => item.name).filter((name): name is string => Boolean(name));
    for (const name of dbNames) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of Array.from(db.objectStoreNames)) {
        const tx = db.transaction(storeName, "readonly");
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const getAll = tx.objectStore(storeName).getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        });
        haystacks.push(JSON.stringify(rows));
      }
      db.close();
    }
    if ("caches" in window) {
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          haystacks.push(request.url);
          const response = await cache.match(request);
          if (response) {
            haystacks.push(await response.clone().text());
          }
        }
      }
    }
    haystacks.push(JSON.stringify(localStorage));
    return /unitCostPiasters|inventoryValue|purchaseCost|تكلفة الدفعات/.test(haystacks.join("\n"));
  });
  expect(leaked).toBe(false);
  await page.getByRole("link", { name: "المبيعات" }).click();
  await expect(page.getByTestId("sale-costs")).toHaveCount(0);
  void seed;
});

test("explicit offline sign-out blocks POS until online reauthentication", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 17000, code: "OFF-OUT" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPosState(page)).sales[0];
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByRole("link", { name: "البحث عن منتج" })).toHaveCount(0);
  const preserved = (await readPosState(page)).sales.find((sale) => sale.id === original?.id);
  expect(preserved?.finalTotalPiasters).toBe(original?.finalTotalPiasters);
  await page.context().setOffline(false);
});

test("reconnect retries the original accepted sale once without repricing", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 3, price: 21000, code: "OFF-RETRY" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const local = (await readPosState(page)).sales[0];
  expect(local?.finalTotalPiasters).toBe(21000);
  await page.unroute("**/api/internal/sales/accepted");
  await page.unroute("**/api/internal/sales");
  await page.unroute("**/api/internal/sales/prepare");
  await expect
    .poll(async () => {
      const listed = await staffApi(page, "GET", "/api/internal/sales");
      return listed.body.filter((sale: { id: string }) => sale.id === local?.id).length;
    }, { timeout: 30_000 })
    .toBe(1);
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const synced = listed.body.find((sale: { id: string }) => sale.id === local?.id);
  expect(synced.soldByDisplayName).toBe("كاشير تجريبي");
  expect(synced.branch.code).toBe("abshway");
  expect(synced.originalTotalPiasters).toBe(21000);
  expect(synced.finalTotalPiasters).toBe(21000);
  const lookupAfter = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`);
  expect(lookupAfter.body.variants[0].availableQuantity).toBe(2);
});

test("offline stock cache keeps each branch balance separate for the same variant", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 3, price: 21000, code: "OFF-BRANCH-CACHE" });
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const branches = workspace.body.authorizedBranches as Array<{ id: string; code: string }>;
  const abshwayId = branches.find((branch) => branch.code === "abshway")?.id;
  const fayoumId = branches.find((branch) => branch.code === "fayoum")?.id;
  expect(abshwayId && fayoumId).toBeTruthy();
  const product = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${seed.code}`);
  const variantId = product.body.variants[0].id as string;
  const fayoumReceipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: fayoumId, receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 1, unitCostPiasters: 4000 }],
  });
  expect(fayoumReceipt.status).toBe(201);

  const loginName = `branch.cache.${crypto.randomUUID().slice(0, 8)}`;
  const staff = await staffApi(page, "POST", "/api/internal/staff", {
    loginName,
    displayName: "كاشير الفرعين",
    password: "e2e-both-branch-pass",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  expect(staff.status).toBe(201);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill("e2e-both-branch-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 3");

  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await page.getByRole("button", { name: "الفيوم" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 1");
  const availability = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const raw = await new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction("meta", "readonly").objectStore("meta").get("stockCache");
      request.onsuccess = () => resolve((request.result as { value?: string } | undefined)?.value);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return JSON.parse(raw ?? "{}") as { availability: Record<string, number> };
  });
  expect(availability.availability[`${abshwayId}:${variantId}`]).toBe(3);
  expect(availability.availability[`${fayoumId}:${variantId}`]).toBe(1);
});

test("queued sales survive a preserving schema upgrade and unsafe upgrades stay deferred", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 15500, code: "OFF-MIG" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPosState(page)).sales[0];
  const version = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const current = db.version;
    db.close();
    return current;
  });
  expect(version).toBeGreaterThanOrEqual(2);
  const unsafe = await page.evaluate(async () => {
    const opened = await new Promise<string>((resolve) => {
      const request = indexedDB.open("bravos-pos", 99);
      request.onupgradeneeded = (event) => {
        const tx = (event.target as IDBOpenDBRequest).transaction;
        tx?.abort();
      };
      request.onsuccess = () => {
        request.result.close();
        resolve("opened");
      };
      request.onerror = () => resolve("blocked");
    });
    return opened;
  });
  expect(unsafe).toBe("blocked");
  const preserved = (await readPosState(page)).sales.find((sale) => sale.id === original?.id);
  expect(preserved?.finalTotalPiasters).toBe(original?.finalTotalPiasters);
  expect(preserved?.operationId).toBe(original?.operationId);
});

async function searchProduct(page: Page, code: string) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(code);
  const submit = lookup.locator('button[type="submit"]');
  await expect(submit).toBeEnabled();
  await submit.click();
  const result = page.getByTestId("lookup-result");
  await expect(result).toBeVisible();
  await expect(submit).toHaveText("بحث");
  await expect(submit).toBeEnabled();
  return result;
}

async function signInAsCashier(page: Page) {
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function seedSingleProduct(
  page: Page,
  options: { quantity: number; price: number; code: string },
) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
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
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.operationalVariantId as string, quantity: options.quantity, unitCostPiasters: 4000 }],
  });
  return { code: options.code, nameAr, sizeName, colorName };
}

async function seedTwoPriceProduct(page: Page, code = `OFF-MIX-${crypto.randomUUID().slice(0, 8)}`) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${code}` });
  const black = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${code}` });
  const white = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `أبيض ${code}` });
  const expensive = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `${code}-HIGH`,
    nameAr: "قميص أوفلاين غالي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: black.body.id, sellingPricePiastersOverride: null }],
  });
  const cheap = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: `${code}-LOW`,
    nameAr: "قميص أوفلاين رخيص",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: null }],
  });
  expect(expensive.status).toBe(201);
  expect(cheap.status).toBe(201);
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: expensive.body.operationalVariantId as string, quantity: 2, unitCostPiasters: 9000 }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: cheap.body.operationalVariantId as string, quantity: 2, unitCostPiasters: 9000 }],
  });
  return {
    expensiveCode: `${code}-HIGH`,
    cheapCode: `${code}-LOW`,
    expensiveName: "قميص أوفلاين غالي",
    cheapName: "قميص أوفلاين رخيص",
  };
}

async function addTwoPricedProducts(
  page: Page,
  seed: { expensiveCode: string; cheapCode: string; expensiveName: string },
) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.expensiveCode);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText(seed.expensiveName);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.cheapCode);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
}

declare global {
  interface Window {
    __bravosSessionRevisionReadStarted?: boolean;
    __bravosReleaseSessionRevisionReads?: () => void;
    __bravosRestoreSessionRevisionReads?: () => void;
  }
}

async function holdSessionRevisionReads(page: Page) {
  await page.evaluate(() => {
    window.__bravosRestoreSessionRevisionReads?.();
    const original = IDBObjectStore.prototype.get;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.__bravosSessionRevisionReadStarted = false;
    window.__bravosReleaseSessionRevisionReads = release;
    window.__bravosRestoreSessionRevisionReads = () => {
      IDBObjectStore.prototype.get = original;
      release();
      delete window.__bravosReleaseSessionRevisionReads;
      delete window.__bravosRestoreSessionRevisionReads;
    };
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, query?: IDBValidKey | IDBKeyRange) {
      const request = original.call(this, query);
      if (this.name !== "meta" || query !== "sessionRevision") {
        return request;
      }
      window.__bravosSessionRevisionReadStarted = true;
      let handler: ((this: IDBRequest, event: Event) => unknown) | null = null;
      Object.defineProperty(request, "onsuccess", {
        configurable: true,
        set(next: ((this: IDBRequest, event: Event) => unknown) | null) {
          handler = next;
        },
        get() {
          return handler;
        },
      });
      request.addEventListener("success", (event) => {
        void held.then(() => {
          handler?.call(request, event);
        });
      });
      return request;
    };
  });
}

async function releaseSessionRevisionReads(page: Page) {
  await page.evaluate(() => {
    window.__bravosRestoreSessionRevisionReads?.();
  });
}

async function waitForPosWriteQueue(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["meta", "sessions"], "readwrite");
      tx.objectStore("meta").get("currentStaffId");
      tx.objectStore("meta").get("sessionRevision");
      tx.objectStore("sessions").getAll();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function readCurrentWorkspace(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentId = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
    const row = currentId
      ? await new Promise<
          | {
              signedOut?: boolean;
              workspace?: { activeBranch?: { code?: string; nameAr?: string } };
            }
          | undefined
        >((resolve, reject) => {
          const req = db.transaction("sessions", "readonly").objectStore("sessions").get(currentId);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
      : undefined;
    db.close();
    return {
      currentId: currentId ?? null,
      signedOut: row?.signedOut === true,
      branchCode: row?.workspace?.activeBranch?.code ?? "",
      branchName: row?.workspace?.activeBranch?.nameAr ?? "",
    };
  });
}

async function readPosSession(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentId = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<Array<{ staffId: string; signedOut: boolean }>>((resolve, reject) => {
      const req = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return { currentId: currentId ?? null, rows };
  });
}

async function readPosState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function all<T>(name: string): Promise<T[]> {
      if (!db.objectStoreNames.contains(name)) {
        return [];
      }
      const tx = db.transaction(name, "readonly");
      return new Promise((resolve, reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    }
    const sales = await all<{
      id: string;
      operationId: string;
      staffId: string;
      soldByDisplayName: string;
      originalTotalPiasters: number;
      finalTotalPiasters: number;
      receiptReference?: string;
      receiptClaim?: { reference?: string; deviceId?: string; registrationId?: string };
      branch: { code: string };
      lines: Array<{ quantity: number }>;
    }>("sales");
    const effects = await all<{ id: string; operationId: string; quantity: number; variantId: string }>("effects");
    const pending = await all<{ saleId: string; operationId: string; staffId: string }>("pending");
    const legacyPending = await all<{ saleId: string; operationId: string; staffId: string }>("legacyPending");
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    const numberingRaw = meta.find((row) => row.key === "receiptNumbering")?.value ?? null;
    const deviceId = meta.find((row) => row.key === "deviceId")?.value ?? null;
    let numbering: { registrationId?: string; deviceId?: string; prefix?: string; nextSequence?: string } | string | null = null;
    if (numberingRaw) {
      try {
        numbering = JSON.parse(numberingRaw) as { registrationId?: string; deviceId?: string; prefix?: string; nextSequence?: string };
      } catch {
        numbering = numberingRaw;
      }
    }
    return { sales, effects, pending, legacyPending, deviceId, numberingRaw, numbering };
  });
}

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
