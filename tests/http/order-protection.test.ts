import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
const now = new Date("2026-09-15T09:00:00.000Z");

let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({
    port: Number(process.env.BRAVOS_ORDER_PROTECTION_TEST_PORT ?? 55459),
  });
  const databaseName = `bravos_order_protection_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-order-protection-outbox-")),
    businessClock: () => now,
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

test("protected confirmation cannot be re-exposed by a positive count correction while a real receiving correction adds capacity", async () => {
  const manager = await managerSession();
  const seeded = await seedProduct(manager, "CAPACITY", 30_000);
  const receipt = await receive(manager, seeded.variantId, 5, 10_000);
  const area = await createArea(manager, "مدينة الفيوم CAPACITY", 5_000);
  const order = await submitOrder(area.id, seeded.variantId, 2);
  await agreeAndConfirm(manager, order.orderId, seeded.variantId, 2);

  expect(await available(seeded.productId)).toBe(3);
  const coordination = await api(manager, "POST", "/api/internal/inventory/count-coordination", {
    operationId: crypto.randomUUID(),
  });
  expect(coordination.status, JSON.stringify(coordination.body)).toBe(201);
  const rejected = await api(manager, "POST", "/api/internal/inventory/stock-corrections", {
    operationId: crypto.randomUUID(),
    coordinationId: coordination.body.id,
    variantId: seeded.variantId,
    previousAvailableQuantity: 3,
    correctedAvailableQuantity: 5,
    reason: "القطع المؤكدة ليست ضمن المتاح المعدود",
    positiveSourceBatchId: receipt.body.lines[0].batchId,
  });
  expect(rejected.status).toBe(400);
  expect(await available(seeded.productId)).toBe(3);

  const cancelled = await api(manager, "POST", "/api/internal/inventory/count-coordination/cancel", {
    operationId: crypto.randomUUID(),
    coordinationId: coordination.body.id,
  });
  expect(cancelled.status).toBe(200);
  const correctedReceipt = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      reason: "الكمية الفعلية المستلمة سبع قطع",
      lines: [{
        lineId: receipt.body.lines[0].id,
        quantity: 7,
        unitCostPiasters: 10_000,
      }],
    },
  );
  expect(correctedReceipt.status, JSON.stringify(correctedReceipt.body)).toBe(201);
  expect(correctedReceipt.body.lines[0]).toMatchObject({
    effectiveQuantity: 7,
    remainingQuantity: 5,
    allocatedQuantity: 2,
  });
  expect(await available(seeded.productId)).toBe(5);
});

test("a paid physical sale remains recorded with an unallocated discrepancy after confirmation wins the unit", async () => {
  const manager = await managerSession();
  const seeded = await seedProduct(manager, "PAID", 22_000);
  await receive(manager, seeded.variantId, 1, 9_000);
  const area = await createArea(manager, "سنورس PAID", 3_000);
  const order = await submitOrder(area.id, seeded.variantId, 1);
  const agreement = await agreeOrder(manager, order.orderId, seeded.variantId, 1);

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const salePayload = {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seeded.variantId, quantity: 1 }],
  };
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", salePayload);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  const confirmed = await confirmOrder(manager, order.orderId, agreement.version);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);

  const paid = await api(manager, "POST", "/api/internal/sales", {
    ...salePayload,
    physicallyCompleted: true,
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  expect(paid.body).toMatchObject({
    id: saleId,
    physicallyCompleted: true,
    costsIncomplete: true,
    lines: [{ allocatedQuantity: 0, unallocatedQuantity: 1 }],
    discrepancy: { unallocatedQuantity: 1 },
  });
  expect(await available(seeded.productId)).toBe(0);
  const retainedOrder = await api(manager, "GET", `/api/internal/online-orders/${order.orderId}`);
  expect(retainedOrder.body).toMatchObject({ status: "confirmed", confirmedQuote: { lines: [{ quantity: 1 }] } });
  const retainedSale = await api(manager, "GET", `/api/internal/sales/${saleId}`);
  expect(retainedSale.body).toMatchObject({ id: saleId, costsIncomplete: true, allocations: [] });
});

test("protected FIFO quantities retain original and effective batch-cost provenance through receiving corrections", async () => {
  const manager = await managerSession();
  const seeded = await seedProduct(manager, "FIFO", 40_000);
  const oldReceipt = await receive(manager, seeded.variantId, 2, 10_000, "2026-09-13");
  const newReceipt = await receive(manager, seeded.variantId, 3, 14_000, "2026-09-14");
  const area = await createArea(manager, "إطسا FIFO", 4_000);
  const order = await submitOrder(area.id, seeded.variantId, 3);
  const confirmed = await agreeAndConfirm(manager, order.orderId, seeded.variantId, 3);

  expect(confirmed.body.status).toBe("confirmed");
  expect(JSON.stringify(confirmed.body)).not.toMatch(/unitCostPiasters|effectiveUnitCostPiasters|batchId/);
  expect(await available(seeded.productId)).toBe(2);
  let batches = (await api(manager, "GET", "/api/internal/inventory/batches")).body;
  expect(batches.find((batch: { id: string }) => batch.id === oldReceipt.body.lines[0].batchId)).toMatchObject({
    receivedQuantity: 2,
    effectiveReceivedQuantity: 2,
    remainingQuantity: 0,
    unitCostPiasters: 10_000,
    effectiveUnitCostPiasters: 10_000,
  });
  expect(batches.find((batch: { id: string }) => batch.id === newReceipt.body.lines[0].batchId)).toMatchObject({
    receivedQuantity: 3,
    effectiveReceivedQuantity: 3,
    remainingQuantity: 2,
    unitCostPiasters: 14_000,
    effectiveUnitCostPiasters: 14_000,
  });

  const oldCorrection = await correctReceipt(manager, oldReceipt, 2, 11_000);
  expect(oldCorrection.body.lines[0]).toMatchObject({
    quantity: 2,
    effectiveQuantity: 2,
    remainingQuantity: 0,
    allocatedQuantity: 2,
    unitCostPiasters: 10_000,
    effectiveUnitCostPiasters: 11_000,
  });
  const newCorrection = await correctReceipt(manager, newReceipt, 4, 15_000);
  expect(newCorrection.body.lines[0]).toMatchObject({
    quantity: 3,
    effectiveQuantity: 4,
    remainingQuantity: 3,
    allocatedQuantity: 1,
    unitCostPiasters: 14_000,
    effectiveUnitCostPiasters: 15_000,
  });
  expect(await available(seeded.productId)).toBe(3);

  batches = (await api(manager, "GET", "/api/internal/inventory/batches")).body;
  expect(batches.find((batch: { id: string }) => batch.id === oldReceipt.body.lines[0].batchId)).toMatchObject({
    remainingQuantity: 0,
    unitCostPiasters: 10_000,
    effectiveUnitCostPiasters: 11_000,
  });
  expect(batches.find((batch: { id: string }) => batch.id === newReceipt.body.lines[0].batchId)).toMatchObject({
    remainingQuantity: 3,
    unitCostPiasters: 14_000,
    effectiveUnitCostPiasters: 15_000,
  });
});

type Session = { cookie: string };
type ReceiptResponse = {
  body: {
    id: string;
    lines: Array<{ id: string; batchId: string }>;
  };
};

async function managerSession(): Promise<Session> {
  const manager = await signIn("owner", "owner-pass-1");
  const selected = await api(manager, "POST", "/api/internal/active-branch", { branchId });
  expect(selected.status).toBe(200);
  return manager;
}

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
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  origin = INTERNAL_ORIGIN,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  return api(undefined, method, url, payload, PUBLIC_ORIGIN);
}

async function seedProduct(manager: Session, prefix: string, price: number) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `PROTECT-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار حماية الطلب",
    categoryId: category.body.id,
    defaultSellingPricePiasters: price,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  return { productId: product.body.id as string, variantId: product.body.variants[0].id as string };
}

async function receive(
  manager: Session,
  variantId: string,
  quantity: number,
  unitCostPiasters: number,
  receiptDate = cairoDate(),
) {
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate,
    lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  return receipt;
}

async function correctReceipt(
  manager: Session,
  receipt: ReceiptResponse,
  quantity: number,
  unitCostPiasters: number,
) {
  const corrected = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      reason: "تصحيح فاتورة المورد",
      lines: [{ lineId: receipt.body.lines[0].id, quantity, unitCostPiasters }],
    },
  );
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(201);
  return corrected;
}

async function createArea(manager: Session, nameAr: string, feePiasters: number) {
  const area = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr, feePiasters, active: true });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  return area.body;
}

async function submitOrder(deliveryAreaId: string, variantId: string, quantity: number) {
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId,
    lines: [{ variantId, quantity }],
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const submitted = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId,
    lines: [{ variantId, quantity }],
    customerName: "عميل حماية",
    primaryPhone: "01012345678",
    detailedAddress: "شارع الجمهورية، منزل ١٠",
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return submitted.body;
}

async function agreeOrder(manager: Session, orderId: string, variantId: string, quantity: number) {
  const review = await api(manager, "POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId, quantity }],
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
  return { version: agreed.body.revision as number };
}

async function confirmOrder(manager: Session, orderId: string, agreedRevision: number) {
  return api(manager, "POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreedRevision,
    agreedRevision,
    itemsLocatedAndSetAside: true,
  });
}

async function agreeAndConfirm(
  manager: Session,
  orderId: string,
  variantId: string,
  quantity: number,
) {
  const agreement = await agreeOrder(manager, orderId, variantId, quantity);
  const confirmed = await confirmOrder(manager, orderId, agreement.version);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  return confirmed;
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
  }).format(now);
}
