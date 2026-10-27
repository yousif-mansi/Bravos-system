import { expect, test, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

const internal = "http://127.0.0.1:5174";
const contactPhone = "01017412287";
const shots = ".scratch/pos-hardware-20261026/screenshots";

type SaleLine = { variantId: string; paidPiasters: number; variant: { product: { nameAr: string; code: string } } };
type Sale = {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  finalTotalPiasters: number;
  lines: SaleLine[];
};

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const response = await page.request.fetch(`${internal}${path}`, {
    method,
    headers: { origin: internal, ...(data ? { "content-type": "application/json" } : {}) },
    data,
  });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

async function login(page: Page) {
  await page.goto(`${internal}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await page.getByRole("button", { name: "أبشواي", exact: true }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function seed(page: Page) {
  await login(page);
  const tag = crypto.randomUUID().slice(0, 8);
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: `قمصان الإيصال ${tag}` });
  const size = await api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M-${tag}` });
  const color = await api(page, "POST", "/api/internal/catalog/colors", { nameAr: `أزرق-${tag}` });
  const nameAr = `قميص Tee <b data-injected="pos-hardware">Bravos</b> ${tag}`;
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code: `HW-${tag}`,
    nameAr,
    descriptionAr: "",
    categoryId: category.id,
    defaultSellingPricePiasters: 12000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
  });
  const workspace = await api(page, "GET", "/api/internal/workspace");
  const variant = product.variants[0];
  await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: workspace.activeBranch.id,
    receiptDate: "2026-10-05",
    lines: [{ variantId: variant.id, quantity: 2, unitCostPiasters: 5000 }],
  });
  return { tag, product, size, color, variant, nameAr };
}

async function openLookup(page: Page) {
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await expect(page.getByRole("form", { name: "البحث برمز المنتج" })).toBeVisible();
}

async function salesForVariant(page: Page, variantId: string): Promise<Sale[]> {
  const sales = await api(page, "GET", "/api/internal/sales");
  return (sales as Sale[]).filter((sale) => sale.lines.some((line) => line.variantId === variantId));
}

async function available(page: Page, code: string, variantId: string) {
  const found = await api(page, "GET", `/api/internal/catalog/lookup?code=${code}`);
  return found.variants.find((variant: { id: string }) => variant.id === variantId).availableQuantity as number;
}

async function lookupCode(page: Page, code: string) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(code);
  await lookup.getByLabel("رمز المنتج").press("Enter");
}

function installPrintHarness({ throwInstead }: { throwInstead: boolean }) {
    const root = window.top as Window & { __receiptPrintCalls?: number; __receiptPrintThrow?: boolean };
    if (root.__receiptPrintCalls == null) root.__receiptPrintCalls = 0;
    root.__receiptPrintThrow ??= throwInstead;
    window.print = () => {
      if (root.__receiptPrintThrow) throw new Error("printer-stub-failed");
      window.dispatchEvent(new Event("afterprint"));
      root.__receiptPrintCalls = (root.__receiptPrintCalls ?? 0) + 1;
    };
}

test("lowercase product-code Enter finds the cached product online and offline without selling", async ({ page, context }) => {
  const data = await seed(page);
  await openLookup(page);
  const before = await salesForVariant(page, data.variant.id);
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toBeVisible();

  await lookupCode(page, data.product.code.toLowerCase());
  await expect(page.getByRole("form", { name: "البحث برمز المنتج" }).getByLabel("رمز المنتج")).toHaveValue("");
  await expect(page.getByTestId("lookup-result")).toContainText(data.nameAr);
  await expect(page.locator("#lookupSize")).toHaveValue("");
  await expect(page.locator("#lookupColor")).toHaveValue("");
  await expect(page.getByRole("form", { name: "إتمام البيع" })).not.toContainText(data.nameAr);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(before.length);

  await context.setOffline(true);
  await lookupCode(page, data.product.code.toLowerCase());
  await expect(page.getByRole("form", { name: "البحث برمز المنتج" }).getByLabel("رمز المنتج")).toHaveValue("");
  await expect(page.getByTestId("lookup-result")).toContainText(data.nameAr);
  await expect(page.locator("#lookupSize")).toHaveValue("");
  await expect(page.locator("#lookupColor")).toHaveValue("");

  await lookupCode(page, `missing-${data.tag}`);
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText(data.nameAr);
  await expect(page.getByTestId("lookup-result")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "إتمام البيع" })).not.toContainText(data.nameAr);
  await context.setOffline(false);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(before.length);
});

test("complete without printing persists one sale and leaves reprint available", async ({ page }) => {
  await page.addInitScript(installPrintHarness, { throwInstead: false });
  const data = await seed(page);
  await openLookup(page);
  const beforeSales = await salesForVariant(page, data.variant.id);
  const beforeStock = await available(page, data.product.code, data.variant.id);

  await lookupCode(page, data.product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(data.size.id);
  await page.locator("#lookupColor").selectOption(data.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByTestId("complete-sale").click();

  await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع" })).toBeVisible();
  await expect(page.getByTestId("sale-details")).toBeVisible();
  await expect(page.getByTestId("reprint-receipt")).toBeVisible();
  await expect(page.getByTestId("complete-sale-print")).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(0);
  await expect.poll(async () => (await salesForVariant(page, data.variant.id)).length).toBe(beforeSales.length + 1);
  const afterSales = await salesForVariant(page, data.variant.id);
  expect(afterSales).toHaveLength(beforeSales.length + 1);
  expect(afterSales.at(-1)?.finalTotalPiasters).toBe(12000);
  await expect.poll(() => available(page, data.product.code, data.variant.id)).toBe(beforeStock - 1);
});

test("receipt preview renders the completed sale at 58mm and 80mm", async ({ page }) => {
  const data = await seed(page);
  await openLookup(page);
  await lookupCode(page, data.product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(data.size.id);
  await page.locator("#lookupColor").selectOption(data.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByTestId("complete-sale").click();
  await expect(page.getByTestId("sale-details")).toBeVisible();
  await expect.poll(async () => (await salesForVariant(page, data.variant.id)).length).toBe(1);
  const sale = (await salesForVariant(page, data.variant.id)).at(-1)!;
  expect(sale.customerName).toBeNull();
  expect(sale.customerPhone).toBeNull();
  expect(sale.lines[0]?.variant.product.nameAr).toBe(data.nameAr);

  for (const paperWidthMm of [58, 80] as const) {
    await page.evaluate(async ({ sale, paperWidthMm, contactPhone }) => {
      const hostId = "receipt-preview-host";
      let host = document.getElementById(hostId);
      if (!host) {
        host = document.createElement("div");
        host.id = hostId;
        document.body.appendChild(host);
      }
      host.replaceChildren();
      const receipts = await import("/src/receipts/index.ts");
      await receipts.mountReceiptPreview(host, sale, { paperWidthMm, contactPhone });
    }, { sale, paperWidthMm, contactPhone });

    const frame = page.frameLocator('iframe[title="معاينة الإيصال"]');
    await expect(frame.getByText(data.nameAr, { exact: false })).toBeVisible();
    await expect(frame.locator("body")).toContainText("120");
    await expect(frame.locator("body")).toContainText(contactPhone);
    await expect(frame.locator("body")).toContainText("BRAVOS");
    await expect(frame.locator('b[data-injected="pos-hardware"], img, script')).toHaveCount(0);
    await expect(frame.getByRole("link", { name: "تغيير الفرع" })).toHaveCount(0);
    await expect(frame.getByRole("link", { name: "تسجيل الخروج" })).toHaveCount(0);
    await expect(frame.locator("body")).not.toContainText("تكلفة");
    await expect(frame.locator("body")).not.toContainText("unitCostPiasters");
    await frame.locator("body").evaluate(async (node) => { await node.ownerDocument.fonts.ready; });
    expect(await frame.locator(".receipt").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await frame.locator(".receipt").screenshot({ path: `${shots}/receipt-${paperWidthMm}.png` });
  }
});

test("stubbed offline receipt print runs once per request and does not sell again", async ({ page, context }) => {
  await page.addInitScript(installPrintHarness, { throwInstead: false });
  const data = await seed(page);
  await openLookup(page);
  const beforeSales = await salesForVariant(page, data.variant.id);
  const beforeStock = await available(page, data.product.code, data.variant.id);

  await lookupCode(page, data.product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(data.size.id);
  await page.locator("#lookupColor").selectOption(data.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: data.product.code })).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.screenshot({ path: `${shots}/pos-completion-options.png`, fullPage: true });
  if (process.env.BRAVOS_HW_PRODUCTION === "1") {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        });
      }
    });
  }
  await context.setOffline(true);
  await page.getByTestId("complete-sale-print").click();
  await expect(page.getByTestId("sale-details")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(1);
  await expect(page.getByTestId("pos-receipt-status")).toContainText("تم طلب طباعة الإيصال");
  await context.setOffline(false);
  await expect.poll(async () => (await salesForVariant(page, data.variant.id)).length).toBe(beforeSales.length + 1);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(beforeSales.length + 1);
  expect(await available(page, data.product.code, data.variant.id)).toBe(beforeStock - 1);

  await page.getByTestId("reprint-receipt").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(2);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(beforeSales.length + 1);
  expect(await available(page, data.product.code, data.variant.id)).toBe(beforeStock - 1);

  await page.evaluate(() => {
    (window as Window & { __receiptPrintThrow?: boolean }).__receiptPrintThrow = true;
  });
  await page.getByTestId("reprint-receipt").click();
  await expect(page.getByTestId("receipt-print-error")).toBeVisible();
  await expect(page.getByTestId("receipt-print-error")).toContainText("لم تُفتح نافذة الطباعة. البيع مكتمل.");
  expect(await page.evaluate(() => (window as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(2);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(beforeSales.length + 1);
  expect(await available(page, data.product.code, data.variant.id)).toBe(beforeStock - 1);
});

test("complete and print shows a local save error and does not sell when sales storage rejects", async ({ page }) => {
  await page.addInitScript(installPrintHarness, { throwInstead: false });
  const data = await seed(page);
  await openLookup(page);
  const beforeSales = await salesForVariant(page, data.variant.id);
  const beforeStock = await available(page, data.product.code, data.variant.id);

  await lookupCode(page, data.product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(data.size.id);
  await page.locator("#lookupColor").selectOption(data.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();

  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype;
    const originalAdd = proto.add;
    const originalPut = proto.put;
    const rejectSales = function (this: IDBObjectStore) {
      if (this.name === "sales") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
    proto.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      rejectSales.call(this);
      return originalAdd.apply(this, args);
    };
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      rejectSales.call(this);
      return originalPut.apply(this, args);
    };
    (window as Window & { __bravosRestoreSalesIdb?: () => void }).__bravosRestoreSalesIdb = () => {
      proto.add = originalAdd;
      proto.put = originalPut;
    };
  });

  try {
    await page.getByTestId("complete-sale-print").click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("تعذر حفظ البيع");
    await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع" })).toHaveCount(0);
    await expect(page.getByTestId("sale-details")).toHaveCount(0);
    await expect(page.locator('iframe[title="إيصال الطباعة"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window.top as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(0);
    expect(await salesForVariant(page, data.variant.id)).toHaveLength(beforeSales.length);
    expect(await available(page, data.product.code, data.variant.id)).toBe(beforeStock);
  } finally {
    await page.evaluate(() => {
      (window as Window & { __bravosRestoreSalesIdb?: () => void }).__bravosRestoreSalesIdb?.();
    }).catch(() => undefined);
  }
});

function installReprintFontBarrier() {
  const top = window.top as Window & {
    __receiptPrintCalls?: number;
    __fontLoadStarted?: boolean;
    __releaseFontLoad?: () => void;
  };
  if (top.__receiptPrintCalls == null) top.__receiptPrintCalls = 0;
  window.print = () => {
    window.dispatchEvent(new Event("afterprint"));
    top.__receiptPrintCalls = (top.__receiptPrintCalls ?? 0) + 1;
  };
  if (window === window.top) return;
  const fonts = Object.getPrototypeOf(document.fonts) as FontFaceSet;
  const originalLoad = fonts.load;
  let gate = (top as Window & { __fontLoadGate?: Promise<void> }).__fontLoadGate;
  if (!gate) {
    gate = new Promise<void>((resolve) => {
      top.__releaseFontLoad = () => resolve();
    });
    (top as Window & { __fontLoadGate?: Promise<void> }).__fontLoadGate = gate;
  }
  fonts.load = function (this: FontFaceSet, ...args: Parameters<FontFaceSet["load"]>) {
    top.__fontLoadStarted = true;
    return gate!.then(() => originalLoad.apply(this, args));
  };
}

test("reprint cancelled by the same staff account during font preparation does not print or resell", async ({ page }) => {
  await page.addInitScript(installReprintFontBarrier);
  const data = await seed(page);
  await openLookup(page);
  const beforeSales = await salesForVariant(page, data.variant.id);
  const beforeStock = await available(page, data.product.code, data.variant.id);

  await lookupCode(page, data.product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(data.size.id);
  await page.locator("#lookupColor").selectOption(data.color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار", exact: true }).click();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByTestId("complete-sale").click();
  await expect(page.getByTestId("sale-details")).toBeVisible();
  await expect.poll(async () => (await salesForVariant(page, data.variant.id)).length).toBe(beforeSales.length + 1);
  const completedCount = (await salesForVariant(page, data.variant.id)).length;
  const stockAfterSale = await available(page, data.product.code, data.variant.id);
  expect(stockAfterSale).toBe(beforeStock - 1);

  const workspace = await api(page, "GET", "/api/internal/workspace");
  const staffId = workspace.staff.id as string;
  await page.getByTestId("reprint-receipt").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __fontLoadStarted?: boolean }).__fontLoadStarted === true)).toBe(true);
  await page.evaluate(async (currentStaffId: string) => {
    const session = await import("/src/account-session.ts");
    (session as { publishAccount: (accountId: string) => void }).publishAccount(currentStaffId);
  }, staffId);
  await page.evaluate(() => {
    (window as Window & { __releaseFontLoad?: () => void }).__releaseFontLoad?.();
  });

  await expect(page.getByTestId("reprint-receipt")).toBeEnabled();
  expect(await page.evaluate(() => (window.top as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(0);
  expect(await salesForVariant(page, data.variant.id)).toHaveLength(completedCount);
  expect(await available(page, data.product.code, data.variant.id)).toBe(stockAfterSale);
});
