import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  CategoryDto,
  ColorDto,
  ExpenseCategoryDto,
  ExpenseDto,
  ManagementReportDto,
  ManagerProductDto,
  ReceiptDto,
  ReturnDto,
  ReturnSourceDto,
  SaleDto,
  SizeDto,
  StaffAccountDto,
  WorkspaceDto,
} from "@bravos/contracts";

const internalOrigin = "http://127.0.0.1:5174";

test("manager filters a connected report and follows its real sale and Return provenance", async ({ page }, testInfo) => {
  const scenarioInstant = new Date();
  const today = cairoDate(scenarioInstant);
  test.skip(
    cairoDate(new Date(scenarioInstant.getTime() + testInfo.timeout + 30_000)) !== today,
    "The connected reporting scenario must stay within one Cairo business day.",
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const employeeLogin = `report.${suffix}`;
  const employeePassword = `Report-${suffix}-pass`;
  const employeeName = `موظف تقرير ${suffix}`;
  const productCode = `REPORT-${suffix}`;
  const productName = `منتج تقرير ${suffix}`;
  const expenseDescription = `مصروف تقرير ${suffix}`;
  const correctionReason = `تصحيح مصروف التقرير ${suffix}`;
  const discountReason = `خصم تقرير ${suffix}`;

  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi<WorkspaceDto>(page, "GET", "/api/internal/workspace");
  expect(workspace.status).toBe(200);
  if (!workspace.body.activeBranch) throw new Error("Expected the manager's selected branch.");
  const branchId = workspace.body.activeBranch.id;
  const branchName = workspace.body.activeBranch.nameAr;

  const employee = await staffApi<StaffAccountDto>(page, "POST", "/api/internal/staff", {
    loginName: employeeLogin,
    displayName: employeeName,
    password: employeePassword,
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(employee.status).toBe(201);

  const category = await staffApi<CategoryDto>(page, "POST", "/api/internal/catalog/categories", { nameAr: `تقارير ${suffix}` });
  const size = await staffApi<SizeDto>(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const firstColor = await staffApi<ColorDto>(page, "POST", "/api/internal/catalog/colors", { nameAr: `أول ${suffix}` });
  const secondColor = await staffApi<ColorDto>(page, "POST", "/api/internal/catalog/colors", { nameAr: `ثان ${suffix}` });
  expect([category.status, size.status, firstColor.status, secondColor.status]).toEqual([201, 201, 201, 201]);

  const product = await staffApi<ManagerProductDto>(page, "POST", "/api/internal/catalog/products", {
    code: productCode,
    nameAr: productName,
    descriptionAr: "ربط تقرير الإدارة بسجل حقيقي",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 30_000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: size.body.id, colorId: firstColor.body.id, sellingPricePiastersOverride: 30_000 },
      { sizeId: size.body.id, colorId: secondColor.body.id, sellingPricePiastersOverride: 20_000 },
    ],
  });
  expect(product.status).toBe(201);
  const expensiveVariant = product.body.variants.find((variant) => variant.sellingPricePiasters === 30_000);
  const cheaperVariant = product.body.variants.find((variant) => variant.sellingPricePiasters === 20_000);
  if (!expensiveVariant || !cheaperVariant) throw new Error("Expected both seeded report variants.");

  const receipt = await staffApi<ReceiptDto>(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: today,
    lines: [
      { variantId: expensiveVariant.id, quantity: 2, unitCostPiasters: 15_000 },
      { variantId: cheaperVariant.id, quantity: 2, unitCostPiasters: 9_000 },
    ],
  });
  expect(receipt.status).toBe(201);

  const expenseCategory = await staffApi<ExpenseCategoryDto>(page, "POST", "/api/internal/expense-categories", {
    nameAr: `مصروفات تقارير ${suffix}`,
  });
  expect(expenseCategory.status).toBe(201);

  await signOut(page);
  await signIn(page, employeeLogin, employeePassword, branchName);

  const saleId = crypto.randomUUID();
  const sale = await staffApi<SaleDto>(page, "POST", "/api/internal/sales", {
    saleId,
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: scenarioInstant.toISOString(),
    employeeDiscountPiasters: 5_000,
    discountReason,
    lines: [
      { variantId: expensiveVariant.id, quantity: 1 },
      { variantId: cheaperVariant.id, quantity: 1 },
    ],
  });
  expect(sale.status).toBe(201);
  expect(sale.body).toMatchObject({
    id: saleId,
    originalTotalPiasters: 50_000,
    employeeDiscountPiasters: 5_000,
    finalTotalPiasters: 45_000,
  });
  expect(sale.body.lines.map((line) => line.paidPiasters).sort((a, b) => a - b))
    .toEqual([17_500, 27_500]);

  const expense = await staffApi<ExpenseDto>(page, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 3_000,
    expenseDate: today,
    categoryId: expenseCategory.body.id,
    description: expenseDescription,
  });
  expect(expense.status).toBe(201);

  await signOut(page);
  await signIn(page, "owner", "e2e-owner-pass", branchName);

  const sources = await staffApi<ReturnSourceDto[]>(page, "GET", `/api/internal/returns/sources?reference=${saleId}`);
  expect(sources.status).toBe(200);
  const source = sources.body.find((candidate) => candidate.saleId === saleId);
  if (!source) throw new Error("Expected the seeded sale in Return source search.");
  const returnedLine = source.lines.find((line) => line.variantId === expensiveVariant.id);
  if (!returnedLine) throw new Error("Expected the seeded high-price sale line.");

  const returnId = crypto.randomUUID();
  const draftedReturn = await staffApi<ReturnDto>(page, "POST", "/api/internal/returns", {
    returnId,
    operationId: crypto.randomUUID(),
    source: { kind: "physical_sale", id: saleId },
    handlingBranchId: branchId,
    authorizedRefund: { merchandisePiasters: 28_000, checkoutChargePiasters: 0 },
    lines: [{ sourceLineId: returnedLine.sourceLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draftedReturn.status).toBe(201);
  const postedReturn = await staffApi<ReturnDto>(page, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: draftedReturn.body.revision,
  });
  expect(postedReturn.status).toBe(201);

  const correctedExpense = await staffApi<ExpenseDto>(page, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
    operationId: crypto.randomUUID(),
    expectedRevision: expense.body.revision,
    type: "correction",
    reason: correctionReason,
    amountPiasters: 2_000,
    expenseDate: today,
    categoryId: expenseCategory.body.id,
    description: expenseDescription,
  });
  expect(correctedExpense.status).toBe(201);

  await page.getByRole("link", { name: "التقارير" }).click();
  await expect(page.getByRole("heading", { name: "تقارير الإدارة" })).toBeVisible();
  await expect(page.getByTestId("report-summary")).toBeVisible();

  const filters = page.getByRole("form", { name: "فلاتر التقارير" });
  await filters.getByLabel("الفرع").selectOption(branchId);
  await filters.getByLabel("القناة").selectOption("physical");
  await expect(filters.locator(`option[value="${employee.body.id}"]`)).toHaveText(employeeName);
  await filters.getByLabel("الموظف").selectOption(employee.body.id);

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management"
      && url.searchParams.get("branchId") === branchId
      && url.searchParams.get("channel") === "physical"
      && url.searchParams.get("employeeId") === employee.body.id;
  });
  await filters.getByRole("button", { name: "عرض التقرير" }).click();
  const reportResponse = await responsePromise;
  expect(reportResponse.status()).toBe(200);
  expect(reportResponse.headers()["cache-control"]).toContain("no-store");
  const report = await reportResponse.json() as ManagementReportDto;

  expect(report.filters).toEqual({ branchId, channel: "physical", employeeId: employee.body.id });
  expect(report.pageInfo).toMatchObject({
    page: 1,
    pageSize: 25,
    totalCompletedSales: 1,
    totalRefunds: 1,
    totalExpenses: 1,
  });
  expect(report.summary).toMatchObject({
    completedCount: 1,
    grossFinalSalesPiasters: 45_000,
    grossMerchandiseSalesPiasters: 45_000,
    deliveryChargesPiasters: 0,
    merchandiseRefundPiasters: 28_000,
    checkoutChargeRefundPiasters: 0,
    netFinalSalesPiasters: 17_000,
    netMerchandiseSalesPiasters: 17_000,
    knownNetMerchandiseCostPiasters: 9_000,
    merchandiseGrossProfitPiasters: 8_000,
    effectiveExpensesPiasters: 2_000,
    operatingProfitPiasters: 6_000,
    costsIncomplete: false,
    unresolvedCostQuantity: 0,
  });
  expect(report.completedSales.map((row) => row.source.id)).toContain(saleId);
  expect(report.refunds).toEqual(expect.arrayContaining([
    expect.objectContaining({
      returnId,
      cashRefundStatus: "owed",
      cashRefundOwedPiasters: 28_000,
      actualRefundPaidPiasters: 0,
    }),
  ]));
  expect(report.expenses.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ expenseId: expense.body.id, effectiveStatus: "active", amountPiasters: 2_000 }),
  ]));
  expect(report.bestSellers).toEqual(expect.arrayContaining([
    expect.objectContaining({ productCode, grossEffectiveSoldQuantity: 2, returnedQuantity: 1 }),
  ]));

  const summary = page.getByTestId("report-summary");
  await expectMetric(summary, "إجمالي القيم النهائية", "450 ج.م.");
  await expectMetric(summary, "استرداد البضاعة", "280 ج.م.");
  await expectMetric(summary, "صافي مبيعات البضاعة", "170 ج.م.");
  await expectMetric(summary, "صافي تكلفة البضاعة المعروفة", "90 ج.م.");
  await expectMetric(summary, "مجمل ربح البضاعة", "80 ج.م.");
  await expectMetric(summary, "المصروفات الفعلية", "20 ج.م.");
  await expectMetric(summary, "ربح التشغيل بعد المصروفات", "60 ج.م.");

  const channelBreakdown = page.getByRole("heading", { name: "حسب القناة" }).locator("..");
  await expect(channelBreakdown.getByRole("row").filter({ hasText: "الفروع (1)" })).toContainText("170 ج.م.");
  const branchBreakdown = page.getByRole("heading", { name: "حسب الفرع" }).locator("..");
  await expect(branchBreakdown.getByRole("row").filter({ hasText: branchName })).toContainText("60 ج.م.");
  const employeeBreakdown = page.getByRole("heading", { name: "حسب الموظف" }).locator("..");
  const employeeRow = employeeBreakdown.getByRole("row").filter({ hasText: employeeName });
  await expect(employeeRow).toContainText("450 ج.م.");
  await expect(employeeRow).toContainText("50 ج.م.");
  await expect(employeeRow).toContainText("280 ج.م.");
  await expect(employeeRow).toContainText("20 ج.م.");

  const saleCard = page.getByTestId("report-sale").filter({ hasText: saleId });
  await expect(saleCard).toContainText(employeeName);
  await expect(saleCard).toContainText("الأصلي: 500 ج.م.");
  await expect(saleCard).toContainText("خصم الموظف: 50 ج.م.");
  await expect(saleCard).toContainText("النهائي: 450 ج.م.");
  await expect(saleCard).toContainText("275 ج.م.");
  await expect(saleCard).toContainText("175 ج.م.");
  await expect(saleCard).toContainText(discountReason);
  await expect(saleCard.getByRole("link", { name: "فتح سجل المبيعات" }))
    .toHaveAttribute("href", `/sales?saleId=${saleId}`);

  const refundCard = page.getByTestId("report-refund").filter({ hasText: returnId });
  await expect(refundCard).toContainText(`القناة الأصلية: الفروع`);
  await expect(refundCard).toContainText(`الفرع الأصلي: ${branchName}`);
  await expect(refundCard).toContainText(`فرع المعالجة: ${branchName}`);
  await expect(refundCard).toContainText("المعتمد: 280 ج.م.");
  await expect(refundCard).toContainText("حالة الاسترداد النقدي: مستحق");
  await expect(refundCard).toContainText("المستحق نقداً: 280 ج.م.");
  await expect(refundCard).toContainText("المدفوع فعلياً: 0 ج.م.");
  await expect(refundCard.getByRole("link", { name: "فتح المرتجع" }))
    .toHaveAttribute("href", `/returns?returnId=${returnId}`);
  await expect(refundCard.getByRole("link", { name: "فتح البيع الأصلي" }))
    .toHaveAttribute("href", `/sales?saleId=${saleId}`);

  const expenses = page.getByRole("heading", { name: "المصروفات" }).locator("..");
  await expect(expenses).toContainText(expenseDescription);
  await expect(expenses).toContainText("20 ج.م.");
  await expect(expenses).toContainText(correctionReason);
  const bestSeller = page.getByTestId("best-sellers").getByRole("listitem").filter({ hasText: productCode });
  await expect(bestSeller).toContainText("مباع فعلياً قبل المرتجعات: 2");
  await expect(bestSeller).toContainText("مرتجع: 1");
  await expect(page.getByTestId("inventory-valuation")).toContainText("لقطة المخزون الحالية الآن");

  const persistedReportIdentifiers = await page.evaluate(async (needles) => {
    const storageText = (storage: Storage) => Array.from(
      { length: storage.length },
      (_, index) => storage.getItem(storage.key(index) ?? "") ?? "",
    ).join("\n");
    const persistedText = [storageText(localStorage), storageText(sessionStorage)];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response) persistedText.push(await response.clone().text().catch(() => ""));
      }
    }
    const combined = persistedText.join("\n");
    return needles.filter((needle) => combined.includes(needle));
  }, [saleId, returnId, employee.body.id]);
  expect(persistedReportIdentifiers).toEqual([]);

  let replacementRequestReachedServer = false;
  await page.route("**/api/internal/reports/management?**", async (route) => {
    const realResponse = await route.fetch();
    expect(realResponse.status()).toBe(200);
    replacementRequestReachedServer = true;
    await route.abort("connectionreset");
  }, { times: 1 });
  await filters.getByLabel("الفترة").selectOption("month");
  await filters.getByLabel("الشهر").fill(today.slice(0, 7));
  await filters.getByRole("button", { name: "عرض التقرير" }).click();
  await expect.poll(() => replacementRequestReachedServer).toBe(true);
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل التقرير");
  await expect(page.getByTestId("report-summary")).toHaveCount(0);

  const retryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management"
      && url.searchParams.get("period") === "month"
      && url.searchParams.get("month") === today.slice(0, 7)
      && response.status() === 200;
  });
  await page.getByRole("button", { name: "إعادة محاولة تحميل التقرير" }).click();
  const monthResponse = await retryResponse;
  const monthReport = await monthResponse.json() as ManagementReportDto;
  expect(monthReport.period).toMatchObject({ kind: "month", fromCairoDate: `${today.slice(0, 7)}-01` });
  await expect(page.getByTestId("report-summary")).toBeVisible();

  const dayResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/internal/reports/management"
      && url.searchParams.get("period") === "day"
      && url.searchParams.get("date") === today
      && response.status() === 200;
  });
  await filters.getByLabel("الفترة").selectOption("day");
  await filters.getByLabel("اليوم").fill(today);
  await filters.getByRole("button", { name: "عرض التقرير" }).click();
  const selectedDayResponse = await dayResponse;
  expect((await selectedDayResponse.json() as ManagementReportDto).period).toMatchObject({
    kind: "day",
    fromCairoDate: today,
    toCairoDateInclusive: today,
  });
  await expect(page.getByRole("region", { name: "الفترة المعروضة" })).toContainText(today);

  await page.getByTestId("report-sale").filter({ hasText: saleId })
    .getByRole("link", { name: "فتح سجل المبيعات" }).click();
  await expect(page).toHaveURL(new RegExp(`/sales\\?saleId=${saleId}$`));
  await expect(page.getByTestId("sale-details")).toContainText(employeeName);
  await expect(page.getByTestId("sale-details")).toContainText("الإجمالي: 450 ج.م.");
  await expect(page.getByTestId("sale-details")).toContainText(discountReason);

  await page.goto(`${internalOrigin}/returns?returnId=${returnId}`);
  await expect(page.getByTestId("return-details")).toContainText(saleId);
  await expect(page.getByTestId("return-details")).toContainText("280 ج.م.");
});

test("cashier cannot discover or request management reporting", async ({ page }) => {
  let browserReportRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/internal/reports/management") browserReportRequests += 1;
  });

  await signIn(page, "cashier", "e2e-cashier-pass");
  await expect(page.getByRole("link", { name: "التقارير" })).toHaveCount(0);
  await page.goto(`${internalOrigin}/reports`);
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "مساحة العمل" })).toBeVisible();
  expect(browserReportRequests).toBe(0);

  const forbidden = await page.request.get(`${internalOrigin}/api/internal/reports/management?period=today`, {
    headers: { origin: internalOrigin },
  });
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
});

async function expectMetric(container: Locator, label: string, value: string) {
  await expect(container.locator(".report-metric").filter({ hasText: label })).toContainText(value);
}

async function signIn(page: Page, username: string, password: string, branchName = "أبشواي") {
  await page.goto(`${internalOrigin}/login`);
  await page.getByLabel("اسم الدخول").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: branchName, exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

async function signOut(page: Page) {
  if (await page.getByRole("button", { name: "تسجيل الخروج" }).count() === 0) {
    await page.goto(`${internalOrigin}/workspace`);
  }
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function staffApi<T>(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`${internalOrigin}${url}`, {
    method,
    headers: { origin: internalOrigin, ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() as T };
}

function cairoDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
