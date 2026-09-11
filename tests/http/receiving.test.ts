import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let databaseName = "bravos_receiving_1";
let outboxDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55440 });
}, 120_000);

afterAll(async () => {
  if (built) {
    await built.close();
  }
  await cluster.stop();
});

beforeEach(async () => {
  await startApp();
});

test("manager receiving of 10 at 100 EGP then 10 at 140 EGP keeps two central batches", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();

  const first = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 10000 }],
  });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    operationId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 10000 }],
  });
  expect(first.body.id).toEqual(expect.any(String));
  expect(first.body.lines[0].batchId).toEqual(expect.any(String));
  expect(JSON.stringify(first.body)).not.toMatch(/abshway|fayoum|branch/i);

  const second = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 14000 }],
  });
  expect(second.status).toBe(201);
  expect(second.body.lines[0].batchId).not.toBe(first.body.lines[0].batchId);
  expect(second.body.lines[0].unitCostPiasters).toBe(14000);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  expect(batches.body).toHaveLength(2);
  expect(batches.body.map((batch: { unitCostPiasters: number }) => batch.unitCostPiasters).sort((a: number, b: number) => a - b)).toEqual([
    10000, 14000,
  ]);
  expect(batches.body.every((batch: { remainingQuantity: number; receivedQuantity: number }) => batch.remainingQuantity === 10 && batch.receivedQuantity === 10)).toBe(true);
  expect(batches.body[0].recordedAt <= batches.body[1].recordedAt).toBe(true);
  const average = (10000 + 14000) / 2;
  expect(batches.body.some((batch: { unitCostPiasters: number }) => batch.unitCostPiasters === average)).toBe(false);
  expect(JSON.stringify(batches.body)).not.toMatch(/abshway|fayoum|branchPrice|inventoryValue|profit/i);

  const listed = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(listed.status).toBe(200);
  expect(listed.body).toHaveLength(2);
  const details = await api(manager, "GET", `/api/internal/receiving/receipts/${first.body.id}`);
  expect(details.status).toBe(200);
  expect(details.body.lines[0]).toMatchObject({
    quantity: 10,
    unitCostPiasters: 10000,
    batchId: first.body.lines[0].batchId,
  });
  const byOperation = await api(manager, "GET", `/api/internal/receiving/operations/${operationId}`);
  expect(byOperation.status).toBe(200);
  expect(byOperation.body.id).toBe(first.body.id);
  expect(byOperation.body.operationId).toBe(operationId);
});

test("identical receiving operation identity returns the original result and changed payload fails", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId,
    receiptDate: "2026-09-10",
    lines: [{ variantId: seed.variantId, quantity: 4, unitCostPiasters: 8000 }],
  };
  const created = await api(manager, "POST", "/api/internal/receiving/receipts", payload);
  expect(created.status).toBe(201);

  const replay = await api(manager, "POST", "/api/internal/receiving/receipts", payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(created.body);

  const reordered = await api(manager, "POST", "/api/internal/receiving/receipts", {
    receiptDate: "2026-09-10",
    operationId,
    lines: [{ unitCostPiasters: 8000, quantity: 4, variantId: seed.variantId }],
  });
  expect(reordered.status).toBe(200);
  expect(reordered.body.id).toBe(created.body.id);

  const changed = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    receiptDate: "2026-09-10",
    lines: [{ variantId: seed.variantId, quantity: 5, unitCostPiasters: 8000 }],
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe("CONFLICT");
  expect(changed.body.error.messageAr).toBe("تعذر إعادة تنفيذ العملية ببيانات مختلفة.");
  expect(changed.status).toBeLessThan(500);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0].receivedQuantity).toBe(4);
});

test("concurrent duplicate receiving identities keep one stock effect", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId,
    receiptDate: "2026-09-09",
    lines: [{ variantId: seed.variantId, quantity: 6, unitCostPiasters: 9000 }],
  };
  const [first, second] = await Promise.all([
    api(manager, "POST", "/api/internal/receiving/receipts", payload),
    api(manager, "POST", "/api/internal/receiving/receipts", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 201]);
  expect(first.body.id).toBe(second.body.id);
  expect(first.body.lines[0].batchId).toBe(second.body.lines[0].batchId);
  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.body).toHaveLength(1);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0].remainingQuantity).toBe(6);
});

test("a failing multi-line receiving operation rolls back receipt and stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const failed = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    receiptDate: "2026-09-11",
    lines: [
      { variantId: seed.variantId, quantity: 8, unitCostPiasters: 7000 },
      {
        variantId: "99999999-9999-4999-8999-999999999999",
        quantity: 3,
        unitCostPiasters: 7000,
      },
    ],
  });
  expect(failed.status).toBe(400);
  expect(failed.body.error.code).toBe("VALIDATION");
  expect(failed.body.error.messageAr).toBe("المتغير المحدد غير موجود.");
  expect(failed.status).toBeLessThan(500);

  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(200);
  expect(receipts.body).toEqual([]);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toEqual([]);

  const retried = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 8, unitCostPiasters: 7000 }],
  });
  expect(retried.status).toBe(201);
  expect(retried.body.lines).toHaveLength(1);
  expect(retried.body.lines[0].quantity).toBe(8);
  const afterRetry = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(afterRetry.body).toHaveLength(1);
  expect(afterRetry.body[0].remainingQuantity).toBe(8);
});

test("low-stock uses persisted global default 3 and per-variant override", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager, { extraColor: true });
  const settings = await api(manager, "GET", "/api/internal/inventory/settings");
  expect(settings.status).toBe(200);
  expect(settings.body).toEqual({ lowStockThreshold: 3 });
  const unstocked = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(unstocked.status).toBe(200);
  expect(unstocked.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variantId: seed.variantId, availableQuantity: 0, threshold: 3, thresholdSource: "global" }),
      expect.objectContaining({ variantId: seed.secondVariantId, availableQuantity: 0, threshold: 3, thresholdSource: "global" }),
    ]),
  );

  await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [
      { variantId: seed.variantId, quantity: 3, unitCostPiasters: 5000 },
      { variantId: seed.secondVariantId, quantity: 4, unitCostPiasters: 5000 },
    ],
  });
  const initial = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(initial.status).toBe(200);
  expect(initial.body.map((item: { variantId: string }) => item.variantId)).toEqual([seed.variantId]);
  expect(initial.body[0]).toMatchObject({
    availableQuantity: 3,
    threshold: 3,
    thresholdSource: "global",
  });

  const raised = await api(manager, "PATCH", "/api/internal/inventory/settings", { lowStockThreshold: 4 });
  expect(raised.status).toBe(200);
  expect(raised.body).toEqual({ lowStockThreshold: 4 });
  const afterGlobal = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterGlobal.body.map((item: { variantId: string }) => item.variantId).sort()).toEqual(
    [seed.secondVariantId, seed.variantId].sort(),
  );

  const override = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${seed.variantId}/low-stock-threshold`,
    { lowStockThreshold: 2 },
  );
  expect(override.status).toBe(200);
  expect(override.body).toMatchObject({ variantId: seed.variantId, lowStockThreshold: 2 });
  const afterOverride = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterOverride.body).toHaveLength(1);
  expect(afterOverride.body[0]).toMatchObject({
    variantId: seed.secondVariantId,
    availableQuantity: 4,
    threshold: 4,
    thresholdSource: "global",
  });

  const persisted = await api(manager, "GET", "/api/internal/inventory/settings");
  expect(persisted.body.lowStockThreshold).toBe(4);

  const cleared = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${seed.variantId}/low-stock-threshold`,
    { lowStockThreshold: null },
  );
  expect(cleared.status).toBe(200);
  expect(cleared.body).toMatchObject({
    variantId: seed.variantId,
    lowStockThreshold: null,
  });
  expect(cleared.body.updatedByStaffId).toEqual(expect.any(String));
  expect(cleared.body.updatedAt).toEqual(expect.any(String));
  const afterClear = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterClear.body.map((item: { variantId: string }) => item.variantId).sort()).toEqual(
    [seed.secondVariantId, seed.variantId].sort(),
  );

  const zero = await api(manager, "PATCH", "/api/internal/inventory/settings", { lowStockThreshold: 0 });
  expect(zero.status).toBe(200);
  expect(zero.body).toEqual({ lowStockThreshold: 0 });
  const afterZero = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterZero.body).toEqual([]);
});

test("cashier lookup uses central availability and selling prices without cost data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 12, unitCostPiasters: 6500 }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.stock",
    displayName: "كاشير المخزون",
    password: "staff-pass-30",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const cashier = await signIn("cashier.stock", "staff-pass-30");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const found = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(found.status).toBe(200);
  expect(found.body.variants[0]).toEqual({
    id: seed.variantId,
    size: { id: seed.sizeId, nameAr: "L" },
    color: { id: seed.colorId, nameAr: "أسود" },
    sellingPricePiasters: 25000,
    availableQuantity: 12,
  });
  expect(JSON.stringify(found.body)).not.toMatch(/cost|profit|purchase|batch|inventoryValue|6500/i);
  expect(Object.keys(found.body).sort()).toEqual(["code", "descriptionAr", "id", "nameAr", "variants"]);

  const receipts = await api(cashier, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(403);
  expect(receipts.body.error.code).toBe("FORBIDDEN");
  expect(receipts.status).toBeLessThan(500);
  const batches = await api(cashier, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(403);
  expect(batches.body.error.code).toBe("FORBIDDEN");
  const settings = await api(cashier, "GET", "/api/internal/inventory/settings");
  expect(settings.status).toBe(403);
  const receive = await api(cashier, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 1, unitCostPiasters: 1000 }],
  });
  expect(receive.status).toBe(403);
  expect(receive.status).toBeLessThan(500);
  const unauthenticated = await api(undefined, "GET", "/api/internal/inventory/batches");
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
  expect(unauthenticated.status).toBeLessThan(500);

  const created = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(created.status).toBe(200);
  const operationId = created.body[0].operationId;
  const cashierLookup = await api(cashier, "GET", `/api/internal/receiving/operations/${operationId}`);
  expect(cashierLookup.status).toBe(403);
  expect(cashierLookup.body.error.code).toBe("FORBIDDEN");
  expect(cashierLookup.status).toBeLessThan(500);
  const unknown = await api(manager, "GET", `/api/internal/receiving/operations/${crypto.randomUUID()}`);
  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe("NOT_FOUND");
  expect(unknown.body.error.messageAr).toBe("لم يُحفظ إذن الاستلام بعد.");
  expect(unknown.status).toBeLessThan(500);
});

test("catalog price edits keep received variant and batch identity, and referenced removal is rejected", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-08",
    lines: [{ variantId: seed.variantId, quantity: 7, unitCostPiasters: 11000 }],
  });
  expect(received.status).toBe(201);
  const batchId = received.body.lines[0].batchId;

  const renamed = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 }],
  });
  expect(renamed.status).toBe(200);
  expect(renamed.body.variants[0].id).toBe(seed.variantId);
  expect(renamed.body.variants[0].sellingPricePiasters).toBe(28000);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0]).toMatchObject({
    id: batchId,
    variantId: seed.variantId,
    remainingQuantity: 7,
    unitCostPiasters: 11000,
  });

  const extraSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  const removed = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: extraSize.body.id, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(removed.status).toBe(409);
  expect(removed.body.error.code).toBe("VARIANT_REFERENCED");
  expect(removed.body.error.messageAr).toBe("لا يمكن حذف متغير مرتبط بسجلات مخزون.");
  expect(removed.status).toBeLessThan(500);

  const stillThere = await api(manager, "GET", `/api/internal/catalog/products/${seed.productId}`);
  expect(stillThere.body.variants[0].id).toBe(seed.variantId);
  const stillBatch = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(stillBatch.body[0].id).toBe(batchId);

  const extraColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أخضر" });
  const withDraft = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 },
      { sizeId: extraSize.body.id, colorId: extraColor.body.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(withDraft.status).toBe(200);
  const draftId = withDraft.body.variants.find((variant: { id: string }) => variant.id !== seed.variantId).id;
  const draftThreshold = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${draftId}/low-stock-threshold`,
    { lowStockThreshold: 1 },
  );
  expect(draftThreshold.status).toBe(200);
  const dropDraft = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 }],
  });
  expect(dropDraft.status).toBe(200);
  expect(dropDraft.body.variants).toHaveLength(1);
  expect(dropDraft.body.variants[0].id).toBe(seed.variantId);
  const stillReceived = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(stillReceived.body[0].id).toBe(batchId);
});

async function startApp(overrides: { databasePoolMax?: number } = {}) {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_receiving_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-receiving-outbox-"));
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
    ...overrides,
  });
  await applyMigrations(built.pool);
  const branches = await built.pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM branch ORDER BY code",
  );
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
}

async function seedShirt(
  manager: CookieSession,
  options?: { extraColor?: boolean },
): Promise<{
  categoryId: string;
  sizeId: string;
  colorId: string;
  productId: string;
  variantId: string;
  secondVariantId: string;
}> {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  expect(category.status).toBe(201);
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  expect(size.status).toBe(201);
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  expect(color.status).toBe(201);
  const variants = [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }];
  let secondColorId = "";
  if (options?.extraColor) {
    const white = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض" });
    expect(white.status).toBe(201);
    secondColorId = white.body.id;
    variants.push({ sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: null });
  }
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
    variants,
  });
  expect(created.status).toBe(201);
  const firstVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أسود");
  const secondVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أبيض");
  return {
    categoryId: category.body.id,
    sizeId: size.body.id,
    colorId: color.body.id,
    productId: created.body.id,
    variantId: firstVariant.id,
    secondVariantId: secondVariant?.id ?? "",
  };
}

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: {
      origin: INTERNAL_ORIGIN,
      "content-type": "application/json",
    },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

async function api(
  session: CookieSession | undefined,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  return {
    status: response.statusCode,
    body: safeJson(response.body),
  };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function safeJson(body: string) {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
