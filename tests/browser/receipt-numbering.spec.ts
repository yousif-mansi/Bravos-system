import { expect, test, type Page, type Request } from "@playwright/test";
import { finalizePosSale } from "./support/pos-checkout";

const internal = "http://127.0.0.1:5174";
const warehouseBranchId = "33333333-3333-4333-8333-333333333333";
const BRV = /^BRV-\d+-\d+$/;
const BRV_TEXT = /BRV-\d+-\d+/;
const POS_TEXT = /POS-\d{6,}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Numbering = {
  registrationId?: string;
  deviceId?: string;
  prefix?: string;
  nextSequence?: string;
};

type LocalSale = {
  id: string;
  operationId: string;
  staffId: string;
  syncStatus?: string;
  reference?: string | null;
  receiptReference?: string;
  receiptNumberingConflict?: true;
  payloadFingerprint?: string | null;
  finalTotalPiasters?: number;
  receiptClaim?: { reference?: string; deviceId?: string; registrationId?: string; sequence?: string; prefix?: string };
};

type PosDb = {
  deviceId: string | null;
  numberingRaw: string | null;
  numbering: Numbering | string | null;
  sales: LocalSale[];
  effects: unknown[];
};

type Seeded = {
  code: string;
  sizeId: string;
  colorId: string;
  variantId: string;
};

function snapshotBodies(page: Page): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/internal/sales/pos-snapshots")) return;
    const raw = request.postData();
    if (!raw) return;
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
  });
  return bodies;
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

async function seed(page: Page, quantity: number): Promise<Seeded> {
  const tag = crypto.randomUUID().slice(0, 8);
  const category = await api(page, "POST", "/api/internal/catalog/categories", { nameAr: `إيصال ${tag}` });
  const size = await api(page, "POST", "/api/internal/catalog/sizes", { nameAr: `M-${tag}` });
  const color = await api(page, "POST", "/api/internal/catalog/colors", { nameAr: `أزرق-${tag}` });
  const product = await api(page, "POST", "/api/internal/catalog/products", {
    code: `RN-${tag}`,
    nameAr: `قميص رقم ${tag}`,
    descriptionAr: "",
    categoryId: category.id,
    defaultSellingPricePiasters: 12000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
  });
  const workspace = await api(page, "GET", "/api/internal/workspace");
  await api(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: warehouseBranchId,
    receiptDate: "2026-10-05",
    lines: [{ productId: product.id, quantity, unitCostPiasters: 4000 }],
  });
  await api(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: warehouseBranchId,
    destinationBranchId: workspace.activeBranch.id,
    productId: product.id,
    quantity,
  });
  return { code: product.code, sizeId: size.id, colorId: color.id, variantId: product.operationalVariantId };
}

async function openLookup(page: Page) {
  await page.goto(`${internal}/lookup`);
  await expect(page.getByRole("form", { name: "البحث برمز المنتج" })).toBeVisible();
}

async function sellOne(
  page: Page, seeded: Seeded, button: "complete-sale" | "complete-sale-print", receipt = BRV_TEXT, available?: number,
) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(seeded.code);
  await lookup.getByLabel("رمز المنتج").press("Enter");
  const selection = page.getByTestId("lookup-result");
  await expect(selection).toContainText(seeded.code);
  if (available !== undefined) {
    await expect(selection.getByTestId("available-quantity")).toHaveText(`الكمية المتاحة في الفرع: ${available}`);
  }
  await selection.getByTestId("add-operational").click();
  await finalizePosSale(page.getByRole("form", { name: "إتمام البيع" }), page, { print: button === "complete-sale-print" });
  await expect(page.getByTestId("sale-details")).toContainText(new RegExp(`رقم الإيصال: ${receipt.source}`));
}

async function readPosDb(page: Page): Promise<PosDb> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(name: string) => new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(name, "readonly").objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const meta = await all<{ key: string; value: string }>("meta");
    const sales = await all<LocalSale>("sales");
    const effects = await all<unknown>("effects");
    db.close();
    const numberingRaw = meta.find((row) => row.key === "receiptNumbering")?.value ?? null;
    let numbering: Numbering | string | null = null;
    if (numberingRaw) {
      try {
        numbering = JSON.parse(numberingRaw) as Numbering;
      } catch {
        numbering = numberingRaw;
      }
    }
    return {
      deviceId: meta.find((row) => row.key === "deviceId")?.value ?? null,
      numberingRaw,
      numbering,
      sales,
      effects,
    };
  });
}

async function writeMeta(page: Page, key: string, value: string) {
  await page.evaluate(async ({ key, value }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { key, value });
}

function readyNumbering(state: PosDb): Numbering {
  expect(state.numbering && typeof state.numbering === "object").toBe(true);
  return state.numbering as Numbering;
}

async function waitForPrefix(page: Page) {
  await expect.poll(async () => {
    const numbering = (await readPosDb(page)).numbering;
    return Boolean(numbering && typeof numbering === "object" && numbering.prefix && numbering.nextSequence);
  }).toBe(true);
}

test("passive login, workspace, and stock snapshots omit registration", async ({ page }) => {
  test.setTimeout(90_000);
  const bodies = snapshotBodies(page);
  let startedPause = false;
  try {
    await login(page);
    await expect.poll(() => bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => !Object.hasOwn(body, "receiptRegistrationId"))).toBe(true);

    const installed = await readPosDb(page);
    expect(installed.deviceId).toBeTruthy();
    const registrationId = "11111111-1111-4111-8111-111111111111";
    await writeMeta(page, "receiptNumbering", JSON.stringify({
      registrationId,
      deviceId: installed.deviceId,
      prefix: "7",
      nextSequence: "5",
    }));
    const beforeReload = bodies.length;
    await page.reload();
    await expect.poll(() => bodies.length).toBeGreaterThan(beforeReload);
    expect(bodies.every((body) => !Object.hasOwn(body, "receiptRegistrationId"))).toBe(true);
    expect(readyNumbering(await readPosDb(page)).nextSequence).toBe("5");

    await page.getByRole("link", { name: "تصحيح كميات المخزون" }).click();
    await page.getByRole("button", { name: "مزامنة النقاط وبدء التوقف" }).click();
    startedPause = true;
    await expect(page.getByRole("status")).toContainText("بدأ التوقف المؤقت");
    const beforeStock = bodies.length;
    await page.getByRole("button", { name: "مزامنة هذه النقطة وإظهار التوقف" }).click();
    await expect.poll(() => bodies.length).toBeGreaterThan(beforeStock);
    expect(bodies.slice(beforeStock).every((body) => !Object.hasOwn(body, "receiptRegistrationId"))).toBe(true);
    await page.getByRole("button", { name: "إلغاء دون تصحيح" }).click();
    startedPause = false;

    await page.goto(`${internal}/workspace`);
    const retry = page.getByTestId("retry-sync");
    await expect(retry).toBeEnabled();
    await retry.focus();
    await retry.press("Enter");
    await expect.poll(() => bodies.some((body) => body.receiptRegistrationId === registrationId)).toBe(true);
    expect(readyNumbering(await readPosDb(page)).nextSequence).toBe("5");
    expect(readyNumbering(await readPosDb(page)).prefix).toBe("7");
  } finally {
    if (startedPause) {
      await page.goto(`${internal}/stock-corrections`).catch(() => undefined);
      const cancel = page.getByRole("button", { name: "إلغاء دون تصحيح" });
      if (await cancel.isVisible().catch(() => false)) await cancel.click();
    }
  }
});

test("connected and cached offline sales keep one receipt through reload, reprint, and returns", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const root = window.top as Window & { __receiptPrintCalls?: number; __lastReceiptText?: string };
    root.__receiptPrintCalls ??= 0;
    window.print = () => {
      root.__lastReceiptText = document.body.textContent ?? "";
      window.dispatchEvent(new Event("afterprint"));
      root.__receiptPrintCalls = (root.__receiptPrintCalls ?? 0) + 1;
    };
  });
  const bodies = snapshotBodies(page);
  await login(page);
  const seeded = await seed(page, 2);
  await openLookup(page);
  await waitForPrefix(page);
  await expect.poll(() => bodies.some((body) => typeof body.receiptRegistrationId === "string")).toBe(true);
  await sellOne(page, seeded, "complete-sale-print", POS_TEXT, 2);
  const firstText = await page.getByTestId("sale-details").innerText();
  const first = firstText.match(POS_TEXT)?.[0];
  expect(first).toMatch(POS_TEXT);
  expect(firstText.includes("عملية محلية")).toBe(false);
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __lastReceiptText?: string }).__lastReceiptText)).toContain(first!);
  const firstAlias = (await readPosDb(page)).sales.find((sale) => sale.reference === first)?.receiptReference;
  expect(firstAlias).toMatch(BRV);
  const afterFirst = readyNumbering(await readPosDb(page));
  expect(afterFirst.nextSequence).not.toBe("1");

  await page.reload();
  await page.goto(`${internal}/sales`);
  await expect(page.getByTestId("sale-list")).toContainText(first!);
  await expect(page.getByTestId("sale-list")).not.toContainText("عملية محلية");
  await page.getByTestId("sale-list").getByRole("row").filter({ hasText: first! }).getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("sale-details")).toContainText(`رقم الإيصال: ${first}`);
  await page.getByTestId("reprint-receipt").click();
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __lastReceiptText?: string }).__lastReceiptText)).toContain(first!);
  expect(readyNumbering(await readPosDb(page)).nextSequence).toBe(afterFirst.nextSequence);

  await openLookup(page);
  await expect(page.getByTestId("pos-product-tile").filter({ hasText: seeded.code })).toContainText("متاح بالفرع: 1");
  await page.context().setOffline(true);
  await sellOne(page, seeded, "complete-sale-print", BRV_TEXT, 1);
  const second = (await page.getByTestId("sale-details").innerText()).match(BRV_TEXT)?.[0];
  expect(second).toMatch(BRV);
  expect(second).not.toBe(firstAlias);
  const offlineState = await readPosDb(page);
  const offlineSecond = offlineState.sales.find((sale) => sale.receiptReference === second);
  expect(offlineSecond?.syncStatus).toBe("pending");
  expect(offlineSecond?.receiptClaim?.reference).toBe(second);
  expect(offlineState.sales.map((sale) => sale.receiptReference).sort()).toEqual([firstAlias, second].sort());
  await page.context().setOffline(false);
  await page.goto(`${internal}/workspace`);
  const passiveFrom = bodies.length;
  await expect.poll(async () => {
    const state = await readPosDb(page);
    return state.sales.every((sale) => sale.syncStatus === "acknowledged");
  }).toBe(true);
  await expect.poll(() => bodies.length).toBeGreaterThan(passiveFrom);
  expect(bodies.slice(passiveFrom).every((body) => !Object.hasOwn(body, "receiptRegistrationId"))).toBe(true);
  const synced = await readPosDb(page);
  const kept = synced.sales.find((sale) => sale.reference === first);
  expect(kept?.receiptClaim?.reference).toBe(firstAlias);
  expect(kept?.payloadFingerprint).toMatch(/^[0-9a-f]{64}$/i);

  await page.route("**/api/internal/sales/pos-snapshots", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.includedOperations = [
      ...(Array.isArray(json.includedOperations) ? json.includedOperations : []),
      { operationId: kept?.operationId, saleId: kept?.id, contentDigest: kept?.payloadFingerprint },
    ];
    await route.fulfill({ response, json });
  });
  await page.reload();
  await expect.poll(async () => (await readPosDb(page)).sales.find((sale) => sale.id === kept?.id)?.receiptClaim?.reference).toBe(firstAlias);

  const syncedSecond = synced.sales.find((sale) => sale.receiptReference === second);
  expect(syncedSecond?.reference).toMatch(POS_TEXT);
  await page.goto(`${internal}/sales?saleId=${syncedSecond!.id}`);
  await expect(page.getByTestId("sale-details")).toContainText(`رقم الإيصال: ${second}`);
  await page.getByTestId("reprint-receipt").click();
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __lastReceiptText?: string }).__lastReceiptText)).toContain(second!);

  await page.goto(`${internal}/returns`);
  for (const reference of [second!, syncedSecond!.reference!]) {
    await page.getByLabel("رقم الإيصال أو الطلب أو هاتف العميل").fill(reference);
    await page.getByRole("button", { name: "بحث" }).click();
    await expect(page.getByTestId("return-source-list")).toContainText(`إيصال ${syncedSecond!.reference}`);
    await expect(page.getByTestId("return-source-list")).not.toContainText(syncedSecond!.operationId);
  }
});

test("two tabs allocate different counters and a failed sale rolls the counter back", async ({ page, context }) => {
  test.setTimeout(90_000);
  await login(page);
  const seeded = await seed(page, 3);
  await openLookup(page);
  const page2 = await context.newPage();
  await page2.goto(`${internal}/lookup`);
  await expect(page2.getByRole("form", { name: "البحث برمز المنتج" })).toBeVisible();
  await expect(page2.getByTestId("pos-product-tile").filter({ hasText: seeded.code })).toBeVisible();
  await waitForPrefix(page);
  await page.context().setOffline(true);
  await sellOne(page, seeded, "complete-sale");
  await sellOne(page2, seeded, "complete-sale");
  const state = await readPosDb(page);
  const references = state.sales.map((sale) => sale.receiptReference);
  expect(references).toHaveLength(2);
  expect(new Set(references).size).toBe(2);
  expect(references.every((reference) => BRV.test(reference ?? ""))).toBe(true);
  const sequences = state.sales.map((sale) => sale.receiptClaim?.sequence);
  expect(new Set(sequences).size).toBe(2);
  expect(readyNumbering(state).nextSequence).not.toBe(sequences[0]);
  expect(state.effects).toHaveLength(2);
  expect(state.sales.every((sale) => sale.finalTotalPiasters === 12000)).toBe(true);
  await page.context().setOffline(false);
  await expect.poll(async () => {
    const found = await api(page, "GET", `/api/internal/catalog/lookup?code=${seeded.code}`);
    return found.availableQuantity;
  }).toBe(1);

  await openLookup(page);
  await expect.poll(() => {
    return readPosDb(page).then((current) => readyNumbering(current).nextSequence ?? "");
  }).not.toBe("");
  const beforeFailure = await readPosDb(page);
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype;
    const originalAdd = proto.add;
    const originalPut = proto.put;
    const abortEffects = function (this: IDBObjectStore) {
      if (this.name === "effects") {
        this.transaction.abort();
        throw new DOMException("AbortError", "AbortError");
      }
    };
    proto.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      abortEffects.call(this);
      return originalAdd.apply(this, args);
    };
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      abortEffects.call(this);
      return originalPut.apply(this, args);
    };
  });
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByLabel("رمز المنتج").fill(seeded.code);
  await lookup.getByLabel("رمز المنتج").press("Enter");
  await page.getByTestId("add-operational").click();
  await page.getByTestId("complete-sale").click();
  await expect(page.getByRole("alert")).toContainText("تعذر حفظ البيع");
  const afterFailure = await readPosDb(page);
  expect(afterFailure.sales).toHaveLength(beforeFailure.sales.length);
  expect(afterFailure.effects).toHaveLength(beforeFailure.effects.length);
  expect(afterFailure.numberingRaw).toBe(beforeFailure.numberingRaw);
});

test("replaced device and corrupt numbering stay untouched until active preparation", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const seeded = await seed(page, 1);
  await openLookup(page);
  await waitForPrefix(page);
  await sellOne(page, seeded, "complete-sale");
  const paid = (await readPosDb(page)).sales[0];
  expect(paid?.receiptClaim?.reference).toMatch(BRV);
  const originalClaim = paid?.receiptClaim;

  await writeMeta(page, "receiptNumbering", "broken");
  await page.goto(`${internal}/workspace`);
  await page.reload();
  expect((await readPosDb(page)).numberingRaw).toBe("broken");
  expect((await readPosDb(page)).sales[0]?.receiptClaim).toEqual(originalClaim);

  await openLookup(page);
  await expect.poll(async () => {
    const state = await readPosDb(page);
    const numbering = state.numbering;
    return Boolean(numbering && typeof numbering === "object" && numbering.registrationId && numbering.deviceId === state.deviceId);
  }).toBe(true);
  expect((await readPosDb(page)).sales[0]?.receiptClaim).toEqual(originalClaim);

  const installed = await readPosDb(page);
  const oldRegistration = readyNumbering(installed).registrationId;
  await writeMeta(page, "deviceId", "22222222-2222-4222-8222-222222222222");
  await page.goto(`${internal}/workspace`);
  await page.reload();
  const passive = await readPosDb(page);
  expect(passive.deviceId).toBe("22222222-2222-4222-8222-222222222222");
  expect(readyNumbering(passive).registrationId).toBe(oldRegistration);
  expect((await readPosDb(page)).sales[0]?.receiptClaim).toEqual(originalClaim);

  await openLookup(page);
  await expect.poll(async () => {
    const numbering = (await readPosDb(page)).numbering;
    return Boolean(
      numbering
      && typeof numbering === "object"
      && numbering.deviceId === "22222222-2222-4222-8222-222222222222"
      && numbering.registrationId
      && numbering.registrationId !== oldRegistration,
    );
  }).toBe(true);
  expect((await readPosDb(page)).sales[0]?.receiptClaim).toEqual(originalClaim);
});

test("nonempty corrupt device id stays until active receipt preparation", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const seeded = await seed(page, 1);
  await openLookup(page);
  await waitForPrefix(page);
  await sellOne(page, seeded, "complete-sale");
  const before = await readPosDb(page);
  const paid = before.sales[0];
  expect(paid?.receiptClaim?.reference).toMatch(BRV);
  const originalClaim = paid?.receiptClaim;
  const previousRegistration = readyNumbering(before).registrationId;
  const corruptDevice = "not-a-uuid";
  await writeMeta(page, "deviceId", corruptDevice);
  await page.goto(`${internal}/workspace`);
  await page.reload();
  const passive = await readPosDb(page);
  expect(passive.deviceId).toBe(corruptDevice);
  expect(passive.numberingRaw).toBe(before.numberingRaw);
  expect(passive.sales[0]?.receiptClaim).toEqual(originalClaim);

  await openLookup(page);
  await expect.poll(async () => {
    const state = await readPosDb(page);
    const numbering = state.numbering;
    return Boolean(
      state.deviceId
      && UUID.test(state.deviceId)
      && state.deviceId !== corruptDevice
      && numbering
      && typeof numbering === "object"
      && numbering.deviceId === state.deviceId
      && numbering.registrationId
      && numbering.registrationId !== previousRegistration,
    );
  }).toBe(true);
  const repaired = await readPosDb(page);
  expect(repaired.sales).toHaveLength(before.sales.length);
  expect(repaired.sales[0]?.receiptClaim).toEqual(originalClaim);
  expect(repaired.sales[0]?.receiptReference).toBe(originalClaim?.reference);
});

test("manager recovery keeps the printed receipt when the server reference differs", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const seeded = await seed(page, 1);
  await openLookup(page);
  await waitForPrefix(page);
  await page.context().setOffline(true);
  await sellOne(page, seeded, "complete-sale");
  const local = (await readPosDb(page)).sales[0];
  expect(local?.receiptClaim?.reference).toMatch(BRV);
  await page.evaluate(async (saleId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sales", "readwrite");
      const store = tx.objectStore("sales");
      const request = store.get(saleId);
      request.onsuccess = () => {
        const row = request.result as { staffId: string; syncStatus: string };
        row.staffId = "00000000-0000-4000-8000-000000000099";
        row.syncStatus = "pending";
        store.put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, local?.id);
  let recoverBody: { receiptClaim?: { reference?: string } } | null = null;
  await page.route("**/api/internal/sales/recover", async (route) => {
    recoverBody = route.request().postDataJSON();
    const response = await route.fetch();
    const json = await response.json();
    json.receiptReference = "BRV-9-999999";
    json.receiptNumberingConflict = true;
    await route.fulfill({ response, json });
  });
  await page.context().setOffline(false);
  await page.goto(`${internal}/workspace`);
  await expect(page.getByTestId("recover-queue")).toBeVisible();
  await page.getByTestId("recover-queue").click();
  await expect.poll(() => recoverBody?.receiptClaim?.reference ?? "").toBe(local?.receiptReference);
  await expect.poll(async () => {
    const sale = (await readPosDb(page)).sales.find((row) => row.id === local?.id);
    return `${sale?.receiptReference ?? ""}:${sale?.receiptNumberingConflict === true}`;
  }).toBe(`${local?.receiptReference}:true`);
});

test("sales list, detail, and deep link reprint keep the local number when the server receipt differs", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const root = window.top as Window & { __receiptPrintCalls?: number };
    root.__receiptPrintCalls ??= 0;
    window.print = () => {
      window.dispatchEvent(new Event("afterprint"));
      root.__receiptPrintCalls = (root.__receiptPrintCalls ?? 0) + 1;
    };
  });
  await login(page);
  const seeded = await seed(page, 1);
  const beforeStock = await api(page, "GET", `/api/internal/catalog/lookup?code=${seeded.code}`);
  const beforeAvailable = beforeStock.availableQuantity as number;
  await openLookup(page);
  await waitForPrefix(page);
  await sellOne(page, seeded, "complete-sale");
  const printed = (await page.getByTestId("sale-details").innerText()).match(BRV_TEXT)?.[0];
  expect(printed).toMatch(BRV);
  await expect.poll(async () => (await readPosDb(page)).sales.find((sale) => sale.receiptReference === printed)?.syncStatus).toBe("acknowledged");
  const saved = (await readPosDb(page)).sales.find((sale) => sale.receiptReference === printed);
  expect(saved?.id).toBeTruthy();
  const saleId = saved!.id;
  const targetDetailFulfillments: Array<{ id: string; receiptReference: string }> = [];
  // `**` does not cross `/`, so the old glob hit the list and missed /sales/<id>.
  const saleReadUrl = /\/api\/internal\/sales(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?=[?#]|$)/i;
  await page.route(saleReadUrl, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const isSaleRead = request.method() === "GET" && (path === "/api/internal/sales" || /^\/api\/internal\/sales\/[^/]+$/.test(path));
    if (!isSaleRead) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = await response.json();
    const differ = (sale: { receiptReference?: string }) => ({ ...sale, receiptReference: "BRV-9-999999" });
    const fulfilled = Array.isArray(json) ? json.map(differ) : differ(json);
    const detailId = /^\/api\/internal\/sales\/([^/]+)$/.exec(path)?.[1];
    if (detailId === saleId && !Array.isArray(fulfilled) && fulfilled.receiptReference === "BRV-9-999999") {
      targetDetailFulfillments.push({ id: detailId, receiptReference: fulfilled.receiptReference });
    }
    await route.fulfill({ response, json: fulfilled });
  });
  await page.goto(`${internal}/sales?saleId=${saleId}`);
  expect(saved?.reference).toMatch(POS_TEXT);
  const row = page.getByTestId("sale-list").getByRole("row").filter({ hasText: saved!.reference! });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("BRV-9-999999");
  await expect(page.getByTestId("sale-details")).toContainText(`رقم الإيصال: ${printed}`);
  expect(targetDetailFulfillments).toContainEqual({ id: saleId, receiptReference: "BRV-9-999999" });
  await expect(page.getByTestId("receipt-number-conflict")).toBeVisible();
  await row.getByRole("button", { name: "فتح التفاصيل" }).click();
  await expect(page.getByTestId("sale-details")).toContainText(`رقم الإيصال: ${printed}`);
  await expect(page.getByTestId("sale-details")).not.toContainText("BRV-9-999999");
  await page.getByTestId("reprint-receipt").click();
  await expect.poll(() => page.evaluate(() => (window.top as Window & { __receiptPrintCalls?: number }).__receiptPrintCalls ?? 0)).toBe(1);
  await expect(page.getByTestId("sale-details")).toContainText(`رقم الإيصال: ${printed}`);
  const afterStock = await api(page, "GET", `/api/internal/catalog/lookup?code=${seeded.code}`);
  expect(afterStock.availableQuantity).toBe(beforeAvailable - 1);
  expect((await readPosDb(page)).sales.find((sale) => sale.id === saved?.id)?.receiptReference).toBe(printed);
});
