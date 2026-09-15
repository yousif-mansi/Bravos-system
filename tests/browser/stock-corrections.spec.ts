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
    await expect(otherTill.getByTestId("stock-pause")).toContainText("تغييرات المخزون متوقفة مؤقتاً");
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
      const body = route.request().postDataJSON() as { operationId: string };
      submittedOperationIds.push(body.operationId);
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
  return { code, variantId, batchId: batch.id as string };
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
