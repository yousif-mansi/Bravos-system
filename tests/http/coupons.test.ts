import { mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T10:00:00.000Z") });
  cluster = await startPostgresCluster({ port: 55450 });
  const databaseName = `bravos_coupons_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-coupons-outbox-")),
  });
  abshwayId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='abshway'")).rows[0]?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.coupons",
    displayName: "كاشير الكوبونات",
    password: "staff-pass-81",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
  vi.useRealTimers();
});

test("manager maintains coupon rules while cashier cannot manage them", async () => {
  const manager = await managerSession();
  const cashier = await cashierSession();
  const catalog = await seedCatalog(manager, "AUTH", [30_000]);

  const denied = await api(cashier, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "DENIED",
    productIds: [catalog.productId],
  }));
  expect(denied.status).toBe(403);
  expect((await api(cashier, "GET", "/api/internal/pricing/coupons")).status).toBe(403);

  const invalidDates = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "BAD-DATES",
    startsOn: cairoDate(1),
    endsOn: cairoDate(-1),
    productIds: [catalog.productId],
  }));
  expect(invalidDates.status).toBe(400);

  const invalidScope = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "BAD-SCOPE",
    productIds: [crypto.randomUUID()],
  }));
  expect(invalidScope.status).toBe(400);
  expect(invalidScope.body.error.messageAr).toBe("المنتج أو التصنيف المحدد غير موجود.");

  const created = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "save-auth",
    usageLimit: 7,
    categoryIds: [catalog.categoryId],
  }));
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    code: "save-auth",
    usageLimit: 7,
    usedCount: 0,
    allowAutomaticOffer: true,
    categoryIds: [catalog.categoryId],
  });

  const duplicate = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: " SAVE-AUTH ",
    productIds: [catalog.productId],
  }));
  expect(duplicate.status).toBe(400);
  expect(duplicate.body.error.messageAr).toBe("كود الكوبون مستخدم بالفعل.");

  const updated = await api(manager, "PUT", `/api/internal/pricing/coupons/${created.body.id}`, couponBody({
    code: "SAVE-AUTH-EDITED",
    discountType: "percentage",
    percentageBasisPoints: 1_500,
    fixedDiscountPiasters: null,
    usageLimit: 9,
    allowAutomaticOffer: false,
    productIds: [catalog.productId],
  }));
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({ code: "SAVE-AUTH-EDITED", percentageBasisPoints: 1_500, usageLimit: 9 });
});

test("automatic offer then coupon then employee discount keeps exact accepted unit effects after rule edits", async () => {
  const manager = await managerSession();
  const catalog = await seedCatalog(manager, "EXACT", [30_000, 20_000]);
  await receive(manager, catalog.variantIds[0]!, 3);
  await receive(manager, catalog.variantIds[1]!, 3);
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "خصم عشرة بالمئة",
    percentageBasisPoints: 1_000,
    categoryIds: [catalog.categoryId],
  }));
  expect(offer.status).toBe(201);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "SAVE50",
    fixedDiscountPiasters: 5_000,
    usageLimit: 3,
    categoryIds: [catalog.categoryId],
  }));
  expect(coupon.status).toBe(201);

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const payload = {
    saleId,
    operationId,
    couponCode: " save50 ",
    employeeDiscountPiasters: 2_000,
    lines: catalog.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", payload);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  expect(prepared.body).toMatchObject({
    originalTotalPiasters: 50_000,
    automaticOfferDiscountPiasters: 5_000,
    couponDiscountPiasters: 5_000,
    employeeDiscountPiasters: 2_000,
    finalTotalPiasters: 38_000,
    appliedCoupon: { id: coupon.body.id, code: "SAVE50", discountPiasters: 5_000 },
  });
  const expensive = prepared.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[0]);
  const cheap = prepared.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[1]);
  expect(expensive).toMatchObject({
    automaticOfferDiscountPiasters: 3_000,
    couponDiscountPiasters: 2_500,
    employeeDiscountPiasters: 1_000,
    paidPiasters: 23_500,
  });
  expect(cheap).toMatchObject({
    automaticOfferDiscountPiasters: 2_000,
    couponDiscountPiasters: 2_500,
    employeeDiscountPiasters: 1_000,
    paidPiasters: 14_500,
  });
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(0);

  const edited = await api(manager, "PUT", `/api/internal/pricing/coupons/${coupon.body.id}`, couponBody({
    code: "CHANGED-AFTER-PREPARE",
    fixedDiscountPiasters: 100,
    active: false,
    usageLimit: 3,
    categoryIds: [catalog.categoryId],
  }));
  expect(edited.status).toBe(200);

  const completions = await Promise.all([
    api(manager, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true }),
    api(manager, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true }),
  ]);
  expect(completions.map((result) => result.status).sort()).toEqual([200, 201]);
  const completed = completions.find((result) => result.status === 201)!;
  const replay = completions.find((result) => result.status === 200)!;
  expect(completed.body.finalTotalPiasters).toBe(38_000);
  expect(completed.body.appliedCoupon).toEqual(prepared.body.appliedCoupon);
  expect(completed.body.lines).toEqual(prepared.body.lines.map((line: Record<string, unknown>) => ({
    ...line,
    allocatedQuantity: 1,
    unallocatedQuantity: 0,
  })));
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);

  expect(replay.body.appliedCoupon).toEqual(prepared.body.appliedCoupon);
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);

  const changedIdentity = await api(manager, "POST", "/api/internal/sales", {
    ...payload,
    couponCode: "CHANGED-AFTER-PREPARE",
    physicallyCompleted: true,
  });
  expect(changedIdentity.status).toBe(409);

  const freeCoupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "CAP-TO-FREE",
    fixedDiscountPiasters: 60_000,
    usageLimit: 2,
    categoryIds: [catalog.categoryId],
  }));
  expect(freeCoupon.status).toBe(201);
  const capped = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: "CAP-TO-FREE",
    employeeDiscountPiasters: 0,
    lines: catalog.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  });
  expect(capped.status).toBe(201);
  expect(capped.body).toMatchObject({
    originalTotalPiasters: 50_000,
    automaticOfferDiscountPiasters: 5_000,
    couponDiscountPiasters: 45_000,
    finalTotalPiasters: 0,
  });
  expect(capped.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[0])).toMatchObject({
    automaticOfferDiscountPiasters: 3_000,
    couponDiscountPiasters: 27_000,
    paidPiasters: 0,
  });
  expect(capped.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[1])).toMatchObject({
    automaticOfferDiscountPiasters: 2_000,
    couponDiscountPiasters: 18_000,
    paidPiasters: 0,
  });
});

test("competing last uses consume once and a failed sale rolls coupon, stock, and operation back together", async () => {
  const manager = await managerSession();
  const catalog = await seedCatalog(manager, "RACE", [12_000]);
  await receive(manager, catalog.variantIds[0]!, 3);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "LAST-USE",
    usageLimit: 1,
    productIds: [catalog.productId],
  }));
  expect(coupon.status).toBe(201);

  const attempts = [0, 1].map(() => ({
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    couponCode: "LAST-USE",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: catalog.variantIds[0], quantity: 1 }],
  }));
  const results = await Promise.all(attempts.map((attempt) => api(manager, "POST", "/api/internal/sales", {
    ...attempt,
    physicallyCompleted: true,
  })));
  expect(results.filter((result) => result.status === 201)).toHaveLength(1);
  const winner = results.findIndex((result) => result.status === 201);
  const loser = winner === 0 ? 1 : 0;
  expect([400, 409]).toContain(results[loser]?.status);
  expect(results[loser]?.body.error.messageAr).toBe("بلغ الكوبون الحد الأقصى للاستخدام.");
  expect(results[winner]?.body).toMatchObject({
    finalTotalPiasters: 11_000,
    couponDiscountPiasters: 1_000,
    appliedCoupon: { id: coupon.body.id, code: "LAST-USE", discountPiasters: 1_000 },
  });
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);
  expect((await api(manager, "GET", `/api/internal/sales/operations/${attempts[loser]!.operationId}`)).status).toBe(404);
  expect((await api(manager, "GET", `/api/internal/sales/${attempts[loser]!.saleId}`)).status).toBe(404);
  const afterRace = await api(manager, "GET", `/api/internal/catalog/lookup?code=${catalog.code}`);
  expect(afterRace.body.variants[0].availableQuantity).toBe(2);
  expect((await api(manager, "POST", "/api/internal/sales", { ...attempts[winner]!, physicallyCompleted: true })).status).toBe(200);
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);
  const afterReplay = await api(manager, "GET", `/api/internal/catalog/lookup?code=${catalog.code}`);
  expect(afterReplay.body.variants[0].availableQuantity).toBe(2);
  const exhausted = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: "LAST-USE",
    employeeDiscountPiasters: 0, lines: [{ variantId: catalog.variantIds[0], quantity: 1 }],
  });
  expect(exhausted.status).toBe(400);
  expect(exhausted.body.error.messageAr).toBe("بلغ الكوبون الحد الأقصى للاستخدام.");

  const rollbackCatalog = await seedCatalog(manager, "ROLLBACK", [8_000]);
  const rollbackCoupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "ROLLBACK",
    usageLimit: 2,
    productIds: [rollbackCatalog.productId],
  }));
  const failedOperation = crypto.randomUUID();
  const failedSale = crypto.randomUUID();
  const failed = await api(manager, "POST", "/api/internal/sales", {
    saleId: failedSale,
    operationId: failedOperation,
    couponCode: "ROLLBACK",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: rollbackCatalog.variantIds[0], quantity: 1 }],
  });
  expect(failed.status).toBe(400);
  expect(await couponUsedCount(manager, rollbackCoupon.body.id)).toBe(0);
  expect((await api(manager, "GET", `/api/internal/sales/operations/${failedOperation}`)).status).toBe(404);
  expect((await api(manager, "GET", `/api/internal/sales/${failedSale}`)).status).toBe(404);
  const unchanged = await api(manager, "GET", `/api/internal/catalog/lookup?code=${rollbackCatalog.code}`);
  expect(unchanged.status).toBe(200);
  expect(unchanged.body.variants[0].availableQuantity).toBe(0);
});

test("manager recovery claims a prepared coupon once and no-coupon replay retains the legacy fingerprint", async () => {
  const manager = await managerSession();
  const catalog = await seedCatalog(manager, "RECOVER", [9_000]);
  await receive(manager, catalog.variantIds[0]!, 3);
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "RECOVER-COUPON",
    usageLimit: 2,
    productIds: [catalog.productId],
  }));
  const preparedCoupon = {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: "RECOVER-COUPON",
    employeeDiscountPiasters: 0, lines: [{ variantId: catalog.variantIds[0], quantity: 1 }],
  };
  expect((await api(manager, "POST", "/api/internal/sales/prepare", preparedCoupon)).status).toBe(201);
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId: preparedCoupon.saleId,
    operationId: preparedCoupon.operationId,
    physicallyCompleted: true,
    occurredAt: new Date().toISOString(),
    pendingOperationIds: [],
  });
  expect(recovered.status).toBe(201);
  expect(recovered.body.appliedCoupon.code).toBe("RECOVER-COUPON");
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);
  expect((await api(manager, "POST", "/api/internal/sales/recover", {
    saleId: preparedCoupon.saleId,
    operationId: preparedCoupon.operationId,
    physicallyCompleted: true,
    occurredAt: new Date().toISOString(),
    pendingOperationIds: [],
  })).status).toBe(200);
  expect(await couponUsedCount(manager, coupon.body.id)).toBe(1);

  const legacy = {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0, lines: [{ variantId: catalog.variantIds[0], quantity: 1 }],
  };
  expect((await api(manager, "POST", "/api/internal/sales/prepare", legacy)).status).toBe(201);
  const oldCanonical = JSON.stringify({
    saleId: legacy.saleId,
    customerName: null,
    customerPhone: null,
    employeeDiscountPiasters: 0,
    discountReason: null,
    lines: legacy.lines,
  });
  const oldFingerprint = createHash("sha256").update(oldCanonical).digest("hex");
  // This is the one deliberate persistence assertion: the public DTO does not expose
  // the digest bytes needed to prove compatibility with pre-coupon durable records.
  const stored = await built.pool.query<{ payload_fingerprint: string }>(
    "SELECT payload_fingerprint FROM sales_sale WHERE id=$1",
    [legacy.saleId],
  );
  expect(stored.rows[0]?.payload_fingerprint).toBe(oldFingerprint);
  expect((await api(manager, "POST", "/api/internal/sales", { ...legacy, physicallyCompleted: true })).status).toBe(201);
  expect((await api(manager, "POST", "/api/internal/sales", { ...legacy, physicallyCompleted: true })).status).toBe(200);
});

test("invalid, expired, ineligible, and disallowed stacking coupons fail before completion", async () => {
  const manager = await managerSession();
  const eligible = await seedCatalog(manager, "VALIDATE", [10_000]);
  const other = await seedCatalog(manager, "OTHER", [10_000]);
  await receive(manager, eligible.variantIds[0]!, 3);
  await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "EXPIRED",
    startsOn: cairoDate(-2),
    endsOn: cairoDate(-1),
    productIds: [eligible.productId],
  }));
  await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "WRONG-SCOPE",
    productIds: [other.productId],
  }));
  await api(manager, "POST", "/api/internal/pricing/coupons", couponBody({
    code: "NO-STACK",
    allowAutomaticOffer: false,
    productIds: [eligible.productId],
  }));
  for (const [couponCode, message] of [
    ["MISSING", "كود الكوبون غير صالح."],
    ["EXPIRED", "الكوبون غير مفعل أو خارج فترة صلاحيته."],
    ["WRONG-SCOPE", "الكوبون غير مؤهل لهذه السلة."],
  ]) {
    const result = await api(manager, "POST", "/api/internal/sales/prepare", {
      saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode,
      employeeDiscountPiasters: 0, lines: [{ variantId: eligible.variantIds[0], quantity: 1 }],
    });
    expect(result.status).toBe(400);
    expect(result.body.error.messageAr).toBe(message);
  }

  const offer = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض يمنع الكوبون",
    allowCoupon: false,
    productIds: [eligible.productId],
  }));
  expect(offer.status).toBe(201);
  const blockedByOffer = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: "NO-STACK",
    employeeDiscountPiasters: 0, lines: [{ variantId: eligible.variantIds[0], quantity: 1 }],
  });
  expect(blockedByOffer.status).toBe(400);
  expect(blockedByOffer.body.error.messageAr).toBe("لا يمكن جمع هذا الكوبون مع العرض التلقائي.");

  expect((await api(manager, "PUT", `/api/internal/pricing/offers/${offer.body.id}`, offerBody({
    nameAr: "عرض يسمح بالكوبون",
    allowCoupon: true,
    productIds: [eligible.productId],
  }))).status).toBe(200);
  const blockedByCoupon = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: "NO-STACK",
    employeeDiscountPiasters: 0, lines: [{ variantId: eligible.variantIds[0], quantity: 1 }],
  });
  expect(blockedByCoupon.status).toBe(400);
  expect(blockedByCoupon.body.error.messageAr).toBe("لا يمكن جمع هذا الكوبون مع العرض التلقائي.");
});

test.each([
  { suffix: "FREE", rewardPercent: 10_000, offerSaving: 20_000, rewardPaid: 0, siblingPaid: 23_000 },
  { suffix: "HALF", rewardPercent: 5_000, offerSaving: 10_000, rewardPaid: 6_500, siblingPaid: 26_500 },
])("a $suffix reward keeps exact values through coupon, employee deduction and Returns", async (example) => {
  const manager = await managerSession();
  const catalog = await seedCatalog(manager, `REWARD-${example.suffix}`, [30_000, 20_000]);
  for (const variantId of catalog.variantIds) await receive(manager, variantId, 1);
  const rule = offerBody({
    discountType: "buy_x_get_y",
    percentageBasisPoints: null,
    buyQuantity: 1,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: example.rewardPercent,
    buyProductIds: [catalog.productId],
    rewardProductIds: [catalog.productId],
  });
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", rule);
  expect(offer.status).toBe(201);
  const code = `REWARD-${example.suffix}`;
  const couponRule = couponBody({ code, fixedDiscountPiasters: 5_000, productIds: [catalog.productId] });
  const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", couponRule);
  expect(coupon.status).toBe(201);
  const payload = {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), couponCode: code,
    employeeDiscountPiasters: 2_000,
    lines: catalog.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", payload);
  expect(prepared.status).toBe(201);
  expect(prepared.body).toMatchObject({
    automaticOfferDiscountPiasters: example.offerSaving,
    couponDiscountPiasters: 5_000,
    employeeDiscountPiasters: 2_000,
    finalTotalPiasters: example.rewardPaid + example.siblingPaid,
  });
  expect((await api(manager, "PUT", `/api/internal/pricing/offers/${offer.body.id}`, { ...rule, active: false })).status).toBe(200);
  expect((await api(manager, "PUT", `/api/internal/pricing/coupons/${coupon.body.id}`, { ...couponRule, active: false })).status).toBe(200);
  const completed = await api(manager, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true });
  expect(completed.status).toBe(201);
  const reward = completed.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[1]);
  const sibling = completed.body.lines.find((line: { variantId: string }) => line.variantId === catalog.variantIds[0]);
  expect(reward.paidPiasters).toBe(example.rewardPaid);
  expect(sibling.paidPiasters).toBe(example.siblingPaid);
  expect(completed.body.appliedAutomaticOffer).toEqual(prepared.body.appliedAutomaticOffer);
  expect(completed.body.appliedCoupon).toEqual(prepared.body.appliedCoupon);

  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: payload.saleId,
    handlingBranchId: abshwayId, authorizedRefundPiasters: example.rewardPaid,
    lines: [{ sourceSaleLineId: reward.id, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status, JSON.stringify(draft.body)).toBe(201);
  expect(draft.body.suggestedRefundPiasters).toBe(example.rewardPaid);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true, expectedRevision: draft.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  const reread = await api(manager, "GET", `/api/internal/sales/${payload.saleId}`);
  expect(reread.body.lines).toEqual(completed.body.lines);
  const coupons = await api(manager, "GET", "/api/internal/pricing/coupons");
  expect(coupons.body.find((entry: { id: string }) => entry.id === coupon.body.id).usedCount).toBe(1);
});

type Session = { cookie: string };

async function managerSession() {
  const session = await signIn("owner", "owner-pass-1");
  await api(session, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  return session;
}

async function cashierSession() {
  const session = await signIn("cashier.coupons", "staff-pass-81");
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

async function seedCatalog(manager: Session, prefix: string, prices: number[]) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const colors = await Promise.all(prices.map((_, index) => api(manager, "POST", "/api/internal/catalog/colors", {
    nameAr: `لون ${prefix} ${index + 1}`,
  })));
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `COUPON-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار الكوبونات",
    categoryId: category.body.id,
    defaultSellingPricePiasters: prices[0],
    publication: "hidden",
    imageRefs: [],
    variants: colors.map((color, index) => ({
      sizeId: size.body.id,
      colorId: color.body.id,
      sellingPricePiastersOverride: prices[index] === prices[0] ? null : prices[index],
    })),
  });
  expect(product.status).toBe(201);
  return {
    code: product.body.code as string,
    categoryId: category.body.id,
    productId: product.body.id,
    variantIds: prices.map((price) => product.body.variants.find((variant: { sellingPricePiasters: number }) =>
      variant.sellingPricePiasters === price)?.id as string),
  };
}

async function receive(manager: Session, variantId: string, quantity: number) {
  const response = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 500 }],
  });
  expect(response.status).toBe(201);
}

async function couponUsedCount(manager: Session, couponId: string) {
  const result = await api(manager, "GET", `/api/internal/pricing/coupons/${couponId}`);
  expect(result.status).toBe(200);
  return result.body.usedCount as number;
}

function couponBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: "SAVE",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 1_000,
    startsOn: cairoDate(),
    endsOn: cairoDate(),
    active: true,
    allowAutomaticOffer: true,
    usageLimit: 10,
    productIds: [],
    categoryIds: [],
    ...overrides,
  };
}

function offerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nameAr: "عرض تلقائي",
    discountType: "percentage",
    percentageBasisPoints: 1_000,
    fixedDiscountPiasters: null,
    startsOn: cairoDate(),
    endsOn: cairoDate(),
    active: true,
    allowCoupon: true,
    productIds: [],
    categoryIds: [],
    ...overrides,
  };
}

function cairoDate(offset = 0) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, (day ?? 1) + offset)).toISOString().slice(0, 10);
}
