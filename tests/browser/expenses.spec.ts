import { expect, test, type Page } from "@playwright/test";

test("Arabic expense entry retries one operation and manager correction preserves the original", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const category = await staffApi(page, "POST", "/api/internal/expense-categories", { nameAr: "مصروفات اختبار الواجهة" });
  expect(category.status).toBe(201);

  await page.getByRole("link", { name: "المصروفات" }).click();
  await expect(page.getByRole("heading", { name: "المصروفات", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "تسجيل مصروف" });
  await form.getByLabel("القيمة بالجنيه").fill("500");
  await form.getByLabel("التاريخ").fill("2026-09-14");
  await form.getByLabel("الفئة").selectOption(category.body.id);
  await form.getByLabel("الوصف").fill("صيانة واجهة المحل");

  const operationIds: string[] = [];
  let dropFirst = true;
  await page.route("**/api/internal/expenses", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
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

  await form.getByRole("button", { name: "حفظ المصروف" }).click();
  await expect(page.getByRole("alert")).toContainText("تعذر تأكيد الحفظ");
  await expect(form.getByLabel("القيمة بالجنيه")).toBeDisabled();
  await form.getByRole("button", { name: "إعادة محاولة الحفظ" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المصروف");
  expect(operationIds).toHaveLength(2);
  expect(new Set(operationIds).size).toBe(1);
  await expect(page.getByTestId("expense-list")).toContainText("صيانة واجهة المحل");
  await expect(page.getByTestId("expense-totals")).toContainText("500 ج.م.");

  const correction = page.getByRole("form", { name: "تصحيح أو إلغاء مصروف" });
  await correction.getByLabel("القيمة المصححة بالجنيه").fill("50");
  await correction.getByLabel("السبب").fill("تم إدخال صفر زائد");
  await correction.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(page.getByRole("status")).toContainText("تم تصحيح المصروف مرة واحدة");
  await expect(page.getByTestId("expense-totals")).toContainText("50 ج.م.");
  await page.getByTestId("expense-details").locator("summary").filter({ hasText: /^الأصل وسجل التعديلات$/ }).click();
  await expect(page.getByTestId("expense-details")).toContainText("الأصل: 500 ج.م.");
  await expect(page.getByTestId("expense-details")).toContainText("القيمة الفعلية: 50 ج.م.");
  await expect(page.getByTestId("expense-details")).toContainText("تم إدخال صفر زائد");
  const history = page.getByTestId("expense-history-item");
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText("قبل: 500 ج.م. — 2026-09-14 — مصروفات اختبار الواجهة — صيانة واجهة المحل");
  await expect(history.first()).toContainText("بعد: 50 ج.م. — 2026-09-14 — مصروفات اختبار الواجهة — صيانة واجهة المحل");

  await correction.getByLabel("القيمة المصححة بالجنيه").fill("40");
  await correction.getByLabel("الوصف المصحح").fill("صيانة نهائية");
  await correction.getByLabel("السبب").fill("مراجعة نهائية");
  await correction.getByRole("button", { name: "حفظ الإجراء" }).click();
  await expect(history).toHaveCount(2);
  await expect(history.nth(1)).toContainText("قبل: 50 ج.م. — 2026-09-14 — مصروفات اختبار الواجهة — صيانة واجهة المحل");
  await expect(history.nth(1)).toContainText("بعد: 40 ج.م. — 2026-09-14 — مصروفات اختبار الواجهة — صيانة نهائية");
});

async function signIn(page: Page, username: string, password: string) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(username);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
