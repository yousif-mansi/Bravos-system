import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

type Session = { cookie: string };

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T20:59:59.000Z") });
  cluster = await startPostgresCluster({ port: 55452 });
  const databaseName = `bravos_offline_promotions_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-offline-promotions-outbox-")),
  });
  abshwayId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='abshway'")).rows[0]?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.offline.promotions",
    displayName: "كاشير عروض دون اتصال",
    password: "staff-pass-91",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
  vi.useRealTimers();
});

test("cashier snapshot caches safe offer and coupon rules with the locally known usage", async () => {
  const manager = await managerSession();
  const product = await seedProduct(manager, "OFFLINE-SNAPSHOT", 30_000, 4);
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض اللقطة",
    discountType: "percentage",
    percentageBasisPoints: 1_000,
    fixedDiscountPiasters: null,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowCoupon: true,
    productIds: [product.productId],
    categoryIds: [],
  });
  expect(offer.status).toBe(201);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "OFFLINE50",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 2,
    productIds: [product.productId],
    categoryIds: [],
  });
  expect(coupon.status).toBe(201);

  const cashier = await cashierSession();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: crypto.randomUUID(),
  });

  expect(snapshot.status).toBe(201);
  expect(snapshot.body.automaticOffers).toEqual([
    expect.objectContaining({ id: offer.body.id, nameAr: "عرض اللقطة", startsOn: "2026-09-15", endsOn: "2026-09-15" }),
  ]);
  expect(snapshot.body.coupons).toEqual([
    expect.objectContaining({ id: coupon.body.id, code: "OFFLINE50", usedCount: 0, usageLimit: 2 }),
  ]);
  expect(JSON.stringify(snapshot.body)).not.toMatch(/unitCostPiasters|purchase|inventoryValue|profit/i);
});

test("offline acceptance keeps the snapshot promotion price after live rules change", async () => {
  const manager = await managerSession();
  const product = await seedProduct(manager, "OFFLINE-ACCEPT", 30_000, 4);
  const offerRule = {
    nameAr: "عرض مقبول دون اتصال",
    discountType: "percentage",
    percentageBasisPoints: 1_000,
    fixedDiscountPiasters: null,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowCoupon: true,
    productIds: [product.productId],
    categoryIds: [],
  };
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", offerRule);
  const couponRule = {
    code: "OFFLINE-ACCEPT-50",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 2,
    productIds: [product.productId],
    categoryIds: [],
  };
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponRule);
  expect(offer.status).toBe(201);
  expect(coupon.status).toBe(201);

  const cashier = await cashierSession();
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  expect((await api(manager, "PUT", `/api/internal/pricing/offers/${offer.body.id}`, { ...offerRule, active: false })).status).toBe(200);
  expect((await api(manager, "PUT", `/api/internal/pricing/coupons/${coupon.body.id}`, { ...couponRule, active: false })).status).toBe(200);

  const acceptedPayload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-15T20:59:59.000Z",
    pricingOccurredAt: "2026-09-15T20:59:59.000Z",
    physicallyCompleted: true,
    couponCode: "offline-accept-50",
    pricingVersion: 1,
    employeeDiscountPiasters: 2_000,
    lines: [{ variantId: product.variantId, quantity: 1, listedUnitPricePiasters: 30_000 }],
  };
  const accepted = await api(cashier, "POST", "/api/internal/sales/accepted", acceptedPayload);

  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect(accepted.body).toMatchObject({
    originalTotalPiasters: 30_000,
    automaticOfferDiscountPiasters: 3_000,
    couponDiscountPiasters: 5_000,
    employeeDiscountPiasters: 2_000,
    finalTotalPiasters: 20_000,
  });
  expect(accepted.body.appliedAutomaticOffer).toMatchObject({ id: offer.body.id, discountPiasters: 3_000 });
  expect(accepted.body.appliedCoupon).toMatchObject({ id: coupon.body.id, code: "OFFLINE-ACCEPT-50", discountPiasters: 5_000 });
  expect(accepted.body.lines[0]).toMatchObject({
    automaticOfferDiscountPiasters: 3_000,
    couponDiscountPiasters: 5_000,
    employeeDiscountPiasters: 2_000,
    paidPiasters: 20_000,
  });
  const retainedCoupon = await api(manager, "GET", `/api/internal/pricing/coupons/${coupon.body.id}`);
  expect(retainedCoupon.body.usedCount).toBe(1);
  vi.setSystemTime(new Date("2026-09-15T21:00:01.000Z"));
  try {
    const retriedAcceptedPrice = await api(cashier, "POST", "/api/internal/sales/accepted", acceptedPayload);
    expect(retriedAcceptedPrice.status).toBe(200);
    expect(retriedAcceptedPrice.body.finalTotalPiasters).toBe(20_000);
    const newlyPreparedAfterExpiry = await api(cashier, "POST", "/api/internal/sales/accepted", {
      ...acceptedPayload,
      saleId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      occurredAt: "2026-09-15T21:00:00.000Z",
      pricingOccurredAt: "2026-09-15T21:00:00.000Z",
    });
    expect(newlyPreparedAfterExpiry.status).toBe(400);
    const changedBoundary = await api(cashier, "POST", "/api/internal/sales/accepted", {
      ...acceptedPayload,
      occurredAt: "2026-09-15T21:00:00.000Z",
    });
    expect(changedBoundary.status).toBe(409);
    const changedAcceptedPrice = await api(cashier, "POST", "/api/internal/sales/accepted", {
      ...acceptedPayload,
      lines: [{ variantId: product.variantId, quantity: 1, listedUnitPricePiasters: 29_999 }],
    });
    expect(changedAcceptedPrice.status).toBe(400);
  } finally {
    vi.setSystemTime(new Date("2026-09-15T20:59:59.000Z"));
  }
});

test("global coupon overuse retains the completed offline sale and retry has one stock effect", async () => {
  const manager = await managerSession();
  const product = await seedProduct(manager, "OFFLINE-OVERUSE", 20_000, 4);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "OFFLINE-LAST-USE",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5_000,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 1,
    productIds: [product.productId],
    categoryIds: [],
  });
  expect(coupon.status).toBe(201);
  const cashier = await cashierSession();
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.body.coupons.find((item: { id: string }) => item.id === coupon.body.id)).toMatchObject({
    id: coupon.body.id,
    usedCount: 0,
    usageLimit: 1,
  });

  const competing = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    couponCode: "OFFLINE-LAST-USE",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: product.variantId, quantity: 1 }],
  };
  expect((await api(manager, "POST", "/api/internal/sales/prepare", competing)).status).toBe(201);
  expect((await api(manager, "POST", "/api/internal/sales", { ...competing, physicallyCompleted: true })).status).toBe(201);

  const offline = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-15T20:59:59.000Z",
    pricingOccurredAt: "2026-09-15T20:59:59.000Z",
    physicallyCompleted: true,
    couponCode: "OFFLINE-LAST-USE",
    pricingVersion: 1,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: product.variantId, quantity: 1, listedUnitPricePiasters: 20_000 }],
  };
  const retained = await api(cashier, "POST", "/api/internal/sales/accepted", offline);
  expect(retained.status, JSON.stringify(retained.body)).toBe(201);
  expect(retained.body).toMatchObject({
    id: offline.saleId,
    finalTotalPiasters: 15_000,
    couponDiscountPiasters: 5_000,
    physicallyCompleted: true,
    discrepancy: { unallocatedQuantity: 0 },
  });

  const inspected = await api(manager, "GET", `/api/internal/sales/${offline.saleId}`);
  expect(inspected.status).toBe(200);
  expect(inspected.body.couponUsageDiscrepancy).toMatchObject({
    couponId: coupon.body.id,
    couponCode: "OFFLINE-LAST-USE",
    usageLimit: 1,
    centralUsedCount: 2,
  });
  expect(inspected.body.couponUsageDiscrepancy.detectedAt).toEqual(expect.any(String));

  const replay = await api(cashier, "POST", "/api/internal/sales/accepted", offline);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(offline.saleId);
  expect((await api(manager, "GET", `/api/internal/pricing/coupons/${coupon.body.id}`)).body.usedCount).toBe(2);
  const refreshed = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    pendingOperationIds: [offline.operationId],
  });
  expect(refreshed.status).toBe(201);
  expect(refreshed.body.coupons.find((item: { id: string }) => item.id === coupon.body.id)).toMatchObject({
    usedCount: 2,
    usageLimit: 1,
  });
  expect(refreshed.body.couponAccountedOperations).toEqual([
    {
      couponId: coupon.body.id,
      sourceType: "physical_sale",
      sourceId: offline.saleId,
      operationId: offline.operationId,
      payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  ]);
  expect((await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    couponCode: "OFFLINE-LAST-USE",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: product.variantId, quantity: 1 }],
  })).status).toBe(400);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("OFFLINE-OVERUSE")}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(2);
});

test("a prepared sale completed during an outage is retained when its coupon becomes overused", async () => {
  const manager = await managerSession();
  const product = await seedProduct(manager, "PREPARED-OVERUSE", 18_000, 4);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "PREPARED-LAST-USE",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 3_000,
    startsOn: "2026-09-15",
    endsOn: "2026-09-15",
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 1,
    productIds: [product.productId],
    categoryIds: [],
  });
  const cashier = await cashierSession();
  const preparedPayload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    couponCode: "PREPARED-LAST-USE",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: product.variantId, quantity: 1 }],
  };
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", preparedPayload);
  expect(prepared.status).toBe(201);
  expect(prepared.body).toMatchObject({ physicallyCompleted: false, finalTotalPiasters: 15_000 });

  const competing = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    couponCode: "PREPARED-LAST-USE",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: product.variantId, quantity: 1 }],
  };
  expect((await api(manager, "POST", "/api/internal/sales/prepare", competing)).status).toBe(201);
  expect((await api(manager, "POST", "/api/internal/sales", { ...competing, physicallyCompleted: true })).status).toBe(201);

  const completedPayload = {
    ...preparedPayload,
    occurredAt: "2026-09-15T20:59:59.000Z",
    physicallyCompleted: true,
  };
  const retained = await api(cashier, "POST", "/api/internal/sales", completedPayload);
  expect(retained.status, JSON.stringify(retained.body)).toBe(201);
  expect(retained.body).toMatchObject({
    id: preparedPayload.saleId,
    physicallyCompleted: true,
    finalTotalPiasters: 15_000,
    discrepancy: { unallocatedQuantity: 0 },
  });
  const inspected = await api(manager, "GET", `/api/internal/sales/${preparedPayload.saleId}`);
  expect(inspected.body.couponUsageDiscrepancy).toMatchObject({
    couponId: coupon.body.id,
    usageLimit: 1,
    centralUsedCount: 2,
  });
  expect((await api(manager, "GET", `/api/internal/pricing/coupons/${coupon.body.id}`)).body.usedCount).toBe(2);
  expect((await api(cashier, "POST", "/api/internal/sales", completedPayload)).status).toBe(200);
  expect((await api(manager, "GET", `/api/internal/pricing/coupons/${coupon.body.id}`)).body.usedCount).toBe(2);
});

async function managerSession() {
  const session = await signIn("owner", "owner-pass-1");
  await api(session, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  return session;
}

async function cashierSession() {
  const session = await signIn("cashier.offline.promotions", "staff-pass-91");
  await api(session, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  return session;
}

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const values = Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"]
    : response.headers["set-cookie"] ? [response.headers["set-cookie"]] : [];
  return { cookie: values.map((value) => value.split(";")[0]).filter(Boolean).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
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
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

async function seedProduct(manager: Session, code: string, price: number, quantity: number) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${code}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${code}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${code}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code,
    nameAr: `منتج ${code}`,
    descriptionAr: "اختبار عروض دون اتصال",
    categoryId: category.body.id,
    defaultSellingPricePiasters: price,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  const variantId = product.body.variants[0].id as string;
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-15",
    lines: [{ variantId, quantity, unitCostPiasters: 10_000 }],
  });
  expect(received.status).toBe(201);
  return { productId: product.body.id as string, variantId };
}
