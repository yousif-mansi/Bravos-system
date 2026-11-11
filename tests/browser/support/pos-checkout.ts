import { expect, type Locator, type Page } from "@playwright/test";

/** Reveal the optional customer, discount, and coupon fields without closing an already-open disclosure. */
export async function openPosOptionalDetails(checkout: Locator): Promise<void> {
  const details = checkout.locator("details.pos-optional-details");
  if (await details.count() === 0) {
    await expect(checkout.getByLabel("اسم الزبون (اختياري)")).toBeVisible();
    return;
  }
  if (await details.getAttribute("open") === null) {
    await details.locator("summary").click();
  }
}

/** Exercise validation to keep a priced cart unpaid for tests that need to edit it or simulate a race. */
export async function stageUnpaidPosQuote(checkout: Locator): Promise<void> {
  await checkout.getByRole("radio", { name: "دفع مقسّم" }).check();
  await checkout.getByLabel("المبلغ النقدي بالجنيه").fill("");
  await checkout.getByLabel("المبلغ الإلكتروني بالجنيه").fill("");
  await checkout.getByTestId("complete-sale").click();
  await expect(checkout.getByRole("alert")).toContainText("أدخل مبلغ النقد والدفع الإلكتروني");
  await expect(checkout.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByRole("radio", { name: "نقداً بالكامل" }).check();
}

/** Clicks Complete Sale (or print) and confirms updated amounts when the POS requires a second click. */
export async function finalizePosSale(
  checkout: Locator,
  page: Page,
  options?: { print?: boolean },
): Promise<void> {
  const button = checkout.getByTestId(options?.print ? "complete-sale-print" : "complete-sale");
  await button.click();
  const saved = page.getByRole("status").filter({ hasText: /تم حفظ البيع|تم العثور على البيع المحفوظ/ });
  const confirm = page.getByTestId("pos-amount-confirmation");
  const error = checkout.getByRole("alert");
  await expect(saved.or(confirm).or(error).first()).toBeVisible({ timeout: 30_000 });
  if (await saved.isVisible()) return;
  if (await confirm.isVisible()) {
    await button.click();
  }
}
