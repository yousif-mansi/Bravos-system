import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { AutomaticOfferDto, AutomaticOfferWriteDto, CouponDto, CouponWriteDto, StaffAccountDto } from "@bravos/contracts";

const BASE = "http://127.0.0.1:5174";

test("delayed automatic-offer save keeps the submitted draft and blocks competing edits", async ({ page }) => {
  const rows = [
    percentageOffer("61000000-0000-4000-8000-0000000000a1", "عرض الصيف", true),
    percentageOffer("61000000-0000-4000-8000-0000000000a2", "عرض الشتاء", false),
  ];
  const writes: Array<{ method: string; nameAr: string }> = [];
  const hold = deferred();
  await installOfferRoutes(page, { rows, writes, holdWrite: hold });
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    await expect(page.getByRole("button", { name: "حفظ الكوبون" })).toBeEnabled();
    await page.getByTestId("offer-row").filter({ hasText: "عرض الصيف" }).getByRole("button", { name: "تعديل", exact: true }).click();
    const form = page.getByRole("form", { name: "تعديل العرض التلقائي" });
    await form.getByLabel("اسم العرض").fill("مسودة محفوظة");
    await form.getByRole("button", { name: "حفظ العرض", exact: true }).click();
    await expect(form.getByRole("button", { name: "جارٍ الحفظ…" })).toBeDisabled();
    await expect(form.getByLabel("اسم العرض")).toBeDisabled();
    await expect(form.getByLabel("اسم العرض")).toHaveValue("مسودة محفوظة");
    await expect(page.getByRole("button", { name: "تعديل", exact: true })).toHaveCount(2);
    for (const edit of await page.getByRole("button", { name: "تعديل", exact: true }).all()) await expect(edit).toBeDisabled();
    await expect(page.getByRole("button", { name: "إيقاف", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تفعيل", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "حفظ الكوبون" })).toBeEnabled();
    expect(writes).toEqual([{ method: "PUT", nameAr: "مسودة محفوظة", active: true }]);
    hold.resolve();
    await expect(page.getByRole("form", { name: "إنشاء عرض تلقائي" })).toBeVisible();
    await expect(page.getByTestId("offer-row").filter({ hasText: "مسودة محفوظة" })).toHaveCount(1);
    expect(writes).toEqual([{ method: "PUT", nameAr: "مسودة محفوظة", active: true }]);
  } finally {
    hold.resolve();
  }
});

test("delayed automatic-offer toggle sends one status change and blocks competing actions", async ({ page }) => {
  const rows = [
    percentageOffer("61000000-0000-4000-8000-0000000000b1", "عرض مفعل", true),
    percentageOffer("61000000-0000-4000-8000-0000000000b2", "عرض متوقف مسبقاً", false),
  ];
  const writes: Array<{ method: string; nameAr: string; active: boolean }> = [];
  const hold = deferred();
  await installOfferRoutes(page, { rows, writes, holdWrite: hold });
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    const active = page.getByTestId("offer-row").filter({ hasText: "عرض مفعل" });
    await active.getByRole("button", { name: "إيقاف", exact: true }).click();
    await expect(active.getByRole("button", { name: "جارٍ تغيير الحالة…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "حفظ العرض", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تعديل", exact: true }).first()).toBeDisabled();
    await expect(page.getByTestId("offer-row").filter({ hasText: "عرض متوقف مسبقاً" }).getByRole("button", { name: "تفعيل", exact: true })).toBeDisabled();
    expect(writes).toEqual([{ method: "PUT", nameAr: "عرض مفعل", active: false }]);
    hold.resolve();
    await expect(active).toContainText("متوقف");
    await expect(active.getByRole("button", { name: "تفعيل", exact: true })).toBeEnabled();
    expect(writes).toEqual([{ method: "PUT", nameAr: "عرض مفعل", active: false }]);
  } finally {
    hold.resolve();
  }
});

test("offer save stays successful when the following list refresh fails and retries with GET only", async ({ page }) => {
  const rows: AutomaticOfferDto[] = [];
  const calls: string[] = [];
  const gate = deferred();
  let rejectNextWrite = true;
  let failNextList = false;
  let holdList: ReturnType<typeof deferred> | null = null;
  await page.route(/\/api\/internal\/pricing\/coupons(?:\/[^/?]+)?(?:\?.*)?$/, fulfillCoupons);
  await page.route(/\/api\/internal\/pricing\/offers(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    if (method === "GET" && path === "/api/internal/pricing/offers") {
      calls.push("GET");
      if (failNextList) {
        failNextList = false;
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: "الخدمة غير متاحة" } } });
        return;
      }
      if (holdList) await holdList.promise;
      await route.fulfill({ json: rows });
      return;
    }
    if (method === "POST" && path === "/api/internal/pricing/offers") {
      calls.push("POST");
      const body = route.request().postDataJSON() as { nameAr: string; active: boolean };
      if (rejectNextWrite) {
        rejectNextWrite = false;
        await route.fulfill({ status: 400, json: { error: { code: "REJECTED", messageAr: "اسم العرض غير مقبول" } } });
        return;
      }
      rows.push({ ...percentageOffer("61000000-0000-4000-8000-0000000000c1", body.nameAr, body.active), ...body, id: "61000000-0000-4000-8000-0000000000c1" });
      await route.fulfill({ status: 201, json: rows[0] });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    const form = page.getByRole("form", { name: "إنشاء عرض تلقائي" });
    await expect(page.getByText("لسه مفيش عروض")).toBeVisible();
    await form.getByLabel("اسم العرض").fill("عرض بعد فشل القائمة");
    await form.getByRole("button", { name: "حفظ العرض", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("اسم العرض غير مقبول");
    failNextList = true;
    await form.getByRole("button", { name: "حفظ العرض", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "تم إنشاء العرض." })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("تعذر تحديث قائمة العروض.");
    await expect(page.getByRole("alert")).toContainText("البيانات الظاهرة قديمة حتى تنجح إعادة التحميل.");
    await expect(page.getByText("تعذر حفظ العرض.")).toHaveCount(0);
    await expect(page.getByText("اسم العرض غير مقبول")).toHaveCount(0);
    await expect(page.getByText("لسه مفيش عروض")).toHaveCount(0);
    expect(calls.filter((call) => call === "POST")).toHaveLength(2);
    const postsBeforeRetry = calls.filter((call) => call === "POST").length;
    holdList = gate;
    await page.getByRole("button", { name: "إعادة تحميل العروض", exact: true }).click();
    await expect(page.getByRole("button", { name: "جارٍ تحديث القائمة…" })).toBeDisabled();
    expect(calls.filter((call) => call === "POST")).toHaveLength(postsBeforeRetry);
    expect(calls.at(-1)).toBe("GET");
    gate.resolve();
    await expect(page.getByTestId("offer-row").filter({ hasText: "عرض بعد فشل القائمة" })).toHaveCount(1);
    await expect(page.getByText("تعذر تحديث قائمة العروض.")).toHaveCount(0);
    expect(calls.filter((call) => call === "POST")).toHaveLength(postsBeforeRetry);
    expect(rows).toHaveLength(1);
  } finally {
    gate.resolve();
  }
});

test("staff create stays successful when the following list refresh fails and retries with GET only", async ({ page }) => {
  const rows: StaffAccountDto[] = [];
  const calls: string[] = [];
  const gate = deferred();
  let rejectNextWrite = true;
  let failNextList = false;
  let holdList: ReturnType<typeof deferred> | null = null;
  await page.route("**/api/internal/staff**", async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    if (path !== "/api/internal/staff") {
      await route.continue();
      return;
    }
    if (method === "GET") {
      calls.push("GET");
      if (failNextList) {
        failNextList = false;
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: "الخدمة غير متاحة" } } });
        return;
      }
      if (holdList) await holdList.promise;
      await route.fulfill({ json: rows });
      return;
    }
    if (method === "POST") {
      calls.push("POST");
      const body = route.request().postDataJSON() as { loginName: string; displayName: string };
      if (rejectNextWrite) {
        rejectNextWrite = false;
        await route.fulfill({ status: 400, json: { error: { code: "REJECTED", messageAr: "اسم الدخول مستخدم بالفعل" } } });
        return;
      }
      rows.push({
        id: "61000000-0000-4000-8000-0000000000d1",
        loginName: body.loginName,
        displayName: body.displayName,
        role: "employee",
        disabled: false,
        grants: [],
        changedByStaffId: null,
        changedAt: "2026-10-22T08:00:00.000Z",
        changes: [],
      });
      await route.fulfill({ status: 201, json: rows[0] });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/staff`);
    const form = page.getByRole("form", { name: "إنشاء حساب موظف" });
    await expect(page.getByText("لسه مفيش موظفين")).toBeVisible();
    await form.getByLabel("اسم الدخول").fill("nora-ux");
    await form.getByLabel("الاسم الظاهر").fill("نورا التجربة");
    await form.getByLabel("كلمة المرور").fill("ux-feedback-staff-pass");
    await form.getByRole("button", { name: "إنشاء الحساب", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("اسم الدخول مستخدم بالفعل");
    failNextList = true;
    await form.getByRole("button", { name: "إنشاء الحساب", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "تم إنشاء الحساب." })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("تعذر تحديث قائمة الموظفين.");
    await expect(page.getByRole("alert")).toContainText("البيانات الظاهرة قديمة حتى تنجح إعادة التحميل.");
    await expect(page.getByText("تعذر إنشاء الحساب.")).toHaveCount(0);
    await expect(page.getByText("اسم الدخول مستخدم بالفعل")).toHaveCount(0);
    await expect(page.getByText("لسه مفيش موظفين")).toHaveCount(0);
    await expect(form.getByLabel("اسم الدخول")).toHaveValue("");
    const postsBeforeRetry = calls.filter((call) => call === "POST").length;
    expect(postsBeforeRetry).toBe(2);
    expect(rows).toHaveLength(1);
    holdList = gate;
    await page.getByRole("button", { name: "إعادة تحميل الموظفين", exact: true }).click();
    await expect(page.getByRole("button", { name: "جارٍ تحديث القائمة…" })).toBeDisabled();
    expect(calls.filter((call) => call === "POST")).toHaveLength(postsBeforeRetry);
    expect(calls.at(-1)).toBe("GET");
    gate.resolve();
    await expect(page.getByText("نورا التجربة", { exact: true })).toHaveCount(1);
    await expect(page.getByText("تعذر تحديث قائمة الموظفين.")).toHaveCount(0);
    expect(calls.filter((call) => call === "POST")).toHaveLength(postsBeforeRetry);
  } finally {
    gate.resolve();
  }
});

test("confirmed online orders hide the empty message until a successful load", async ({ page }) => {
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await (await page.request.get(`${BASE}/api/internal/workspace`)).json();
  const branchId = workspace.activeBranch.id as string;
  const orders = [
    listedOrder("ON-CONFIRMED", "confirmed", "2026-10-22T08:00:00.000Z", branchId, 99900, 18550),
    listedOrder("ON-PENDING", "pending", null, branchId, 50000, null),
    listedOrder("ON-CANCELLED", "cancelled_unreachable", "2026-10-22T09:00:00.000Z", branchId, 40000, 40000),
  ];
  const gate = deferred();
  const reload = deferred();
  const traffic = { phase: "hold" as "hold" | "send", status: 503, body: { error: { code: "UNAVAILABLE", messageAr: "تعذر التحميل" } } as unknown, gets: 0 };
  await page.route("**/api/internal/online-orders**", async (route) => {
    const path = pathname(route.request().url());
    if (path !== "/api/internal/online-orders" || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    traffic.gets += 1;
    if (traffic.phase === "hold") await gate.promise;
    await route.fulfill({ status: traffic.status, json: traffic.body });
  });
  await page.route("**/api/internal/sales**", async (route) => {
    const path = pathname(route.request().url());
    if (path === "/api/internal/sales" && route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto(`${BASE}/sales`);
    const section = page.getByTestId("confirmed-online-sales");
    await expect(section.getByRole("status")).toHaveText("جارٍ تحميل الطلبات المؤكدة…");
    await expect(section.getByText("لا توجد طلبات تم تأكيدها بعد.")).toHaveCount(0);
    expect(traffic.gets).toBeGreaterThan(0);
    traffic.phase = "send";
    gate.resolve();
    await expect(section.getByRole("alert")).toHaveText("تعذر تحميل الطلبات المؤكدة. أعد محاولة التحميل.");
    await expect(section.getByText("لا توجد طلبات تم تأكيدها بعد.")).toHaveCount(0);
    traffic.status = 200;
    traffic.body = orders;
    await section.getByRole("button", { name: "إعادة تحميل الطلبات المؤكدة" }).click();
    const confirmed = section.getByRole("link", { name: /ON-CONFIRMED/ });
    await expect(confirmed).toContainText("أبشواي");
    await expect(confirmed).toContainText("185.50 ج.م.");
    await expect(confirmed).toContainText("مؤكد");
    await expect(section.getByText("999 ج.م.")).toHaveCount(0);
    await expect(section.getByText("ON-PENDING")).toHaveCount(0);
    await expect(section.getByRole("link", { name: /ON-CANCELLED/ })).toContainText("ملغي لعدم الرد");
    traffic.phase = "hold";
    traffic.body = [];
    await page.unroute("**/api/internal/online-orders**");
    await page.route("**/api/internal/online-orders**", async (route) => {
      const path = pathname(route.request().url());
      if (path !== "/api/internal/online-orders" || route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (traffic.phase === "hold") await reload.promise;
      await route.fulfill({ status: 200, json: traffic.body });
    });
    await page.goto(`${BASE}/sales`);
    await expect(section.getByRole("status")).toHaveText("جارٍ تحميل الطلبات المؤكدة…");
    await expect(section.getByText("لا توجد طلبات تم تأكيدها بعد.")).toHaveCount(0);
    traffic.phase = "send";
    reload.resolve();
    await expect(section.getByText("لا توجد طلبات تم تأكيدها بعد.")).toBeVisible();
  } finally {
    gate.resolve();
    reload.resolve();
  }
});

test("cashier sales view does not request the manager order list", async ({ page }) => {
  let orderGets = 0;
  await signIn(page, "cashier", "e2e-cashier-pass");
  await page.route("**/api/internal/online-orders**", async (route) => {
    if (pathname(route.request().url()) === "/api/internal/online-orders" && route.request().method() === "GET") orderGets += 1;
    await route.continue();
  });
  const salesLoaded = page.waitForResponse((response) => pathname(response.url()) === "/api/internal/sales" && response.request().method() === "GET");
  await page.goto(`${BASE}/sales`);
  await salesLoaded;
  await expect(page.getByRole("heading", { name: "مبيعات الفروع" })).toBeVisible();
  await expect(page.getByTestId("confirmed-online-sales")).toHaveCount(0);
  expect(orderGets).toBe(0);
});

test("recovery request and completion block a second submit and replace stale success", async ({ page }) => {
  const hits: string[] = [];
  const requestGate = deferred();
  const completeGate = deferred();
  await page.route("**/api/internal/owner-recovery/**", async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    hits.push(`${method} ${path}`);
    if (method === "POST" && path === "/api/internal/owner-recovery/request") {
      await requestGate.promise;
      await route.fulfill({ json: { accepted: true } });
      return;
    }
    if (method === "POST" && path === "/api/internal/owner-recovery/complete") {
      await completeGate.promise;
      await route.fulfill({ status: 400, json: { error: { code: "INVALID_RECOVERY", messageAr: "رمز الاسترداد غير صالح أو منتهٍ." } } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
  try {
    await page.goto(`${BASE}/recovery`);
    await expect(page.getByRole("heading", { name: "استرداد حساب المالك" })).toBeVisible();
    await page.getByLabel("اسم دخول المالك").fill("ux-feedback-absent");
    await page.getByRole("button", { name: "طلب الاسترداد", exact: true }).click();
    await expect(page.getByRole("button", { name: "جارٍ طلب الاسترداد…" })).toBeDisabled();
    await expect(page.getByLabel("اسم دخول المالك")).toBeDisabled();
    await expect(page.getByLabel("رمز الاسترداد")).toBeDisabled();
    await expect(page.getByLabel("كلمة المرور الجديدة")).toBeDisabled();
    await expect(page.getByRole("button", { name: "حفظ", exact: true })).toBeDisabled();
    expect(hits).toEqual(["POST /api/internal/owner-recovery/request"]);
    requestGate.resolve();
    await expect(page.getByRole("status")).toHaveText("إذا كان الحساب مالكاً، سيصل رمز الاسترداد عبر وسيلة الاسترداد المعتمدة.");
    await page.getByLabel("رمز الاسترداد").fill("ab".repeat(32));
    await page.getByLabel("كلمة المرور الجديدة").fill("ux-feedback-pass-99");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "جارٍ الحفظ…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "طلب الاسترداد", exact: true })).toBeDisabled();
    expect(hits).toEqual([
      "POST /api/internal/owner-recovery/request",
      "POST /api/internal/owner-recovery/complete",
    ]);
    completeGate.resolve();
    await expect(page.getByRole("alert")).toHaveText("رمز الاسترداد غير صالح أو منتهٍ.");
    await expect(page.getByRole("status")).toHaveCount(0);
    expect(hits).toHaveLength(2);
  } finally {
    requestGate.resolve();
    completeGate.resolve();
  }
});

test("workspace ready status stays hidden until readiness data is cached", async ({ page }) => {
  await signIn(page, "cashier", "e2e-cashier-pass", false);
  const releases: Array<() => void> = [];
  let snapshots = 0;
  let releaseSnapshots = false;
  const releaseHeldSnapshots = () => {
    releaseSnapshots = true;
    for (const release of releases) release();
  };
  await page.route("**/api/internal/sales/pos-snapshots", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    snapshots += 1;
    if (!releaseSnapshots) {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "أبشواي", exact: true }).click();
    await expect(page.getByTestId("offline-not-ready")).toHaveText("نقطة البيع بتتجهز");
    await expect(page.getByTestId("offline-ready")).toHaveCount(0);
    await expect.poll(() => snapshots, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("offline-ready")).toHaveCount(0);
    releaseHeldSnapshots();
    const ready = page.getByTestId("offline-ready");
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await expect(ready).toHaveText("جاهز للعمل دون اتصال");
    await expect(ready).toHaveAttribute("role", "status");
    await expect(ready).toHaveClass(/quiet-status/);
    await expect(ready).not.toHaveClass(/theme-hook/);
    await expect(page.getByTestId("offline-not-ready")).toHaveCount(0);
    const box = await ready.evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: Number(style.opacity), width: element.getBoundingClientRect().width };
    });
    expect(box.opacity).toBeGreaterThan(0);
    expect(box.width).toBeGreaterThan(8);
  } finally {
    releaseHeldSnapshots();
  }
});

test("stale automatic-offer edit disables the old row until GET reload permits toggling the accepted terms", async ({ page }) => {
  const rows = [{
    ...percentageOffer("61000000-0000-4000-8000-0000000000f1", "عرض قديم", true),
    productIds: ["61000000-0000-4000-8000-0000000000aa"],
    categoryIds: ["61000000-0000-4000-8000-0000000000bb"],
  }];
  const state: OfferEditRouteState = { rows, writes: [], calls: [], failNextList: false, holdList: null };
  const gate = deferred();
  await installStaleOfferEditRoutes(page, state);
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    const stale = page.getByTestId("offer-row").filter({ hasText: "عرض قديم" });
    await stale.getByRole("button", { name: "تعديل", exact: true }).click();
    const editing = page.getByRole("form", { name: "تعديل العرض التلقائي" });
    await editing.getByLabel("اسم العرض").fill("عرض محدّث");
    await editing.getByLabel("النسبة المئوية").fill("25");
    state.failNextList = true;
    await editing.getByRole("button", { name: "حفظ العرض", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "تم تحديث العرض." })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("تعذر تحديث قائمة العروض.");
    await expect(page.getByRole("alert")).toContainText("البيانات الظاهرة قديمة حتى تنجح إعادة التحميل.");
    await expect(page.getByText("تعذر حفظ العرض.")).toHaveCount(0);
    await expect(stale).toContainText("10٪");
    await expect(stale).toContainText("مفعل");
    await expect(stale.getByRole("button", { name: "تعديل", exact: true })).toBeDisabled();
    await expect(stale.getByRole("button", { name: "إيقاف", exact: true })).toBeDisabled();
    await expect(page.getByRole("form", { name: "إنشاء عرض تلقائي" }).getByLabel("اسم العرض")).toBeEnabled();
    await expect(page.getByRole("form", { name: "إنشاء عرض تلقائي" }).getByRole("button", { name: "حفظ العرض", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "إعادة تحميل العروض", exact: true })).toBeEnabled();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({
      nameAr: "عرض محدّث", percentageBasisPoints: 2500, active: true,
      productIds: ["61000000-0000-4000-8000-0000000000aa"],
      categoryIds: ["61000000-0000-4000-8000-0000000000bb"],
    });
    state.holdList = gate;
    await page.getByRole("button", { name: "إعادة تحميل العروض", exact: true }).click();
    await expect(page.getByRole("button", { name: "جارٍ تحديث القائمة…" })).toBeDisabled();
    expect(state.calls.filter((call) => call === "PUT")).toEqual(["PUT"]);
    expect(state.calls.at(-1)).toBe("GET");
    gate.resolve();
    const updated = page.getByTestId("offer-row").filter({ hasText: "عرض محدّث" });
    await expect(updated).toContainText("25٪");
    await expect(page.getByText("تعذر تحديث قائمة العروض.")).toHaveCount(0);
    state.holdList = null;
    await expect(updated.getByRole("button", { name: "تعديل", exact: true })).toBeEnabled();
    await expect(updated.getByRole("button", { name: "إيقاف", exact: true })).toBeEnabled();
    await updated.getByRole("button", { name: "إيقاف", exact: true }).click();
    await expect(updated).toContainText("متوقف");
    expect(state.calls.filter((call) => call === "PUT")).toEqual(["PUT", "PUT"]);
    expect(state.writes[1]).toMatchObject({
      nameAr: "عرض محدّث", percentageBasisPoints: 2500, active: false,
      productIds: ["61000000-0000-4000-8000-0000000000aa"],
      categoryIds: ["61000000-0000-4000-8000-0000000000bb"],
    });
  } finally {
    gate.resolve();
  }
});

test("delayed coupon save keeps the submitted draft and blocks other coupon edits", async ({ page }) => {
  const state: CouponRouteState = {
    rows: [
      fixedCoupon("61000000-0000-4000-8000-0000000000c1", "SUMMER"),
      fixedCoupon("61000000-0000-4000-8000-0000000000c2", "WINTER", 4),
    ],
    writes: [], calls: [], holdWrite: deferred(), holdList: null, failNextList: false, rejectNextWrite: false,
  };
  await installCouponRoutes(page, state);
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    const panel = page.getByRole("region", { name: "إدارة الكوبونات" });
    await panel.getByTestId("coupon-row").filter({ hasText: "SUMMER" }).getByRole("button", { name: "تعديل", exact: true }).click();
    const form = panel.getByRole("form", { name: "تعديل كوبون" });
    await form.getByLabel("كود الكوبون").fill("SUMMER-HELD");
    await form.getByRole("button", { name: "حفظ الكوبون", exact: true }).click();
    await expect(form.getByRole("button", { name: "جارٍ الحفظ…" })).toBeDisabled();
    await expect(form.getByLabel("كود الكوبون")).toBeDisabled();
    await expect(form.getByLabel("كود الكوبون")).toHaveValue("SUMMER-HELD");
    await expect(form.getByLabel("حد الاستخدام")).toBeDisabled();
    await expect(form.getByRole("button", { name: "إلغاء التعديل", exact: true })).toBeDisabled();
    const edits = panel.getByRole("button", { name: "تعديل", exact: true });
    await expect(edits).toHaveCount(2);
    for (const edit of await edits.all()) await expect(edit).toBeDisabled();
    await expect(page.getByRole("form", { name: "إنشاء عرض تلقائي" }).getByLabel("اسم العرض")).toBeEnabled();
    await expect(page.getByRole("button", { name: "حفظ العرض", exact: true })).toBeEnabled();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].method).toBe("PUT");
    expect(state.writes[0].body.code).toBe("SUMMER-HELD");
    state.holdWrite?.resolve();
    await expect(panel.getByRole("form", { name: "إنشاء كوبون" })).toBeVisible();
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "SUMMER-HELD" })).toHaveCount(1);
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "WINTER" })).toHaveCount(1);
    expect(state.writes).toHaveLength(1);
  } finally {
    state.holdWrite?.resolve();
  }
});

test("coupon create and update stay successful when the following list GET fails", async ({ page }) => {
  const state: CouponRouteState = {
    rows: [fixedCoupon("61000000-0000-4000-8000-0000000000c3", "KEEP50", 3)],
    writes: [], calls: [], holdWrite: null, holdList: null, failNextList: false, rejectNextWrite: true,
  };
  await installCouponRoutes(page, state);
  const gates: Array<ReturnType<typeof deferred>> = [];
  const retryList = async (panel: Locator) => {
    const gate = deferred();
    gates.push(gate);
    const posts = state.writes.filter((write) => write.method === "POST").length;
    const puts = state.writes.filter((write) => write.method === "PUT").length;
    state.holdList = gate;
    try {
      await panel.getByRole("button", { name: "إعادة تحميل الكوبونات", exact: true }).click();
      await expect(panel.getByRole("button", { name: "جارٍ تحديث القائمة…" })).toBeDisabled();
      expect(state.writes.filter((write) => write.method === "POST")).toHaveLength(posts);
      expect(state.writes.filter((write) => write.method === "PUT")).toHaveLength(puts);
      expect(state.calls.at(-1)).toBe("GET");
      gate.resolve();
      await expect(panel.getByRole("button", { name: "إعادة تحميل الكوبونات", exact: true })).toHaveCount(0);
    } finally {
      gate.resolve();
      state.holdList = null;
    }
  };
  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/offers`);
    const panel = page.getByRole("region", { name: "إدارة الكوبونات" });
    const form = panel.getByRole("form", { name: "إنشاء كوبون" });
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "KEEP50" })).toBeVisible();
    await form.getByLabel("كود الكوبون").fill("NEW50");
    await form.getByLabel("الخصم بالجنيه").fill("20");
    await form.getByLabel("حد الاستخدام").fill("2");
    await form.getByRole("button", { name: "حفظ الكوبون", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText("كود الكوبون غير مقبول");
    state.failNextList = true;
    await form.getByRole("button", { name: "حفظ الكوبون", exact: true }).click();
    await expect(panel.getByRole("status").filter({ hasText: "تم إنشاء الكوبون." })).toBeVisible();
    await expect(panel.getByRole("alert")).toContainText("تعذر تحديث قائمة الكوبونات.");
    await expect(panel.getByRole("alert")).toContainText("البيانات الظاهرة قديمة حتى تنجح إعادة التحميل.");
    await expect(panel.getByText("تعذر حفظ الكوبون.")).toHaveCount(0);
    await expect(panel.getByText("كود الكوبون غير مقبول")).toHaveCount(0);
    await expect(form.getByLabel("كود الكوبون")).toHaveValue("");
    await expect(form.getByLabel("كود الكوبون")).toBeEnabled();
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" })).toHaveCount(0);
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "KEEP50" }).getByRole("button", { name: "تعديل", exact: true })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "إعادة تحميل الكوبونات", exact: true })).toBeEnabled();
    expect(state.rows.map((row) => row.code)).toEqual(["KEEP50", "NEW50"]);
    expect(state.writes.filter((write) => write.method === "POST")).toHaveLength(2);
    expect(state.writes[1].body).toMatchObject({ code: "NEW50", usageLimit: 2, fixedDiscountPiasters: 2_000 });
    await retryList(panel);
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" })).toContainText("من 2");
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" }).getByRole("button", { name: "تعديل", exact: true })).toBeEnabled();
    expect(state.writes.filter((write) => write.method === "POST")).toHaveLength(2);
    await panel.getByTestId("coupon-row").filter({ hasText: "NEW50" }).getByRole("button", { name: "تعديل", exact: true }).click();
    const editing = panel.getByRole("form", { name: "تعديل كوبون" });
    await editing.getByLabel("حد الاستخدام").fill("6");
    state.failNextList = true;
    await editing.getByRole("button", { name: "حفظ الكوبون", exact: true }).click();
    await expect(panel.getByRole("status").filter({ hasText: "تم تحديث الكوبون." })).toBeVisible();
    await expect(panel.getByRole("alert")).toContainText("تعذر تحديث قائمة الكوبونات.");
    await expect(panel.getByText("تعذر حفظ الكوبون.")).toHaveCount(0);
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" })).toContainText("من 2");
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" }).getByRole("button", { name: "تعديل", exact: true })).toBeDisabled();
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "KEEP50" }).getByRole("button", { name: "تعديل", exact: true })).toBeDisabled();
    expect(state.writes.filter((write) => write.method === "PUT")).toHaveLength(1);
    expect(state.writes.at(-1)?.body).toMatchObject({ code: "NEW50", usageLimit: 6, fixedDiscountPiasters: 2_000 });
    await retryList(panel);
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" })).toContainText("من 6");
    await expect(panel.getByTestId("coupon-row").filter({ hasText: "NEW50" }).getByRole("button", { name: "تعديل", exact: true })).toBeEnabled();
    expect(state.writes.filter((write) => write.method === "POST")).toHaveLength(2);
    expect(state.writes.filter((write) => write.method === "PUT")).toHaveLength(1);
  } finally {
    for (const gate of gates) gate.resolve();
  }
});

test("branch sales hide the empty message on a failed read and show it after a held GET retry", async ({ page }) => {
  const methods: string[] = [];
  const reload = deferred();
  let failList = true;
  await signIn(page, "owner", "e2e-owner-pass");
  await page.route((url) => url.pathname === "/api/internal/sales", async (route) => {
    const method = route.request().method();
    methods.push(method);
    if (method !== "GET") {
      await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: method } } });
      return;
    }
    if (failList) {
      await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: "تعذر تحميل المبيعات." } } });
      return;
    }
    await reload.promise;
    await route.fulfill({ status: 200, json: [] });
  });
  await page.route((url) => url.pathname === "/api/internal/online-orders", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto(`${BASE}/sales`);
    await expect(page.getByRole("alert")).toContainText("تعذر تحميل المبيعات.");
    await expect(page.getByText("مفيش مبيعات تظهر")).toHaveCount(0);
    failList = false;
    await page.getByRole("button", { name: "إعادة تحميل المبيعات" }).click();
    await expect(page.getByRole("status").filter({ hasText: "جارٍ تحميل المبيعات…" })).toBeVisible();
    await expect(page.getByText("مفيش مبيعات تظهر")).toHaveCount(0);
    expect(methods.every((method) => method === "GET")).toBe(true);
    reload.resolve();
    await expect(page.getByText("مفيش مبيعات تظهر")).toBeVisible();
    expect(methods.filter((method) => method !== "GET")).toEqual([]);
    expect(methods.length).toBeGreaterThanOrEqual(2);
  } finally {
    reload.resolve();
  }
});

function percentageOffer(id: string, nameAr: string, active: boolean): AutomaticOfferDto {
  return {
    id,
    nameAr,
    discountType: "percentage",
    percentageBasisPoints: 1000,
    fixedDiscountPiasters: null,
    bundlePricePiasters: null,
    bundleItems: [],
    buyQuantity: null,
    rewardQuantity: null,
    rewardPercentageBasisPoints: null,
    buyProductIds: [],
    buyCategoryIds: [],
    rewardProductIds: [],
    rewardCategoryIds: [],
    startsOn: "2026-10-22",
    endsOn: "2026-10-22",
    active,
    allowCoupon: true,
    productIds: [],
    categoryIds: [],
    createdByStaffId: "61000000-0000-4000-8000-000000000099",
    updatedByStaffId: "61000000-0000-4000-8000-000000000099",
    createdAt: "2026-10-22T08:00:00.000Z",
    updatedAt: "2026-10-22T08:00:00.000Z",
  };
}

async function installOfferRoutes(page: Page, state: {
  rows: AutomaticOfferDto[];
  writes: Array<{ method: string; nameAr: string; active?: boolean }>;
  holdWrite: ReturnType<typeof deferred> | null;
}) {
  await page.route(/\/api\/internal\/pricing\/coupons(?:\/[^/?]+)?(?:\?.*)?$/, fulfillCoupons);
  await page.route(/\/api\/internal\/pricing\/offers(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    if (method === "GET" && path === "/api/internal/pricing/offers") {
      await route.fulfill({ json: state.rows });
      return;
    }
    if (method === "PUT" && path.startsWith("/api/internal/pricing/offers/")) {
      const body = route.request().postDataJSON() as AutomaticOfferDto;
      state.writes.push({ method, nameAr: body.nameAr, active: body.active });
      if (state.holdWrite) await state.holdWrite.promise;
      const id = decodeURIComponent(path.slice("/api/internal/pricing/offers/".length));
      state.rows = state.rows.map((row) => row.id === id ? { ...row, ...body, id: row.id } : row);
      await route.fulfill({ json: state.rows.find((row) => row.id === id) });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
}

type OfferEditRouteState = {
  rows: AutomaticOfferDto[];
  writes: AutomaticOfferWriteDto[];
  calls: string[];
  failNextList: boolean;
  holdList: ReturnType<typeof deferred> | null;
};

type CouponRouteState = {
  rows: CouponDto[];
  writes: Array<{ method: string; body: CouponWriteDto }>;
  calls: string[];
  holdWrite: ReturnType<typeof deferred> | null;
  holdList: ReturnType<typeof deferred> | null;
  failNextList: boolean;
  rejectNextWrite: boolean;
};

function fixedCoupon(id: string, code: string, usageLimit = 3): CouponDto {
  return {
    id,
    code,
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: "2026-10-22",
    endsOn: "2026-12-31",
    active: true,
    allowAutomaticOffer: true,
    usageLimit,
    usedCount: 0,
    productIds: [],
    categoryIds: [],
    createdByStaffId: "61000000-0000-4000-8000-000000000099",
    updatedByStaffId: "61000000-0000-4000-8000-000000000099",
    createdAt: "2026-10-22T08:00:00.000Z",
    updatedAt: "2026-10-22T08:00:00.000Z",
  };
}

async function installStaleOfferEditRoutes(page: Page, state: OfferEditRouteState) {
  await page.route(/\/api\/internal\/pricing\/coupons(?:\/[^/?]+)?(?:\?.*)?$/, fulfillCoupons);
  await page.route(/\/api\/internal\/pricing\/offers(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    if (method === "GET" && path === "/api/internal/pricing/offers") {
      state.calls.push("GET");
      if (state.failNextList) {
        state.failNextList = false;
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: "الخدمة غير متاحة" } } });
        return;
      }
      if (state.holdList) await state.holdList.promise;
      await route.fulfill({ json: state.rows });
      return;
    }
    if (method === "PUT" && path.startsWith("/api/internal/pricing/offers/")) {
      state.calls.push("PUT");
      const body = route.request().postDataJSON() as AutomaticOfferWriteDto;
      state.writes.push(body);
      const id = decodeURIComponent(path.slice("/api/internal/pricing/offers/".length));
      state.rows = state.rows.map((row) => row.id === id ? { ...row, ...body, id: row.id } : row);
      await route.fulfill({ json: state.rows.find((row) => row.id === id) });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
}

async function installCouponRoutes(page: Page, state: CouponRouteState) {
  await page.route(/\/api\/internal\/pricing\/offers(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const path = pathname(route.request().url());
    if (route.request().method() === "GET" && path === "/api/internal/pricing/offers") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: path } } });
  });
  await page.route(/\/api\/internal\/pricing\/coupons(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
    const path = pathname(route.request().url());
    const method = route.request().method();
    if (method === "GET" && path === "/api/internal/pricing/coupons") {
      state.calls.push("GET");
      if (state.failNextList) {
        state.failNextList = false;
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: "الخدمة غير متاحة" } } });
        return;
      }
      if (state.holdList) await state.holdList.promise;
      await route.fulfill({ json: state.rows });
      return;
    }
    if ((method === "POST" && path === "/api/internal/pricing/coupons") || (method === "PUT" && path.startsWith("/api/internal/pricing/coupons/"))) {
      state.calls.push(method);
      const body = route.request().postDataJSON() as CouponWriteDto;
      state.writes.push({ method, body });
      if (state.rejectNextWrite) {
        state.rejectNextWrite = false;
        await route.fulfill({ status: 400, json: { error: { code: "REJECTED", messageAr: "كود الكوبون غير مقبول" } } });
        return;
      }
      if (state.holdWrite) await state.holdWrite.promise;
      if (method === "POST") {
        const created: CouponDto = {
          ...fixedCoupon("61000000-0000-4000-8000-0000000000c4", body.code),
          ...body,
          id: "61000000-0000-4000-8000-0000000000c4",
          usedCount: 0,
        };
        state.rows = [...state.rows, created];
        await route.fulfill({ status: 201, json: created });
        return;
      }
      const id = decodeURIComponent(path.slice("/api/internal/pricing/coupons/".length));
      state.rows = state.rows.map((row) => row.id === id ? { ...row, ...body, id: row.id } : row);
      await route.fulfill({ json: state.rows.find((row) => row.id === id) });
      return;
    }
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: `${method} ${path}` } } });
  });
}

function fulfillCoupons(route: Route) {
  const path = pathname(route.request().url());
  if (route.request().method() === "GET" && path === "/api/internal/pricing/coupons") {
    return route.fulfill({ json: [] });
  }
  return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: path } } });
}

function listedOrder(reference: string, status: string, confirmedAt: string | null, branchId: string, requestedFinalTotalPiasters: number, confirmedFinalTotalPiasters: number | null) {
  return {
    id: reference,
    reference,
    customerName: "عميل التجربة",
    fulfillmentBranchId: branchId,
    status,
    confirmedAt,
    requestedFinalTotalPiasters,
    confirmedQuote: confirmedFinalTotalPiasters === null ? null : { finalTotalPiasters: confirmedFinalTotalPiasters },
  };
}

function pathname(url: string) {
  return new URL(url).pathname;
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function signIn(page: Page, loginName: string, password: string, choose = true) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  if (choose) {
    await page.getByRole("button", { name: "أبشواي", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  }
}
