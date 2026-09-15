import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => { cluster = await startPostgresCluster({ port: 55445 }); }, 120_000);
afterAll(async () => { if (built) await built.close(); await cluster.stop(); });
beforeEach(async () => { await startApp(); });

test("employee expense is server-attributed to the active authorized branch and immediately visible in totals", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "كهرباء" });
  expect(category.status).toBe(201);
  await createEmployee(manager, "ahmed", "أحمد", [abshwayId, fayoumId]);
  await createEmployee(manager, "mona", "منى", [abshwayId]);
  const ahmed = await signIn("ahmed", "staff-pass-1");
  const mona = await signIn("mona", "staff-pass-1");
  await selectBranch(ahmed, abshwayId);
  await selectBranch(mona, abshwayId);

  const forged = await api(ahmed, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 50000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "فاتورة الفرع", branchId: fayoumId, createdByStaffId: "forged",
  });
  expect(forged.status).toBe(400);

  const operationId = crypto.randomUUID();
  const payload = {
    operationId, amountPiasters: 50000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "فاتورة الفرع",
  };
  const created = await api(ahmed, "POST", "/api/internal/expenses", payload);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    operationId, branch: { id: abshwayId, code: "abshway" }, createdByDisplayName: "أحمد",
    revision: 0, status: "active", original: { amountPiasters: 50000, expenseDate: "2026-09-14" },
    effective: { amountPiasters: 50000 }, changes: [],
  });
  const replay = await api(ahmed, "POST", "/api/internal/expenses", payload);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(created.body.id);
  const changedRetry = await api(ahmed, "POST", "/api/internal/expenses", { ...payload, description: "بيانات مختلفة" });
  expect(changedRetry.status).toBe(409);
  const forbiddenChange = await api(ahmed, "POST", `/api/internal/expenses/${created.body.id}/changes`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "محاولة موظف",
  });
  expect(forbiddenChange.status).toBe(403);

  const own = await api(ahmed, "GET", "/api/internal/expenses");
  expect(own.body).toHaveLength(1);
  expect((await api(ahmed, "GET", "/api/internal/expenses/totals")).body).toMatchObject({
    totalPiasters: 50000, activeExpenseCount: 1,
  });
  expect((await api(mona, "GET", "/api/internal/expenses")).body).toEqual([]);
  expect((await api(mona, "GET", `/api/internal/expenses/${created.body.id}`)).status).toBe(404);
  await selectBranch(manager, fayoumId);
  const managerExpense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 1000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "مصروف الفيوم",
  });
  expect(managerExpense.body.branch.code).toBe("fayoum");
  const all = await api(manager, "GET", "/api/internal/expenses");
  expect(all.body).toHaveLength(2);
  const managerTotals = await api(manager, "GET", "/api/internal/expenses/totals");
  expect(managerTotals.body).toMatchObject({ totalPiasters: 51000, activeExpenseCount: 2 });
  expect(managerTotals.body.byBranch).toEqual(expect.arrayContaining([
    expect.objectContaining({ branch: expect.objectContaining({ code: "abshway" }), totalPiasters: 50000 }),
    expect.objectContaining({ branch: expect.objectContaining({ code: "fayoum" }), totalPiasters: 1000 }),
  ]));
});

test("500 EGP corrected to 50 preserves original history and contributes 50 exactly once", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "صيانة" });
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 50000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "إصلاح باب",
  });
  expect((await api(manager, "PATCH", `/api/internal/expense-categories/${category.body.id}`, {
    nameAr: "صيانة عامة", active: true,
  })).status).toBe(200);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId, expectedRevision: 0, type: "correction", reason: "خطأ في القيمة",
    amountPiasters: 5000, expenseDate: "2026-09-14", categoryId: category.body.id, description: "إصلاح باب",
  };
  const corrected = await api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, payload);
  expect(corrected.status).toBe(201);
  expect(corrected.body).toMatchObject({
    revision: 1, status: "active",
    original: { amountPiasters: 50000, category: { nameAr: "صيانة" } },
    effective: { amountPiasters: 5000, category: { nameAr: "صيانة عامة" } },
    changes: [{
      operationId, type: "correction", revision: 1, reason: "خطأ في القيمة",
      previous: { amountPiasters: 50000, category: { nameAr: "صيانة" } },
      effective: { amountPiasters: 5000, category: { nameAr: "صيانة عامة" } },
    }],
  });
  const replay = await api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(corrected.body);
  const changedPayload = await api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, { ...payload, amountPiasters: 4000 });
  expect(changedPayload.status).toBe(409);
  expect(changedPayload.body.error.code).toBe("CONFLICT");
  expect((await api(manager, "GET", "/api/internal/expenses/totals")).body).toMatchObject({ totalPiasters: 5000, activeExpenseCount: 1 });
  const byOperation = await api(manager, "GET", `/api/internal/expenses/operations/${operationId}`);
  expect(byOperation.body.id).toBe(expense.body.id);
  expect(byOperation.body.changes).toHaveLength(1);

  const cancelled = await api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "cancellation", reason: "المصروف لم يحدث",
  });
  expect(cancelled.status).toBe(201);
  expect(cancelled.body).toMatchObject({ revision: 2, status: "cancelled", effective: null });
  expect(cancelled.body.original.amountPiasters).toBe(50000);
  expect(cancelled.body.changes).toHaveLength(2);
  expect((await api(manager, "GET", "/api/internal/expenses/totals")).body).toMatchObject({ totalPiasters: 0, activeExpenseCount: 0 });

  const createReplayAfterCancellation = await api(manager, "POST", "/api/internal/expenses", {
    operationId: expense.body.operationId,
    amountPiasters: 50000,
    expenseDate: "2026-09-14",
    categoryId: category.body.id,
    description: "إصلاح باب",
  });
  expect(createReplayAfterCancellation.status).toBe(200);
  expect(createReplayAfterCancellation.body).toEqual(expense.body);

  const correctionReplayAfterCancellation = await api(
    manager,
    "POST",
    `/api/internal/expenses/${expense.body.id}/changes`,
    payload,
  );
  expect(correctionReplayAfterCancellation.status).toBe(200);
  expect(correctionReplayAfterCancellation.body).toEqual(corrected.body);
  expect((await api(manager, "GET", `/api/internal/expenses/operations/${operationId}`)).body).toEqual(corrected.body);
});

test("concurrent manager corrections from one revision accept one result and reject the stale one", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, fayoumId);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "نقل" });
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 50000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "نقل بضائع",
  });
  const correction = (amountPiasters: number) => api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "مراجعة متزامنة",
    amountPiasters, expenseDate: "2026-09-14", categoryId: category.body.id, description: "نقل بضائع",
  });
  const [first, second] = await Promise.all([correction(5000), correction(7000)]);
  expect([first.status, second.status].sort()).toEqual([201, 409]);
  const winner = first.status === 201 ? first.body.effective.amountPiasters : second.body.effective.amountPiasters;
  expect([5000, 7000]).toContain(winner);
  const detail = await api(manager, "GET", `/api/internal/expenses/${expense.body.id}`);
  expect(detail.body.revision).toBe(1);
  expect(detail.body.changes).toHaveLength(1);
  expect(detail.body.effective.amountPiasters).toBe(winner);
  expect((await api(manager, "GET", "/api/internal/expenses/totals")).body.totalPiasters).toBe(winner);
});

test("concurrent detail reads keep effective revision and append-only history coherent", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "تشغيل" });
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 10000, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "مصروف متغير",
  });

  let revision = 0;
  const observed = [expense.body];
  for (let step = 1; step <= 8; step += 1) {
    const correction = api(manager, "POST", `/api/internal/expenses/${expense.body.id}/changes`, {
      operationId: crypto.randomUUID(), expectedRevision: revision, type: "correction", reason: `مراجعة ${step}`,
      amountPiasters: 10000 + step, expenseDate: "2026-09-14", categoryId: category.body.id,
      description: `مصروف متغير ${step}`,
    });
    const readers = Array.from({ length: 12 }, () =>
      api(manager, "GET", `/api/internal/expenses/${expense.body.id}`),
    );
    const [changed, ...reads] = await Promise.all([correction, ...readers]);
    expect(changed.status).toBe(201);
    revision += 1;
    observed.push(changed.body, ...reads.map((item) => item.body));
  }

  for (const detail of observed) {
    expect(detail.changes).toHaveLength(detail.revision);
    expect(detail.changes.map((change: { revision: number }) => change.revision)).toEqual(
      Array.from({ length: detail.revision }, (_, index) => index + 1),
    );
    expect(detail.effective.amountPiasters).toBe(10000 + detail.revision);
  }
});

test("categories are manager editable while employees receive active categories only and cannot correct", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await selectBranch(manager, abshwayId);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "مياه" });
  expect((await api(manager, "PATCH", `/api/internal/expense-categories/${category.body.id}`, { nameAr: "مياه الفرع", active: false })).status).toBe(200);
  await createEmployee(manager, "cashier", "كاشير", [abshwayId]);
  const employee = await signIn("cashier", "staff-pass-1");
  await selectBranch(employee, abshwayId);
  expect((await api(employee, "GET", "/api/internal/expense-categories")).body).toEqual([]);
  expect((await api(employee, "POST", "/api/internal/expense-categories", { nameAr: "اختراق" })).status).toBe(403);
  expect((await api(employee, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 100, expenseDate: "2026-02-30",
    categoryId: category.body.id, description: "غير صالح",
  })).status).toBe(400);
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(), amountPiasters: 100, expenseDate: "2026-09-14",
    categoryId: category.body.id, description: "غير متاح",
  });
  expect(expense.status).toBe(400);
});

async function startApp() {
  if (built) await built.close();
  const databaseName = `bravos_expenses_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  built = await buildApp({
    nodeEnv: "test", databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32", authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN, publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"], secureCookies: false,
    ownerRecoveryAdapter: "local-outbox", ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-expense-outbox-")),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch ORDER BY code");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
}

async function createEmployee(manager: CookieSession, loginName: string, displayName: string, branches: string[]) {
  const result = await api(manager, "POST", "/api/internal/staff", {
    loginName, displayName, password: "staff-pass-1",
    grants: branches.map((branchId) => ({ branchId, cashier: true, orderRepresentative: false })),
  });
  expect(result.status).toBe(201);
}

async function selectBranch(session: CookieSession, branchId: string) {
  expect((await api(session, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
}

type CookieSession = { cookie: string };
async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST", url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" }, payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

async function api(session: CookieSession | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await built.app.inject({ method, url, headers: {
    origin: INTERNAL_ORIGIN, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}),
  }, payload });
  return { status: response.statusCode, body: safeJson(response.body) };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

function safeJson(body: string) {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}
