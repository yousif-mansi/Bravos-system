import { expect, test, type Page, type Route } from "@playwright/test";

const BASE = "http://127.0.0.1:5174";
const READ_ERROR = "تعذر قراءة حالة الاستعادة.";

test("failed restore-state read stays until explicit refresh, which keeps the upload draft", async ({ page }) => {
  const mutations: string[] = [];
  let failState = true;
  const heldStates: Route[] = [];
  let releaseHeld: () => void = () => {};
  const stateHeld = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const stateMatched = deferred();

  await page.route("**/api/internal/restore/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== "GET") {
      mutations.push(`${method} ${path}`);
      await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: "طلب غير متوقع" } } });
      return;
    }
    if (path === "/api/internal/restore/pause") {
      await route.fulfill({ json: { currentGeneration: 1, pause: null } });
      return;
    }
    if (path === "/api/internal/restore/state") {
      if (failState) {
        await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", messageAr: READ_ERROR } } });
        return;
      }
      heldStates.push(route);
      if (heldStates.length === 1) stateMatched.resolve();
      await stateHeld;
      await route.fulfill({ json: { currentGeneration: 1, pause: null } });
      return;
    }
    if (path === "/api/internal/restore/previews") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/internal/sales/restore-deferred", async (route) => {
    const method = route.request().method();
    if (method !== "GET") {
      mutations.push(`${method} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED", messageAr: "طلب غير متوقع" } } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  try {
    await signIn(page, "owner", "e2e-owner-pass");
    await page.goto(`${BASE}/restore`);
    await expect(page.getByRole("alert")).toHaveText(READ_ERROR);
    const refresh = page.getByRole("button", { name: "تحديث الحالة", exact: true });
    await expect(refresh).toBeVisible();
    await expect(refresh).toBeEnabled();
    await page.getByLabel("كلمة حماية النسخة المرفوعة", { exact: true }).fill("draft-archive-password");
    await page.getByLabel("كلمة حماية نسخة البيانات الحالية", { exact: true }).fill("draft-checkpoint-password");
    await page.getByLabel("تأكيد كلمة حماية نسخة البيانات الحالية", { exact: true }).fill("draft-checkpoint-password");

    failState = false;
    await refresh.click();
    await stateMatched.promise;
    await expect(page.getByRole("button", { name: "جارٍ تحديث الحالة…", exact: true })).toBeDisabled();
    releaseHeld();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("كلمة حماية النسخة المرفوعة", { exact: true })).toHaveValue("draft-archive-password");
    await expect(page.getByLabel("كلمة حماية نسخة البيانات الحالية", { exact: true })).toHaveValue("draft-checkpoint-password");
    await expect(page.getByLabel("تأكيد كلمة حماية نسخة البيانات الحالية", { exact: true })).toHaveValue("draft-checkpoint-password");
    await expect(page.getByRole("button", { name: "تحديث الحالة", exact: true })).toBeEnabled();
    expect(mutations).toEqual([]);
  } finally {
    releaseHeld();
  }
});

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول", exact: true }).click();
  await expect(page.getByRole("heading", { name: "اختيار الفرع النشط" })).toBeVisible();
  await page.getByRole("button", { name: "أبشواي" }).click();
}
