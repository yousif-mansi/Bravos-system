import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let businessNow = new Date("2026-09-10T12:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_ONLINE_RETURNS_TEST_PORT ?? 55462) });
  const databaseName = `bravos_online_returns_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "online-returns-secret-online-returns-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-online-returns-outbox-")),
    businessClock: () => new Date(businessNow),
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='fayoum'"))
    .rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("a delivered purchase supports partial then cumulative-final Returns with one checkout-charge suggestion", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const purchase = await createDeliveredPurchase(manager, 2);
  expect(await available(purchase.productId)).toBe(0);

  businessNow = new Date("2026-09-16T12:00:00.000Z");
  const picked = await api(
    manager,
    "GET",
    `/api/internal/returns/sources?reference=${purchase.orderId}&channel=online`,
  );
  expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  expect(picked.body).toHaveLength(1);
  const source = picked.body[0];
  expect(source).toMatchObject({
    source: { kind: "delivered_online_order", id: purchase.orderId },
    reference: purchase.reference,
    channel: "online",
    originalBranch: { id: branchId },
    seller: null,
    receivedAt: "2026-09-10T12:00:00.000Z",
    originalPayment: {
      merchandisePiasters: 40000,
      checkoutChargePiasters: 2500,
      totalPiasters: 42500,
    },
    availableCheckoutChargePiasters: 2500,
    lines: [expect.objectContaining({
      sourceLineId: expect.any(String),
      purchasedQuantity: 2,
      remainingQuantity: 2,
      remainingSuggestedPiasters: 40000,
      availablePaidRanges: [{ quantity: 2, paidUnitPiasters: 20000 }],
    })],
  });
  const phoneLookup = await api(manager, "GET", "/api/internal/returns/sources?phone=01012345678&channel=online");
  expect(phoneLookup.status, JSON.stringify(phoneLookup.body)).toBe(200);
  expect(phoneLookup.body.map((row: { reference: string }) => row.reference)).toContain(purchase.reference);

  const first = await createReturn(manager, source, {
    merchandisePiasters: 20000,
    checkoutChargePiasters: 0,
  });
  expect(first.body).toMatchObject({
    suggestedRefund: {
      merchandisePiasters: 20000,
      checkoutChargePiasters: 0,
      totalPiasters: 20000,
    },
    authorizedRefund: {
      merchandisePiasters: 20000,
      checkoutChargePiasters: 0,
      totalPiasters: 20000,
    },
  });
  const firstPosted = await postReturn(manager, first.body.id, first.body.revision);
  expect(firstPosted.body).toMatchObject({
    source: { source: { kind: "delivered_online_order", id: purchase.orderId } },
    restorations: [expect.objectContaining({ batchId: purchase.batchId, quantity: 1, unitCostPiasters: 9000 })],
    refund: { status: "owed", owedPiasters: 20000, paidPiasters: 0 },
  });
  expect(await available(purchase.productId)).toBe(1);

  const afterPartial = await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`);
  expect(afterPartial.status, JSON.stringify(afterPartial.body)).toBe(200);
  expect(afterPartial.body[0]).toMatchObject({
    availableCheckoutChargePiasters: 2500,
    lines: [expect.objectContaining({ returnedQuantity: 1, remainingQuantity: 1, remainingSuggestedPiasters: 20000 })],
  });

  const finalDraft = await createReturn(manager, afterPartial.body[0], {
    merchandisePiasters: 20000,
    checkoutChargePiasters: 2500,
  });
  expect(finalDraft.body).toMatchObject({
    suggestedRefundPiasters: 22500,
    authorizedRefundPiasters: 22500,
    suggestedRefund: {
      merchandisePiasters: 20000,
      checkoutChargePiasters: 2500,
      totalPiasters: 22500,
    },
  });
  await postReturn(manager, finalDraft.body.id, finalDraft.body.revision);
  expect(await available(purchase.productId)).toBe(2);

  const exhausted = await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`);
  expect(exhausted.status, JSON.stringify(exhausted.body)).toBe(200);
  expect(exhausted.body[0]).toMatchObject({
    availableCheckoutChargePiasters: 0,
    lines: [expect.objectContaining({ returnedQuantity: 2, remainingQuantity: 0 })],
  });
});

test("an online Return correction reverses its exact stock and protected-allocation effects", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const purchase = await createDeliveredPurchase(manager, 1);
  businessNow = new Date("2026-09-16T12:00:00.000Z");
  const picked = await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`);
  const draft = await createReturn(manager, picked.body[0], {
    merchandisePiasters: 20000,
    checkoutChargePiasters: 2500,
  });
  const posted = await postReturn(manager, draft.body.id, draft.body.revision);
  expect(await available(purchase.productId)).toBe(1);
  const detail = await api(manager, "GET", `/api/internal/corrections/returns/${posted.body.id}`);
  expect(detail.status, JSON.stringify(detail.body)).toBe(200);
  expect(detail.body).toMatchObject({
    source: { kind: "delivered_online_order", id: purchase.orderId },
    original: { authorizedRefund: { merchandisePiasters: 20000, checkoutChargePiasters: 2500, totalPiasters: 22500 } },
  });
  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${posted.body.id}`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    type: "cancellation",
    reason: "تم تسجيل استلام غير صحيح",
    effective: null,
    merchandise: [{ lineId: detail.body.original.lines[0].returnLineId, quantityDelta: -1 }],
    cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  expect(cancelled.body).toMatchObject({ status: "cancelled", effective: null });
  expect(await available(purchase.productId)).toBe(0);
  const sourceAgain = await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`);
  expect(sourceAgain.body[0]).toMatchObject({
    availableCheckoutChargePiasters: 2500,
    lines: [expect.objectContaining({ remainingQuantity: 1, returnedQuantity: 0 })],
  });
});

test("cancelling the later Return deducts its own retained batch rather than the earlier batch", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const purchase = await createDeliveredPurchase(manager, 2, [9000, 13000]);
  businessNow = new Date("2026-09-16T12:00:00.000Z");
  const original = (await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`)).body[0];
  const first = await createReturn(manager, original, { merchandisePiasters: 20000, checkoutChargePiasters: 0 });
  await postReturn(manager, first.body.id, first.body.revision);
  const remaining = (await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`)).body[0];
  const second = await createReturn(manager, remaining, { merchandisePiasters: 20000, checkoutChargePiasters: 2500 });
  const secondPosted = await postReturn(manager, second.body.id, second.body.revision);
  const detail = await api(manager, "GET", `/api/internal/corrections/returns/${secondPosted.body.id}`);
  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${secondPosted.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation",
    reason: "إلغاء المرتجع الثاني", effective: null,
    merchandise: [{ lineId: detail.body.original.lines[0].returnLineId, quantityDelta: -1 }], cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  const batches = await built.pool.query<{ id: string; remaining_quantity: number }>(
    `SELECT batch_id AS id,remaining_quantity FROM inventory_batch_balance
     WHERE batch_id=ANY($1::uuid[]) AND branch_id=$2`, [purchase.batchIds, branchId]);
  expect(new Map(batches.rows.map((row) => [row.id, row.remaining_quantity]))).toEqual(new Map([
    [purchase.batchIds[0], 1],
    [purchase.batchIds[1], 0],
  ]));
});

test("cancelling an earlier differently-paid Return preserves the later unit identity", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const offered = await createDeliveredPurchase(manager, 2, [9000], async ({ productId }) => {
    const offer = await api(manager, "POST", "/api/internal/pricing/offers", {
      nameAr: "وحدة مجانية للمرتجع الإلكتروني", discountType: "buy_x_get_y",
      percentageBasisPoints: null, fixedDiscountPiasters: null, bundlePricePiasters: null,
      bundleItems: [], buyQuantity: 1, rewardQuantity: 1, rewardPercentageBasisPoints: 10000,
      buyProductIds: [productId], buyCategoryIds: [], rewardProductIds: [productId],
      rewardCategoryIds: [], startsOn: "2026-09-01", endsOn: "2026-09-30", active: true,
      allowCoupon: true, productIds: [], categoryIds: [],
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
  });
  businessNow = new Date("2026-09-16T12:00:00.000Z");
  const original = (await api(manager, "GET", `/api/internal/returns/sources?reference=${offered.orderId}`)).body[0];
  expect(original.lines[0].availablePaidRanges).toHaveLength(2);
  const firstPaid = original.lines[0].availablePaidRanges[0].paidUnitPiasters as number;
  const secondPaid = original.lines[0].availablePaidRanges[1].paidUnitPiasters as number;
  expect(new Set([firstPaid, secondPaid])).toEqual(new Set([0, 20000]));
  const first = await createReturn(manager, original, { merchandisePiasters: firstPaid, checkoutChargePiasters: 0 });
  await postReturn(manager, first.body.id, first.body.revision);
  const remaining = (await api(manager, "GET", `/api/internal/returns/sources?reference=${offered.orderId}`)).body[0];
  const second = await createReturn(manager, remaining, { merchandisePiasters: secondPaid, checkoutChargePiasters: 2500 });
  await postReturn(manager, second.body.id, second.body.revision);
  const detail = await api(manager, "GET", `/api/internal/corrections/returns/${first.body.id}`);
  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${first.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation",
    reason: "إلغاء المرتجع الأول فقط", effective: null,
    merchandise: [{ lineId: detail.body.original.lines[0].returnLineId, quantityDelta: -1 }], cash: null,
  });
  expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
  const reopened = (await api(manager, "GET", `/api/internal/returns/sources?reference=${offered.orderId}`)).body[0];
  expect(reopened.lines[0]).toMatchObject({ remainingQuantity: 1, remainingSuggestedPiasters: firstPaid });
  expect(reopened.lines[0].availablePaidRanges).toEqual([{ quantity: 1, paidUnitPiasters: firstPaid }]);
});

test("a Delivered source can be exchanged atomically without creating a fake source Sale", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await expectOk(await api(manager, "POST", "/api/internal/active-branch", { branchId }));
  const purchase = await createDeliveredPurchase(manager, 1);
  businessNow = new Date("2026-09-16T12:00:00.000Z");
  const picked = await api(manager, "GET", `/api/internal/returns/sources?reference=${purchase.orderId}`);
  const draft = await createReturn(manager, picked.body[0], {
    merchandisePiasters: 20000,
    checkoutChargePiasters: 2500,
  });
  const sourceLine = picked.body[0].lines[0];
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, sourceLine.variantId);
  expect(quote.body).toMatchObject({
    replacementMerchandisePiasters: 20000,
    creditAvailablePiasters: 22500,
    creditAppliedPiasters: 20000,
    cashRefundPiasters: 2500,
  });
  const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement,
    quoteId: quote.body.id,
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
    cashRefundStatus: "owed",
  });
  expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(201);
  expect(exchanged.body).toMatchObject({
    source: { source: { kind: "delivered_online_order", id: purchase.orderId } },
    exchange: {
      replacementMerchandisePiasters: 20000,
      creditAppliedPiasters: 20000,
      cashCollectedPiasters: 0,
      cashRefund: { status: "owed", owedPiasters: 2500, paidPiasters: 0 },
    },
    refund: { status: "owed", owedPiasters: 2500 },
  });
  expect(await available(purchase.productId)).toBe(0);
  const sourceSaleRows = await built.pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sales_sale WHERE id=$1`, [purchase.orderId]);
  expect(sourceSaleRows.rows[0]?.count).toBe("0");
});

async function createReturn(
  manager: Session,
  source: { source: { kind: string; id: string }; lines: Array<{ sourceLineId: string }> },
  authorizedRefund: { merchandisePiasters: number; checkoutChargePiasters: number },
) {
  const response = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    source: source.source,
    handlingBranchId: branchId,
    authorizedRefund,
    lines: [{ sourceLineId: source.lines[0]!.sourceLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response;
}

async function postReturn(manager: Session, returnId: string, expectedRevision: number) {
  const response = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    expectedRevision,
    receivedAndInspected: true,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response;
}

async function exchangeQuote(manager: Session, returnId: string, expectedRevision: number, variantId: string) {
  const response = await api(manager, "POST", `/api/internal/returns/${returnId}/exchange-quote`, {
    quoteId: crypto.randomUUID(), expectedRevision,
    exchangeId: crypto.randomUUID(), operationId: crypto.randomUUID(),
    replacementSaleId: crypto.randomUUID(), replacementSaleOperationId: crypto.randomUUID(),
    replacementLines: [{ variantId, quantity: 1 }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response;
}

async function createDeliveredPurchase(
  manager: Session,
  quantity: number,
  unitCosts: number[] = [9000],
  beforeCheckout?: (product: { productId: string; variantId: string }) => Promise<void>,
) {
  businessNow = new Date("2026-09-09T08:00:00.000Z");
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `ONLINE-RETURN-${suffix}`,
    nameAr: `منتج مرتجع ${suffix}`,
    descriptionAr: "منتج لاختبار إرجاع طلب مسلم",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  const receipts = [];
  for (const [index, unitCostPiasters] of unitCosts.entries()) {
    businessNow = new Date(`2026-09-09T${String(8 + index).padStart(2, "0")}:00:00.000Z`);
    const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(),
      receiptDate: "2026-09-09",
      branchId,
      lines: [{ variantId, quantity: unitCosts.length === 1 ? quantity : 1, unitCostPiasters }],
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    receipts.push(receipt);
  }
  await beforeCheckout?.({ productId: product.body.id as string, variantId });
  businessNow = new Date("2026-09-10T10:00:00.000Z");
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${suffix}`,
    feePiasters: 2500,
    active: true,
  });
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [{ variantId, quantity }],
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submitted = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId: area.body.id,
    lines: [{ variantId, quantity }],
    customerName: "عميل الإرجاع الإلكتروني",
    primaryPhone: "01012345678",
    detailedAddress: "عنوان اختبار الإرجاع الإلكتروني",
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const orderId = submitted.body.orderId as string;
  const reviewed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity }],
  });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: reviewed.body.quoteId,
    reviewDigest: reviewed.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    fulfillmentBranchId: branchId,
    itemsLocatedAndSetAside: true,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  businessNow = new Date("2026-09-10T12:00:00.000Z");
  const delivered = await api(manager, "POST", `/api/internal/online-orders/${orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: "2026-09-10T12:00:00.000Z",
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
  return {
    orderId,
    reference: delivered.body.result.reference as string,
    productId: product.body.id as string,
    variantId,
    batchId: receipts[0]!.body.lines[0].batchId as string,
    batchIds: receipts.map((receipt) => receipt.body.lines[0].batchId as string),
  };
}

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

async function available(productId: string): Promise<number> {
  const product = await publicApi("GET", `/api/public/catalog/products/${productId}`);
  expect(product.status, JSON.stringify(product.body)).toBe(200);
  return product.body.variants[0].availableQuantity;
}

async function expectOk(response: { status: number; body: unknown }) {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}
