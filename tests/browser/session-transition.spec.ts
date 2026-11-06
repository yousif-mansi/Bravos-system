import { openPosOptionalDetails } from "./support/pos-checkout";
import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceDto } from "@bravos/contracts";
import type { OfflinePosServices } from "@bravos/sales/browser";

type LogoutRace = {
  started: boolean;
  finished: boolean;
  rememberAccepted?: boolean;
  generationBefore?: number;
  generationAfterRemember?: number;
  originalAccepted?: boolean;
  release?: () => void;
  restore: () => void;
};

declare global {
  interface Window {
    __bravosLogoutRace?: LogoutRace;
  }
}

test("explicit logout survives a same-account session refresh and preserves a completed queued sale", async ({ page }) => {
  const original = await queueOwnerSale(page);
  let signOutPosts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/sign-out" && request.method() === "POST") signOutPosts += 1;
  });
  await installLogoutRace(page, "refresh");
  try {
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect.poll(async () => (await raceProof(page)).finished).toBe(true);
    const proof = await raceProof(page);
    await test.info().attach("same-account-real-CAS-proof", {
      body: JSON.stringify(proof, null, 2), contentType: "application/json",
    });
    expect(proof.rememberAccepted).toBe(true);
    expect(proof.generationAfterRemember).toBe(proof.generationBefore);
    expect(proof.originalAccepted).toBe(false);
    await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
    await expect.poll(() => signOutPosts).toBe(1);
    const state = await readLocalState(page);
    expect(state.currentStaffId).toBeNull();
    expect(state.sessions.find((session) => session.staffId === original.staffId)?.signedOut).toBe(true);
    expect(state.sales.find((sale) => sale.id === original.id)).toEqual(original);
    expect(state.sales.find((sale) => sale.id === original.id)?.syncStatus).toBe("pending");
    expect(state.sales.find((sale) => sale.id === original.id)?.physicallyCompleted).toBe(true);
    const server = await staffApi(page, "GET", "/api/internal/workspace");
    expect(server.status).toBe(401);
  } finally {
    await restoreLogoutRace(page);
  }
});

test("a delayed old-account logout cannot sign out a newer real cashier login in another tab", async ({ page, context }) => {
  const original = await queueOwnerSale(page);
  const phase = { name: "queued-owner-sale", proof: null as Awaited<ReturnType<typeof raceProof>> | null };
  async function enter(name: string) {
    phase.name = name;
    if (page.isClosed()) return;
    try {
      phase.proof = await raceProof(page);
    } catch {
      /* proof is best-effort and must not replace the phase error */
    }
  }
  let oldSignOutPosts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/sign-out" && request.method() === "POST") oldSignOutPosts += 1;
  });
  await installLogoutRace(page, "hold");
  await enter("logout-hold-installed");
  const newer = await context.newPage();
  try {
    const logoutButton = page.getByRole("button", { name: "تسجيل الخروج" });
    await expect(logoutButton, "old tab still shows explicit logout before the held sign-out starts").toBeVisible();
    await logoutButton.click();
    await expect.poll(
      async () => (await raceProof(page)).started,
      { message: "held markSignedOut must start before the server cookie is expired" },
    ).toBe(true);
    await enter("old-logout-held");
    // Expire only the server cookie so the other tab can perform a real fresh login.
    // The first tab already owns its in-flight held logout against the cached workspace.
    // Expiring first can let a 401 workspace clear unmount AppShell before the
    // click reaches markSignedOut. Establish the intended held operation first.
    const expired = await staffApi(page, "POST", "/api/auth/sign-out", {});
    expect(expired.status).toBe(200);
    await enter("server-cookie-expired-after-hold");
    await newer.goto("http://127.0.0.1:5174/login");
    await signIn(newer, "cashier-b", "e2e-cashier-b-pass");
    await expect(newer.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await enter("newer-cashier-offline-ready");
    const workspace = await staffApi(newer, "GET", "/api/internal/workspace");
    const staffId = workspace.body.staff.id as string;
    expect(workspace.body.staff.displayName).toBe("كاشير ثان");
    expect(staffId).not.toBe(original.staffId);
    await expect.poll(async () => (await readLocalState(newer)).currentStaffId).toBe(staffId);
    await expect.poll(async () => {
      const accountPath = "/src/account-session.ts";
      return page.evaluate(async (path) => {
        const account = await import(path) as { accountGeneration: () => number };
        return account.accountGeneration();
      }, accountPath);
    }).toBeGreaterThan((await raceProof(page)).generationBefore!);
    await enter("newer-account-generation-advanced");
    const beforeRelease = await readLocalState(newer);
    await page.evaluate(() => window.__bravosLogoutRace?.release?.());
    await expect.poll(async () => (await raceProof(page)).finished).toBe(true);
    const proof = await raceProof(page);
    await enter("old-logout-finished");
    await test.info().attach("newer-account-real-CAS-proof", {
      body: JSON.stringify(proof, null, 2), contentType: "application/json",
    });
    expect(proof.originalAccepted).toBe(false);
    expect(oldSignOutPosts).toBe(0);
    await expect(newer.getByTestId("active-branch")).toContainText("أبشواي");
    await expect(newer.getByTestId("unsynced-count")).toContainText("مبيعات غير مزامنة: 0");
    await expect(newer.getByTestId("foreign-queue")).toHaveCount(0);
    const after = await readLocalState(newer);
    expect(after.currentStaffId).toBe(staffId);
    expect(after.sessions.find((session) => session.staffId === staffId)?.signedOut).toBe(false);
    expect(after.snapshots.filter((snapshot) => snapshot.staffId === staffId))
      .toEqual(beforeRelease.snapshots.filter((snapshot) => snapshot.staffId === staffId));
    expect(after.sales.find((sale) => sale.id === original.id)).toEqual(original);
    expect(JSON.stringify(after.snapshots.filter((snapshot) => snapshot.staffId === staffId)))
      .not.toContain("01055557777");
    expect(JSON.parse(await newer.evaluate(() => localStorage.getItem("bravos.account") ?? "{}")).staffId).toBe(staffId);
    const server = await staffApi(newer, "GET", "/api/internal/workspace");
    expect(server.status).toBe(200);
    expect(server.body.staff.id).toBe(staffId);
  } catch (error) {
    await test.info().attach("logout-race-phase", {
      body: JSON.stringify({ phase: phase.name, oldSignOutPosts, proof: phase.proof }, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await restoreLogoutRace(page);
    if (!newer.isClosed()) await newer.close();
  }
});

async function installLogoutRace(page: Page, mode: "refresh" | "hold") {
  await page.evaluate(async (nextMode) => {
    const posPath = "/src/pos.ts";
    const accountPath = "/src/account-session.ts";
    const { pos } = await import(posPath) as { pos: OfflinePosServices };
    const { accountGeneration } = await import(accountPath) as { accountGeneration: () => number };
    const workspace = await pos.loadSignedInWorkspace();
    if (!workspace) throw new Error("missing current real workspace");
    const original = pos.markSignedOut;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const race: LogoutRace = {
      started: false, finished: false, release,
      restore: () => { pos.markSignedOut = original; release(); },
    };
    window.__bravosLogoutRace = race;
    pos.markSignedOut = async (staffId, transition) => {
      if (race.started) return original.call(pos, staffId, transition);
      race.started = true;
      race.generationBefore = accountGeneration();
      if (!transition) throw new Error("logout did not provide its real CAS transition");
      if (nextMode === "refresh") {
        // Commit through the production public service, then forward the original
        // transition unchanged. Its false result comes from the actual database CAS.
        race.rememberAccepted = await pos.rememberSession(workspace, {
          expectedRevision: transition.expectedRevision, revision: crypto.randomUUID(),
        });
        race.generationAfterRemember = accountGeneration();
      } else {
        await held;
      }
      const accepted = await original.call(pos, staffId, transition);
      race.originalAccepted = accepted;
      race.finished = true;
      return accepted;
    };
  }, mode);
}

async function raceProof(page: Page) {
  return page.evaluate(() => {
    const race = window.__bravosLogoutRace;
    if (!race) throw new Error("missing race proof");
    return {
      started: race.started, finished: race.finished, rememberAccepted: race.rememberAccepted,
      generationBefore: race.generationBefore, generationAfterRemember: race.generationAfterRemember,
      originalAccepted: race.originalAccepted,
    };
  });
}

async function restoreLogoutRace(page: Page) {
  if (page.isClosed()) return;
  try {
    await page.evaluate(() => { window.__bravosLogoutRace?.restore(); delete window.__bravosLogoutRace; });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (page.isClosed() || /Target page, context or browser has been closed|Execution context was destroyed|Target closed/i.test(message)) {
      return;
    }
    throw error;
  }
}

async function queueOwnerSale(page: Page) {
  await page.goto("http://127.0.0.1:5174/login");
  await signIn(page, "owner", "e2e-owner-pass");
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const code = `LOGOUT-${crypto.randomUUID().slice(0, 8)}`;
  const category = await staffApi(page, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await staffApi(page, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${code}` });
  const color = await staffApi(page, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${code}` });
  const product = await staffApi(page, "POST", "/api/internal/catalog/products", {
    code, nameAr: `منتج ${code}`, descriptionAr: "قطن", categoryId: category.body.id,
    defaultSellingPricePiasters: 21000, publication: "hidden", imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  await stockAtBranch(page, product.body.id, 2, 4000);
  // Re-enter workspace to issue a snapshot containing the newly received variant.
  await page.reload();
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "البحث عن منتج" }).click();
  await page.route("**/api/internal/sales/prepare", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales", (route) => route.abort("failed"));
  await page.route("**/api/internal/sales/accepted", (route) => route.abort("failed"));
  const lookup = page.getByRole("form", { name: "البحث برمز المنتج" });
  await lookup.getByRole("textbox", { name: "رمز المنتج" }).fill(code);
  await lookup.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByTestId("lookup-result")).toContainText(code);
  await page.getByTestId("add-operational").click();
  const checkout = page.getByRole("form", { name: "إتمام البيع" });
  await openPosOptionalDetails(checkout);
  await checkout.getByLabel("اسم الزبون (اختياري)").fill("زبون جلسة محفوظ");
  await checkout.getByLabel("هاتف الزبون (اختياري)").fill("01055557777");
  await checkout.getByRole("button", { name: "إتمام البيع" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ البيع.");
  const state = await readLocalState(page);
  expect(state.sales).toHaveLength(1);
  const original = state.sales[0]!;
  expect(original.staffId).toBe(workspace.body.staff.id);
  expect(original.physicallyCompleted).toBe(true);
  expect(original.syncStatus).toBe("pending");
  expect(original.finalTotalPiasters).toBe(21000);
  return original;
}

async function signIn(page: Page, loginName: string, password: string) {
  await page.getByLabel("اسم الدخول").fill(loginName);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.getByRole("button", { name: "أبشواي" }).click();
  await expect(page.getByTestId("active-branch")).toContainText("أبشواي");
}

async function readLocalState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("bravos-pos");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    async function all<T>(name: string): Promise<T[]> {
      return new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    }
    const sessions = await all<{ staffId: string; signedOut: boolean; workspace: WorkspaceDto }>("sessions");
    const sales = await all<Record<string, unknown> & {
      id: string; staffId: string; syncStatus: string; physicallyCompleted: boolean; finalTotalPiasters: number;
    }>("sales");
    const snapshots = await all<{ staffId: string; snapshot: unknown }>("snapshots");
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    return { sessions, sales, snapshots, currentStaffId: meta.find((row) => row.key === "currentStaffId")?.value ?? null };
  });
}

async function stockAtBranch(page: import("@playwright/test").Page, productId: string, quantity: number, unitCostPiasters: number) {
  const warehouse = "33333333-3333-4333-8333-333333333333";
  const workspace = await staffApi(page, "GET", "/api/internal/workspace");
  const receipt = await staffApi(page, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: warehouse, receiptDate: "2026-09-11",
    lines: [{ productId, quantity, unitCostPiasters }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  const transfer = await staffApi(page, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(), sourceBranchId: warehouse,
    destinationBranchId: workspace.body.activeBranch.id, productId, quantity,
  });
  expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
}

async function staffApi(page: Page, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await page.request.fetch(`http://127.0.0.1:5174${url}`, {
    method, headers: { origin: "http://127.0.0.1:5174", ...(payload ? { "content-type": "application/json" } : {}) },
    data: payload,
  });
  return { status: response.status(), body: await response.json() };
}
