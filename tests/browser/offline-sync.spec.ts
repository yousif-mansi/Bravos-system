import { expect, test, type Page } from "@playwright/test";

test("delayed web crypto still saves a local sale and acks two operations in one transaction", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 16500, code: "SYNC-HASH" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await delayWebCrypto(page);
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await addAndPrice(page, seed, { customerPhone: "01016500001" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(async () =>
    salesForCode((await staffApi(page, "GET", "/api/internal/sales")).body, seed.code).length,
  ).toBe(1);
  await addAndPrice(page, seed, { customerPhone: "01016500002", waitForLookupResponse: true });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(async () =>
    salesForCode((await staffApi(page, "GET", "/api/internal/sales")).body, seed.code).length,
  ).toBe(2);
  const local = await readPrivacyState(page);
  expect(local.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(2);
  expect(local.effects).toHaveLength(2);
  const oldVersion = local.stockCache.version;
  const oldAvailability = local.stockCache.availability?.[seed.variantId];
  await installAckTransactionAbort(page, { abortAfterAcknowledgementWrites: 1 });
  await page.unroute("**/api/internal/sales/accepted");
  await page.evaluate(() => {
    (window as unknown as { __bravosAckAbort?: boolean }).__bravosAckAbort = true;
  });
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect.poll(() => ackAbortReached(page)).toBe(true);
  const rolledBack = await readPrivacyState(page);
  expect(rolledBack.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(2);
  expect(rolledBack.effects).toHaveLength(2);
  expect(rolledBack.stockCache.version).toBe(oldVersion);
  expect(rolledBack.stockCache.availability?.[seed.variantId]).toBe(oldAvailability);
  await restoreAckTransactionAbort(page);
  await page.getByTestId("retry-sync").click();
  await expect.poll(async () => (await readPrivacyState(page)).sales.filter((sale) => sale.syncStatus === "pending").length).toBe(0);
  const acked = await readPrivacyState(page);
  expect(acked.sales).toHaveLength(2);
  expect(acked.sales.every((sale) => sale.syncStatus === "acknowledged")).toBe(true);
  expect(acked.effects).toHaveLength(0);
  expect(acked.stockCache.availability?.[seed.variantId]).toBe(0);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  expect(salesForCode(listed.body, seed.code)).toHaveLength(2);
});

test("pinned unpaid cart is rejected after shared cache reaches zero and earlier completed facts remain", async ({
  context,
}) => {
  const page = await context.newPage();
  const seed = await seedSingleProduct(page, { quantity: 1, price: 16000, code: "SYNC-PIN" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  const page2 = await context.newPage();
  await page2.goto("http://127.0.0.1:5174/lookup");
  await expect(page2.getByRole("heading", { name: "البحث عن منتج" })).toBeVisible();
  await page.route("**/api/internal/catalog/lookup**", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed);
  await addAndPrice(page2, seed);
  const checkout2 = page2.getByRole("form", { name: "إتمام البيع" });
  await checkout2.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout2.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page2.getByRole("status")).toContainText("تم حفظ البيع.");
  const completed = (await readPrivacyState(page2)).sales[0];
  expect(["pending", "acknowledged"]).toContain(completed?.syncStatus);
  expect(completed?.finalTotalPiasters).toBe(16000);
  await page2.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect.poll(async () =>
    (await staffApi(page2, "GET", "/api/internal/sales")).body.some((sale: { id: string }) => sale.id === completed?.id),
  ).toBe(true);
  await expect(page2.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  const afterAck = await readPrivacyState(page2);
  expect(afterAck.sales.find((sale) => sale.id === completed?.id)?.syncStatus).toBe("acknowledged");
  expect(afterAck.stockCache.availability?.[seed.variantId]).toBe(0);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("main").getByRole("alert").filter({ hasText: /^الكمية المتاحة غير كافية\.$/ }))
    .toContainText("الكمية المتاحة غير كافية.");
  await expect(page.getByRole("status").filter({ hasText: "تم حفظ البيع." })).toHaveCount(0);
  const state = await readPrivacyState(page);
  expect(state.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(0);
  expect(state.sales.filter((sale) => sale.id === completed?.id && sale.syncStatus === "acknowledged")).toHaveLength(1);
  expect(state.sales.find((sale) => sale.id === completed?.id)?.finalTotalPiasters).toBe(16000);
  expect(state.stockCache.availability?.[seed.variantId]).toBe(0);
});

test("a new local sale during an outstanding ack rebases newer stock first without losing the original payload", async ({
  page,
  context,
}) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 17000, code: "SYNC-RACE" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, { customerName: "زبون أول", customerPhone: "01017000001" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const firstLocal = (await readPrivacyState(page)).sales[0];
  expect(firstLocal?.customerPhone).toBe("01017000001");
  const baseline = await readPrivacyState(page);
  expect(baseline.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(1);
  expect(baseline.effects).toHaveLength(1);
  const baselineVersion = baseline.stockCache.version ?? 0;
  await page.unroute("**/api/internal/sales/accepted");
  const held: HeldAccepted[] = [];
  await attachHeldAccepted(context, held);
  const workspace = await context.newPage();
  await workspace.goto("http://127.0.0.1:5174/workspace");
  await expect.poll(() => held.length).toBe(1);
  expect(held[0]?.saleId).toBe(firstLocal?.id);
  const afterFirstCapture = await readPrivacyState(page);
  expect(afterFirstCapture.sales.filter((sale) => sale.syncStatus === "pending").map((sale) => sale.id)).toEqual([
    firstLocal?.id,
  ]);
  expect(afterFirstCapture.effects).toHaveLength(1);
  expect(afterFirstCapture.stockCache.version).toBe(baselineVersion);
  await addAndPrice(page, seed, { customerName: "زبون ثان", customerPhone: "01017000002" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(() => held.length).toBe(2);
  const secondLocal = (await readPrivacyState(page)).sales.find((sale) => sale.id !== firstLocal?.id);
  expect(secondLocal?.customerPhone).toBe("01017000002");
  const beforeRelease = await readPrivacyState(page);
  expect(beforeRelease.sales.filter((sale) => sale.syncStatus === "pending").map((sale) => sale.id).sort()).toEqual(
    [firstLocal?.id, secondLocal?.id].sort(),
  );
  expect(beforeRelease.effects).toHaveLength(2);
  expect(beforeRelease.stockCache.version).toBe(baselineVersion);
  const older = held.find((item) => item.saleId === firstLocal?.id);
  const newer = held.find((item) => item.saleId === secondLocal?.id);
  expect(older?.stockVersion).toBeGreaterThan(baselineVersion);
  expect(newer?.stockVersion).toBeGreaterThan(older?.stockVersion ?? 0);
  expect(newer?.includedOperationIds).toContain(firstLocal?.operationId);
  expect(availabilityOf(newer, seed.variantId)).toBe(0);
  newer?.release();
  await expect.poll(async () => (await readPrivacyState(page)).stockCache.version).toBe(newer?.stockVersion);
  const afterNewer = await readPrivacyState(page);
  expect(afterNewer.stockCache.availability?.[seed.variantId]).toBe(0);
  expect(afterNewer.sales.find((sale) => sale.id === firstLocal?.id)?.customerPhone).toBe("01017000001");
  expect(afterNewer.sales.find((sale) => sale.id === secondLocal?.id)?.customerPhone).toBe("01017000002");
  expect(afterNewer.sales.find((sale) => sale.id === secondLocal?.id)?.syncStatus).toBe("acknowledged");
  older?.release();
  await expect.poll(async () => (await readPrivacyState(page)).sales.filter((sale) => sale.syncStatus === "pending").length).toBe(0);
  const afterOlder = await readPrivacyState(page);
  expect(afterOlder.stockCache.version).toBe(newer?.stockVersion);
  expect(afterOlder.stockCache.availability?.[seed.variantId]).toBe(0);
  expect(afterOlder.effects).toHaveLength(0);
  expect(afterOlder.sales.find((sale) => sale.id === firstLocal?.id)?.syncStatus).toBe("acknowledged");
  expect(afterOlder.sales.find((sale) => sale.id === firstLocal?.id)?.customerPhone).toBe("01017000001");
  expect(afterOlder.sales.find((sale) => sale.id === secondLocal?.id)?.finalTotalPiasters).toBe(17000);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  expect(salesForCode(listed.body, seed.code)).toHaveLength(2);
  const lookup = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(0);
  void workspace;
});

test("an older acknowledgement that is not in the newer proof still rebases without dropping a third pending sale", async ({
  page,
  context,
}) => {
  const seed = await seedSingleProduct(page, { quantity: 4, price: 17500, code: "SYNC-OLD" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, { customerPhone: "01017500002" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const saleB = (await readPrivacyState(page)).sales[0];
  await page.unroute("**/api/internal/sales/accepted");
  const captured: CapturedAccepted[] = [];
  await attachCapturedAccepted(context, captured);
  const workspace = await context.newPage();
  await workspace.route("**/api/internal/sales/pos-snapshots", (route) => route.abort("failed"));
  await workspace.goto("http://127.0.0.1:5174/workspace");
  await expect.poll(() => captured.length).toBe(1);
  expect(captured[0]?.saleId).toBe(saleB?.id);
  expect(captured[0]?.pendingOperationIds).toEqual([saleB?.operationId]);
  await addAndPrice(page, seed, { customerPhone: "01017500001" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(() => captured.length).toBe(2);
  const saleA = (await readPrivacyState(page)).sales.find((sale) => sale.id !== saleB?.id);
  const capturedA = captured.find((item) => item.saleId === saleA?.id);
  const capturedB = captured.find((item) => item.saleId === saleB?.id);
  const committedA = await capturedA?.commit();
  const committedB = await capturedB?.commit();
  expect(committedA?.includedOperationIds).toContain(saleA?.operationId);
  expect(committedB?.includedOperationIds).toContain(saleB?.operationId);
  expect(committedB?.includedOperationIds).not.toContain(saleA?.operationId);
  expect(committedB?.stockVersion).toBeGreaterThan(committedA?.stockVersion ?? 0);
  expect(availabilityOf(committedB, seed.variantId)).toBe(2);
  await addAndPrice(page, seed, { customerPhone: "01017500003" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  await expect.poll(() => captured.length).toBe(3);
  const beforeRelease = await readPrivacyState(page);
  const saleC = beforeRelease.sales.find((sale) => sale.customerPhone === "01017500003");
  expect(saleC).toMatchObject({ syncStatus: "pending", customerPhone: "01017500003", finalTotalPiasters: 17500 });
  expect(beforeRelease.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(3);
  expect(beforeRelease.effects.some((effect) => effect.operationId === saleC?.operationId)).toBe(true);
  expect(beforeRelease.stockCache.availability?.[seed.variantId]).toBe(4);
  capturedB?.release();
  await expect.poll(async () => (await readPrivacyState(page)).sales.find((sale) => sale.id === saleB?.id)?.syncStatus).toBe(
    "acknowledged",
  );
  const afterNewer = await readPrivacyState(page);
  expect(afterNewer.stockCache.version).toBe(committedB?.stockVersion);
  expect(afterNewer.stockCache.availability?.[seed.variantId]).toBe(2);
  expect(afterNewer.sales.find((sale) => sale.id === saleA?.id)?.syncStatus).toBe("pending");
  expect(afterNewer.effects.some((effect) => effect.operationId === saleA?.operationId)).toBe(true);
  expect(afterNewer.effects.some((effect) => effect.operationId === saleB?.operationId)).toBe(false);
  expect(afterNewer.sales.find((sale) => sale.id === saleC?.id)).toMatchObject({
    operationId: saleC?.operationId,
    customerPhone: "01017500003",
    syncStatus: "pending",
  });
  expect(afterNewer.effects.some((effect) => effect.operationId === saleC?.operationId)).toBe(true);
  expect((afterNewer.stockCache.availability?.[seed.variantId] ?? 0) - 1).toBe(1);
  await workspace.unroute("**/api/internal/sales/pos-snapshots");
  capturedA?.release();
  await expect.poll(async () => (await readPrivacyState(page)).sales.find((sale) => sale.id === saleA?.id)?.syncStatus).toBe(
    "acknowledged",
  );
  const afterOlder = await readPrivacyState(page);
  expect(afterOlder.stockCache.version).toBe(committedB?.stockVersion);
  expect(afterOlder.stockCache.availability?.[seed.variantId]).toBe(2);
  expect(afterOlder.sales.find((sale) => sale.id === saleA?.id)?.customerPhone).toBe("01017500001");
  expect(afterOlder.sales.find((sale) => sale.id === saleC?.id)).toMatchObject({
    operationId: saleC?.operationId,
    customerPhone: "01017500003",
    syncStatus: "pending",
  });
  expect(afterOlder.sales.filter((sale) => sale.syncStatus === "acknowledged")).toHaveLength(2);
  expect(afterOlder.effects.some((effect) => effect.operationId === saleC?.operationId)).toBe(true);
  expect((afterOlder.stockCache.availability?.[seed.variantId] ?? 0) - 1).toBe(1);
  void workspace;
});

test("rebase storage failure leaves the sale unacknowledged and not shown as synced", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 18000, code: "SYNC-STOR" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, { customerPhone: "01018000001" });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const before = await readPrivacyState(page);
  expect(before.sales[0]?.syncStatus).toBe("pending");
  expect(before.effects).toHaveLength(1);
  const beforeVersion = before.stockCache.version ?? 0;
  const beforeQty = before.stockCache.availability?.[seed.variantId];
  await installAckTransactionAbort(page);
  await page.unroute("**/api/internal/sales/accepted");
  await page.unroute("**/api/internal/sales");
  await page.route("**/api/internal/sales/accepted", async (route) => {
    const response = await route.fetch();
    await page.evaluate(() => {
      (window as unknown as { __bravosAckAbort?: boolean }).__bravosAckAbort = true;
    });
    await route.fulfill({ response });
  });
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByTestId("retry-sync").click();
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __bravosAckAbortReached?: boolean }).__bravosAckAbortReached))).toBe(
    true,
  );
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  const failed = await readPrivacyState(page);
  expect(failed.sales[0]?.syncStatus).toBe("pending");
  expect(failed.sales[0]?.customerPhone).toBe("01018000001");
  expect(failed.effects).toHaveLength(1);
  expect(failed.stockCache.version).toBe(beforeVersion);
  expect(failed.stockCache.availability?.[seed.variantId]).toBe(beforeQty);
  const listedDuringFailure = await staffApi(page, "GET", "/api/internal/sales");
  expect(listedDuringFailure.body.some((sale: { id: string }) => sale.id === before.sales[0]?.id)).toBe(true);
  await restoreAckTransactionAbort(page);
  await page.getByTestId("retry-sync").click();
  await expect.poll(async () => (await readPrivacyState(page)).sales.filter((sale) => sale.syncStatus === "pending").length).toBe(0);
  const restored = await readPrivacyState(page);
  expect(restored.sales[0]?.syncStatus).toBe("acknowledged");
  expect(restored.sales[0]?.customerPhone).toBe("01018000001");
  expect(restored.effects).toHaveLength(0);
  expect(restored.stockCache.availability?.[seed.variantId]).toBe(1);
  expect(restored.stockCache.version).toBeGreaterThan(beforeVersion);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  expect(listed.body.filter((sale: { id: string }) => sale.id === before.sales[0]?.id)).toHaveLength(1);
  const lookup = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(1);
});

test("two tabs serialize synchronization of the same operation and deduct once", async ({ context }) => {
  const page = await context.newPage();
  const seed = await seedSingleProduct(page, { quantity: 2, price: 19000, code: "SYNC-TABS" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed);
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const local = (await readPrivacyState(page)).sales[0];
  const held: HeldAccepted[] = [];
  await attachHeldAccepted(context, held);
  await page.unroute("**/api/internal/sales/accepted");
  await page.unroute("**/api/internal/sales");
  const page2 = await context.newPage();
  await Promise.all([page2.goto("http://127.0.0.1:5174/workspace"), page.getByRole("link", { name: "العودة لمساحة العمل" }).click()]);
  await expect.poll(() => held.filter((item) => item.saleId === local?.id).length).toBe(1);
  expect(held.every((item) => item.saleId === local?.id)).toBe(true);
  expect(held.every((item) => item.operationId === local?.operationId)).toBe(true);
  expect(availabilityOf(held[0], seed.variantId)).toBe(1);
  for (const item of held) {
    item.release();
  }
  await expect.poll(async () => (await readPrivacyState(page)).sales.find((sale) => sale.id === local?.id)?.syncStatus).toBe(
    "acknowledged",
  );
  await expect.poll(async () => (await readPrivacyState(page2)).sales.find((sale) => sale.id === local?.id)?.syncStatus).toBe(
    "acknowledged",
  );
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  expect(listed.body.filter((sale: { id: string }) => sale.id === local?.id)).toHaveLength(1);
  const lookup = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(1);
  expect((await readPrivacyState(page)).stockCache.availability?.[seed.variantId]).toBe(1);
  expect((await readPrivacyState(page2)).stockCache.availability?.[seed.variantId]).toBe(1);
});

test("lost acknowledgement is reconciled from an opaque later snapshot without leaking the other cashier", async ({
  page,
}) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 23000, code: "SYNC-PRIV" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, {
    customerName: "زبون الخصوصية",
    customerPhone: "01099887766",
    discountReason: "سبب سري للاختبار",
  });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPrivacyState(page)).sales[0];
  expect(original?.customerPhone).toBe("01099887766");
  await page.unroute("**/api/internal/sales/accepted");
  let lostAcknowledgementCompleted = false;
  await page.route("**/api/internal/sales/accepted", async (route) => {
    await route.fetch();
    await route.abort("failed");
    lostAcknowledgementCompleted = true;
  });
  await page.route("**/api/internal/sales/pos-snapshots", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect.poll(async () =>
    (await staffApi(page, "GET", "/api/internal/sales")).body.some((sale: { id: string }) => sale.id === original?.id),
  ).toBe(true);
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  await expect.poll(() => lostAcknowledgementCompleted, { timeout: 15_000 }).toBe(true);
  await page.unroute("**/api/internal/sales/accepted");
  await page.unroute("**/api/internal/sales/pos-snapshots");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier-b");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  const betaSnapshotResponse = page.waitForResponse(
    (response) => response.url().includes("/api/internal/sales/pos-snapshots") && response.ok(),
  );
  await page.getByRole("button", { name: "أبشواي" }).click();
  const betaSnapshot = (await (await betaSnapshotResponse).json()) as {
    includedOperationIds: string[];
    includedOperations: Array<Record<string, unknown>>;
    staffId: string;
  };
  expect(betaSnapshot.includedOperationIds).toContain(original?.operationId);
  const proof = betaSnapshot.includedOperations.find((item) => item.operationId === original?.operationId);
  expect(Object.keys(proof ?? {}).sort()).toEqual(["contentDigest", "operationId", "saleId"]);
  expect(proof?.saleId).toBe(original?.id);
  expect(String(proof?.contentDigest)).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(betaSnapshot)).not.toContain("زبون الخصوصية");
  expect(JSON.stringify(betaSnapshot)).not.toContain("01099887766");
  expect(JSON.stringify(betaSnapshot)).not.toContain("سبب سري للاختبار");
  expect(JSON.stringify(betaSnapshot)).not.toContain("كاشير تجريبي");
  expect(JSON.stringify(betaSnapshot.includedOperations)).not.toMatch(
    /soldByStaffId|finalTotalPiasters|employeeDiscountPiasters|customerName|customerPhone|lines/,
  );
  await expect.poll(async () => (await readPrivacyState(page)).sales.find((sale) => sale.id === original?.id)?.syncStatus).toBe(
    "acknowledged",
  );
  const afterB = await readPrivacyState(page);
  expect(afterB.effects.filter((effect) => effect.operationId === original?.operationId)).toHaveLength(0);
  expect(JSON.stringify(afterB.snapshots)).not.toContain("زبون الخصوصية");
  expect(JSON.stringify(afterB.snapshots)).not.toContain("01099887766");
  expect(JSON.stringify(afterB.stockCache)).not.toContain("زبون الخصوصية");
  expect(JSON.stringify(afterB.stockCache)).not.toContain("01099887766");
  expect(afterB.snapshots.every((row) => Array.isArray(row.snapshot.includedOperations) && row.snapshot.includedOperations.length === 0)).toBe(
    true,
  );
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await expect(page.getByTestId("foreign-queue")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("01099887766");
  const lookup = await staffApi(page, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent(seed.code)}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(1);
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  const returned = (await readPrivacyState(page)).sales.find((sale) => sale.id === original?.id);
  expect(returned?.syncStatus).toBe("acknowledged");
  expect(returned?.customerPhone).toBe("01099887766");
  expect(returned?.customerName).toBe("زبون الخصوصية");
  expect(returned?.discountReason).toBe("سبب سري للاختبار");
  expect(returned?.finalTotalPiasters).toBe(23000);
});

test("a conflicting phone, reason, or tender stays durable pending after another cashier's snapshot", async ({ page }) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 24000, code: "SYNC-CONF" });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, {
    customerName: "زبون أصلي",
    customerPhone: "01011111111",
    discountReason: "سبب أصلي",
  });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const original = (await readPrivacyState(page)).sales[0];
  await page.unroute("**/api/internal/sales/accepted");
  await page.route("**/api/internal/sales/accepted", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.route("**/api/internal/sales/pos-snapshots", (route) => route.abort("failed"));
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await expect.poll(async () =>
    (await staffApi(page, "GET", "/api/internal/sales")).body.some((sale: { id: string }) => sale.id === original?.id),
  ).toBe(true);
  await page.unroute("**/api/internal/sales/accepted");
  await page.unroute("**/api/internal/sales/pos-snapshots");
  await mutateLocalSale(page, { payment: { method: "online", cashPiasters: 0, onlinePiasters: 24000 } });
  await page.getByTestId("retry-sync").click();
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  const afterTenderConflict = (await readPrivacyState(page)).sales[0];
  expect(afterTenderConflict?.syncStatus).toBe("pending");
  expect(afterTenderConflict?.customerPhone).toBe("01011111111");
  expect(afterTenderConflict?.discountReason).toBe("سبب أصلي");
  expect(afterTenderConflict?.payment).toEqual({ method: "online", cashPiasters: 0, onlinePiasters: 24000 });
  await mutateLocalSale(page, {
    customerPhone: "01022222222",
    discountReason: "سبب مختلف",
  });
  await page.getByTestId("retry-sync").click();
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  const afterConflict = (await readPrivacyState(page)).sales[0];
  expect(afterConflict?.syncStatus).toBe("pending");
  expect(afterConflict?.customerPhone).toBe("01022222222");
  expect(afterConflict?.discountReason).toBe("سبب مختلف");
  expect(afterConflict?.payment).toEqual({ method: "online", cashPiasters: 0, onlinePiasters: 24000 });
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("cashier-b");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await readPrivacyState(page)).sales[0]?.syncStatus).toBe("pending");
  const duringB = await readPrivacyState(page);
  expect(duringB.sales[0]?.customerPhone).toBe("01022222222");
  expect(duringB.sales[0]?.discountReason).toBe("سبب مختلف");
  expect(duringB.sales[0]?.customerName).toBe("زبون أصلي");
  expect(duringB.effects.some((effect) => effect.operationId === original?.operationId)).toBe(true);
  await expect(page.locator("body")).not.toContainText("01022222222");
  await expect(page.locator("body")).not.toContainText("زبون أصلي");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await signInAsCashier(page);
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 1");
  const returned = (await readPrivacyState(page)).sales[0];
  expect(returned?.syncStatus).toBe("pending");
  expect(returned?.customerPhone).toBe("01022222222");
  expect(returned?.discountReason).toBe("سبب مختلف");
  expect(returned?.customerName).toBe("زبون أصلي");
  expect(returned?.finalTotalPiasters).toBe(24000);
});

test("account recovery preserves accepted and connected sales across revoke, expiry, and delayed manager ack", async ({
  page,
  context,
}) => {
  const seed = await seedSingleProduct(page, { quantity: 2, price: 21000, code: "SYNC-MGR" });
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const ownerId = workspace.body.staff.id as string;
  const branches = workspace.body.authorizedBranches as Array<{ id: string; code: string; nameAr: string }>;
  const abshway = branches.find((branch) => branch.code === "abshway");
  const fayoum = branches.find((branch) => branch.code === "fayoum");
  expect(abshway && fayoum).toBeTruthy();
  const loginName = `sync.recover.${crypto.randomUUID().slice(0, 8)}`;
  const created = await staffApi(page, "POST", "/api/internal/staff", {
    loginName,
    displayName: "كاشير الاسترداد",
    password: "e2e-recover-pass",
    grants: [
      { branchId: abshway?.id, cashier: true, orderRepresentative: false },
      { branchId: fayoum?.id, cashier: true, orderRepresentative: false },
    ],
  });
  expect(created.status).toBe(201);
  const cashierId = created.body.id as string;
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill("e2e-recover-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("button", { name: "الفيوم" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  await addAndPrice(page, seed, {
    customerName: "زبون الاسترداد",
    customerPhone: "01055556666",
    discountReason: "سبب الاسترداد",
  });
  await page.getByRole("form", { name: "إتمام البيع" }).getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const acceptedSale = (await readPrivacyState(page)).sales[0];
  expect(acceptedSale?.kind).toBe("accepted");
  expect(acceptedSale?.customerPhone).toBe("01055556666");
  expect(acceptedSale?.branch?.code).toBe("abshway");
  const acceptedOccurredAt = acceptedSale?.occurredAt;
  await page.unroute("**/api/internal/sales/prepare");
  await page.getByRole("link", { name: "العودة لمساحة العمل" }).click();
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await addAndPrice(page, seed);
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
  await checkout.getByLabel("استلم الزبون البضاعة وتم استلام المبلغ بالطريقة المحددة").check();
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const both = await readPrivacyState(page);
  const connectedSale = both.sales.find((sale) => sale.id !== acceptedSale?.id);
  expect(connectedSale?.kind).toBe("connected");
  expect(connectedSale?.branch?.code).toBe("abshway");
  const connectedOccurredAt = connectedSale?.occurredAt;
  expect(both.sales.filter((sale) => sale.syncStatus === "pending")).toHaveLength(2);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const revoked = await staffApi(page, "POST", `/api/internal/staff/${cashierId}/grants`, {
    grants: [{ branchId: fayoum?.id, cashier: true, orderRepresentative: false }],
  });
  expect(revoked.status).toBe(200);

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill("e2e-recover-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page.getByRole("button", { name: "الفيوم" })).toBeVisible();
  await expect(page.getByRole("button", { name: "أبشواي" })).toHaveCount(0);
  await page.getByRole("button", { name: "الفيوم" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("الفيوم");
  await page.getByRole("link", { name: "تغيير الفرع" }).click();
  await expect(page.getByRole("button", { name: "أبشواي" })).toHaveCount(0);
  await page.getByRole("button", { name: "الفيوم" }).click();

  const expired = await page.request.fetch("http://127.0.0.1:5174/api/auth/sign-out", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5174", "content-type": "application/json" },
    data: {},
  });
  expect(expired.ok()).toBe(true);
  const blocked = await staffApi(page, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(blocked.status).toBe(401);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByTestId("accepted-prices")).toHaveCount(0);
  const preserved = await readPrivacyState(page);
  expect(preserved.sales.filter((sale) => sale.id === acceptedSale?.id || sale.id === connectedSale?.id)).toHaveLength(2);
  expect(preserved.sales.every((sale) => sale.syncStatus === "pending")).toBe(true);
  void context;

  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("cashier-b");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await expect(page.getByTestId("foreign-queue")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("01055556666");
  await expect(page.locator("body")).not.toContainText("زبون الاسترداد");

  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("foreign-queue")).toContainText("مبيعات محفوظة لحساب تاني: 2");
  await expect(page.locator("body")).not.toContainText("01055556666");
  const recoverHeld: Array<{ release: () => void; delivered: Promise<void> }> = [];
  await page.route("**/api/internal/sales/recover", async (route) => {
    const response = await route.fetch();
    let release!: () => void;
    let markDelivered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered = new Promise<void>((resolve) => {
      markDelivered = resolve;
    });
    recoverHeld.push({ release, delivered });
    await gate;
    await route.fulfill({ response });
    markDelivered();
  });
  await page.getByTestId("recover-queue").click();
  await expect.poll(() => recoverHeld.length).toBeGreaterThan(0);
  const betaPage = await context.newPage();
  await betaPage.goto("http://127.0.0.1:5174/login");
  await betaPage.getByRole("button", { name: "تسجيل الخروج" }).click();
  await betaPage.getByLabel("اسم الدخول").fill("cashier-b");
  await betaPage.getByLabel("كلمة المرور").fill("e2e-cashier-b-pass");
  await betaPage.getByRole("button", { name: "دخول" }).click();
  await betaPage.getByRole("button", { name: "أبشواي" }).click();
  await expect(betaPage.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  for (const item of recoverHeld) {
    item.release();
  }
  await Promise.all(recoverHeld.map((item) => item.delivered));
  await expect.poll(async () => {
    const state = await readPrivacyState(betaPage);
    const leaked = JSON.stringify({ snapshots: state.snapshots, stockCache: state.stockCache }).includes("01055556666");
    const unsyncedText = await betaPage.getByTestId("unsynced-count").textContent();
    const foreign = await betaPage.getByTestId("foreign-queue").count();
    return !leaked && unsyncedText?.includes("مبيعات غير مزامنة: 0") && foreign === 0;
  }).toBe(true);
  const betaWorkspace = await staffApi(betaPage, "GET", "/api/internal/workspace");
  expect(betaWorkspace.body.staff.displayName).toBe("كاشير ثان");
  await expect(betaPage.getByTestId("foreign-queue")).toHaveCount(0);
  await expect(betaPage.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
  await expect(betaPage.locator("body")).not.toContainText("01055556666");
  await expect(betaPage.locator("body")).not.toContainText("كاشير الاسترداد");
  const betaCache = await readPrivacyState(betaPage);
  expect(JSON.stringify(betaCache.stockCache)).not.toContain("01055556666");
  expect(JSON.stringify(betaCache.snapshots)).not.toContain("01055556666");
  expect(betaWorkspace.body.staff.displayName).toBe("كاشير ثان");

  await betaPage.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await page.unroute("**/api/internal/sales/recover");
  await expect(page.getByTestId("foreign-queue")).toBeVisible();
  await page.getByTestId("recover-queue").click();
  await expect.poll(async () => {
    const listed = await staffApi(page, "GET", "/api/internal/sales");
    return listed.body.filter((sale: { id: string }) => sale.id === acceptedSale?.id || sale.id === connectedSale?.id).length;
  }).toBe(2);
  const listed = await staffApi(page, "GET", "/api/internal/sales");
  const recoveredAccepted = listed.body.find((sale: { id: string }) => sale.id === acceptedSale?.id);
  const recoveredConnected = listed.body.find((sale: { id: string }) => sale.id === connectedSale?.id);
  expect(recoveredAccepted.soldByStaffId).toBe(cashierId);
  expect(recoveredAccepted.soldByDisplayName).toBe("كاشير الاسترداد");
  expect(recoveredAccepted.branch.code).toBe("abshway");
  expect(recoveredAccepted.customerPhone).toBe("01055556666");
  expect(recoveredAccepted.occurredAt).toBe(acceptedOccurredAt);
  expect(recoveredAccepted.recoveredByStaffId).toBe(ownerId);
  expect(recoveredAccepted.recoveredAt).toEqual(expect.any(String));
  expect(recoveredAccepted.recoveredAt).not.toBe(recoveredAccepted.occurredAt);
  expect(recoveredConnected.soldByStaffId).toBe(cashierId);
  expect(recoveredConnected.soldByDisplayName).toBe("كاشير الاسترداد");
  expect(recoveredConnected.branch.code).toBe("abshway");
  expect(recoveredConnected.occurredAt).toBe(connectedOccurredAt);
  expect(recoveredConnected.recoveredByStaffId).toBe(ownerId);
  await expect.poll(async () => (await readPrivacyState(page)).sales.filter((sale) => sale.syncStatus === "pending").length).toBe(0);
});

async function attemptAcceptPrices(page: Page, seed: { code: string; nameAr?: string; sizeName: string; colorName: string }) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText(seed.nameAr ?? seed.code);
  const color = page.getByLabel("اللون");
  await expect(color).toBeDisabled();
  await page.getByLabel("المقاس").selectOption({ label: seed.sizeName });
  await expect(color).toBeEnabled();
  await color.selectOption({ label: seed.colorName });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  await page.getByRole("form", { name: "إتمام البيع" }).getByRole("button", { name: "قبول الأسعار" }).click();
}

async function addAndPrice(
  page: Page,
  seed: { code: string; nameAr?: string; sizeName: string; colorName: string },
  details?: { customerName?: string; customerPhone?: string; discountReason?: string; waitForLookupResponse?: boolean },
) {
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(seed.code);
  const searchButton = lookup.locator('button[type="submit"]');
  const lookupResponse = details?.waitForLookupResponse
    ? page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/internal/catalog/lookup" && url.searchParams.get("code") === seed.code;
      })
    : null;
  await searchButton.click();
  if (lookupResponse) {
    await lookupResponse;
    await expect(searchButton).toHaveText("بحث");
    await expect(searchButton).toBeEnabled();
  }
  await expect(page.getByTestId("lookup-result")).toContainText(seed.nameAr ?? seed.code);
  const color = page.getByLabel("اللون");
  await page.getByLabel("المقاس").selectOption({ index: 0 });
  await expect(color).toBeDisabled();
  await page.getByLabel("المقاس").selectOption({ label: seed.sizeName });
  await expect(color).toBeEnabled();
  await color.selectOption({ label: seed.colorName });
  await page.getByRole("button", { name: "إضافة إلى السلة" }).click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  if (details?.customerName) {
    await checkout.getByLabel("اسم الزبون (اختياري)").fill(details.customerName);
  }
  if (details?.customerPhone) {
    await checkout.getByLabel("هاتف الزبون (اختياري)").fill(details.customerPhone);
  }
  if (details?.discountReason) {
    await checkout.getByLabel("سبب الخصم (اختياري)").fill(details.discountReason);
  }
  await checkout.getByRole("button", { name: "قبول الأسعار" }).click();
  await expect(page.getByTestId("accepted-prices")).toBeVisible();
}

async function signInAsCashier(page: Page) {
  await page.getByLabel("اسم الدخول").fill("cashier");
  await page.getByLabel("كلمة المرور").fill("e2e-cashier-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function seedSingleProduct(page: Page, options: { quantity: number; price: number; code: string }) {
  await page.goto("http://127.0.0.1:5174/login");
  await page.getByLabel("اسم الدخول").fill("owner");
  await page.getByLabel("كلمة المرور").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  const sizeName = `مقاس ${options.code}`;
  const colorName = `لون ${options.code}`;
  const nameAr = `منتج ${options.code}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${options.code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: sizeName });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: colorName });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code: options.code,
    nameAr,
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: options.price,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: options.quantity, unitCostPiasters: 4000 }],
  });
  return { code: options.code, nameAr, sizeName, colorName, variantId };
}

async function readPosState(page: Page) {
  const state = await readPrivacyState(page);
  return { sales: state.sales, effects: state.effects };
}

async function readPrivacyState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function all<T>(name: string): Promise<T[]> {
      if (!db.objectStoreNames.contains(name)) {
        return [];
      }
      const tx = db.transaction(name, "readonly");
      return new Promise((resolve, reject) => {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    }
    const sales = await all<{
      id: string;
      operationId: string;
      staffId: string;
      syncStatus: string;
      kind?: string;
      occurredAt?: string;
      snapshotId?: string | null;
      branch?: { code: string };
      soldByDisplayName: string;
      soldByStaffId?: string;
      customerName: string | null;
      customerPhone: string | null;
      discountReason: string | null;
      finalTotalPiasters: number;
      payloadFingerprint?: string | null;
      payment?: { method: string; cashPiasters: number; onlinePiasters: number };
    }>("sales");
    const effects = await all<{ quantity: number; variantId: string; operationId: string }>("effects");
    const snapshots = await all<{ staffId: string; snapshot: { branch?: { id: string }; includedOperations?: unknown[] } }>("snapshots");
    const meta = await all<{ key: string; value: string }>("meta");
    const cacheRow = meta.find((row) => row.key === "stockCache");
    let stockCache: { version?: number; availability?: Record<string, number>; includedOperationIds?: string[] } = {};
    if (cacheRow?.value) {
      try {
        stockCache = JSON.parse(cacheRow.value) as typeof stockCache;
      } catch {
        stockCache = {};
      }
    }
    const branchId = snapshots[0]?.snapshot.branch?.id;
    if (branchId && stockCache.availability) {
      for (const [key, quantity] of Object.entries(stockCache.availability)) {
        if (key.startsWith(`${branchId}:`)) stockCache.availability[key.slice(branchId.length + 1)] = quantity;
      }
    }
    db.close();
    return { sales, effects, snapshots, stockCache };
  });
}

async function delayWebCrypto(page: Page) {
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(globalThis.crypto.subtle) as SubtleCrypto;
    const original = proto.digest;
    proto.digest = function (this: SubtleCrypto, algorithm: AlgorithmIdentifier, data: BufferSource) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        window.setTimeout(() => {
          original.call(this, algorithm, data).then(resolve, reject);
        }, 75);
      });
    };
  });
}

type HeldAccepted = {
  saleId: string;
  operationId: string;
  stockVersion: number;
  availability: Array<{ variantId: string; availableQuantity: number }>;
  includedOperationIds: string[];
  release: () => void;
};

async function attachHeldAccepted(
  router: { route(url: string, handler: (route: import("@playwright/test").Route) => Promise<void>): Promise<void> },
  held: HeldAccepted[],
) {
  await router.route("**/api/internal/sales/accepted", async (route) => {
    const response = await route.fetch();
    const text = await response.text();
    const body = JSON.parse(text) as {
      id: string;
      operationId: string;
      acknowledgement: {
        stockVersion: number;
        availability: Array<{ variantId: string; availableQuantity: number }>;
        includedOperationIds: string[];
      };
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    held.push({
      saleId: body.id,
      operationId: body.operationId,
      stockVersion: body.acknowledgement.stockVersion,
      availability: body.acknowledgement.availability,
      includedOperationIds: body.acknowledgement.includedOperationIds,
      release,
    });
    await gate;
    await route.fulfill({
      status: response.status(),
      headers: { "content-type": "application/json" },
      body: text,
    });
  });
}

function availabilityOf(held: HeldAccepted | undefined, variantId: string) {
  return held?.availability.find((item) => item.variantId === variantId)?.availableQuantity;
}

type CapturedAccepted = {
  saleId: string;
  pendingOperationIds: string[];
  commit: () => Promise<HeldAccepted>;
  release: () => void;
};

async function attachCapturedAccepted(
  router: { route(url: string, handler: (route: import("@playwright/test").Route) => Promise<void>): Promise<void> },
  captured: CapturedAccepted[],
) {
  await router.route("**/api/internal/sales/accepted", async (route) => {
    const posted = JSON.parse(route.request().postData() ?? "{}") as {
      saleId?: string;
      pendingOperationIds?: string[];
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let committed: HeldAccepted | undefined;
    let payload = "";
    let status = 0;
    const item: CapturedAccepted = {
      saleId: posted.saleId ?? "",
      pendingOperationIds: Array.isArray(posted.pendingOperationIds) ? posted.pendingOperationIds : [],
      commit: async () => {
        if (committed) {
          return committed;
        }
        const response = await route.fetch();
        payload = await response.text();
        status = response.status();
        const body = JSON.parse(payload) as {
          id: string;
          operationId: string;
          acknowledgement: {
            stockVersion: number;
            availability: Array<{ variantId: string; availableQuantity: number }>;
            includedOperationIds: string[];
          };
        };
        committed = {
          saleId: body.id,
          operationId: body.operationId,
          stockVersion: body.acknowledgement.stockVersion,
          availability: body.acknowledgement.availability,
          includedOperationIds: body.acknowledgement.includedOperationIds,
          release,
        };
        return committed;
      },
      release,
    };
    captured.push(item);
    await gate;
    if (!committed) {
      await item.commit();
    }
    await route.fulfill({
      status,
      headers: { "content-type": "application/json" },
      body: payload,
    });
  });
}

async function installAckTransactionAbort(page: Page, options?: { abortAfterAcknowledgementWrites?: number }) {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    const proto = IDBObjectStore.prototype as IDBObjectStore & { __bravosPut?: typeof put };
    proto.__bravosPut = put;
    const flags = window as unknown as {
      __bravosAckAbort?: boolean;
      __bravosAckAbortReached?: boolean;
      __bravosAckAbortAfter?: number;
      __bravosAckWrites?: number;
    };
    flags.__bravosAckAbort = false;
    flags.__bravosAckAbortReached = false;
    flags.__bravosAckWrites = 0;
    proto.put = function (this: IDBObjectStore, ...args: unknown[]) {
      const names = [...this.transaction.objectStoreNames];
      if (
        flags.__bravosAckAbort &&
        names.includes("sales") &&
        names.includes("snapshots") &&
        names.includes("effects") &&
        names.includes("meta")
      ) {
        flags.__bravosAckWrites = (flags.__bravosAckWrites ?? 0) + 1;
        if ((flags.__bravosAckWrites ?? 0) > (flags.__bravosAckAbortAfter ?? 0)) {
          flags.__bravosAckAbortReached = true;
          this.transaction.abort();
        }
      }
      return put.apply(this, args as [IDBValidKey]);
    };
  });
  await page.evaluate((abortAfter) => {
    const flags = window as unknown as { __bravosAckAbortAfter?: number };
    flags.__bravosAckAbortAfter = abortAfter;
  }, options?.abortAfterAcknowledgementWrites ?? 0);
}

async function ackAbortReached(page: Page) {
  return page.evaluate(() => Boolean((window as unknown as { __bravosAckAbortReached?: boolean }).__bravosAckAbortReached));
}

async function restoreAckTransactionAbort(page: Page) {
  await page.evaluate(() => {
    const proto = IDBObjectStore.prototype as IDBObjectStore & { __bravosPut?: typeof IDBObjectStore.prototype.put };
    if (proto.__bravosPut) {
      proto.put = proto.__bravosPut;
    }
    (window as unknown as { __bravosAckAbort?: boolean }).__bravosAckAbort = false;
  });
}

async function mutateLocalSale(
  page: Page,
  patch: { customerPhone?: string; discountReason?: string; snapshotId?: string;
    payment?: { method: "cash" | "online" | "split"; cashPiasters: number; onlinePiasters: number } },
) {
  await page.evaluate(async (next) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("sales", "readwrite");
    const store = tx.objectStore("sales");
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    const sale = rows[0];
    if (!sale) {
      throw new Error("missing local sale");
    }
    store.put({ ...sale, ...next });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, patch);
}

function salesForCode(
  body: Array<{ lines?: Array<{ variant?: { product?: { code?: string } } }> }>,
  code: string,
) {
  return body.filter((sale) => sale.lines?.some((line) => line.variant?.product?.code === code));
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  if (method === "POST" && url === "/api/internal/receiving/receipts" && payload && typeof payload === "object" && !("branchId" in payload)) {
    const current = await staffApi(page, "GET", "/api/internal/workspace");
    payload = { ...payload, branchId: current.body.activeBranch?.id };
  }
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:5174",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    data: payload,
  });
  return {
    status: response.status(),
    body: await response.json(),
  };
}
