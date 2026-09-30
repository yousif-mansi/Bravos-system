import { expect, test, type Page } from "@playwright/test";

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
}

async function expectGreenChecked(checkbox: ReturnType<Page["getByRole"]>) {
  await expect(checkbox).toBeChecked();
  const accentColor = await checkbox.evaluate((element) => getComputedStyle(element).accentColor);
  expect(accentColor).toMatch(/^rgb\((22, 128, 82|38, 162, 105)\)$/);
}
