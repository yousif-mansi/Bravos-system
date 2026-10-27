import { expect, test, type Page } from "@playwright/test";
import type { SaleDto, WorkspaceDto } from "@bravos/contracts";

test("same-account refresh during initial sales loading starts a fresh read and rejects stale rows", async ({ page }) => {
  await signIn(page);
  const workspace = await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json() as WorkspaceDto;
  expect(workspace.activeBranch?.code).toBe("abshway");
  const stale = feedbackSale(workspace, "OLD");
  const fresh = feedbackSale(workspace, "NEW");
  let holdStale = true;
  const releaseStale: Array<() => void> = [];
  await page.route("**/api/internal/sales", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/internal/sales") {
      await route.fallback();
      return;
    }
    if (holdStale) {
      await new Promise<void>((resolve) => { releaseStale.push(resolve); });
      await route.fulfill({ json: [stale] });
      return;
    }
    await route.fulfill({ json: [fresh] });
  });
  await page.route(`**/api/internal/sales/${fresh.id}`, (route) => route.fulfill({ json: fresh }));
  await page.getByRole("link", { name: "المبيعات", exact: true }).click();
  const loading = page.getByRole("status").filter({ hasText: "جارٍ تحميل المبيعات" });
  await expect(loading).toBeVisible();
  await expect.poll(() => releaseStale.length).toBeGreaterThan(0);
  holdStale = false;
  await page.evaluate((staffId) => window.dispatchEvent(new CustomEvent("bravos-account", { detail: { eventId: crypto.randomUUID(), generation: 0, staffId } })), workspace.staff.id);
  const list = page.getByTestId("sale-list");
  await expect(list.getByRole("button", { name: /POS-FEEDBACK-NEW/ })).toBeVisible();
  await expect(loading).toHaveCount(0);
  const staleResponse = page.waitForResponse((value) => value.url().endsWith("/api/internal/sales"));
  for (const release of releaseStale) release();
  await staleResponse;
  await expect(list.getByRole("button", { name: /POS-FEEDBACK-OLD/ })).toHaveCount(0);
  await list.getByRole("button", { name: /POS-FEEDBACK-NEW/ }).click();
  await expect(page.getByTestId("sale-detail-region").getByRole("heading", { name: "بيع POS-FEEDBACK-NEW", exact: true })).toBeFocused();
});

test("sale details show progress, ignore stale responses and retry with a visible local fallback", async ({ page }, testInfo) => {
  await signIn(page);
  const workspace = await (await page.request.get("http://127.0.0.1:5174/api/internal/workspace")).json() as WorkspaceDto;
  const rows = ["A", "B", "C"].map((suffix) => feedbackSale(workspace, suffix));
  await page.route("**/api/internal/sales", (route) => route.fulfill({ json: rows }));
  let releaseFirst!: () => void;
  let firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let failThird = true;
  await page.route("**/api/internal/sales/*", async (route) => {
    const row = rows.find((sale) => route.request().url().endsWith(`/${sale.id}`));
    if (!row) return route.continue();
    if (row === rows[0]) await firstGate;
    if (row === rows[2] && failThird) { failThird = false; return route.abort("failed"); }
    await route.fulfill({ json: row });
  });
  await page.getByRole("link", { name: "المبيعات", exact: true }).click();
  const list = page.getByTestId("sale-list");
  await list.getByRole("button", { name: /POS-FEEDBACK-A/ }).click();
  await expect(list.getByRole("button", { name: /POS-FEEDBACK-A/ })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status").filter({ hasText: "جارٍ فتح تفاصيل البيع" })).toBeVisible();
  await list.getByRole("button", { name: /POS-FEEDBACK-B/ }).click();
  const region = page.getByTestId("sale-detail-region");
  await expect(region.getByRole("heading", { name: "بيع POS-FEEDBACK-B", exact: true })).toBeFocused();
  await expect(region).toHaveClass(/is-highlighted/);
  const response = page.waitForResponse((value) => value.url().endsWith(`/${rows[0]!.id}`));
  releaseFirst();
  await response;
  await expect(region).toContainText("POS-FEEDBACK-B");
  await expect(list.getByRole("button", { name: /POS-FEEDBACK-B/ })).toHaveAttribute("aria-pressed", "true");
  await list.getByRole("button", { name: /POS-FEEDBACK-C/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "نعرض التفاصيل المحفوظة" })).toBeVisible();
  await expect(region).toContainText("POS-FEEDBACK-C");
  await page.getByRole("button", { name: "إعادة محاولة فتح البيع" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(region.getByRole("heading", { name: "بيع POS-FEEDBACK-C", exact: true })).toBeFocused();
  await region.screenshot({ path: testInfo.outputPath("sale-revealed.png") });
  firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await list.getByRole("button", { name: /POS-FEEDBACK-A/ }).click();
  await page.getByRole("link", { name: "الموظفون", exact: true }).click();
  const lateResponse = page.waitForResponse((value) => value.url().endsWith(`/${rows[0]!.id}`));
  releaseFirst();
  await lateResponse;
  await expect(page.getByTestId("sale-detail-region")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "إدارة الموظفين", exact: true })).toBeVisible();
});

test("delivery editing, expense details and staff password reset reveal their target", async ({ page }, testInfo) => {
  await signIn(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const headers = { origin: "http://127.0.0.1:5174" };
  const areaName = `منطقة تغذية ${suffix}`;
  const area = await page.request.post("http://127.0.0.1:5174/api/internal/delivery-areas", { headers, data: { nameAr: areaName, feePiasters: 2000, active: true } });
  expect(area.status()).toBe(201);
  await page.goto("http://127.0.0.1:5174/delivery-areas");
  await page.locator("article").filter({ hasText: areaName }).getByRole("button", { name: "تعديل" }).click();
  await expect(page.getByRole("heading", { name: "تعديل المنطقة", exact: true })).toBeFocused();
  await expect(page.getByRole("form", { name: "بيانات منطقة التوصيل" })).toContainText("حفظ");
  await page.locator(".reveal-feedback.is-highlighted").screenshot({ path: testInfo.outputPath("delivery-edit-revealed.png") });
  const category = await page.request.post("http://127.0.0.1:5174/api/internal/expense-categories", { headers, data: { nameAr: `فئة تغذية ${suffix}` } });
  expect(category.status()).toBe(201);
  const expense = await page.request.post("http://127.0.0.1:5174/api/internal/expenses", { headers, data: { operationId: crypto.randomUUID(), amountPiasters: 2500, expenseDate: "2026-09-30", categoryId: (await category.json()).id, description: `مصروف تغذية ${suffix}` } });
  expect(expense.status()).toBe(201);
  await page.goto("http://127.0.0.1:5174/expenses");
  await page.getByTestId("expense-list").getByRole("row").filter({ hasText: `مصروف تغذية ${suffix}` }).getByRole("button", { name: "عرض التفاصيل" }).click();
  await expect(page.getByTestId("expense-details")).toHaveClass(/is-highlighted/);
  await expect(page.getByRole("heading", { name: "تفاصيل المصروف", exact: true })).toBeFocused();
  await page.getByTestId("expense-details").screenshot({ path: testInfo.outputPath("expense-details-revealed.png") });
  await page.locator(".category-list article").filter({ hasText: `فئة تغذية ${suffix}` }).getByRole("button", { name: "تعديل الاسم" }).click();
  await expect(page.getByRole("heading", { name: "تعديل اسم الفئة", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "الموظفون", exact: true }).click();
  const card = page.locator(".staff-item").filter({ has: page.locator("p.muted").filter({ hasText: /^cashier —/ }) });
  await card.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).click();
  const reset = card.getByRole("form");
  await expect(reset).toHaveClass(/is-highlighted/);
  await expect(reset.getByRole("heading")).toBeFocused();
  await reset.screenshot({ path: testInfo.outputPath("staff-reset-revealed.png") });
  await reset.getByRole("button", { name: "إلغاء" }).click();
  await expect(reset).toHaveCount(0);
});

test("offer and coupon editing reveals the form and selected checkboxes are green", async ({ page }) => {
  await signIn(page);
  const category = await page.request.post("http://127.0.0.1:5174/api/internal/catalog/categories", {
    headers: { origin: "http://127.0.0.1:5174" },
    data: { nameAr: `تصنيف تغذية راجعة ${crypto.randomUUID().slice(0, 8)}` },
  });
  expect(category.status()).toBe(201);
  const categoryName = (await category.json()).nameAr as string;

  await page.getByRole("link", { name: "العروض" }).click();
  const offerName = `عرض تغذية راجعة ${crypto.randomUUID().slice(0, 8)}`;
  const offerForm = page.getByRole("form", { name: "إنشاء عرض تلقائي" });
  await offerForm.getByLabel("اسم العرض").fill(offerName);
  await offerForm.getByRole("checkbox", { name: new RegExp(categoryName) }).check();
  await expectGreenChecked(offerForm.getByRole("checkbox", { name: new RegExp(categoryName) }));
  await offerForm.getByRole("button", { name: "حفظ العرض" }).click();
  const offerRow = page.getByTestId("offer-row").filter({ hasText: offerName });
  await expect(offerRow).toBeVisible();
  await offerRow.getByRole("button", { name: "تعديل" }).click();
  const offerEdit = page.getByRole("form", { name: "تعديل العرض التلقائي" });
  await expect(offerEdit).toHaveClass(/is-highlighted/);
  await expect(offerEdit.getByRole("heading", { name: `تعديل العرض: ${offerName}` })).toBeFocused();
  await offerEdit.getByRole("button", { name: "إلغاء التعديل" }).click();

  const couponCode = `FEEDBACK${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const couponForm = page.getByRole("form", { name: "إنشاء كوبون" });
  await couponForm.getByLabel("كود الكوبون").fill(couponCode);
  await couponForm.getByLabel("الخصم بالجنيه").fill("10");
  await couponForm.getByRole("checkbox", { name: new RegExp(categoryName) }).check();
  await couponForm.getByRole("button", { name: "حفظ الكوبون" }).click();
  const couponRow = page.getByTestId("coupon-row").filter({ hasText: couponCode });
  await expect(couponRow).toBeVisible();
  await couponRow.getByRole("button", { name: "تعديل" }).click();
  const couponEdit = page.getByRole("form", { name: "تعديل كوبون" });
  await expect(couponEdit).toHaveClass(/is-highlighted/);
  await expect(couponEdit.getByRole("heading", { name: `تعديل الكوبون: ${couponCode}` })).toBeFocused();
  await expectGreenChecked(couponEdit.getByRole("checkbox", { name: new RegExp(categoryName) }));
});

async function signIn(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function expectGreenChecked(checkbox: ReturnType<Page["getByRole"]>) {
  await expect(checkbox).toBeChecked();
  const accentColor = await checkbox.evaluate((element) => getComputedStyle(element).accentColor);
  expect(accentColor).toMatch(/^rgb\((22, 128, 82|38, 162, 105)\)$/);
  await expect(checkbox).toHaveCSS("background-color", accentColor);
  await expect(checkbox).toHaveCSS("background-image", /stroke='white'/);
}

function feedbackSale(workspace: WorkspaceDto, suffix: string): SaleDto {
  return { id: `feedback-sale-${suffix}`, reference: `POS-FEEDBACK-${suffix}`, operationId: crypto.randomUUID(), branch: workspace.activeBranch!, soldByStaffId: workspace.staff.id, soldByDisplayName: workspace.staff.displayName, occurredAt: "2026-09-30T09:00:00Z", recordedAt: "2026-09-30T09:00:01Z", customerName: `عميل ${suffix}`, customerPhone: null, originalTotalPiasters: 30000, automaticOfferDiscountPiasters: 0, appliedAutomaticOffer: null, couponDiscountPiasters: 0, appliedCoupon: null, employeeDiscountPiasters: 0, discountReason: null, discountedByStaffId: null, finalTotalPiasters: 30000, exchangeCreditAppliedPiasters: 0, cashReceivedPiasters: 30000, payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 }, physicallyCompleted: true, discrepancy: null, lines: [] };
}
