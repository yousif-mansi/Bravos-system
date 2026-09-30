import { expect, test, type Page } from "@playwright/test";

async function manager(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
}

test("dashboard explains combined scope and recovers failed reads without lingering loading", async ({ page, context }) => {
  const endpoints = [
    "**/api/internal/reports/management?*",
    "**/api/internal/online-orders",
    "**/api/internal/inventory/low-stock",
    "**/api/internal/backups/readiness",
  ];
  for (const endpoint of endpoints) await page.route(endpoint, (route) => route.abort("failed"));
  await manager(page);
  const summary = page.getByRole("region", { name: "ملخص كل الفروع والمتجر" });
  await expect(summary.getByText("تعذر تحميل البيانات", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("alert").filter({ hasText: "حالة النسخ الاحتياطي" })).toBeVisible();
  await expect(summary).not.toContainText("لحظات");
  for (const endpoint of endpoints) await page.unroute(endpoint);

  const response = page.waitForResponse((result) => result.url().includes("/reports/management?") && result.ok());
  await page.getByRole("button", { name: "إعادة تحميل الملخص" }).click();
  const reportResponse = await response;
  const query = new URL(reportResponse.url()).searchParams;
  expect(query.get("period")).toBe("today");
  expect(query.has("branchId")).toBe(false);
  expect(query.has("channel")).toBe(false);
  const report = await reportResponse.json();
  await expect(summary.getByText(`${report.summary.completedCount} عملية`, { exact: true })).toBeVisible();
  await expect(summary).toContainText("صافي مبيعات اليوم — كل الفروع والمتجر");
  await expect(page.getByRole("button", { name: "إعادة تحميل الملخص" })).toHaveCount(0);
  await context.setOffline(true);
  await expect(summary.getByText("غير متاح بدون اتصال", { exact: true })).toHaveCount(3);
  await expect(summary).not.toContainText("لحظات");
  await context.setOffline(false);
  await expect(summary.getByText("غير متاح بدون اتصال", { exact: true })).toHaveCount(0);
  await expect(summary.getByText(`${report.summary.completedCount} عملية`, { exact: true })).toBeVisible();
});

test("native form constraints expose invalid fields and clear when corrected", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/login");
  const login = page.getByLabel("اسم الدخول");
  const password = page.getByLabel("كلمة المرور");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(login).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  const danger = await login.evaluate((element) => getComputedStyle(element).getPropertyValue("--danger").trim());
  const expectedBorder = await page.evaluate((color) => {
    const element = document.createElement("span");
    element.style.color = color;
    document.body.append(element);
    const result = getComputedStyle(element).color;
    element.remove();
    return result;
  }, danger);
  await expect(login).toHaveCSS("border-top-color", expectedBorder);
  await login.fill("cashier");
  await password.fill("e2e-cashier-pass");
  await expect(login).toHaveAttribute("aria-invalid", "false");
  await expect(password).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
});

test("branch checkboxes show green and white checked, mixed, disabled and keyboard states in both themes", async ({ page }, testInfo) => {
  await manager(page);
  await page.getByRole("link", { name: "الموظفون", exact: true }).click();
  const form = page.getByRole("form", { name: "إنشاء حساب موظف" });
  const assigned = form.getByRole("checkbox", { name: "أبشواي", exact: true });
  const cashier = form.getByRole("checkbox", { name: "كاشير لأبشواي", exact: true });
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "فاتح", exact: true }).click();
    await assigned.uncheck();
    await expect(cashier).toBeDisabled();
    await expect(cashier).toHaveCSS("opacity", "0.5");
    await expect(assigned).toHaveCSS("appearance", "none");
    await expect(assigned).not.toBeChecked();
    await expect(assigned).toHaveCSS("background-image", "none");
    await form.screenshot({ path: testInfo.outputPath(`checkbox-${theme}-unchecked.png`) });
    await assigned.check();
    await cashier.check();
    await expect(cashier).toBeChecked();
    await expect(cashier).toHaveCSS("opacity", "1");
    await expect(assigned).toHaveCSS("background-color", theme === "dark" ? "rgb(38, 162, 105)" : "rgb(22, 128, 82)");
    await expect(assigned).toHaveCSS("background-image", /stroke='white'/);
    await form.screenshot({ path: testInfo.outputPath(`checkbox-${theme}-checked.png`) });
    await page.getByLabel("كلمة المرور", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(assigned).toBeFocused();
    await expect(assigned).toHaveCSS("outline-style", "solid");
    await expect(assigned).toHaveCSS("outline-width", "3px");
    await form.screenshot({ path: testInfo.outputPath(`checkbox-${theme}-focused.png`) });
    await assigned.evaluate((element: HTMLInputElement) => { element.indeterminate = true; });
    await expect(assigned).toHaveJSProperty("indeterminate", true);
    await expect(assigned).toHaveCSS("background-image", /M3(?: |%20)8h10/);
    await expect(assigned).toHaveCSS("background-image", /stroke='white'/);
    await form.screenshot({ path: testInfo.outputPath(`checkbox-${theme}-mixed.png`) });
    await assigned.evaluate((element: HTMLInputElement) => { element.indeterminate = false; });
  }
  await page.emulateMedia({ forcedColors: "active" });
  await expect(assigned).toHaveCSS("appearance", "auto");
  await expect(assigned).toHaveCSS("background-image", "none");
  await expect(assigned).toBeChecked();
  await expect(assigned).toBeFocused();
  await form.screenshot({ path: testInfo.outputPath("checkbox-forced-colors.png") });
});

test("existing backup password validation identifies the rejected field", async ({ page }) => {
  await manager(page);
  await page.getByRole("link", { name: "نسخة احتياطية", exact: true }).click();
  const password = page.getByLabel("كلمة حماية النسخة", { exact: true });
  const confirmation = page.getByLabel("تأكيد كلمة الحماية", { exact: true });
  await password.fill("short");
  await confirmation.fill("short");
  await page.getByRole("button", { name: "إنشاء وتنزيل النسخة" }).click();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await password.fill("long-test-password");
  await confirmation.fill("different-password");
  await page.getByRole("button", { name: "إنشاء وتنزيل النسخة" }).click();
  await expect(confirmation).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "كلمتا الحماية غير متطابقتين" })).toBeVisible();
});
