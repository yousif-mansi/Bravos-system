import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const NOW = new Date("2026-09-15T12:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55447 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  const database = `bravos_returns_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(database),
    authSecret: "returns-secret-returns-secret-32xx",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-returns-outbox-")),
    businessClock: () => new Date(NOW),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
});

test("manager picks an unattributed-phone sale, drafts cross-branch, restores the original batch once, and pays the edited refund separately", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [30000, 20000]);
  const oldReceipt = await receive(manager, product.variantIds[0]!, 1, 10000);
  await receive(manager, product.variantIds[0]!, 2, 14000);
  await receive(manager, product.variantIds[1]!, 2, 8000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-01T12:00:00.000Z",
    employeeDiscountPiasters: 5000,
    lines: product.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  });
  expect(originalSale.body.customerPhone).toBeNull();
  expect(originalSale.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((a: number, b: number) => a - b)).toEqual([17500, 27500]);

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.return.denied",
    displayName: "كاشير بلا إرجاع",
    password: "staff-pass-71",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.return.denied", "staff-pass-71");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const denied = await api(cashier, "GET", "/api/internal/returns/sources");
  expect(denied.status).toBe(403);

  const picked = await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}&date=2026-09-01&branchId=${abshwayId}&item=${encodeURIComponent("قميص مرتجع")}&amountPiasters=45000`);
  expect(picked.status).toBe(200);
  expect(picked.body).toHaveLength(1);
  expect(picked.body[0]).toMatchObject({ saleId: originalSale.body.id, customerPhone: null, soldByStaffId: expect.any(String) });
  const returnedLine = picked.body[0].lines.find((line: { variantId: string }) => line.variantId === product.variantIds[0]);
  expect(returnedLine.remainingSuggestedPiasters).toBe(27500);

  const returnId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const draftPayload = {
    returnId,
    operationId,
    sourceSaleId: originalSale.body.id,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 30000,
    lines: [{ sourceSaleLineId: returnedLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  };
  const beforeDraft = await batches(manager);
  const draft = await api(manager, "POST", "/api/internal/returns", draftPayload);
  expect(draft.status).toBe(201);
  expect(draft.body).toMatchObject({
    status: "draft",
    revision: 1,
    suggestedRefundPiasters: 27500,
    authorizedRefundPiasters: 30000,
    handlingBranch: { code: "fayoum" },
    source: { originalBranch: { code: "abshway" }, soldByStaffId: originalSale.body.soldByStaffId },
    refund: { status: "none", owedPiasters: 0, paidPiasters: 0, recordedByStaffId: null, recordedAt: null },
  });
  expect(await batches(manager)).toEqual(beforeDraft);

  const editPayload = {
    expectedRevision: 1,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 31000,
    lines: draftPayload.lines,
  };
  const edited = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, editPayload);
  expect(edited.status).toBe(200);
  expect(edited.body).toMatchObject({
    id: returnId,
    operationId,
    status: "draft",
    revision: 2,
    suggestedRefundPiasters: 27500,
    authorizedRefundPiasters: 31000,
    refund: { status: "none", owedPiasters: 0, paidPiasters: 0 },
  });
  expect(await batches(manager)).toEqual(beforeDraft);

  const editReplay = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, editPayload);
  expect(editReplay.status).toBe(200);
  expect(editReplay.body).toMatchObject({ revision: 2, authorizedRefundPiasters: 31000 });

  const createReplay = await api(manager, "POST", "/api/internal/returns", draftPayload);
  expect(createReplay.status).toBe(200);
  expect(createReplay.body).toMatchObject({ revision: 2, authorizedRefundPiasters: 31000 });

  const changedCreateReplay = await api(manager, "POST", "/api/internal/returns", {
    ...draftPayload,
    authorizedRefundPiasters: 29000,
  });
  expect(changedCreateReplay.status).toBe(409);

  const staleEdit = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, {
    expectedRevision: 1,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 20000,
    lines: draftPayload.lines,
  });
  expect(staleEdit.status).toBe(409);

  const stalePost = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 1,
  });
  expect(stalePost.status).toBe(409);

  const posted = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 2,
  });
  expect(posted.status).toBe(201);
  expect(posted.body.status).toBe("posted");
  expect(posted.body.restorations).toEqual([
    expect.objectContaining({ batchId: oldReceipt.lines[0].batchId, quantity: 1, unitCostPiasters: 10000 }),
  ]);
  const afterPost = await batches(manager);
  expect(afterPost.find((batch: { id: string }) => batch.id === oldReceipt.lines[0].batchId).remainingQuantity).toBe(1);
  const stockVersion = await built.pool.query<{ version: string }>("SELECT version FROM inventory_stock_clock WHERE id = true");
  expect(Number(stockVersion.rows[0]?.version)).toBe(5);

  const postReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 2,
  });
  expect(postReplay.status).toBe(200);
  expect(await batches(manager)).toEqual(afterPost);

  const paymentOperation = crypto.randomUUID();
  const paid = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 31000,
  });
  expect(paid.status).toBe(201);
  expect(paid.body.refund).toMatchObject({ status: "paid", owedPiasters: 0, paidPiasters: 31000, recordedByStaffId: expect.any(String) });
  const paymentReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 31000,
  });
  expect(paymentReplay.status).toBe(200);
  expect(paymentReplay.body.refund.events).toHaveLength(1);

  const changedReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 30000,
  });
  expect(changedReplay.status).toBe(409);

  const secondPaymentIdentity = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: crypto.randomUUID(),
    status: "paid",
    amountPiasters: 31000,
  });
  expect(secondPaymentIdentity.status).toBe(409);
  expect(await batches(manager)).toEqual(afterPost);
});

test("the receipt-plus-14 Cairo-day cutoff is inclusive before and at the instant and rejects immediately after", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [85000]);
  await receive(manager, product.variantIds[0]!, 3, 40000);
  const occurrences = [
    "2026-09-01T12:00:00.001Z",
    "2026-09-01T12:00:00.000Z",
    "2026-09-01T11:59:59.999Z",
  ];
  const outcomes: number[] = [];
  for (const occurredAt of occurrences) {
    const original = await sale(manager, { occurredAt, lines: [{ variantId: product.variantIds[0]!, quantity: 1 }] });
    const sourceResult = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`);
    expect(sourceResult.status).toBe(200);
    const source = sourceResult.body[0];
    expect(source.lines[0].remainingSuggestedPiasters).toBe(85000);
    const draft = await api(manager, "POST", "/api/internal/returns", {
      returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
      handlingBranchId: abshwayId, authorizedRefundPiasters: 85000,
      lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
    });
    const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
      receivedAndInspected: true,
      expectedRevision: draft.body.revision,
    });
    outcomes.push(posted.status);
  }
  expect(outcomes).toEqual([201, 201, 400]);
});

test("concurrent partial postings cannot return the same units and unsellable quantities never re-enter stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [12000]);
  await receive(manager, product.variantIds[0]!, 2, 5000);
  const original = await sale(manager, { occurredAt: "2026-09-10T12:00:00.000Z", lines: [{ variantId: product.variantIds[0]!, quantity: 2 }] });
  const sourceResult = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`);
  expect(sourceResult.status).toBe(200);
  const source = sourceResult.body[0];
  const draftBodies = [0, 1].map(() => ({
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 24000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 2, sellableQuantity: 0 }],
  }));
  const drafts = await Promise.all(draftBodies.map((body) => api(manager, "POST", "/api/internal/returns", body)));
  expect(drafts.map((row) => row.status)).toEqual([201, 201]);
  const raced = await Promise.all(drafts.map((draft) => api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  })));
  expect(raced.map((row) => row.status).sort()).toEqual([201, 400]);
  expect((await batches(manager))[0].remainingQuantity).toBe(0);
  const listed = await api(manager, "GET", "/api/internal/returns");
  expect(listed.body.items.filter((row: { status: string }) => row.status === "posted")).toHaveLength(1);
  expect(listed.body.items[0]).not.toHaveProperty("source");
  expect(listed.body.items[0]).not.toHaveProperty("lines");
});

test("return history uses bounded summaries and a stable cursor", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [12000]);
  await receive(manager, product.variantIds[0]!, 2, 5000);
  const original = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: product.variantIds[0]!, quantity: 2 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  for (let index = 0; index < 2; index += 1) {
    const created = await api(manager, "POST", "/api/internal/returns", {
      returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
      handlingBranchId: abshwayId, authorizedRefundPiasters: 12000,
      lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
    });
    expect(created.status).toBe(201);
  }

  const first = await api(manager, "GET", "/api/internal/returns?limit=1");
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(first.body.nextCursor).toEqual(expect.any(String));
  expect(first.body.items[0]).toMatchObject({ status: "draft", refundStatus: "none" });
  expect(first.body.items[0]).not.toHaveProperty("source");
  expect(first.body.items[0]).not.toHaveProperty("lines");

  const second = await api(manager, "GET", `/api/internal/returns?limit=1&cursor=${first.body.nextCursor}`);
  expect(second.status).toBe(200);
  expect(second.body.items).toHaveLength(1);
  expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  expect(second.body.nextCursor).toBeNull();
});

test("a partial sellable return spanning FIFO costs restores each original batch without averaging", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [30000]);
  const old = await receive(manager, product.variantIds[0]!, 1, 10000);
  const newer = await receive(manager, product.variantIds[0]!, 2, 14000);
  const original = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: product.variantIds[0]!, quantity: 3 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: fayoumId, authorizedRefundPiasters: 60000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 2, sellableQuantity: 2 }],
  });
  expect(draft.body.suggestedRefundPiasters).toBe(60000);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status).toBe(201);
  expect(posted.body.restorations).toEqual(expect.arrayContaining([
    expect.objectContaining({ batchId: old.lines[0].batchId, quantity: 1, unitCostPiasters: 10000 }),
    expect.objectContaining({ batchId: newer.lines[0].batchId, quantity: 1, unitCostPiasters: 14000 }),
  ]));
  const restored = await batches(manager);
  expect(restored.find((batch: { id: string }) => batch.id === old.lines[0].batchId).remainingQuantity).toBe(1);
  expect(restored.find((batch: { id: string }) => batch.id === newer.lines[0].batchId).remainingQuantity).toBe(1);
});

async function seedProduct(session: Session, prices: number[]) {
  const category = await api(session, "POST", "/api/internal/catalog/categories", { nameAr: "مرتجعات" });
  const size = await api(session, "POST", "/api/internal/catalog/sizes", { nameAr: "L مرتجع" });
  const variants: Array<{ sizeId: string; colorId: string; sellingPricePiastersOverride: number | null }> = [];
  for (const [index, price] of prices.entries()) {
    const color = await api(session, "POST", "/api/internal/catalog/colors", { nameAr: `لون مرتجع ${index}` });
    variants.push({ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: price });
  }
  const product = await api(session, "POST", "/api/internal/catalog/products", {
    code: `RET-${crypto.randomUUID().slice(0, 6)}`,
    nameAr: "قميص مرتجع",
    descriptionAr: "اختبار الإرجاع",
    categoryId: category.body.id,
    defaultSellingPricePiasters: prices[0],
    publication: "hidden",
    imageRefs: [],
    variants,
  });
  return { variantIds: product.body.variants.map((variant: { id: string }) => variant.id) as string[] };
}

async function receive(session: Session, variantId: string, quantity: number, unitCostPiasters: number) {
  const result = await api(session, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), receiptDate: "2026-08-01", lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function sale(session: Session, input: { occurredAt: string; employeeDiscountPiasters?: number; lines: Array<{ variantId: string; quantity: number }> }) {
  const result = await api(session, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: input.occurredAt, employeeDiscountPiasters: input.employeeDiscountPiasters ?? 0, lines: input.lines,
  });
  expect(result.status).toBe(201);
  return result;
}

async function batches(session: Session) {
  return (await api(session, "GET", "/api/internal/inventory/batches")).body;
}

type Session = { cookie: string };
async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST", url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" }, payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const values = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [response.headers["set-cookie"]].filter(Boolean) as string[];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method, url,
    headers: { origin: INTERNAL_ORIGIN, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}
