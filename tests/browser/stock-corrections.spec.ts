import { expect, test, type Page } from "@playwright/test";

type Snapshot = {
  snapshotId: string;
  deviceId: string;
  stockPause: null | {
    coordinationId: string;
    boundaryStockVersion: number;
  };
};

type Coordination = {
  id: string;
  devices: Array<{ deviceId: string; acknowledgedAt: string | null }>;
};

test("manager pauses every known till and retries one documented positive stock correction", async ({ browser, page }) => {
  const managerSnapshot = await signInAndRegisterTill(page, "owner", "e2e-owner-pass");
  const seeded = await seedVariant(page);

  const otherContext = await browser.newContext({ locale: "ar-EG" });
  try {
    const otherTill = await otherContext.newPage();
    const otherSnapshot = await signInAndRegisterTill(otherTill, "owner", "e2e-owner-pass");
    expect(otherSnapshot.deviceId).not.toBe(managerSnapshot.deviceId);

    await page.getByRole("link", { name: "تصحيح كميات المخزون" }).click();
    await expect(page.getByRole("heading", { name: "تصحيح كميات المخزون" })).toBeVisible();
    await page.getByRole("button", { name: "مزامنة النقاط وبدء التوقف" }).click();
    await expect(page.getByRole("status")).toContainText("بدأ التوقف المؤقت");

    const knownTills = page.getByTestId("known-tills");
    await expect(knownTills.getByTestId("known-till").filter({ hasText: managerSnapshot.deviceId })).toContainText("لم تؤكد التوقف");
    await expect(knownTills.getByTestId("known-till").filter({ hasText: otherSnapshot.deviceId })).toContainText("لم تؤكد التوقف");

    const pausedSnapshotResponse = otherTill.waitForResponse(isSuccessfulSnapshotResponse);
    await otherTill.reload();
    const pausedSnapshot = (await (await pausedSnapshotResponse).json()) as Snapshot;
    expect(pausedSnapshot.stockPause).not.toBeNull();
    await expect(otherTill.getByTestId("stock-pause")).toContainText("تصحيح كمية شغال");
    await otherTill.getByTestId("acknowledge-stock-pause").click();
    await expect(otherTill.getByTestId("stock-pause-acknowledged")).toBeVisible();

    const ownPausedSnapshotResponse = page.waitForResponse(isSuccessfulSnapshotResponse);
    await page.getByRole("button", { name: "مزامنة هذه النقطة وإظهار التوقف" }).click();
    const ownPausedSnapshot = (await (await ownPausedSnapshotResponse).json()) as Snapshot;
    await expect(page.getByTestId("pause-observation")).toContainText(ownPausedSnapshot.snapshotId);
    await page.getByRole("button", { name: "تأكيد توقف هذه النقطة" }).click();

    await acknowledgeAnyEarlierTestTills(page, new Set([managerSnapshot.deviceId, otherSnapshot.deviceId]));
    await page.getByRole("button", { name: "تحديث الحالات" }).click();
    await expect(knownTills.getByTestId("known-till").filter({ hasText: managerSnapshot.deviceId })).toContainText("متزامنة ومتوقفة");
    await expect(knownTills.getByTestId("known-till").filter({ hasText: otherSnapshot.deviceId })).toContainText("متزامنة ومتوقفة");

    const correctionForm = page.getByRole("form", { name: "تصحيح الكمية الفعلية" });
    await correctionForm.getByLabel("الصنف").selectOption(seeded.variantId);
    await expect(correctionForm.getByTestId("previous-available")).toContainText("4");
    await correctionForm.getByLabel("المتاح الفعلي المصحح").fill("5");
    await correctionForm.getByLabel("دفعة التكلفة الفعلية للزيادة").selectOption(seeded.batchId);
    await correctionForm.getByLabel("سبب التصحيح").fill("قطعة زائدة ظهرت في العد الفعلي");

    const submittedOperationIds: string[] = [];
    let dropFirstResponse = true;
    await page.route("**/api/internal/inventory/stock-corrections", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { operationId: string; branchId: string };
      submittedOperationIds.push(body.operationId);
      expect(body.branchId).toBe(seeded.branchId);
      if (dropFirstResponse) {
        dropFirstResponse = false;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    await correctionForm.getByRole("button", { name: "حفظ التصحيح وإنهاء التوقف" }).click();
    await expect(page.getByRole("alert")).toContainText("نتيجة حفظ التصحيح غير مؤكدة");
    await correctionForm.getByRole("button", { name: "إعادة محاولة حفظ التصحيح" }).click();

    await expect(page.getByRole("status")).toContainText("حُفظ تصحيح الكمية");
    expect(submittedOperationIds).toHaveLength(2);
    expect(new Set(submittedOperationIds).size).toBe(1);

    const history = page.getByTestId("stock-correction-history").filter({ hasText: seeded.code });
    await expect(history).toContainText("من 4 إلى 5");
    await expect(history).toContainText("قطعة زائدة ظهرت في العد الفعلي");
    await expect(history).toContainText("استعادة 1");
    await expect(history).toContainText("70 ج.م.");
    await expect(history).toContainText(seeded.batchId);

    const corrections = await staffApi(page, "GET", "/api/internal/inventory/stock-corrections");
    const matching = corrections.body.filter((item: { variantId: string }) => item.variantId === seeded.variantId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      branchId: seeded.branchId,
      previousAvailableQuantity: 4,
      correctedAvailableQuantity: 5,
      positiveSourceBatchId: seeded.batchId,
      reason: "قطعة زائدة ظهرت في العد الفعلي",
    });
  } finally {
    await otherContext.close();
  }
});

async function signInAndRegisterTill(page: Page, loginName: string, password: string): Promise<Snapshot> {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  const response = page.waitForResponse(isSuccessfulSnapshotResponse);
  await page.getByRole("button", { name: "أبشواي" }).click();
  return (await (await response).json()) as Snapshot;
}

async function seedVariant(page: Page) {
  const branchId = (await staffApi(page, "GET", "/api/internal/workspace")).body.activeBranch.id as string;
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `عد مخزون ${suffix}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس عد ${suffix}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون عد ${suffix}` });
  const code = `COUNT-${suffix}`;
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: "قطعة العد الفعلي",
    descriptionAr: "اختبار تصحيح كمية المخزون",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 16000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity: 5, unitCostPiasters: 7000 }],
  });
  await staffApi(page, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
  });
  const batches = await staffApi(page, "GET", "/api/internal/inventory/batches");
  const batch = batches.body.find((item: { variantId: string }) => item.variantId === variantId);
  expect(batch).toBeTruthy();
  return { code, branchId, variantId, batchId: batch.id as string };
}

async function acknowledgeAnyEarlierTestTills(page: Page, exercisedDevices: Set<string>) {
  const coordination = (await staffApi(page, "GET", "/api/internal/inventory/count-coordination")).body as Coordination;
  for (const device of coordination.devices) {
    if (exercisedDevices.has(device.deviceId) || device.acknowledgedAt) continue;
    const snapshot = (await staffApi(page, "POST", "/api/internal/sales/pos-snapshots", {
      deviceId: device.deviceId,
      pendingOperationIds: [],
    })).body as Snapshot;
    await staffApi(page, "POST", "/api/internal/inventory/count-coordination/acknowledgements", {
      coordinationId: coordination.id,
      deviceId: device.deviceId,
      snapshotId: snapshot.snapshotId,
    });
  }
}

function isSuccessfulSnapshotResponse(response: { url(): string; request(): { method(): string }; ok(): boolean }) {
  return response.url().includes("/api/internal/sales/pos-snapshots")
    && response.request().method() === "POST"
    && response.ok();
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  expect(response.status(), `${method} ${url}`).toBeLessThan(400);
  return { status: response.status(), body: await response.json() };
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const stockOrigin = "http://127.0.0.1:5174";
const lateSaleId = "62300000-0000-4000-8000-0000000000a1";
const lateVariantMedium = "62300000-0000-4000-8000-0000000000b1";
const lateVariantLarge = "62300000-0000-4000-8000-0000000000b2";
const lateVariantUnknown = "62300000-0000-4000-8000-0000000000b3";
const lateBranchUnknown = "62300000-0000-4000-8000-0000000000ff";
const lateCorrectionId = "62300000-0000-4000-8000-0000000000c1";
const lateHistoryId = "62300000-0000-4000-8000-0000000000c2";
const lateReconciliationId = "62300000-0000-4000-8000-0000000000d1";
const lateAt = "2026-10-22T10:00:00.000Z";

test("failed stock reads stay explicit and a list retry shows same-sale variant and branch identity", async ({ page }) => {
  await signInOwner(page);
  const workspaceResponse = await page.request.get(`${stockOrigin}/api/internal/workspace`);
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = await workspaceResponse.json() as {
    activeBranch: { id: string; nameAr: string } | null;
    authorizedBranches: Array<{ id: string; nameAr: string }>;
  };
  const active = workspace.activeBranch;
  const other = workspace.authorizedBranches.find((branch) => branch.id !== active?.id);
  expect(active?.id).toBeTruthy();
  expect(other?.id).toBeTruthy();
  expect(active!.nameAr).not.toBe(other!.nameAr);
  expect(lateBranchUnknown).not.toBe(active!.id);
  expect(lateBranchUnknown).not.toBe(other!.id);

  const writes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const watched = url.pathname.startsWith("/api/internal/inventory/") || url.pathname.startsWith("/api/internal/catalog/");
    if (watched && request.method() !== "GET") writes.push(`${request.method()} ${url.pathname}`);
  });

  let mode: "fail" | "hold" | "ready" = "fail";
  let heldReads = 0;
  let releaseHold = () => {};
  let hold = new Promise<void>(() => {});
  const reads = stockReadPayload(active!.id, other!.id);

  await page.route(/\/api\/internal\/(?:inventory\/(?:count-coordination|stock-pause|batches|stock-corrections|stock-reconciliation-cases|stock-reconciliations)|catalog\/pos-snapshot)(?:\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }
    if (mode === "fail") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE", messageAr: "تعذر قراءة قوائم المخزون." } }),
      });
      return;
    }
    if (mode === "hold") {
      heldReads += 1;
      await hold;
    }
    const path = new URL(request.url()).pathname;
    if (!Object.hasOwn(reads, path)) throw new Error(`unexpected stock read ${path}`);
    await route.fulfill({ json: reads[path] });
  });

  try {
    await page.goto(`${stockOrigin}/stock-corrections`);
    await expect(page.getByRole("heading", { name: "تصحيح كميات المخزون" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("تعذر قراءة قوائم المخزون.");
    await expect(page.getByText("تعذر قراءة تنسيق العد. أعد تحميل القوائم قبل بدء توقف أو تصحيح.")).toBeVisible();
    await expect(page.getByText("تعذر تحميل حالات المبيعات المتأخرة.")).toBeVisible();
    await expect(page.getByText("تعذر تحميل سجل التصحيحات.")).toBeVisible();
    await expect(page.getByText("تعذر تحميل سجل المصالحات.")).toBeVisible();
    await expect(page.getByText("مفيش حاجة للمراجعة")).toHaveCount(0);
    await expect(page.getByText("لسه مفيش تصحيحات")).toHaveCount(0);
    await expect(page.getByText("لا توجد مصالحات.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "مزامنة النقاط وبدء التوقف" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "استرداد تنسيق نشط" })).toHaveCount(0);
    await expect(page.getByTestId("stock-load-retry")).toHaveText("إعادة تحميل قوائم المخزون");
    expect(writes).toEqual([]);

    heldReads = 0;
    mode = "hold";
    hold = new Promise<void>((resolve) => { releaseHold = resolve; });
    await page.getByTestId("stock-load-retry").click();
    await expect(page.locator("main").getByRole("status")).toContainText("جارٍ تحميل المخزون والتصحيحات");
    await expect(page.getByTestId("stock-load-retry")).toHaveText("جارٍ تحميل القوائم…");
    await expect(page.getByTestId("stock-load-retry")).toBeDisabled();
    await expect.poll(() => heldReads).toBeGreaterThanOrEqual(7);
    await expect(page.getByText("مفيش حاجة للمراجعة")).toHaveCount(0);
    await expect(page.getByText("لسه مفيش تصحيحات")).toHaveCount(0);
    await expect(page.getByText("لا توجد مصالحات.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "مزامنة النقاط وبدء التوقف" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    expect(writes).toEqual([]);

    mode = "ready";
    releaseHold();
    const cases = page.getByTestId("stock-reconciliation-case");
    await expect(cases).toHaveCount(3);
    const medium = cases.filter({ hasText: "SKU-LATE — قميص العد / M / أسود" });
    const large = cases.filter({ hasText: "SKU-LATE — قميص العد / L / أبيض" });
    const unknown = cases.filter({ hasText: lateVariantUnknown });
    await expect(medium).toHaveCount(1);
    await expect(large).toHaveCount(1);
    await expect(unknown).toHaveCount(1);
    await expect(medium.getByTestId("reconciliation-identity")).toContainText(`الفرع: ${active!.nameAr}`);
    await expect(large.getByTestId("reconciliation-identity")).toContainText(`الفرع: ${other!.nameAr}`);
    await expect(medium).toContainText("المباع: 2");
    await expect(large).toContainText("المباع: 1");
    await expect(unknown.getByTestId("reconciliation-identity")).toContainText(`تعذر مطابقة الصنف ${lateVariantUnknown} مع قائمة نقطة البيع المحملة.`);
    await expect(unknown.getByTestId("reconciliation-identity")).toContainText("تعذر مطابقة الفرع مع الفروع المتاحة.");
    await expect(unknown.getByTestId("reconciliation-identity")).not.toContainText("SKU-LATE");
    expect(await medium.locator("details").textContent()).toContain(lateSaleId);
    expect(await medium.locator("details").textContent()).toContain(lateVariantMedium);
    expect(await medium.locator("details").textContent()).toContain(active!.id);
    expect(await large.locator("details").textContent()).toContain(lateSaleId);
    expect(await large.locator("details").textContent()).toContain(lateVariantLarge);
    expect(await large.locator("details").textContent()).toContain(other!.id);
    expect(await unknown.locator("details").textContent()).toContain(lateBranchUnknown);
    expect(await identityPrecedesCountAction(medium)).toBe(true);
    expect(await identityPrecedesCountAction(large)).toBe(true);

    const history = page.getByTestId("stock-correction-row");
    await expect(history).toContainText("SKU-HIST");
    await expect(history).toContainText("قميص السجل");
    await expect(history).toContainText("/ L / أبيض");
    await expect(history).toContainText(other!.nameAr);
    await expect(history).toContainText("من 3 إلى 1");
    await expect(history).not.toContainText("قميص العد");
    expect(await history.locator("details").textContent()).toContain(lateVariantLarge);
    expect(await history.locator("details").textContent()).toContain(other!.id);

    const reconciled = page.getByTestId("stock-reconciliation-row");
    await expect(reconciled.getByTestId("reconciliation-history-identity")).toContainText("SKU-LATE — قميص العد / M / أسود");
    await expect(reconciled.getByTestId("reconciliation-history-identity")).toContainText(`الفرع: ${active!.nameAr}`);
    await expect(reconciled.getByTestId("reconciliation-history-identity")).toContainText("كان داخل العدد");
    await expect(reconciled.getByTestId("reconciliation-history-identity")).not.toContainText("SKU-HIST");
    expect(await reconciled.locator("details").textContent()).toContain(lateSaleId);
    expect(await reconciled.locator("details").textContent()).toContain(lateVariantMedium);
    expect(await reconciled.locator("details").textContent()).toContain(active!.id);

    await expect(page.getByText("مفيش حاجة للمراجعة")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "مزامنة النقاط وبدء التوقف" })).toBeVisible();
    expect(writes).toEqual([]);
  } finally {
    releaseHold();
  }
});

function stockReadPayload(activeBranchId: string, otherBranchId: string): Record<string, unknown> {
  const staff = {
    id: "62300000-0000-4000-8000-000000000099",
    loginName: "owner",
    displayName: "مدير الاختبار",
    role: "manager",
    disabled: false,
  };
  const lateCase = (variantId: string, branchId: string, sold: number) => ({
    correctionId: lateCorrectionId,
    branchId,
    saleId: lateSaleId,
    saleOperationId: "62300000-0000-4000-8000-0000000000a2",
    variantId,
    deviceId: "till-late-identity",
    sourceSnapshotId: "62300000-0000-4000-8000-0000000000e1",
    sourceSnapshotIssuedAt: lateAt,
    occurredAt: lateAt,
    recordedAt: lateAt,
    boundaryAt: lateAt,
    timing: "before_count",
    soldQuantity: sold,
    allocatedQuantity: sold,
    unallocatedQuantity: 0,
    costsIncomplete: false,
    alreadyCountedQuantity: 0,
    maximumCountedQuantity: 1,
  });
  return {
    "/api/internal/inventory/count-coordination": null,
    "/api/internal/inventory/stock-pause": null,
    "/api/internal/inventory/batches": [],
    "/api/internal/catalog/pos-snapshot": [{
      id: "62300000-0000-4000-8000-000000000010",
      code: "SKU-LATE",
      nameAr: "قميص العد",
      descriptionAr: "",
      variants: [
        { id: lateVariantMedium, size: { id: "62300000-0000-4000-8000-0000000000s1", nameAr: "M" }, color: { id: "62300000-0000-4000-8000-0000000000c8", nameAr: "أسود" }, sellingPricePiasters: 10000, availableQuantity: 3 },
        { id: lateVariantLarge, size: { id: "62300000-0000-4000-8000-0000000000s2", nameAr: "L" }, color: { id: "62300000-0000-4000-8000-0000000000c9", nameAr: "أبيض" }, sellingPricePiasters: 10000, availableQuantity: 1 },
      ],
    }],
    "/api/internal/inventory/stock-reconciliation-cases": [
      lateCase(lateVariantMedium, activeBranchId, 2),
      lateCase(lateVariantLarge, otherBranchId, 1),
      lateCase(lateVariantUnknown, lateBranchUnknown, 1),
    ],
    "/api/internal/inventory/stock-corrections": [{
      id: lateHistoryId,
      branchId: otherBranchId,
      operationId: "62300000-0000-4000-8000-0000000000c3",
      coordinationId: lateCorrectionId,
      variantId: lateVariantLarge,
      variant: {
        id: lateVariantLarge,
        product: { id: "62300000-0000-4000-8000-000000000011", code: "SKU-HIST", nameAr: "قميص السجل" },
        size: { id: "62300000-0000-4000-8000-0000000000s2", nameAr: "L" },
        color: { id: "62300000-0000-4000-8000-0000000000c9", nameAr: "أبيض" },
      },
      previousAvailableQuantity: 3,
      correctedAvailableQuantity: 1,
      quantityDelta: -2,
      reason: "سجل هوية التصحيح",
      positiveSourceBatchId: null,
      changedBy: staff,
      changedAt: lateAt,
      boundaryStockVersion: 4,
      coordinationBoundaryAt: lateAt,
      boundaryAt: lateAt,
      devices: [],
      batches: [],
    }],
    "/api/internal/inventory/stock-reconciliations": [{
      id: lateReconciliationId,
      branchId: activeBranchId,
      operationId: "62300000-0000-4000-8000-0000000000d2",
      correctionId: lateCorrectionId,
      saleId: lateSaleId,
      variantId: lateVariantMedium,
      resolution: "included_in_count",
      quantity: 2,
      previousAvailableQuantity: 4,
      resultingAvailableQuantity: 6,
      resolvedBy: staff,
      resolvedAt: lateAt,
      batches: [],
    }],
  };
}

async function identityPrecedesCountAction(article: ReturnType<Page["getByTestId"]>) {
  return article.evaluate((node) => {
    const identity = node.querySelector("[data-testid='reconciliation-identity']");
    const button = Array.from(node.querySelectorAll("button")).find((item) => item.textContent?.includes("تسجيل الكمية الداخلة في العد"));
    if (!identity || !button) return false;
    return Boolean(identity.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
}

async function signInOwner(page: Page) {
  await page.goto(`${stockOrigin}/login`);
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}
