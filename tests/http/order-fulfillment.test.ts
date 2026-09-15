import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_FULFILLMENT_TEST_PORT ?? 55463) });
  const databaseName = `bravos_fulfillment_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-fulfillment-outbox-")),
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='fayoum'")).rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("confirmed order ships without deducting its protected stock again", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "SHIP", 2);
  const pendingJump = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/ship`, {
    operationId: crypto.randomUUID(), expectedRevision: 1,
  });
  expect(pendingJump.status).toBe(409);
  const confirmed = await confirmOrder(manager, seeded.orderId, seeded.variantId, 1);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  expect(await available(seeded.productId)).toBe(1);

  const deliveryJump = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/deliver`, {
    operationId: crypto.randomUUID(), expectedRevision: confirmed.body.revision,
    customerReceivedAt: new Date().toISOString(),
  });
  expect(deliveryJump.status).toBe(409);

  const shipped = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });

  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  expect(shipped.body).toMatchObject({
    created: true,
    result: { id: seeded.orderId, status: "shipped" },
  });
  expect(await available(seeded.productId)).toBe(1);
});

test("shipment then customer receipt completes only the delivered order and rejects invalid receipt times", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "DELIVER", 2);
  const confirmed = await confirmOrder(manager, seeded.orderId, seeded.variantId, 1);
  const shipOperationId = crypto.randomUUID();
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/ship`, {
    operationId: shipOperationId,
    expectedRevision: confirmed.body.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  expect(shipped.body.result.shippedAt).toEqual(expect.any(String));

  const future = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: "2999-01-01T00:00:00.000Z",
  });
  expect(future.status).toBe(400);
  expect(future.body.error.code).toBe("VALIDATION");

  const delivered = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: shipped.body.result.shippedAt,
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
  expect(delivered.body.result).toMatchObject({ status: "delivered", deliveredAt: shipped.body.result.shippedAt });
  expect(await available(seeded.productId)).toBe(1);

  const completed = await api(manager, "GET", "/api/internal/completed-online-orders");
  expect(completed.status).toBe(200);
  expect(completed.body).toContainEqual(expect.objectContaining({
    orderId: seeded.orderId,
    deliveredAt: shipped.body.result.shippedAt,
    finalTotalPiasters: 22500,
  }));
});

test("pending cancellation restores nothing while confirmed cancellation restores stock and releases its coupon once", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const pending = await seedOrder(manager, "CANCEL-PENDING", 1);
  const pendingPayload = {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    reason: "طلب العميل الإلغاء قبل التأكيد",
  };
  const cancelledPending = await api(manager, "POST", `/api/internal/online-orders/${pending.orderId}/cancel-before-shipment`, pendingPayload);
  expect(cancelledPending.status, JSON.stringify(cancelledPending.body)).toBe(201);
  expect(cancelledPending.body.result).toMatchObject({ status: "cancelled_before_shipment", confirmedAt: null });
  expect(await available(pending.productId)).toBe(1);
  const pendingReplay = await api(manager, "POST", `/api/internal/online-orders/${pending.orderId}/cancel-before-shipment`, pendingPayload);
  expect(pendingReplay.status).toBe(200);
  expect(pendingReplay.body).toMatchObject({ created: false, result: { status: "cancelled_before_shipment" } });

  const couponCode = `FUL${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const confirmedSeed = await seedOrder(manager, "CANCEL-CONFIRMED", 1, 1, couponCode);
  const confirmed = await confirmOrder(manager, confirmedSeed.orderId, confirmedSeed.variantId, 1, couponCode);
  expect(await available(confirmedSeed.productId)).toBe(0);
  expect(await couponUse(manager, couponCode)).toBe(1);
  const payload = {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
    reason: "إلغاء مؤكد قبل تسليم الشحنة",
  };
  const cancelled = await api(manager, "POST", `/api/internal/online-orders/${confirmedSeed.orderId}/cancel-before-shipment`, payload);
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  expect(await available(confirmedSeed.productId)).toBe(1);
  expect(await couponUse(manager, couponCode)).toBe(0);
  const replay = await api(manager, "POST", `/api/internal/online-orders/${confirmedSeed.orderId}/cancel-before-shipment`, payload);
  expect(replay.status).toBe(200);
  expect(await available(confirmedSeed.productId)).toBe(1);
  expect(await couponUse(manager, couponCode)).toBe(0);
});

test("failed parcel stays protected until manager posts partial inspections and closes only after every unit is classified", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const representative = await createEmployee(manager, "failed.rep", true);
  const cashier = await createEmployee(manager, "failed.cashier", false);
  const couponCode = `FAIL${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const seeded = await seedOrder(manager, "FAILED", 3, 3, couponCode);
  const confirmed = await confirmOrder(manager, seeded.orderId, seeded.variantId, 3, couponCode);
  const shipped = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/ship`, {
    operationId: crypto.randomUUID(), expectedRevision: confirmed.body.revision,
  });
  const courierCancellation = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/cancel-before-shipment`, {
    operationId: crypto.randomUUID(), expectedRevision: shipped.body.result.revision,
    reason: "محاولة غير مسموحة بعد خروج الشحنة",
  });
  expect(courierCancellation.status).toBe(409);
  const failed = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/delivery-failure`, {
    operationId: crypto.randomUUID(), expectedRevision: shipped.body.result.revision, reason: "العميل لم يستلم الشحنة",
  });
  expect(failed.status, JSON.stringify(failed.body)).toBe(201);
  expect(await available(seeded.productId)).toBe(0);

  const wrongDraft = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: failed.body.result.revision,
    lines: [{ variantId: seeded.variantId, receivedQuantity: 1, sellableQuantity: 1 }],
  });
  expect(wrongDraft.status, JSON.stringify(wrongDraft.body)).toBe(201);
  const wrongInspection = wrongDraft.body.result.failedReturnInspections[0];
  const abandoned = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${wrongInspection.id}/abandon`, {
    operationId: crypto.randomUUID(), expectedRevision: wrongDraft.body.result.revision,
    reason: "تم إدخال حالة الصنف بصورة غير صحيحة",
  });
  expect(abandoned.status, JSON.stringify(abandoned.body)).toBe(201);
  expect(abandoned.body.result.failedReturnInspections[0]).toMatchObject({
    status: "abandoned",
    abandonmentReason: "تم إدخال حالة الصنف بصورة غير صحيحة",
  });
  expect(await available(seeded.productId)).toBe(0);
  expect(await couponUse(manager, couponCode)).toBe(1);
  const postAbandoned = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${wrongInspection.id}/post`, {
    operationId: crypto.randomUUID(), expectedRevision: abandoned.body.result.revision,
  });
  expect(postAbandoned.status).toBe(404);

  const firstDraft = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: abandoned.body.result.revision,
    lines: [{ variantId: seeded.variantId, receivedQuantity: 2, sellableQuantity: 1 }],
  });
  expect(firstDraft.status, JSON.stringify(firstDraft.body)).toBe(201);
  expect(await available(seeded.productId)).toBe(0);
  const firstInspection = firstDraft.body.result.failedReturnInspections.find((item: { status: string }) => item.status === "draft");

  const employeePost = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${firstInspection.id}/post`, {
    operationId: crypto.randomUUID(), expectedRevision: firstDraft.body.result.revision,
  });
  expect(employeePost.status).toBe(403);
  const cashierDraft = await api(cashier, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: firstDraft.body.result.revision,
    lines: [{ variantId: seeded.variantId, receivedQuantity: 1, sellableQuantity: 1 }],
  });
  expect(cashierDraft.status).toBe(403);

  const firstPostPayload = { operationId: crypto.randomUUID(), expectedRevision: firstDraft.body.result.revision };
  const firstPost = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${firstInspection.id}/post`, firstPostPayload);
  expect(firstPost.status, JSON.stringify(firstPost.body)).toBe(201);
  expect(await available(seeded.productId)).toBe(1);
  const postReplay = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${firstInspection.id}/post`, firstPostPayload);
  expect(postReplay.status).toBe(200);
  expect(await available(seeded.productId)).toBe(1);

  const tooEarly = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/close-failed-delivery`, {
    operationId: crypto.randomUUID(), expectedRevision: firstPost.body.result.revision, reason: "إغلاق مبكر",
  });
  expect(tooEarly.status).toBe(409);
  expect(await couponUse(manager, couponCode)).toBe(1);

  const secondDraft = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: firstPost.body.result.revision,
    lines: [{ variantId: seeded.variantId, receivedQuantity: 1, sellableQuantity: 0 }],
  });
  expect(secondDraft.status, JSON.stringify(secondDraft.body)).toBe(201);
  const secondInspection = secondDraft.body.result.failedReturnInspections.find((item: { status: string }) => item.status === "draft");
  const secondPost = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections/${secondInspection.id}/post`, {
    operationId: crypto.randomUUID(), expectedRevision: secondDraft.body.result.revision,
  });
  expect(secondPost.status, JSON.stringify(secondPost.body)).toBe(201);
  expect(await available(seeded.productId)).toBe(1);
  const duplicateReceipt = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/failed-return-inspections`, {
    operationId: crypto.randomUUID(), expectedRevision: secondPost.body.result.revision,
    lines: [{ variantId: seeded.variantId, receivedQuantity: 1, sellableQuantity: 1 }],
  });
  expect(duplicateReceipt.status).toBe(400);

  const employeeClose = await api(representative, "POST", `/api/internal/online-orders/${seeded.orderId}/close-failed-delivery`, {
    operationId: crypto.randomUUID(), expectedRevision: secondPost.body.result.revision, reason: "إغلاق",
  });
  expect(employeeClose.status).toBe(403);
  const closed = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/close-failed-delivery`, {
    operationId: crypto.randomUUID(), expectedRevision: secondPost.body.result.revision, reason: "استلمنا وفحصنا كامل الشحنة",
  });
  expect(closed.status, JSON.stringify(closed.body)).toBe(201);
  expect(closed.body.result.status).toBe("cancelled_after_failed_delivery");
  expect(await available(seeded.productId)).toBe(1);
  expect(await couponUse(manager, couponCode)).toBe(0);
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

async function api(
  session: Session | undefined,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
  origin = INTERNAL_ORIGIN,
) {
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

async function seedOrder(
  manager: Session,
  prefix: string,
  quantity: number,
  orderQuantity = 1,
  couponCode?: string,
) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `FULFILL-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار التسليم",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  if (couponCode) {
    const coupon = await api(manager, "POST", "/api/internal/pricing/coupons", {
      code: couponCode,
      discountType: "fixed",
      percentageBasisPoints: null,
      fixedDiscountPiasters: 1000,
      startsOn: cairoDate(),
      endsOn: cairoDate(),
      active: true,
      allowAutomaticOffer: true,
      usageLimit: 1,
      productIds: [product.body.id],
      categoryIds: [],
    });
    expect(coupon.status, JSON.stringify(coupon.body)).toBe(201);
  }
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: cairoDate(),
    lines: [{ variantId, quantity, unitCostPiasters: 9000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${prefix}`,
    feePiasters: 2500,
    active: true,
  });
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    ...(couponCode ? { couponCode } : {}),
    lines: [{ variantId, quantity: orderQuantity }],
  });
  const submitted = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId: area.body.id,
    ...(couponCode ? { couponCode } : {}),
    lines: [{ variantId, quantity: orderQuantity }],
    customerName: "عميل التسليم",
    primaryPhone: "01012345678",
    detailedAddress: "عنوان اختبار التسليم",
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return { orderId: submitted.body.orderId as string, productId: product.body.id as string, variantId: variantId as string };
}

async function confirmOrder(
  manager: Session,
  orderId: string,
  variantId: string,
  quantity: number,
  couponCode?: string,
) {
  const review = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity }],
    ...(couponCode ? { couponCode } : {}),
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  return api(manager, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    itemsLocatedAndSetAside: true,
  });
}

async function couponUse(manager: Session, code: string): Promise<number> {
  const coupons = await api(manager, "GET", "/api/internal/pricing/coupons");
  expect(coupons.status, JSON.stringify(coupons.body)).toBe(200);
  return coupons.body.find((coupon: { code: string }) => coupon.code === code)?.usedCount ?? -1;
}

async function createEmployee(manager: Session, loginName: string, orderRepresentative: boolean): Promise<Session> {
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: `موظف ${loginName}`,
    password: "staff-pass-1",
    grants: [{ branchId, cashier: !orderRepresentative, orderRepresentative }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const session = await signIn(loginName, "staff-pass-1");
  const activated = await api(session, "POST", "/api/internal/active-branch", { branchId });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  return session;
}

async function available(productId: string): Promise<number> {
  const product = await publicApi("GET", `/api/public/catalog/products/${productId}`);
  expect(product.status, JSON.stringify(product.body)).toBe(200);
  return product.body.variants[0].availableQuantity;
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
