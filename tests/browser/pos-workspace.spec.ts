import { expect, test, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";
import { finalizePosSale, stageUnpaidPosQuote } from "./support/pos-checkout";

const internal = "http://127.0.0.1:5174";

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const response = await page.request.fetch(`${internal}${path}`, {
    method, headers: { origin: internal, ...(data ? { "content-type": "application/json" } : {}) }, data,
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

async function login(page: Page, account = "owner", branch = "أبشواي") {
  await page.goto(`${internal}/login`);
  await page.getByLabel("اسم الدخول").fill(account);
  await page.getByLabel("كلمة المرور").fill(`e2e-${account}-pass`);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.getByRole("button", { name: branch, exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText(branch);
}

async function logoutBeforeLogin(page: Page) {
  const signedOut = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/sign-out" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  expect((await signedOut).ok()).toBe(true);
}

async function seed(page: Page) {
  await login(page);
  const tag = crypto.randomUUID().slice(0, 8);
  const categoryName = `قمصان البيع ${tag}`;
  const otherCategoryName = `جاكيتات البيع ${tag}`;
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: categoryName });
  const otherCategory = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: otherCategoryName });
  const sizes = await Promise.all(["M", "L", "S"].map((name) => api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `${name}-${tag}` })));
  const colors = await Promise.all(["أزرق", "أسود", "أحمر"].map((name) => api(page, "POST", "/api/internal/catalog/colors", { nameAr: `${name}-${tag}` })));
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code: `WORKSPACE-${tag}`, nameAr: `قميص اختبار البيع ${tag}`, descriptionAr: "", categoryId: category.id,
    defaultSellingPricePiasters: 12000, publication: "hidden", imageRefs: [],
    variants: sizes.map((size, index) => ({ sizeId: size.id, colorId: colors[index].id, sellingPricePiastersOverride: index === 1 ? 18000 : null })),
  });
  const other = await api(page, "POST", "/api/internal/catalog/products", {
    code: `WORKSPACE-JACKET-${tag}`, nameAr: `جاكيت اختبار البيع ${tag}`, descriptionAr: "", categoryId: otherCategory.id,
    defaultSellingPricePiasters: 9000, publication: "hidden", imageRefs: [],
    variants: [{ sizeId: sizes[0].id, colorId: colors[1].id, sellingPricePiastersOverride: null }],
  });
  const workspace = await api(page, "GET", "/api/internal/workspace");
  const firstBranchId = workspace.activeBranch.id;
  const m = product.variants.find((variant: { size: { id: string } }) => variant.size.id === sizes[0].id);
  const l = product.variants.find((variant: { size: { id: string } }) => variant.size.id === sizes[1].id);
  await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: firstBranchId, receiptDate: "2026-10-05",
    lines: [
      { variantId: m.id, quantity: 2, unitCostPiasters: 5000 },
      { variantId: l.id, quantity: 1, unitCostPiasters: 6000 },
      { variantId: other.variants[0].id, quantity: 3, unitCostPiasters: 4000 },
    ],
  });
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await page.getByRole("button", { name: "الفيوم", exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText("الفيوم");
  const secondWorkspace = await api(page, "GET", "/api/internal/workspace");
  await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: secondWorkspace.activeBranch.id, receiptDate: "2026-10-05",
    lines: [{ variantId: m.id, quantity: 7, unitCostPiasters: 5000 }],
  });
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  return { product, other, categoryName, otherCategoryName, sizes, colors, m, firstBranchId };
}

async function openPos(page: Page) {
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByTestId("pos-product-browser")).toBeVisible();
}

async function chooseM(page: Page, data: Awaited<ReturnType<typeof seed>>) {
  await page.getByTestId("pos-product-tile").filter({ hasText: data.product.code }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس", { exact: true }).selectOption(data.sizes[0].id);
  await page.getByLabel("اللون", { exact: true }).selectOption(data.colors[0].id);
}

test("cashier browses real staff categories and actual variant prices without knowing a SKU", async ({ page }) => {
  const data = await seed(page);
  await logoutBeforeLogin(page);
  await login(page, "cashier");
  const reads: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/")) reads.push(new URL(request.url()).pathname); });
  await openPos(page);
  const categories = page.getByRole("group", { name: "تصنيفات الأصناف" });
  await categories.getByRole("button", { name: data.categoryName, exact: true }).click();
  const tile = page.getByTestId("pos-product-tile").filter({ hasText: data.product.code });
  await expect(tile).toContainText("120 ج.م.");
  await expect(tile).toContainText("180 ج.م.");
  await expect(tile).toContainText("متاح بالفرع: 3");
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.other.code })).toHaveCount(0);
  await page.getByLabel("ابحث بالاسم أو الكود").fill(data.product.nameAr);
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "اختيارات الصنف المتاحة" }).getByRole("button").first()).toBeFocused();
  await openLookupLists(page);
  await page.getByLabel("المقاس", { exact: true }).selectOption(data.sizes[0].id);
  await expect(page.getByLabel("اللون", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByLabel("اللون", { exact: true }).selectOption(data.colors[0].id);
  await expect(page.getByTestId("selected-variant")).toContainText("سعر البيع: 120 ج.م.");
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 2");
  const pairs = page.getByRole("group", { name: "اختيارات الصنف المتاحة" });
  await expect(pairs.getByRole("button")).toHaveCount(3);
  await pairs.getByRole("button", { name: `${data.sizes[1].nameAr} / ${data.colors[1].nameAr}`, exact: true }).click();
  await expect(page.getByTestId("selected-variant")).toContainText("سعر البيع: 180 ج.م.");
  await pairs.getByRole("button", { name: `${data.sizes[2].nameAr} / ${data.colors[2].nameAr} — غير متوفر`, exact: true }).click();
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 0");
  await expect(page.getByRole("button", { name: "إضافة إلى السلة" })).toHaveCount(0);
  expect(reads.some((path) => path.startsWith("/api/public/") || path.startsWith("/api/internal/media") || path === "/api/internal/catalog/products")).toBe(false);
  await expect(page.getByTestId("lookup-result").getByText(/تكلفة|ربح|شراء/)).toHaveCount(0);
});

test("browsing and exact code lookup preserve quoted amounts while cart changes invalidate them", async ({ page }) => {
  const data = await seed(page);
  await openPos(page);
  await chooseM(page, data);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("5");
  await stageUnpaidPosQuote(checkout);
  const accepted = page.getByTestId("accepted-prices");
  await expect(accepted).toBeVisible();
  const acceptedText = await accepted.innerText();
  await page.getByRole("group", { name: "تصنيفات الأصناف" }).getByRole("button", { name: data.otherCategoryName, exact: true }).click();
  await page.getByLabel("ابحث بالاسم أو الكود").fill(data.other.nameAr);
  await page.getByTestId("pos-product-tile").filter({ hasText: data.other.code }).click();
  await expect(accepted).toHaveText(acceptedText, { useInnerText: true });
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(data.product.code);
  await lookup.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByTestId("lookup-result")).toContainText(data.product.nameAr);
  await expect(accepted).toHaveText(acceptedText, { useInnerText: true });
  await checkout.getByLabel("الكمية", { exact: true }).fill("2");
  await expect(accepted).toHaveCount(0);
  await expect(checkout.getByTestId("complete-sale")).toBeEnabled();
  await stageUnpaidPosQuote(checkout);
  await expect(accepted).toBeVisible();
});

test("offline browse refreshes after completion, rejects known overselling and keeps branch quantities separate", async ({ page, context }) => {
  const data = await seed(page);
  // Reselecting the current branch also replaces the signed-in workspace.
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  await openPos(page);
  await chooseM(page, data);
  await context.setOffline(true);
  await page.getByLabel("ابحث بالاسم أو الكود").fill(data.product.nameAr);
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toContainText("متاح بالفرع: 3");
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("الكمية", { exact: true }).fill("3");
  await checkout.getByTestId("complete-sale").click();
  await expect(page.getByRole("alert").filter({ hasText: "الكمية المتاحة غير كافية" })).toBeVisible();
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  await expect(checkout.getByLabel("الكمية", { exact: true })).toBeEnabled();
  await expect(checkout.getByRole("button", { name: "إعادة المحاولة", exact: true })).toHaveCount(0);
  await checkout.getByLabel("الكمية", { exact: true }).fill("1");
  await finalizePosSale(checkout, page);
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 1");
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toContainText("متاح بالفرع: 2");
  await context.setOffline(false);
  await expect.poll(async () => {
    const found = await api(page, "GET", `/api/internal/catalog/lookup?code=${data.product.code}`);
    return found.variants.find((variant: { id: string }) => variant.id === data.m.id).availableQuantity;
  }).toBe(1);
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await page.getByRole("button", { name: "الفيوم", exact: true }).click();
  await openPos(page);
  await chooseM(page, data);
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 7");
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toContainText("متاح بالفرع: 7");
});

test("POS uses two lanes on desktop and tablet, stacks on phones and keeps checkout actions reachable", async ({ page }, testInfo) => {
  const data = await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPos(page);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await expect(checkout.getByLabel("اسم الزبون (اختياري)")).toHaveCount(0);
  await expect(checkout.getByTestId("complete-sale")).toBeDisabled();
  await page.getByLabel("ابحث بالاسم أو الكود").fill(data.product.nameAr);
  const tile = page.getByTestId("pos-product-tile").filter({ hasText: data.product.code });
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "اختيارات الصنف المتاحة" }).getByRole("button").first()).toBeFocused();
  await openLookupLists(page);
  await page.getByLabel("المقاس", { exact: true }).selectOption(data.sizes[0].id);
  await page.getByLabel("اللون", { exact: true }).selectOption(data.colors[0].id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("5");
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByRole("radio", { name: "دفع مقسّم" }).check();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const browser = await page.getByTestId("pos-product-browser").boundingBox();
    const cart = await checkout.boundingBox();
    expect(browser).not.toBeNull();
    expect(cart).not.toBeNull();
    if (width >= 1024) {
      expect(Math.abs(browser!.x - cart!.x)).toBeGreaterThan(200);
      await expect(checkout.getByRole("button", { name: "إتمام البيع", exact: true })).toBeInViewport();
    } else {
      expect(cart!.y).toBeGreaterThan(browser!.y);
      await checkout.getByLabel("المبلغ النقدي بالجنيه").fill("50");
      await checkout.getByRole("button", { name: "إتمام البيع", exact: true }).scrollIntoViewIfNeeded();
      await expect(checkout.getByRole("button", { name: "إتمام البيع", exact: true })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pos-workspace-${width}.png`), fullPage: true });
  }
});

test("another tab's completed offline sale refreshes known availability without changing this tab's accepted quote", async ({ page, context }) => {
  const data = await seed(page);
  await openPos(page);
  await chooseM(page, data);
  const second = await context.newPage();
  await second.goto(`${internal}/lookup`);
  await expect(second.getByTestId("pos-product-browser")).toBeVisible();
  await chooseM(second, data);
  await context.setOffline(true);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("خصم الموظف بالجنيه").fill("5");
  await stageUnpaidPosQuote(checkout);
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  const acceptedText = await page.getByTestId("accepted-prices").innerText();
  await second.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const secondCheckout = second.getByRole("form", { name: "إتمام البيع" });
  await finalizePosSale(secondCheckout, second);
  await expect(second.getByRole("status").filter({ hasText: "تم حفظ البيع" })).toBeVisible();
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 1");
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toContainText("متاح بالفرع: 2");
  await expect(page.getByTestId("accepted-prices")).toHaveText(acceptedText, { useInnerText: true });
  await expect(page.getByRole("button", { name: "إضافة إلى السلة" })).toBeDisabled();
  await context.setOffline(false);
  await second.close();
});

test("a remote same-cashier branch reselection keeps automatic sync running after the other tab closes", async ({ page, context }) => {
  const data = await seed(page);
  await logoutBeforeLogin(page);
  await login(page, "cashier");
  const originalWorkspace = await api(page, "GET", "/api/internal/workspace");
  await openPos(page);
  await chooseM(page, data);
  // Observe the existing transport; only the second tab's real UI action publishes.
  await page.evaluate(async (staffId) => {
    const accountModulePath = "/src/account-session.ts";
    const { subscribeAccount } = await import(accountModulePath);
    const observed = window as unknown as { remoteSameStaffObserved: boolean; stopAccountObservation: () => void };
    observed.remoteSameStaffObserved = false;
    observed.stopAccountObservation = subscribeAccount((change: { staffId: string | null }) => {
      if (change.staffId === staffId) observed.remoteSameStaffObserved = true;
    });
  }, originalWorkspace.staff.id);
  const second = await context.newPage();
  await second.goto(`${internal}/workspace`);
  await expect(second.getByTestId("active-branch")).toContainText("أبشواي");
  await second.getByRole("link", { name: "تغيير الفرع" }).click();
  await second.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(second.getByTestId("active-branch")).toContainText("أبشواي");
  await expect.poll(() => page.evaluate(() => (window as unknown as { remoteSameStaffObserved: boolean }).remoteSameStaffObserved)).toBe(true);
  await page.evaluate(() => (window as unknown as { stopAccountObservation: () => void }).stopAccountObservation());
  await second.close();
  await expect(page).toHaveURL(`${internal}/lookup`);
  await context.setOffline(true);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await finalizePosSale(checkout, page);

  type LocalFact = {
    id: string; operationId: string; staffId: string; soldByStaffId: string; branch: { id: string };
    snapshotId: string; payloadFingerprint: string; syncStatus: string; finalTotalPiasters: number;
    payment: { method: string; cashPiasters: number; onlinePiasters: number };
  };
  const readLocal = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sales = await new Promise<LocalFact[]>((resolve, reject) => {
      const request = database.transaction("sales", "readonly").objectStore("sales").getAll();
      request.onsuccess = () => resolve(request.result as LocalFact[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return sales;
  });
  const original = (await readLocal())[0]!;
  expect(original).toMatchObject({
    syncStatus: "pending", staffId: originalWorkspace.staff.id, soldByStaffId: originalWorkspace.staff.id,
    branch: { id: data.firstBranchId }, finalTotalPiasters: 12000,
    payment: { method: "cash", cashPiasters: 12000, onlinePiasters: 0 },
  });
  expect(original.snapshotId).toBeTruthy();
  expect(original.payloadFingerprint).toMatch(/^[0-9a-f]{64}$/);
  await context.setOffline(false);
  await expect.poll(async () => (await readLocal()).find((sale) => sale.id === original.id)?.syncStatus).toBe("acknowledged");
  const acknowledged = (await readLocal()).find((sale) => sale.id === original.id)!;
  expect(acknowledged).toMatchObject({
    id: original.id, operationId: original.operationId, staffId: original.staffId, soldByStaffId: original.soldByStaffId,
    branch: original.branch, finalTotalPiasters: original.finalTotalPiasters, payment: original.payment,
    snapshotId: original.snapshotId, payloadFingerprint: original.payloadFingerprint,
  });
  const sales = await api(page, "GET", "/api/internal/sales");
  expect(sales.filter((sale: { operationId: string }) => sale.operationId === original.operationId)).toHaveLength(1);
  const product = await api(page, "GET", `/api/internal/catalog/lookup?code=${data.product.code}`);
  expect(product.variants.find((variant: { id: string }) => variant.id === data.m.id).availableQuantity).toBe(1);
  await expect(page.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 1");
  await expect(page).toHaveURL(`${internal}/lookup`);
});
