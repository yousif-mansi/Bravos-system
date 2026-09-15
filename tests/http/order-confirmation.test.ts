import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let now = new Date("2026-09-15T09:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_ORDER_CONFIRMATION_TEST_PORT ?? 55466) });
  const databaseName = `bravos_order_confirmation_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-order-confirmation-outbox-")),
    businessClock: () => now,
  });
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='fayoum'")).rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("a representative confirms only the exact customer-agreed review after attesting physical set-aside", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "AGREED", 2, 30_000);
  const area = await createArea(manager, "مدينة الفيوم AGREED", 5_000);
  const order = await submitOrder(area.id, seeded.variantId);
  const representative = await createRepresentative(manager, "orders.rep.agreed");

  const review = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  expect(review.body).toMatchObject({
    orderId: order.orderId,
    orderRevision: 1,
    merchandiseTotalPiasters: 30_000,
    deliveryFeePiasters: 5_000,
    finalTotalPiasters: 35_000,
    lines: [{ variantId: seeded.variantId, quantity: 1, listedUnitPricePiasters: 30_000 }],
  });

  const agreedPayload = {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  };
  const agreed = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/agreed-revisions`, agreedPayload);
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  expect(agreed.body).toMatchObject({ status: "pending", revision: 2 });
  expect(agreed.body.agreedRevision).toMatchObject({ version: 2, agreedByStaffId: expect.any(String), quote: review.body });
  expect(agreed.body.lines[0]).toMatchObject({ requestedQuantity: 1, requestedListedUnitPricePiasters: 30_000 });

  const missingSetAside = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, {
    operationId: crypto.randomUUID(), expectedRevision: 2, agreedRevision: 2, itemsLocatedAndSetAside: false,
  });
  expect(missingSetAside.status).toBe(400);
  expect(missingSetAside.body.error.code).toBe("VALIDATION");

  const confirmationPayload = {
    operationId: crypto.randomUUID(), expectedRevision: 2, agreedRevision: 2, itemsLocatedAndSetAside: true,
  };
  const confirmed = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, confirmationPayload);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  expect(confirmed.body).toMatchObject({
    status: "confirmed",
    revision: 3,
    confirmedByStaffId: expect.any(String),
    confirmedAt: now.toISOString(),
    confirmedQuote: review.body,
  });

  const replay = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, confirmationPayload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(confirmed.body);
  const product = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(product.body.variants[0].availableQuantity).toBe(1);

  const publicReplay = await publicApi("POST", "/api/public/checkout/orders", order.submissionPayload);
  expect(publicReplay.status).toBe(200);
  expect(publicReplay.body).toEqual(order.acknowledgement);
  expect(publicReplay.body.status).toBe("pending");
});

test("cashiers are denied while real attempts and controlled time govern manual unreachable cancellation", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "UNREACHABLE", 2, 20_000);
  const area = await createArea(manager, "سنورس UNREACHABLE", 4_000);
  const order = await submitOrder(area.id, seeded.variantId);
  const representative = await createRepresentative(manager, "orders.rep.unreachable");
  const cashier = await createCashier(manager, "orders.cashier.denied");

  const denied = await api(cashier, "POST", `/api/internal/online-orders/${order.orderId}/contact-attempts`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, outcome: "no_answer",
  });
  expect(denied.status).toBe(403);
  expect(denied.body.error.code).toBe("FORBIDDEN");

  const firstPayload = { operationId: crypto.randomUUID(), expectedRevision: 1, outcome: "no_answer", note: "لا يرد" };
  const first = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/contact-attempts`, firstPayload);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(first.body).toMatchObject({ status: "pending", revision: 2 });
  expect(first.body.contactAttempts).toEqual([expect.objectContaining({
    operationId: firstPayload.operationId, outcome: "no_answer", note: "لا يرد", occurredAt: now.toISOString(),
  })]);
  const firstReplay = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/contact-attempts`, firstPayload);
  expect(firstReplay.status).toBe(200);
  expect(firstReplay.body).toEqual(first.body);

  now = new Date("2026-09-15T10:00:00.000Z");
  const second = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/contact-attempts`, {
    operationId: crypto.randomUUID(), expectedRevision: 2, outcome: "no_answer",
  });
  expect(second.status).toBe(201);
  expect(second.body.revision).toBe(3);

  const cancelPayload = { operationId: crypto.randomUUID(), expectedRevision: 3, reason: "تعذر التواصل بعد محاولتين" };
  const early = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/cancel-unreachable`, cancelPayload);
  expect(early.status).toBe(409);
  expect(early.body.error.code).toBe("UNREACHABLE_POLICY_NOT_MET");

  now = new Date("2026-09-17T09:00:00.000Z");
  const cancelled = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/cancel-unreachable`, cancelPayload);
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  expect(cancelled.body).toMatchObject({
    status: "cancelled_unreachable", revision: 4, cancellationReason: "تعذر التواصل بعد محاولتين",
    cancelledByStaffId: expect.any(String), cancelledAt: now.toISOString(),
  });
  const replay = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/cancel-unreachable`, cancelPayload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(cancelled.body);

  const available = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(available.body.variants[0].availableQuantity).toBe(2);

  const untouched = await submitOrder(area.id, seeded.variantId);
  now = new Date("2026-10-30T09:00:00.000Z");
  const stillPending = await api(manager, "GET", `/api/internal/online-orders/${untouched.orderId}`);
  expect(stillPending.body).toMatchObject({ status: "pending", revision: 1 });
});

test("stale order versions and changed prices require a fresh customer-reviewed quote without partial effects", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "STALE", 2, 30_000);
  const area = await createArea(manager, "إطسا STALE", 3_000);
  const order = await submitOrder(area.id, seeded.variantId);
  const representative = await createRepresentative(manager, "orders.rep.stale");

  const staleReview = await agreementQuote(representative, order.orderId, 1, [{ variantId: seeded.variantId, quantity: 1 }]);
  const attempt = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/contact-attempts`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, outcome: "reached",
  });
  expect(attempt.status).toBe(201);
  const staleAgreement = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, quoteId: staleReview.quoteId,
    reviewDigest: staleReview.reviewDigest, customerAgreed: true,
  });
  expect(staleAgreement.status).toBe(409);
  expect(staleAgreement.body.error.code).toBe("ORDER_REVISION_CONFLICT");

  const currentReview = await agreementQuote(representative, order.orderId, 2, [{ variantId: seeded.variantId, quantity: 1 }]);
  const agreed = await agreeReviewed(representative, order.orderId, 2, currentReview);
  expect(agreed.body.revision).toBe(3);
  await updateProductPrice(manager, seeded.productId, 35_000);

  const rejected = await api(representative, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, {
    operationId: crypto.randomUUID(), expectedRevision: 3, agreedRevision: 3, itemsLocatedAndSetAside: true,
  });
  expect(rejected.status).toBe(409);
  expect(rejected.body.error.code).toBe("QUOTE_STALE");
  const unchanged = await api(representative, "GET", `/api/internal/online-orders/${order.orderId}`);
  expect(unchanged.body).toMatchObject({ status: "pending", revision: 3, requestedFinalTotalPiasters: 33_000 });
  expect(unchanged.body.lines[0]).toMatchObject({ requestedListedUnitPricePiasters: 30_000 });
  const product = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(product.body.variants[0].availableQuantity).toBe(2);

  const fresh = await agreementQuote(representative, order.orderId, 3, [{ variantId: seeded.variantId, quantity: 1 }]);
  expect(fresh.lines[0].listedUnitPricePiasters).toBe(35_000);
  expect(fresh.finalTotalPiasters).toBe(38_000);
});

test("manager backup can confirm an explicitly agreed replacement while the original request remains immutable", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const requested = await seedOrder(manager, "ORIGINAL", 1, 25_000);
  const replacement = await seedOrder(manager, "REPLACEMENT", 3, 28_000);
  const area = await createArea(manager, "طامية REPLACEMENT", 4_500);
  const order = await submitOrder(area.id, requested.variantId);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "REPLACE-ROUND", discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 1,
    startsOn: cairoDate(), endsOn: cairoDate(), active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [replacement.productId], categoryIds: [],
  });
  expect(coupon.status, JSON.stringify(coupon.body)).toBe(201);

  const review = await agreementQuote(manager, order.orderId, 1, [{ variantId: replacement.variantId, quantity: 3 }], "REPLACE-ROUND");
  expect(review.lines[0].units).toEqual([
    expect.objectContaining({ unitIndex: 0, quantity: 1, listedPiasters: 28_000, couponDiscountPiasters: 1, paidPiasters: 27_999 }),
    expect.objectContaining({ unitIndex: 1, quantity: 2, listedPiasters: 28_000, couponDiscountPiasters: 0, paidPiasters: 28_000 }),
  ]);
  expect(review.lines[0].units.reduce((sum: number, unit: { quantity: number; paidPiasters: number }) =>
    sum + unit.quantity * unit.paidPiasters, 0)).toBe(review.merchandiseTotalPiasters);
  const agreed = await agreeReviewed(manager, order.orderId, 1, review);
  const confirmationPayload = {
    operationId: crypto.randomUUID(), expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.agreedRevision.version, itemsLocatedAndSetAside: true,
  };
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, confirmationPayload);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  expect(confirmed.body.lines).toEqual([expect.objectContaining({
    variantId: requested.variantId, requestedQuantity: 1, requestedListedUnitPricePiasters: 25_000,
  })]);
  expect(confirmed.body.confirmedQuote.lines).toEqual([expect.objectContaining({
    id: review.lines[0].id, variantId: replacement.variantId, quantity: 3, listedUnitPricePiasters: 28_000,
    units: review.lines[0].units,
  })]);
  expect(agreed.body.agreedRevision.quote.lines[0].id).toBe(review.lines[0].id);
  await updateProductPrice(manager, replacement.productId, 31_000);
  const replay = await api(manager, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, confirmationPayload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(confirmed.body);
  const reread = await api(manager, "GET", `/api/internal/online-orders/${order.orderId}`);
  expect(reread.body.confirmedQuote.lines[0]).toMatchObject({ id: review.lines[0].id, units: review.lines[0].units });
  expect((await publicApi("GET", `/api/public/catalog/products/${requested.productId}`)).body.variants[0].availableQuantity).toBe(1);
  expect((await publicApi("GET", `/api/public/catalog/products/${replacement.productId}`)).body.variants[0].availableQuantity).toBe(0);
  expect(JSON.stringify(confirmed.body)).not.toMatch(/cost/i);
});

test("two confirmations competing for one unit serialize so only one customer promise is protected", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "CONFIRM-RACE", 1, 18_000);
  const area = await createArea(manager, "أبشواي CONFIRM-RACE", 2_000);
  const firstOrder = await submitOrder(area.id, seeded.variantId);
  const secondOrder = await submitOrder(area.id, seeded.variantId);
  const firstAgreed = await reviewAndAgree(manager, firstOrder.orderId, seeded.variantId);
  const secondAgreed = await reviewAndAgree(manager, secondOrder.orderId, seeded.variantId);
  const commands = [firstAgreed, secondAgreed].map((entry) => ({
    orderId: entry.orderId,
    payload: { operationId: crypto.randomUUID(), expectedRevision: 2, agreedRevision: 2, itemsLocatedAndSetAside: true },
  }));
  const results = await Promise.all(commands.map((entry) =>
    api(manager, "POST", `/api/internal/online-orders/${entry.orderId}/confirm`, entry.payload)));
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(results.find((result) => result.status === 409)?.body.error.code).toBe("INSUFFICIENT_STOCK");
  expect((await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`)).body.variants[0].availableQuantity).toBe(0);
  const reread = await Promise.all(commands.map((entry) => api(manager, "GET", `/api/internal/online-orders/${entry.orderId}`)));
  expect(reread.filter((entry) => entry.body.status === "confirmed")).toHaveLength(1);
  expect(reread.filter((entry) => entry.body.status === "pending")).toHaveLength(1);
});

test("a confirmation racing a physically completed cash sale preserves the paid sale under either lock winner", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  expect((await api(manager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const seeded = await seedOrder(manager, "POS-RACE", 1, 19_000);
  const area = await createArea(manager, "الفيوم POS-RACE", 2_500);
  const order = await submitOrder(area.id, seeded.variantId);
  await reviewAndAgree(manager, order.orderId, seeded.variantId);
  const confirmationPayload = {
    operationId: crypto.randomUUID(), expectedRevision: 2, agreedRevision: 2, itemsLocatedAndSetAside: true,
  };
  const salePayload = {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0, lines: [{ variantId: seeded.variantId, quantity: 1 }],
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", salePayload);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  const [confirmation, paidSale] = await Promise.all([
    api(manager, "POST", `/api/internal/online-orders/${order.orderId}/confirm`, confirmationPayload),
    api(manager, "POST", "/api/internal/sales", {
      ...salePayload, physicallyCompleted: true,
    }),
  ]);
  expect(paidSale.status, JSON.stringify(paidSale.body)).toBe(201);
  expect(paidSale.body.physicallyCompleted).toBe(true);
  expect([201, 409]).toContain(confirmation.status);
  if (confirmation.status === 201) {
    expect(paidSale.body.lines[0]).toMatchObject({ allocatedQuantity: 0, unallocatedQuantity: 1 });
  } else {
    expect(confirmation.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(paidSale.body.lines[0]).toMatchObject({ allocatedQuantity: 1, unallocatedQuantity: 0 });
  }
  expect((await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`)).body.variants[0].availableQuantity).toBe(0);
});

test("a final coupon use and protected allocation commit together and retain unit pricing provenance", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "COUPON-RACE", 2, 22_000);
  const area = await createArea(manager, "يوسف الصديق COUPON-RACE", 3_000);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "ORDER-LAST-USE", discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 2_000,
    startsOn: cairoDate(), endsOn: cairoDate(), active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [seeded.productId], categoryIds: [],
  });
  expect(coupon.status, JSON.stringify(coupon.body)).toBe(201);
  const firstOrder = await submitOrder(area.id, seeded.variantId, "ORDER-LAST-USE");
  const secondOrder = await submitOrder(area.id, seeded.variantId, "ORDER-LAST-USE");
  const first = await reviewAndAgree(manager, firstOrder.orderId, seeded.variantId, "ORDER-LAST-USE");
  const second = await reviewAndAgree(manager, secondOrder.orderId, seeded.variantId, "ORDER-LAST-USE");
  const commands = [first, second].map((entry) => ({
    orderId: entry.orderId,
    payload: { operationId: crypto.randomUUID(), expectedRevision: 2, agreedRevision: 2, itemsLocatedAndSetAside: true },
  }));
  const results = await Promise.all(commands.map((entry) =>
    api(manager, "POST", `/api/internal/online-orders/${entry.orderId}/confirm`, entry.payload)));
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(results.find((result) => result.status === 409)?.body.error.code).toBe("QUOTE_STALE");
  expect((await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`)).body.variants[0].availableQuantity).toBe(1);
  const coupons = await api(manager, "GET", `/api/internal/pricing/coupons/${coupon.body.id}`);
  expect(coupons.body.usedCount).toBe(1);

  const winnerIndex = results.findIndex((result) => result.status === 201);
  const winner = commands[winnerIndex]!;
  const stored = await built.pool.query<{ pricing_snapshot_json: { couponUnitRanges: unknown[] } }>(
    "SELECT pricing_snapshot_json FROM online_order_confirmation WHERE order_id=$1",
    [winner.orderId],
  );
  expect(stored.rows[0]?.pricing_snapshot_json.couponUnitRanges).toEqual([
    expect.objectContaining({ variantId: seeded.variantId, quantity: 1, couponDiscountPiasters: 2_000 }),
  ]);
  expect(JSON.stringify(stored.rows[0]?.pricing_snapshot_json)).not.toMatch(/cost/i);
  const replay = await api(manager, "POST", `/api/internal/online-orders/${winner.orderId}/confirm`, winner.payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(results[winnerIndex]?.body);
  const changed = await api(manager, "POST", `/api/internal/online-orders/${winner.orderId}/confirm`, {
    ...winner.payload, expectedRevision: 99,
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe("OPERATION_CONFLICT");
});

test("manager controls the configurable unreachable policy with optimistic revisions and a floor of two attempts", async () => {
  now = new Date("2026-09-15T09:00:00.000Z");
  const manager = await signIn("owner", "owner-pass-1");
  const representative = await createRepresentative(manager, "orders.rep.settings");
  const cashier = await createCashier(manager, "orders.cashier.settings");
  const initial = await api(representative, "GET", "/api/internal/online-order-settings");
  expect(initial.status).toBe(200);
  expect(initial.body).toMatchObject({ revision: 1, unreachableWaitHours: 48, minimumContactAttempts: 2 });
  expect((await api(cashier, "GET", "/api/internal/online-order-settings")).status).toBe(403);
  expect((await api(representative, "PUT", "/api/internal/online-order-settings", {
    expectedRevision: 1, unreachableWaitHours: 72, minimumContactAttempts: 3,
  })).status).toBe(403);
  const updated = await api(manager, "PUT", "/api/internal/online-order-settings", {
    expectedRevision: 1, unreachableWaitHours: 72, minimumContactAttempts: 3,
  });
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({ revision: 2, unreachableWaitHours: 72, minimumContactAttempts: 3,
    changedByStaffId: expect.any(String), changedAt: now.toISOString() });
  const stale = await api(manager, "PUT", "/api/internal/online-order-settings", {
    expectedRevision: 1, unreachableWaitHours: 24, minimumContactAttempts: 2,
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe("ORDER_REVISION_CONFLICT");
  const belowFloor = await api(manager, "PUT", "/api/internal/online-order-settings", {
    expectedRevision: 2, unreachableWaitHours: 24, minimumContactAttempts: 1,
  });
  expect(belowFloor.status).toBe(400);
  expect(belowFloor.body.error.code).toBe("VALIDATION");
});

type Session = { cookie: string };

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, origin = INTERNAL_ORIGIN) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  return api(undefined, method, url, payload, PUBLIC_ORIGIN);
}

async function createRepresentative(manager: Session, loginName: string) {
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "ممثل الطلبات",
    password: "staff-pass-20",
    grants: [{ branchId, cashier: false, orderRepresentative: true }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const representative = await signIn(loginName, "staff-pass-20");
  expect((await api(representative, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  return representative;
}

async function createCashier(manager: Session, loginName: string) {
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "كاشير الطلبات",
    password: "staff-pass-20",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const cashier = await signIn(loginName, "staff-pass-20");
  expect((await api(cashier, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  return cashier;
}

async function createArea(manager: Session, nameAr: string, feePiasters: number) {
  const response = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr, feePiasters, active: true });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function seedOrder(manager: Session, prefix: string, quantity: number, price: number) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `ORDER-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار تأكيد الطلب",
    categoryId: category.body.id,
    defaultSellingPricePiasters: price,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  const variantId = product.body.variants[0].id;
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), receiptDate: cairoDate(), lines: [{ variantId, quantity, unitCostPiasters: 5_000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  return { productId: product.body.id, variantId };
}

async function submitOrder(deliveryAreaId: string, variantId: string, couponCode?: string) {
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId, lines: [{ variantId, quantity: 1 }], ...(couponCode ? { couponCode } : {}),
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submissionPayload = {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity: 1 }],
    ...(couponCode ? { couponCode } : {}),
    customerName: "عميل تأكيد",
    primaryPhone: "01012345678",
    detailedAddress: "شارع الجمهورية، منزل ١٠",
  };
  const submitted = await publicApi("POST", "/api/public/checkout/orders", submissionPayload);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return { orderId: submitted.body.orderId as string, acknowledgement: submitted.body, submissionPayload };
}

async function agreementQuote(
  session: Session,
  orderId: string,
  expectedRevision: number,
  lines: Array<{ variantId: string; quantity: number }>,
  couponCode?: string,
) {
  const response = await api(session, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision, lines, ...(couponCode ? { couponCode } : {}),
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function agreeReviewed(session: Session, orderId: string, expectedRevision: number, quote: Record<string, unknown>) {
  const response = await api(session, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(), expectedRevision, quoteId: quote.quoteId,
    reviewDigest: quote.reviewDigest, customerAgreed: true,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response;
}

async function reviewAndAgree(session: Session, orderId: string, variantId: string, couponCode?: string) {
  const quote = await agreementQuote(session, orderId, 1, [{ variantId, quantity: 1 }], couponCode);
  await agreeReviewed(session, orderId, 1, quote);
  return { orderId, quote };
}

async function updateProductPrice(manager: Session, productId: string, price: number) {
  const current = await api(manager, "GET", `/api/internal/catalog/products/${productId}`);
  const updated = await api(manager, "PATCH", `/api/internal/catalog/products/${productId}`, {
    code: current.body.code,
    nameAr: current.body.nameAr,
    descriptionAr: current.body.descriptionAr,
    categoryId: current.body.category.id,
    defaultSellingPricePiasters: price,
    publication: current.body.publication,
    imageRefs: current.body.imageRefs,
    sizeGuideAr: current.body.sizeGuideAr,
    variants: current.body.variants.map((variant: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
