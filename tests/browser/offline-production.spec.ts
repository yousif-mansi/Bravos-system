import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { pinnedProcessEnv, workspaceRoot } from "../../scripts/pinned-env.ts";
import { openLookupLists } from "./support/open-lookup-lists";

const PREVIEW_PORT = 5176;
const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;

let preview: ChildProcess | undefined;

test.beforeAll(async () => {
  await waitForPortFree(PREVIEW_PORT);
  await runPinned("pnpm", ["--filter", "@bravos/internal", "build"]);
  preview = spawn(
    "pnpm",
    ["--filter", "@bravos/internal", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    {
      cwd: workspaceRoot(),
      env: pinnedProcessEnv({ BRAVOS_API_ORIGIN: "http://127.0.0.1:3011" }),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  await waitForHttp(`${PREVIEW_ORIGIN}/`, 60_000);
});

test.afterAll(async () => {
  await stopPreview(preview);
  preview = undefined;
});

test("production precache serves first offline POS navigation and survives a same-profile restart", async ({
  playwright,
}) => {
  const profileParent = await mkdtemp(path.join(tmpdir(), "bravos-offline-parent-"));
  const userDataDir = path.join(profileParent, "profile");
  await mkdir(userDataDir, { recursive: true });
  let context: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  let restarted: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      locale: "ar-EG",
      viewport: { width: 1280, height: 720 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${PREVIEW_ORIGIN}/login`);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "إنتاج أوفلاين" });
    const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس إنتاج" });
    const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون إنتاج" });
    const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
      code: "OFF-PROD",
      nameAr: "قميص الإنتاج",
      descriptionAr: "قطن",
      categoryId: category.body.id,
      defaultSellingPricePiasters: 16000,
      publication: "hidden",
      imageRefs: [],
      variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
    });
    await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(),
      receiptDate: "2026-09-11",
      lines: [{ variantId: product.body.variants[0].id, quantity: 3, unitCostPiasters: 5000 }],
    });
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await page.getByLabel("اسم الدخول").fill("cashier");
    await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });

    await context.setOffline(true);
    await page.getByRole("link", { name: "البحث عن منتج" }).click();
    await expect(page.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
    const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-PROD");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await expect(page.getByTestId("lookup-result")).toContainText("قميص الإنتاج");
    await openLookupLists(page);
    await page.getByLabel("المقاس").selectOption({ label: "مقاس إنتاج" });
    await page.getByLabel("اللون").selectOption({ label: "لون إنتاج" });
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByLabel("خصم الموظف بالجنيه").fill("10");
    await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    await expect(page.getByTestId("sale-details")).toContainText("150");
    const original = await readPosSales(page);
    expect(original).toHaveLength(1);
    expect(original[0]?.branch.code).toBe("abshway");
    expect(original[0]?.soldByDisplayName).toBe("كاشير تجريبي");
    expect(original[0]?.originalTotalPiasters).toBe(16000);
    expect(original[0]?.employeeDiscountPiasters).toBe(1000);
    expect(original[0]?.finalTotalPiasters).toBe(15000);
    const originalId = original[0]?.id;
    const originalOperation = original[0]?.operationId;
    const originalOccurred = original[0]?.occurredAt;

    await page.close();
    await context.close();
    context = undefined;

    restarted = await playwright.chromium.launchPersistentContext(userDataDir, {
      locale: "ar-EG",
      viewport: { width: 1280, height: 720 },
    });
    await restarted.setOffline(true);
    const again = restarted.pages()[0] ?? (await restarted.newPage());
    await again.goto(`${PREVIEW_ORIGIN}/lookup`);
    await expect(again.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
    // Same-profile restart while offline must retain the actual Cairo font assets.
    const typography = await again.evaluate(async () => {
      const loaded = await Promise.all([400, 500, 600, 700, 800].map(async (weight) => {
        const faces = await document.fonts.load(`${weight} 16px Cairo`, "برافوس Bravos");
        return faces.length > 0 && faces.every((face) => face.status === "loaded");
      }));
      const assets = await Promise.all(["arabic", "latin", "latin-ext"].map(async (subset) => {
        const response = await fetch(`/fonts/cairo-${subset}.woff2`, { cache: "no-store" });
        return response.ok && (await response.arrayBuffer()).byteLength > 0;
      }));
      return { loaded, assets };
    });
    expect(typography.loaded).toEqual([true, true, true, true, true]);
    expect(typography.assets).toEqual([true, true, true]);
    await again.getByRole("link", { name: "المبيعات" }).click();
    await expect(again.getByTestId("sale-list")).toContainText("كاشير تجريبي");
    await expect(again.getByTestId("sale-list")).toContainText("غير مزامن");
    await expect(again.getByTestId("sale-details")).toContainText("أبشواي");
    await expect(again.getByTestId("sale-details")).toContainText("150");
    const restored = await readPosSales(again);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(originalId);
    expect(restored[0]?.operationId).toBe(originalOperation);
    expect(restored[0]?.occurredAt).toBe(originalOccurred);
    expect(restored[0]?.branch.code).toBe("abshway");
    expect(restored[0]?.soldByDisplayName).toBe("كاشير تجريبي");
    expect(restored[0]?.originalTotalPiasters).toBe(16000);
    expect(restored[0]?.employeeDiscountPiasters).toBe(1000);
    expect(restored[0]?.finalTotalPiasters).toBe(15000);
    await again.getByRole("link", { name: "العودة لمساحة العمل" }).click();
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
    await again.getByRole("link", { name: "البحث عن منتج" }).click();
    const lookupAgain = again.getByRole("form", { name: "البحث برمز المنتج" });
    await lookupAgain.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-PROD");
    await lookupAgain.getByRole("button", { name: "بحث" }).click();
    await openLookupLists(again);
    await again.getByLabel("المقاس").selectOption({ label: "مقاس إنتاج" });
    await again.getByLabel("اللون").selectOption({ label: "لون إنتاج" });
    await expect(again.getByTestId("available-quantity")).toHaveText("الكمية المتاحة: 2");
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (restarted) {
      await restarted.close().catch(() => undefined);
    }
    const resolvedParent = await realpath(profileParent);
    const resolvedProfile = await realpath(userDataDir).catch(() => userDataDir);
    if (resolvedProfile === resolvedParent || resolvedProfile.startsWith(`${resolvedParent}${path.sep}`)) {
      await rm(profileParent, { recursive: true, force: true });
    }
  }
});

test("production offline queue survives restart then automatically syncs after reconnect", async ({
  playwright,
}) => {
  const profileParent = await mkdtemp(path.join(tmpdir(), "bravos-offline-ack-"));
  const userDataDir = path.join(profileParent, "profile");
  await mkdir(userDataDir, { recursive: true });
  let context: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  let restarted: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      locale: "ar-EG",
      viewport: { width: 1280, height: 720 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${PREVIEW_ORIGIN}/login`);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "إنتاج مزامنة" });
    const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس مزامنة" });
    const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون مزامنة" });
    const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
      code: "OFF-ACK",
      nameAr: "قميص المزامنة",
      descriptionAr: "قطن",
      categoryId: category.body.id,
      defaultSellingPricePiasters: 15000,
      publication: "hidden",
      imageRefs: [],
      variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
    });
    await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(),
      receiptDate: "2026-09-11",
      lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 4000 }],
    });
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await page.getByLabel("اسم الدخول").fill("cashier");
    await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
    await page.getByRole("link", { name: "البحث عن منتج" }).click();
    await expect(page.getByRole("form", { name: "البحث برمز المنتج" })).toBeVisible();
    await expect.poll(async () => {
      const numbering = await readReceiptNumbering(page);
      return Boolean(numbering?.prefix && numbering.nextSequence);
    }, { timeout: 45_000 }).toBe(true);
    const prepared = await readReceiptNumbering(page);
    expect(prepared?.prefix).toBeTruthy();
    expect(prepared?.nextSequence).toBeTruthy();
    await context.setOffline(true);
    const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-ACK");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await openLookupLists(page);
    await page.getByLabel("المقاس").selectOption({ label: "مقاس مزامنة" });
    await page.getByLabel("اللون").selectOption({ label: "لون مزامنة" });
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    const original = await readPosSales(page);
    expect(original).toHaveLength(1);
    expect(original[0]?.syncStatus).toBe("pending");
    expect(original[0]?.finalTotalPiasters).toBe(15000);
    const originalId = original[0]?.id;
    const receiptReference = original[0]?.receiptReference;
    const receiptClaim = original[0]?.receiptClaim;
    expect(receiptReference).toMatch(/^BRV-\d{3,}-\d{6,}$/);
    expect(receiptClaim?.reference).toBe(receiptReference);
    expect(receiptClaim?.prefix).toBe(prepared?.prefix);
    expect(receiptClaim?.sequence).toBe(prepared?.nextSequence);
    expect(receiptClaim?.registrationId).toBe(prepared?.registrationId);
    expect(receiptClaim?.deviceId).toBe(prepared?.deviceId);
    const counterAfterSale = await readReceiptNumbering(page);
    expect(counterAfterSale?.prefix).toBe(prepared?.prefix);
    expect(counterAfterSale?.registrationId).toBe(prepared?.registrationId);
    expect(counterAfterSale?.deviceId).toBe(prepared?.deviceId);
    expect(counterAfterSale?.nextSequence).not.toBe(prepared?.nextSequence);
    await page.close();
    await context.close();
    context = undefined;

    const relaunched = await relaunchSameProfileOffline(playwright, userDataDir);
    restarted = relaunched.context;
    const again = relaunched.page;
    await again.goto(`${PREVIEW_ORIGIN}/workspace`);
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1", { timeout: 45_000 });
    expect(await readReceiptNumbering(again)).toEqual(counterAfterSale);
    const restored = await readPosSales(again);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(originalId);
    expect(restored[0]?.syncStatus).toBe("pending");
    expect(restored[0]?.finalTotalPiasters).toBe(15000);
    expect(restored[0]?.receiptReference).toBe(receiptReference);
    expect(restored[0]?.receiptClaim).toEqual(receiptClaim);
    expect(await readReceiptNumbering(again)).toEqual(counterAfterSale);
    await restarted.setOffline(false);
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0", { timeout: 45_000 });
    await expect.poll(async () => (await readPosSales(again))[0]?.syncStatus).toBe("acknowledged");
    const acknowledged = await readPosSales(again);
    expect(acknowledged[0]?.receiptReference).toBe(receiptReference);
    expect(acknowledged[0]?.receiptClaim).toEqual(receiptClaim);
    expect(acknowledged[0]?.finalTotalPiasters).toBe(15000);
    expect(await readReceiptNumbering(again)).toEqual(counterAfterSale);
    const listed = await staffApi(again, "GET", "/api/internal/sales");
    expect(listed.body.some((sale: { id: string }) => sale.id === originalId)).toBe(true);
    expect(listed.body.find((sale: { id: string; receiptReference?: string }) => sale.id === originalId)?.receiptReference).toBe(receiptReference);
    const lookupAfter = await staffApi(again, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("OFF-ACK")}`);
    expect(lookupAfter.body.variants[0].availableQuantity).toBe(1);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (restarted) {
      await restarted.close().catch(() => undefined);
    }
    const resolvedParent = await realpath(profileParent);
    const resolvedProfile = await realpath(userDataDir).catch(() => userDataDir);
    if (resolvedProfile === resolvedParent || resolvedProfile.startsWith(`${resolvedParent}${path.sep}`)) {
      await rm(profileParent, { recursive: true, force: true });
    }
  }
});

test("incomplete production cache is not advertised ready", async ({ page }) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (request.url.includes("cashier-sales")) {
          await cache.delete(request);
        }
      }
    }
  });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByTestId("offline-not-ready")).toBeVisible({ timeout: 20_000 });
});

test("waiting service worker with an unknown schema defers activation", async ({ page }) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "تحديث مؤجل" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس تحديث" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون تحديث" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "OFF-WAIT",
    nameAr: "قميص التحديث",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 16000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 5000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-WAIT");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption({ label: "مقاس تحديث" });
  await page.getByLabel("اللون").selectOption({ label: "لون تحديث" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const queued = await readPosSales(page);
  expect(queued).toHaveLength(1);
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  const swPath = path.join(workspaceRoot(), "apps", "internal", "dist", "sw.js");
  const originalSw = await readFile(swPath, "utf8");
  expect(originalSw).toContain("POS_RELEASE");
  const schemaDeclaration = originalSw.match(/(?:const|let|var)\s+[A-Za-z_$][\w$]*=Number\.parseInt\("4",\s*10\)/);
  expect(schemaDeclaration).not.toBeNull();
  const replacedSw = originalSw.replace(schemaDeclaration![0], schemaDeclaration![0].replace(/Number\.parseInt\("4",\s*10\)/, "99"));
  expect(replacedSw).not.toBe(originalSw);
  await writeFile(swPath, `${replacedSw}\n// bravos-unknown-schema-fixture\n`);
  await page.context().route(/sw\.js/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "cache-control": "no-store" },
      body: `${replacedSw}\n// bravos-unknown-schema-fixture\n`,
    });
  });
  try {
  const originalController = await page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) {
      return null;
    }
    const release = await new Promise<{ schemaVersion: number }>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("release-timeout")), 4000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(event.data as { schemaVersion: number });
      };
      worker.postMessage({ type: "POS_RELEASE" }, [channel.port2]);
    });
    return { scriptURL: worker.scriptURL, schemaVersion: release.schemaVersion, state: worker.state };
  });
  expect(originalController?.schemaVersion).toBe(4);
  expect(originalController?.state).toBe("activated");
  const waitingMeta = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      const current = await navigator.serviceWorker.getRegistration();
      if (current?.waiting) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const waiting = (await navigator.serviceWorker.getRegistration())?.waiting;
    if (!waiting) {
      return null;
    }
    const release = await new Promise<{ schemaVersion: number }>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("release-timeout")), 4000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(event.data as { schemaVersion: number });
      };
      waiting.postMessage({ type: "POS_RELEASE" }, [channel.port2]);
    });
    await window.__bravosDecideUpdate?.();
    return { schemaVersion: release.schemaVersion, state: waiting.state };
  });
  expect(waitingMeta?.schemaVersion).toBe(99);
  expect(waitingMeta?.state).toBe("installed");
  await expect(page.getByTestId("update-deferred")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("offline-ready")).toBeVisible();
  const after = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const controller = navigator.serviceWorker.controller;
    const waiting = registration?.waiting;
    async function releaseOf(worker: ServiceWorker | null | undefined) {
      if (!worker) {
        return null;
      }
      return new Promise<{ schemaVersion: number }>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => reject(new Error("release-timeout")), 4000);
        channel.port1.onmessage = (event) => {
          window.clearTimeout(timer);
          resolve(event.data as { schemaVersion: number });
        };
        worker.postMessage({ type: "POS_RELEASE" }, [channel.port2]);
      });
    }
    return {
      controllerSchema: (await releaseOf(controller))?.schemaVersion ?? null,
      controllerState: controller?.state ?? null,
      waitingSchema: (await releaseOf(waiting))?.schemaVersion ?? null,
      waitingState: waiting?.state ?? null,
    };
  });
  expect(after.controllerSchema).toBe(4);
  expect(after.controllerState).toBe("activated");
  expect(after.waitingSchema).toBe(99);
  expect(after.waitingState).toBe("installed");
  const stillQueued = await readPosSales(page);
  expect(stillQueued).toHaveLength(1);
  expect(stillQueued[0]?.id).toBe(queued[0]?.id);
  expect(stillQueued[0]?.finalTotalPiasters).toBe(16000);
  } finally {
    await writeFile(swPath, originalSw);
  }
});

test("an older index revision cannot satisfy the current release cache", async ({ page }) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  const swapped = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active;
    if (!worker) {
      return false;
    }
    const release = await new Promise<{ cacheName: string; cacheKeys: string[] }>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("release-timeout")), 4000);
      channel.port1.onmessage = (event) => {
        window.clearTimeout(timer);
        resolve(event.data as { cacheName: string; cacheKeys: string[] });
      };
      worker.postMessage({ type: "POS_RELEASE" }, [channel.port2]);
    });
    const indexKey = release.cacheKeys.find((key) => key.includes("index.html"));
    if (!indexKey || !release.cacheName) {
      return false;
    }
    const cache = await caches.open(release.cacheName);
    const current = await cache.match(indexKey);
    if (!current) {
      return false;
    }
    await cache.delete(indexKey);
    const oldKey = indexKey.includes("__WB_REVISION__")
      ? indexKey.replace(/(__WB_REVISION__=)[^&]+/, "$1old-revision-fixture")
      : `${indexKey}${indexKey.includes("?") ? "&" : "?"}__WB_REVISION__=old-revision-fixture`;
    await cache.put(oldKey, current.clone());
    return (await cache.match(oldKey)) !== undefined && (await cache.match(indexKey)) === undefined;
  });
  expect(swapped).toBe(true);
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(page.getByTestId("offline-not-ready")).toBeVisible({ timeout: 20_000 });
});

test("schema 2 individual paid units and signed-in session survive upgrade and offline restart", async ({
  playwright,
}) => {
  const profileParent = await mkdtemp(path.join(tmpdir(), "bravos-upgrade-parent-"));
  const userDataDir = path.join(profileParent, "profile");
  await mkdir(userDataDir, { recursive: true });
  let context: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  let restarted: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      locale: "ar-EG",
      viewport: { width: 1280, height: 720 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${PREVIEW_ORIGIN}/login`);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "ترقية مخطط" });
    const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس ترقية" });
    const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون ترقية" });
    const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
      code: "OFF-UP",
      nameAr: "قميص الترقية",
      descriptionAr: "قطن",
      categoryId: category.body.id,
      defaultSellingPricePiasters: 20000,
      publication: "hidden",
      imageRefs: [],
      variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
    });
    await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(),
      receiptDate: "2026-09-11",
      lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 4000 }],
    });
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await page.getByLabel("اسم الدخول").fill("cashier");
    await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
    await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
    await page.route("**/api/internal/sales", (route) => route.abort("failed"));
    await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
    await page.getByRole("link", { name: "البحث عن منتج" }).click();
    const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-UP");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await openLookupLists(page);
    await page.getByLabel("المقاس").selectOption({ label: "مقاس ترقية" });
    await page.getByLabel("اللون").selectOption({ label: "لون ترقية" });
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByLabel("خصم الموظف بالجنيه").fill("1");
    await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    const snapshot = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      async function all(name: string) {
        if (!db.objectStoreNames.contains(name)) {
          return [];
        }
        return new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(name, "readonly").objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      const sales = await all("sales");
      const sessions = await all("sessions");
      const snapshots = await all("snapshots");
      const effects = await all("effects");
      const pending = await all("pending");
      const device = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("deviceId");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      const currentStaff = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return {
        sales,
        sessions,
        snapshots,
        effects,
        pending,
        deviceId: device?.value,
        currentStaffId: currentStaff?.value,
      };
    });
    expect((snapshot.sales as Array<{ id: string }>).length).toBe(1);
    const signedInBeforeSeed = (snapshot.sessions as Array<{ signedOut: boolean }>).filter((row) => !row.signedOut);
    expect(signedInBeforeSeed).toHaveLength(1);
    const seeded = await seedLegacyOnIsolatedPage(context, page, snapshot, {
      omitCurrentStaffId: true,
      unitMode: "legacy-individual",
    });
    expect(seeded.version).toBe(20);
    expect(seeded.schema).toBe("2");
    expect(seeded.currentStaffId).toBeNull();
    expect(seeded.storeNames).toEqual(
      expect.arrayContaining(["meta", "sessions", "snapshots", "sales", "effects", "pending", "legacyPending"]),
    );
    expect(seeded.salesIndexes).toEqual(expect.arrayContaining(["staffId", "operationId", "syncStatus"]));
    expect(seeded.sessions.filter((row) => !row.signedOut)).toHaveLength(1);
    expect(seeded.units).toEqual([
      { listedPiasters: 20000, discountPiasters: 100, paidPiasters: 19900 },
    ]);

    await context.close();
    context = undefined;
    const relaunched = await relaunchSameProfileOffline(playwright, userDataDir);
    restarted = relaunched.context;
    const again = relaunched.page;
    await again.goto(`${PREVIEW_ORIGIN}/workspace`);
    await expect.poll(async () => (await readPosSales(again)).length, { timeout: 45_000 }).toBe(1);
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1", { timeout: 45_000 });
    await expect(again.getByTestId("active-branch")).toContainText("أبشواي");
    await again.getByRole("link", { name: "المبيعات" }).click();
    await expect(again.getByTestId("sale-list")).toContainText("كاشير تجريبي");
    await expect(again.getByTestId("sale-details")).toContainText("أبشواي");
    await expect(again.getByTestId("sale-details")).toContainText("199");
    const restored = await again.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const currentId = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      const schema = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("schemaVersion");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      const sales = await new Promise<
        Array<{
          id: string;
          staffId: string;
          soldByDisplayName: string;
          finalTotalPiasters: number;
          originalTotalPiasters: number;
          employeeDiscountPiasters: number;
          branch: { code: string };
          lines: Array<{ quantity: number; units: Array<{ unitIndex: number; quantity: number; paidPiasters: number }> }>;
        }>
      >((resolve, reject) => {
        const req = db.transaction("sales", "readonly").objectStore("sales").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const effects = await new Promise<Array<{ quantity: number }>>((resolve, reject) => {
        const req = db.transaction("effects", "readonly").objectStore("effects").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return { currentId, schema, sales, effects };
    });
    expect(restored.schema).toBe("4");
    expect(restored.sales).toHaveLength(1);
    expect(restored.currentId).toBe(restored.sales[0]?.staffId);
    expect(restored.sales[0]?.soldByDisplayName).toBe("كاشير تجريبي");
    expect(restored.sales[0]?.branch.code).toBe("abshway");
    expect(restored.sales[0]?.originalTotalPiasters).toBe(20000);
    expect(restored.sales[0]?.employeeDiscountPiasters).toBe(100);
    expect(restored.sales[0]?.finalTotalPiasters).toBe(19900);
    expect(restored.sales[0]?.lines[0]?.quantity).toBe(1);
    expect(restored.sales[0]?.lines[0]?.units).toEqual([
      { unitIndex: 0, quantity: 1, listedPiasters: 20000, discountPiasters: 100, paidPiasters: 19900 },
    ]);
    expect(restored.effects[0]?.quantity).toBe(1);
    await again.reload();
    await expect(again.getByTestId("sale-details")).toContainText("كاشير تجريبي");
    await expect(again.getByTestId("sale-details")).toContainText("199");
    await expect(again.getByTestId("sale-list")).toContainText("غير مزامن");
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (restarted) {
      await restarted.close().catch(() => undefined);
    }
    await rm(profileParent, { recursive: true, force: true });
  }
});

test("schema 2 completed sales missing paid-unit allocations defer upgrade and keep original facts", async ({
  playwright,
}) => {
  const profileParent = await mkdtemp(path.join(tmpdir(), "bravos-incomplete-parent-"));
  const userDataDir = path.join(profileParent, "profile");
  await mkdir(userDataDir, { recursive: true });
  let context: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  let restarted: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
  try {
    context = await playwright.chromium.launchPersistentContext(userDataDir, {
      locale: "ar-EG",
      viewport: { width: 1280, height: 720 },
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`${PREVIEW_ORIGIN}/login`);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "ترقية ناقصة" });
    const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس ناقص" });
    const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون ناقص" });
    const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
      code: "OFF-INCOMPLETE",
      nameAr: "قميص الوحدات الناقصة",
      descriptionAr: "قطن",
      categoryId: category.body.id,
      defaultSellingPricePiasters: 18000,
      publication: "hidden",
      imageRefs: [],
      variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
    });
    await staffApi(page, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(),
      receiptDate: "2026-09-11",
      lines: [{ variantId: product.body.variants[0].id, quantity: 2, unitCostPiasters: 4000 }],
    });
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await page.getByLabel("اسم الدخول").fill("cashier");
    await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
    await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
    await page.route("**/api/internal/sales", (route) => route.abort("failed"));
    await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
    await page.getByRole("link", { name: "البحث عن منتج" }).click();
    const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
    await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-INCOMPLETE");
    await lookup.getByRole("button", { name: "بحث" }).click();
    await openLookupLists(page);
    await page.getByLabel("المقاس").selectOption({ label: "مقاس ناقص" });
    await page.getByLabel("اللون").selectOption({ label: "لون ناقص" });
    await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
    const checkout = page.getByRole("form", { name: "إتمام البيع" });
    await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
    await checkout.getByRole("button", { name: "إتمام البيع" }).click();
    await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
    const original = await readPosSales(page);
    expect(original).toHaveLength(1);
    const snapshot = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      async function all(name: string) {
        if (!db.objectStoreNames.contains(name)) {
          return [];
        }
        return new Promise<unknown[]>((resolve, reject) => {
          const req = db.transaction(name, "readonly").objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      const currentStaff = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      const device = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("deviceId");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      const payload = {
        sales: await all("sales"),
        sessions: await all("sessions"),
        snapshots: await all("snapshots"),
        effects: await all("effects"),
        pending: await all("pending"),
        deviceId: device?.value,
        currentStaffId: currentStaff?.value,
      };
      db.close();
      return payload;
    });
    const seeded = await seedLegacyOnIsolatedPage(context, page, snapshot, {
      omitCurrentStaffId: false,
      unitMode: "empty",
    });
    expect(seeded.version).toBe(20);
    expect(seeded.schema).toBe("2");
    expect(seeded.currentStaffId).toBe(snapshot.currentStaffId ?? null);
    expect(seeded.sessions.filter((row) => !row.signedOut)).toHaveLength(1);
    expect(seeded.units).toEqual([]);

    await context.close();
    context = undefined;
    const relaunched = await relaunchSameProfileOffline(playwright, userDataDir);
    restarted = relaunched.context;
    const again = relaunched.page;
    await again.goto(`${PREVIEW_ORIGIN}/workspace`);
    await expect.poll(async () => (await readPosSales(again)).length, { timeout: 45_000 }).toBe(1);
    await expect(again.getByTestId("update-deferred")).toBeVisible({ timeout: 45_000 });
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
    await again.getByRole("link", { name: "المبيعات" }).click();
    await expect(again.getByTestId("sale-list")).toContainText("كاشير تجريبي");
    await expect(again.getByTestId("sale-details")).toContainText("180");
    const restored = await again.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const schema = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("schemaVersion");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      const blocked = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("upgradeBlocked");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      const sales = await new Promise<
        Array<{
          id: string;
          staffId: string;
          soldByDisplayName: string;
          syncStatus: string;
          originalTotalPiasters: number;
          employeeDiscountPiasters: number;
          finalTotalPiasters: number;
          branch: { code: string };
          lines: Array<{ quantity: number; units?: unknown[] }>;
        }>
      >((resolve, reject) => {
        const req = db.transaction("sales", "readonly").objectStore("sales").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const effects = await new Promise<Array<{ quantity: number }>>((resolve, reject) => {
        const req = db.transaction("effects", "readonly").objectStore("effects").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return { schema, blocked, sales, effects };
    });
    expect(restored.schema).toBe("2");
    expect(restored.blocked).toBe("1");
    expect(restored.sales).toHaveLength(1);
    expect(restored.sales[0]?.id).toBe(original[0]?.id);
    expect(restored.sales[0]?.soldByDisplayName).toBe("كاشير تجريبي");
    expect(restored.sales[0]?.branch.code).toBe("abshway");
    expect(restored.sales[0]?.syncStatus).toBe("pending");
    expect(restored.sales[0]?.originalTotalPiasters).toBe(18000);
    expect(restored.sales[0]?.finalTotalPiasters).toBe(18000);
    expect(restored.sales[0]?.lines[0]?.quantity).toBe(1);
    expect(restored.sales[0]?.lines[0]?.units ?? []).toEqual([]);
    expect(restored.effects[0]?.quantity).toBe(1);
    await again.getByRole("link", { name: "العودة لمساحة العمل" }).click();
    await expect(again.getByTestId("update-deferred")).toBeVisible();
    await again.reload();
    await expect(again.getByTestId("update-deferred")).toBeVisible();
    await again.getByRole("link", { name: "المبيعات" }).click();
    await expect(again.getByTestId("sale-details")).toContainText("180");
    let blockedUploadAttempts = 0;
    await restarted.route(/\/api\/internal\/sales(?:\/accepted|\/recover)?$/, async (route) => {
      if (route.request().method() === "POST") {
        blockedUploadAttempts += 1;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    await again.getByRole("link", { name: "العودة لمساحة العمل" }).click();
    await restarted.setOffline(false);
    await again.getByTestId("retry-sync").click();
    await expect(again.getByTestId("sync-error")).toContainText("تحديث نقطة البيع مؤجل");
    await expect(again.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
    expect(blockedUploadAttempts).toBe(0);

    await again.getByRole("button", { name: "تسجيل الخروج" }).click();
    await again.getByLabel("اسم الدخول").fill("owner");
    await again.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await again.getByRole("button", { name: "دخول" }).click();
    await again.getByRole("button", { name: "أبشواي" }).click();
    await expect(again).toHaveURL(`${PREVIEW_ORIGIN}/workspace`);
    await expect(again.getByTestId("foreign-queue")).toContainText("مبيعات محفوظة لحساب تاني: 1");
    await again.getByTestId("recover-queue").click();
    await expect(again.getByTestId("sync-error")).toContainText("تحديث نقطة البيع مؤجل");
    expect(blockedUploadAttempts).toBe(0);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (restarted) {
      await restarted.close().catch(() => undefined);
    }
    await rm(profileParent, { recursive: true, force: true });
  }
});

test("explicit logout from catalog, staff and receiving pages blocks offline restore and keeps queued sales", async ({
  page,
}) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "خروج إداري" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس خروج" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون خروج" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "OFF-LOGOUT-M",
    nameAr: "قميص الخروج",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 13000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 1, unitCostPiasters: 4000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-LOGOUT-M");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption({ label: "مقاس خروج" });
  await page.getByLabel("اللون").selectOption({ label: "لون خروج" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const queued = await readPosSales(page);
  expect(queued).toHaveLength(1);
  const queuedId = queued[0]?.id;
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();

  async function logoutFrom(heading: string, linkName: string) {
    await page.context().setOffline(false);
    await page.getByLabel("اسم الدخول").fill("owner");
    await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
    await page.getByRole("button", { name: "دخول" }).click();
    await page.getByRole("button", { name: "أبشواي" }).click();
    await page.getByRole("link", { name: linkName }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect(page.getByRole("link", { name: "البحث عن منتج" })).toHaveCount(0);
    const session = await readPosSession(page);
    expect(session.currentId).toBeNull();
    expect(session.rows.find((row) => row.staffId && !row.signedOut)).toBeUndefined();
    const sales = await readPosSales(page);
    expect(sales.some((sale) => sale.id === queuedId)).toBe(true);
    expect(sales.find((sale) => sale.id === queuedId)?.finalTotalPiasters).toBe(13000);
  }

  await logoutFrom("إدارة المنتجات", "المنتجات");
  await logoutFrom("إدارة الموظفين", "الموظفون");
  await logoutFrom("استلام المخزون", "استلام المخزون");
  await page.context().setOffline(false);
});

test("logout after reload still signs out so an offline restart cannot restore the account", async ({ page }) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.reload();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByRole("link", { name: "البحث عن منتج" })).toHaveCount(0);
  const current = await readPosSession(page);
  expect(current.currentId).toBeNull();
  expect(current.rows.every((row) => row.signedOut)).toBe(true);
  await page.context().setOffline(false);
});

test("a fresh cashier login keeps an old cached session from becoming current after offline restart", async ({
  page,
  context,
}) => {
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: "جلسة قديمة" });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: "مقاس جلسة" });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: "لون جلسة" });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: "OFF-SESS-P",
    nameAr: "قميص الجلسة",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 14000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: product.body.variants[0].id, quantity: 1, unitCostPiasters: 4000 }],
  });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill("OFF-SESS-P");
  await lookup.getByRole("button", { name: "بحث" }).click();
  await openLookupLists(page);
  await page.getByLabel("المقاس").selectOption({ label: "مقاس جلسة" });
  await page.getByLabel("اللون").selectOption({ label: "لون جلسة" });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPosSales(page))[0];
  expect(original?.id).toBeTruthy();
  const staffA = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentId = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return currentId ?? "";
  });
  expect(staffA.length).toBeGreaterThan(0);
  const expired = await page.request.fetch(`${PREVIEW_ORIGIN}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      origin: PREVIEW_ORIGIN,
      "content-type": "application/json",
    },
    data: {},
  });
  expect(expired.ok()).toBe(true);
  const beforeB = await readPosSession(page);
  expect(beforeB.currentId).toBe(staffA);
  expect(beforeB.rows.find((row) => row.staffId === staffA)?.signedOut).toBe(false);
  const pageB = await context.newPage();
  await pageB.goto(`${PREVIEW_ORIGIN}/login`);
  await expect(pageB.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await pageB.getByLabel("اسم الدخول").fill("cashier-b");
  await pageB.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await pageB.getByRole("button", { name: "دخول" }).click();
  await pageB.getByRole("button", { name: "أبشواي" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await expect(pageB.getByTestId("offline-ready")).toBeVisible({ timeout: 45_000 });
  const workspaceB = await staffApi(pageB, "GET", "/api/internal/workspace");
  const staffB = workspaceB.body.staff.id as string;
  expect(staffB.length).toBeGreaterThan(0);
  const sessions = await readPosSession(pageB);
  expect(sessions.currentId).toBe(staffB);
  expect(sessions.currentId).not.toBe(staffA);
  expect(sessions.rows.find((row) => row.staffId === staffA)?.signedOut).toBe(false);
  await expect.poll(async () => {
    return pageB.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const currentId = await new Promise<string | undefined>((resolve, reject) => {
        const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
      const row = currentId
        ? await new Promise<{ workspace?: { activeBranch?: { nameAr?: string } } } | undefined>((resolve, reject) => {
            const req = db.transaction("sessions", "readonly").objectStore("sessions").get(currentId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          })
        : undefined;
      db.close();
      return row?.workspace?.activeBranch?.nameAr ?? "";
    });
  }).toBe("أبشواي");
  await expect(pageB.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await pageB.getByRole("link", { name: "المبيعات" }).click();
  await expect(pageB.getByText("كاشير تجريبي")).toHaveCount(0);
  await pageB.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  await pageB.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await pageB.context().setOffline(true);
  await pageB.reload();
  await expect(pageB.getByTestId("active-branch")).toContainText("أبشواي");
  const afterReload = await readPosSession(pageB);
  expect(afterReload.currentId).toBe(staffB);
  expect(afterReload.rows.find((row) => row.staffId === staffA)?.signedOut).toBe(false);
  const restoredSales = await readPosSales(pageB);
  expect(restoredSales.some((sale) => sale.id === original?.id)).toBe(true);
  await expect(pageB.getByText("كاشير تجريبي")).toHaveCount(0);
  await pageB.context().setOffline(false);
  await pageB.close();
});

const POS_SEED_HTML =
  "<!doctype html><html><head><title>pos-seed</title></head><body><p id=\"pos-seed-marker\">pos-seed</p></body></html>";

type LegacyPosSnapshot = {
  sales: unknown[];
  sessions: unknown[];
  snapshots: unknown[];
  effects: unknown[];
  pending: unknown[];
  deviceId?: string;
  currentStaffId?: string;
};

async function relaunchSameProfileOffline(
  playwright: import("@playwright/test").Playwright,
  userDataDir: string,
) {
  const restarted = await playwright.chromium.launchPersistentContext(userDataDir, {
    locale: "ar-EG",
    viewport: { width: 1280, height: 720 },
  });
  await restarted.setOffline(true);
  const page = restarted.pages()[0] ?? (await restarted.newPage());
  return { context: restarted, page };
}

async function seedLegacyOnIsolatedPage(
  context: import("@playwright/test").BrowserContext,
  appPage: import("@playwright/test").Page,
  snapshot: LegacyPosSnapshot,
  options: { omitCurrentStaffId: boolean; unitMode: "legacy-individual" | "empty" },
) {
  const popupPromise = context.waitForEvent("page");
  const opened = await appPage.evaluate(() => {
    const child = window.open("about:blank", "pos-seed");
    if (!child) {
      return { opened: false, origin: null as string | null };
    }
    return { opened: true, origin: child.origin };
  });
  expect(opened.opened).toBe(true);
  expect(opened.origin).toBe(PREVIEW_ORIGIN);
  const seedPage = await popupPromise;
  await seedPage.waitForLoadState("domcontentloaded");
  expect(await seedPage.evaluate(() => self.origin)).toBe(PREVIEW_ORIGIN);
  expect(seedPage.url()).toBe("about:blank");

  for (const open of [...context.pages()]) {
    if (open !== seedPage) {
      await open.close();
    }
  }
  expect(context.pages()).toHaveLength(1);
  expect(context.pages()[0]).toBe(seedPage);

  await seedPage
    .evaluate((html) => {
      document.open();
      document.write(html);
      document.close();
    }, POS_SEED_HTML)
    .catch(() => undefined);

  expect(await seedPage.evaluate(() => self.origin)).toBe(PREVIEW_ORIGIN);
  expect(await seedPage.evaluate(() => location.href)).toBe("about:blank");
  await expect(seedPage).toHaveTitle("pos-seed");
  await expect(seedPage.locator("#pos-seed-marker")).toHaveText("pos-seed");
  expect(await seedPage.locator("#root").count()).toBe(0);
  expect(await seedPage.locator("script").count()).toBe(0);
  expect(context.pages()).toHaveLength(1);

  const seeded = await seedNativeSchema2(seedPage, snapshot, options);
  await seedPage.close();
  return seeded;
}

async function seedNativeSchema2(
  page: import("@playwright/test").Page,
  snapshot: LegacyPosSnapshot,
  options: { omitCurrentStaffId: boolean; unitMode: "legacy-individual" | "empty" },
) {
  return page.evaluate(
    async ({ data, omitCurrentStaffId, unitMode }) => {
      function createSchema2Stores(db: IDBDatabase) {
        db.createObjectStore("meta", { keyPath: "key" });
        db.createObjectStore("sessions", { keyPath: "staffId" });
        db.createObjectStore("snapshots", { keyPath: "staffId" });
        const sales = db.createObjectStore("sales", { keyPath: "id" });
        sales.createIndex("staffId", "staffId");
        sales.createIndex("operationId", "operationId");
        sales.createIndex("syncStatus", "syncStatus");
        const effects = db.createObjectStore("effects", { keyPath: "id" });
        effects.createIndex("staffId", "staffId");
        effects.createIndex("variantId", "variantId");
        effects.createIndex("operationId", "operationId");
        const pending = db.createObjectStore("pending", { keyPath: "staffId" });
        pending.createIndex("saleId", "saleId");
        const legacyPending = db.createObjectStore("legacyPending", { keyPath: "saleId" });
        legacyPending.createIndex("staffId", "staffId");
      }
      const opened = await new Promise<IDBDatabase>((resolve, reject) => {
        const del = indexedDB.deleteDatabase("bravos-pos");
        del.onblocked = () => reject(new Error("تعذر حذف قاعدة نقطة البيع: blocked"));
        del.onerror = () => reject(del.error ?? new Error("تعذر حذف قاعدة نقطة البيع"));
        del.onsuccess = () => {
          const request = indexedDB.open("bravos-pos", 20);
          request.onupgradeneeded = (event) => {
            if (event.oldVersion !== 0) {
              request.result.close();
              reject(new Error(`تعذر إنشاء مخطط 2: oldVersion=${event.oldVersion}`));
              return;
            }
            createSchema2Stores(request.result);
          };
          request.onerror = () => reject(request.error ?? new Error("تعذر فتح مخطط 2"));
          request.onsuccess = () => {
            if (request.result.version !== 20) {
              request.result.close();
              reject(new Error(`إصدار غير متوقع بعد الإنشاء: ${request.result.version}`));
              return;
            }
            resolve(request.result);
          };
        };
      });
      await new Promise<void>((resolve, reject) => {
        const tx = opened.transaction(
          ["meta", "sessions", "snapshots", "sales", "effects", "pending", "legacyPending"],
          "readwrite",
        );
        tx.objectStore("meta").put({ key: "schemaVersion", value: "2" });
        if (data.deviceId) {
          tx.objectStore("meta").put({ key: "deviceId", value: data.deviceId });
        }
        if (!omitCurrentStaffId && data.currentStaffId) {
          tx.objectStore("meta").put({ key: "currentStaffId", value: data.currentStaffId });
        }
        for (const session of data.sessions as Array<{ staffId: string; signedOut: boolean }>) {
          tx.objectStore("sessions").put(session);
        }
        for (const row of data.snapshots) {
          tx.objectStore("snapshots").put(row);
        }
        for (const sale of data.sales as Array<{ lines: Array<{ units?: Array<Record<string, unknown>> }> }>) {
          tx.objectStore("sales").put({
            ...sale,
            lines: sale.lines.map((line) => ({
              ...line,
              units:
                unitMode === "empty"
                  ? []
                  : (line.units ?? []).map((unit) => ({
                      listedPiasters: unit.listedPiasters,
                      discountPiasters: unit.discountPiasters,
                      paidPiasters: unit.paidPiasters,
                    })),
            })),
          });
        }
        for (const effect of data.effects) {
          tx.objectStore("effects").put(effect);
        }
        for (const row of data.pending) {
          tx.objectStore("pending").put(row);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      opened.close();
      const verifyDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bravos-pos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const currentStaff = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = verifyDb.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      const schema = await new Promise<{ value?: string } | undefined>((resolve, reject) => {
        const req = verifyDb.transaction("meta", "readonly").objectStore("meta").get("schemaVersion");
        req.onsuccess = () => resolve(req.result as { value?: string } | undefined);
        req.onerror = () => reject(req.error);
      });
      const sessions = await new Promise<Array<{ staffId: string; signedOut: boolean }>>((resolve, reject) => {
        const req = verifyDb.transaction("sessions", "readonly").objectStore("sessions").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const sales = await new Promise<Array<{ lines: Array<{ units: unknown[] }> }>>((resolve, reject) => {
        const req = verifyDb.transaction("sales", "readonly").objectStore("sales").getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const version = verifyDb.version;
      const storeNames = [...verifyDb.objectStoreNames];
      const salesStore = verifyDb.transaction("sales", "readonly").objectStore("sales");
      const salesIndexes = [...salesStore.indexNames];
      verifyDb.close();
      return {
        version,
        storeNames,
        salesIndexes,
        schema: schema?.value,
        currentStaffId: currentStaff?.value ?? null,
        sessions,
        units: sales[0]?.lines[0]?.units ?? [],
      };
    },
    { data: snapshot, omitCurrentStaffId: options.omitCurrentStaffId, unitMode: options.unitMode },
  );
}

async function readPosSession(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const currentId = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get("currentStaffId");
      req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<Array<{ staffId: string; signedOut: boolean }>>((resolve, reject) => {
      const req = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return { currentId: currentId ?? null, rows };
  });
}

async function readReceiptNumbering(page: import("@playwright/test").Page): Promise<{
  registrationId?: string;
  deviceId?: string;
  prefix?: string;
  nextSequence?: string;
} | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const value = await new Promise<string | null>((resolve, reject) => {
        const request = db.transaction("meta", "readonly").objectStore("meta").get("receiptNumbering");
        request.onsuccess = () => {
          const row = request.result as { value?: unknown } | undefined;
          resolve(typeof row?.value === "string" ? row.value : null);
        };
        request.onerror = () => reject(request.error);
      });
      if (!value) return null;
      try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const record = parsed as Record<string, unknown>;
        const numbering: {
          registrationId?: string;
          deviceId?: string;
          prefix?: string;
          nextSequence?: string;
        } = {};
        if (typeof record.registrationId === "string") numbering.registrationId = record.registrationId;
        if (typeof record.deviceId === "string") numbering.deviceId = record.deviceId;
        if (typeof record.prefix === "string") numbering.prefix = record.prefix;
        if (typeof record.nextSequence === "string") numbering.nextSequence = record.nextSequence;
        return numbering;
      } catch {
        return null;
      }
    } finally {
      db.close();
    }
  });
}

async function readPosSales(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readonly");
    const rows = await new Promise<
      Array<{
        id: string;
        operationId: string;
        occurredAt: string;
        soldByDisplayName: string;
        originalTotalPiasters: number;
        employeeDiscountPiasters: number;
        finalTotalPiasters: number;
        syncStatus?: string;
        receiptReference?: string;
        receiptClaim?: {
          registrationId?: string;
          deviceId?: string;
          prefix?: string;
          sequence?: string;
          reference?: string;
        };
        branch: { code: string };
      }>
    >((resolve, reject) => {
      const request = tx.objectStore("sales").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
  });
}

async function staffApi(page: import("@playwright/test").Page, method: "GET" | "POST", url: string, payload?: unknown) {
  if (method === "POST" && url === "/api/internal/receiving/receipts" && payload && typeof payload === "object" && !("branchId" in payload)) {
    const current = await staffApi(page, "GET", "/api/internal/workspace");
    payload = { ...payload, branchId: current.body.activeBranch?.id };
  }
  const response = await page.request.fetch(`${PREVIEW_ORIGIN}${url}`, {
    method,
    headers: {
      origin: PREVIEW_ORIGIN,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  return {
    status: response.status(),
    body: await response.json(),
  };
}

function runPinned(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot(),
      env: pinnedProcessEnv(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "not started";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function stopPreview(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function waitForPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
}
