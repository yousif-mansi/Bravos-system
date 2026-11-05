import { expect, test, type Page } from "@playwright/test";
import { openLookupLists } from "./support/open-lookup-lists";

const internal = "http://127.0.0.1:5174";
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const LABEL_PRINTER = "Xprinter XP-236B";
const RECEIPT_PRINTER = "Bravos Receipts - Xprinter XP-80TS";

type JobBody = {
  id?: string;
  kind?: string;
  copies?: number;
  product?: { code?: string; name?: string };
  receiptView?: {
    printedReference?: string;
    finalTotal?: string;
    serverReference?: string;
    localOperationReference?: string;
  };
};

function statusBody() {
  return {
    ok: true,
    paired: true,
    staffOrigin: internal,
    listen: { host: "127.0.0.1", port: 17831 },
    routing: { label: LABEL_PRINTER, receipt: RECEIPT_PRINTER },
    implementation: "windows_native",
    queue: { outstanding: 0, cap: 8, retained: 0, metadataCap: 50000, retentionMs: 1 },
  };
}

async function installConnector(page: Page, jobs: JobBody[], options?: { fail?: boolean }) {
  await page.route("http://127.0.0.1:17831/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/health") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (request.method() === "POST" && path === "/pair") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: TOKEN }) });
      return;
    }
    if (request.method() === "GET" && path === "/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statusBody()) });
      return;
    }
    if (request.method() === "POST" && path === "/unpair") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (request.method() === "POST" && path === "/jobs") {
      const body = request.postDataJSON() as JobBody;
      jobs.push(body);
      if (options?.fail) {
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({
          job: { id: body.id, kind: body.kind, phase: "unknown", failureCode: "submission_uncertain", createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" },
        }) });
        return;
      }
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({
        job: { id: body.id, kind: body.kind, phase: "submitted", failureCode: null, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" },
      }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{\"error\":\"not_found\"}" });
  });
}

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

test("pairing is once per browser, keeps the generic label size, and routes documents apart", async ({ page, context }) => {
  const jobs: JobBody[] = [];
  await page.addInitScript(() => {
    const root = window.top as Window & { __printCalls?: number };
    root.__printCalls = 0;
    window.print = () => {
      root.__printCalls = (root.__printCalls ?? 0) + 1;
    };
  });
  await installConnector(page, jobs);
  await page.goto(`${internal}/login`);
  await page.evaluate(() => {
    localStorage.setItem("bravos.product-label.device", JSON.stringify({ widthMm: 90, heightMm: 50, dpi: 300 }));
    localStorage.removeItem("bravos.product-label.profile");
  });
  await login(page);
  await page.goto(`${internal}/workspace`);
  const panel = page.getByTestId("printer-connection");
  await expect(panel.getByTestId("printer-pair-code")).toBeVisible();
  await panel.getByTestId("printer-pair-code").fill(" abcd2345efgh6789 ");
  await panel.getByTestId("printer-pair").click();
  await expect(panel.getByTestId("printer-pair-code")).toHaveCount(0);
  await expect(panel.getByTestId("printer-label-destination")).toContainText(LABEL_PRINTER);
  await expect(panel.getByTestId("printer-receipt-destination")).toContainText(RECEIPT_PRINTER);
  await expect(panel.getByTestId("printer-connection-status")).not.toContainText("خرج الورق");
  const saved = await page.evaluate(() => ({
    token: localStorage.getItem("bravos.print-connector.token"),
    device: localStorage.getItem("bravos.product-label.device"),
    profile: localStorage.getItem("bravos.product-label.profile"),
  }));
  expect(saved.token).toBe(TOKEN);
  expect(saved.profile).toBe("xp236b-38x25");
  expect(JSON.parse(saved.device ?? "null")).toEqual({ widthMm: 90, heightMm: 50, dpi: 300 });

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("bravos.print-connector.token"))).toBe(TOKEN);

  await login(page);
  await page.goto(`${internal}/workspace`);
  await expect(page.getByTestId("printer-pair-code")).toHaveCount(0);

  const tag = crypto.randomUUID().slice(0, 8);
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: `طابعة ${tag}` });
  const size = await api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M-${tag}` });
  const color = await api(page, "POST", "/api/internal/catalog/colors", { nameAr: `أسود-${tag}` });
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code: `BRV-PRT-${tag}`,
    nameAr: `قميص ${tag}`,
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

  await page.goto(`${internal}/catalog`);
  await page.getByRole("button", { name: `طباعة باركود ${product.code}`, exact: true }).click();
  const dialog = page.getByTestId("product-label-dialog");
  await expect(dialog.getByTestId("product-label-print")).toBeEnabled();
  await dialog.getByTestId("product-label-print").click();
  await expect(dialog.getByRole("status")).toContainText("برنامج الطباعة");
  expect(jobs.filter((job) => job.kind === "label")).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    kind: "label",
    product: { code: product.code, name: product.nameAr },
    paper: { widthMm: 38, heightMm: 25 },
    profile: "compact",
  });
  expect(await page.evaluate(() => (window.top as Window & { __printCalls?: number }).__printCalls ?? 0)).toBe(0);
  const matchingSales = async () => {
    const sales = await api(page, "GET", "/api/internal/sales") as Array<{ finalTotalPiasters?: number; lines: Array<{ variantId: string }> }>;
    return sales.filter((sale) => sale.lines.some((line) => line.variantId === variant.id));
  };
  const available = async () => {
    const looked = await api(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(product.code)}`);
    return looked.variants.find((item: { id: string }) => item.id === variant.id).availableQuantity as number;
  };
  expect(await matchingSales()).toHaveLength(0);
  expect(await available()).toBe(2);

  await page.goto(`${internal}/lookup`);
  const form = page.getByRole("form", { name: "البحث برمز المنتج" });
  await form.getByLabel("رمز المنتج").fill(product.code);
  await form.getByLabel("رمز المنتج").press("Enter");
  await expect(page.getByTestId("lookup-result")).toContainText(product.code);
  await openLookupLists(page);
  await page.locator("#lookupSize").selectOption(size.id);
  await page.locator("#lookupColor").selectOption(color.id);
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await context.setOffline(true);
  let printed = "";
  try {
    await page.getByTestId("complete-sale-print").click();
    await expect(page.getByTestId("sale-details")).toContainText(/رقم الإيصال: BRV-/);
    const receiptText = await page.getByTestId("sale-details").innerText();
    printed = receiptText.match(/BRV-\d+-\d+/)?.[0] ?? "";
    expect(printed).toBeTruthy();
    await expect.poll(() => jobs.filter((job) => job.kind === "receipt").length).toBe(1);
    const receiptJob = jobs.find((job) => job.kind === "receipt");
    expect(receiptJob?.receiptView?.printedReference).toBe(printed);
    expect(receiptJob?.receiptView?.finalTotal).toBe("120");
    expect(receiptText).toContain("120");
    expect(receiptJob?.receiptView?.serverReference).toBeUndefined();
    expect(receiptJob?.receiptView?.localOperationReference).toBeUndefined();
    expect(JSON.stringify(receiptJob)).not.toContain("unitCost");
    expect(await page.evaluate(() => (window.top as Window & { __printCalls?: number }).__printCalls ?? 0)).toBe(0);
    expect(await matchingSales()).toHaveLength(0);
    expect(await available()).toBe(2);

    await page.getByTestId("reprint-receipt").click();
    await expect(page.getByTestId("receipt-print-status")).toContainText("برنامج الطباعة");
    expect(jobs.filter((job) => job.kind === "receipt")).toHaveLength(2);
    const reprintJob = jobs.filter((job) => job.kind === "receipt")[1];
    expect(reprintJob?.receiptView?.printedReference).toBe(printed);
    expect(reprintJob?.receiptView?.finalTotal).toBe("120");
    expect(reprintJob?.receiptView?.serverReference).toBeUndefined();
    expect(reprintJob?.receiptView?.localOperationReference).toBeUndefined();
    expect(JSON.stringify(reprintJob)).not.toContain("unitCost");
    expect(await matchingSales()).toHaveLength(0);
    expect(await available()).toBe(2);
    expect(await page.evaluate(() => (window.top as Window & { __printCalls?: number }).__printCalls ?? 0)).toBe(0);
  } finally {
    await context.setOffline(false);
  }

  await expect.poll(async () => (await matchingSales()).length).toBe(1);
  await expect.poll(available).toBe(1);
  expect((await matchingSales())[0]?.finalTotalPiasters).toBe(12000);

  jobs.length = 0;
  await page.unroute("http://127.0.0.1:17831/**");
  await installConnector(page, jobs, { fail: true });
  await page.getByTestId("reprint-receipt").click();
  await expect(page.getByTestId("receipt-print-error")).toBeVisible();
  expect(jobs.filter((job) => job.kind === "receipt")).toHaveLength(1);
  const uncertain = jobs.find((job) => job.kind === "receipt");
  expect(uncertain?.receiptView?.printedReference).toBe(printed);
  expect(uncertain?.receiptView?.serverReference).toBeUndefined();
  expect(uncertain?.receiptView?.localOperationReference).toBeUndefined();
  expect(JSON.stringify(uncertain)).not.toContain("unitCost");
  expect(await matchingSales()).toHaveLength(1);
  expect(await available()).toBe(1);
  expect(await page.evaluate(() => (window.top as Window & { __printCalls?: number }).__printCalls ?? 0)).toBe(0);
});
