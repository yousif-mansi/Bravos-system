import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";
let manager: { cookie: string };
let businessNow = new Date("2026-09-15T12:00:00.000Z");

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_SYSTEM_RETURNS_TEST_PORT ?? 55492) });
}, 120_000);
afterAll(async () => { if (built) await built.close(); if (cluster) await cluster.stop(); });
beforeEach(async () => {
  if (built) await built.close();
  businessNow = new Date("2026-09-15T12:00:00.000Z");
  const database = `bravos_source_pages_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test", databaseUrl: cluster.connectionString(database),
    authSecret: "source-pages-secret-source-pages-32",
    authBaseUrl: "http://127.0.0.1:3010", internalOrigin: INTERNAL_ORIGIN, publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"], secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-source-pages-")),
    businessClock: () => new Date(businessNow),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id,code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")!.id;
  fayoumId = branches.rows.find((row) => row.code === "fayoum")!.id;
  await ensureOwner(built.services, { loginName: "owner", displayName: "مدير صفحات الإرجاع", password: "owner-pass-1" });
  const signed = await built.app.inject({
    method: "POST", url: "/api/auth/sign-in/username", headers: { origin: INTERNAL_ORIGIN },
    payload: { username: "owner", password: "owner-pass-1" },
  });
  expect(signed.statusCode).toBe(200);
  const cookies = signed.headers["set-cookie"];
  manager = { cookie: (Array.isArray(cookies) ? cookies : [cookies!]).map((value) => value.split(";")[0]).join("; ") };
  await expectStatus(api("POST", "/api/internal/active-branch", { branchId: abshwayId }), 200);
});

test("more than 100 purchases per channel page without loss at microsecond, UUID and channel ties", async () => {
  const fixture = await merchandise(500);
  const phone = "01012345678";
  const expected: Array<{ id: string; channel: string; timestamp: string }> = [];
  for (let index = 0; index < 101; index += 1) {
    const online = await deliveredPurchase(fixture, { phone: "010 1234-5678" });
    const storedPhone = ["٠١٠١٢٣٤٥٦٧٨", "۰۱۰۱۲۳۴۵۶۷۸", "010 (1234) 5678"][index % 3]!;
    const physical = await physicalPurchase(fixture.variantId, { id: online.id, phone: storedPhone });
    const onlineTime = `2026-09-10T12:00:00.${String(index * 2 + 1).padStart(6, "0")}Z`;
    const physicalTime = index % 3 === 0 ? onlineTime
      : `2026-09-10T12:00:00.${String(index * 2 + 2).padStart(6, "0")}Z`;
    // API dates use JS milliseconds; retain genuine PostgreSQL microsecond receipt facts in this isolated fixture.
    await built.pool.query("UPDATE sales_sale SET occurred_at=$2::timestamptz WHERE id=$1", [physical.id, physicalTime]);
    await built.pool.query("UPDATE online_order_fulfillment_event SET occurred_at=$2::timestamptz WHERE order_id=$1 AND event_type='delivered'", [online.id, onlineTime]);
    expected.push({ id: online.id, channel: "online", timestamp: onlineTime }, { id: physical.id, channel: "physical", timestamp: physicalTime });
  }
  expected.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id)
    || Number(right.channel === "physical") - Number(left.channel === "physical"));
  const key = (row: { source: { id: string }; channel: string }) => `${row.channel}:${row.source.id}`;
  const defaultPage = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${phone}`), 200);
  expect(defaultPage.items).toHaveLength(25);
  expect(defaultPage.nextCursor).toEqual(expect.any(String));
  const maximumPage = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${phone}&limit=100`), 200);
  expect(maximumPage.items).toHaveLength(100);
  expect(maximumPage.items.map(key)).toEqual(expected.slice(0, 100).map((row) => `${row.channel}:${row.id}`));
  const all: string[] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  do {
    const query = new URLSearchParams({ phone, limit: "7", ...(cursor ? { cursor } : {}) });
    const page = await expectStatus(api("GET", `/api/internal/returns/sources-page?${query}`), 200);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(7);
    all.push(...page.items.map(key));
    cursor = page.nextCursor;
    if (cursor) { expect(cursors.has(cursor)).toBe(false); cursors.add(cursor); }
    expect(all.length).toBeLessThanOrEqual(expected.length);
  } while (cursor);
  expect(new Set(all).size).toBe(202);
  expect(all).toEqual(expected.map((row) => `${row.channel}:${row.id}`));
  for (const channel of ["physical", "online"]) {
    const first = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${phone}&channel=${channel}&limit=100`), 200);
    expect(first.items).toHaveLength(100);
    const last = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${phone}&channel=${channel}&limit=100&cursor=${encodeURIComponent(first.nextCursor)}`), 200);
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect([...first.items, ...last.items].every((row: { channel: string }) => row.channel === channel)).toBe(true);
  }
  for (const queryPhone of ["٠١٠ ١٢٣٤-٥٦٧٨", "۰۱۰ (۱۲۳۴) ۵۶۷۸", "010 (1234)-5678"]) {
    const query = new URLSearchParams({ phone: queryPhone, limit: "100" });
    const normalized = await expectStatus(api("GET", `/api/internal/returns/sources-page?${query}`), 200);
    expect(normalized.items.map(key)).toEqual(maximumPage.items.map(key));
    expect(normalized.items.some((row: { customerPhone: string }) => row.customerPhone === "010 1234-5678")).toBe(true);
  }
  const legacy = await expectStatus(api("GET", `/api/internal/returns/sources?phone=${phone}`), 200);
  expect(Array.isArray(legacy)).toBe(true);
  for (const endpoint of ["sources", "sources-page"]) {
    expect((await api("GET", `/api/internal/returns/${endpoint}?phone=${encodeURIComponent("لا يوجد رقم ()-")}`)).status).toBe(400);
  }
  for (const limit of ["0", "101", "1.5", "invalid"]) {
    expect((await api("GET", `/api/internal/returns/sources-page?limit=${limit}`)).status).toBe(400);
  }
  for (const extra of ["channel=physical", `branchId=${fayoumId}`, "date=2026-09-11", "amountPiasters=1", "reference=POS"]) {
    expect((await api("GET", `/api/internal/returns/sources-page?phone=${phone}&cursor=${encodeURIComponent(defaultPage.nextCursor)}&${extra}`)).status).toBe(400);
  }
  expect((await api("GET", `/api/internal/returns/sources-page?phone=01199999999&cursor=${encodeURIComponent(defaultPage.nextCursor)}`)).status).toBe(400);
  for (const badCursor of ["not-a-cursor", Buffer.from("{}").toString("base64url")]) {
    expect((await api("GET", `/api/internal/returns/sources-page?phone=${phone}&cursor=${badCursor}`)).status).toBe(400);
  }
}, 120_000);

test("source filters precede page limits and online branches refer to fulfillment", async () => {
  const fixture = await merchandise(500);
  const phone = "01112345678";
  const original = await physicalPurchase(fixture.variantId, { phone, occurredAt: "2026-09-09T12:00:00.000Z" });
  for (let index = 0; index < 101; index += 1) {
    const cancelled = await physicalPurchase(fixture.variantId, { phone });
    await expectStatus(api("POST", `/api/internal/corrections/sales/${cancelled.id}`, {
      operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "سجل اختبار مكرر",
      effective: null, merchandise: [], cash: null,
    }), 201);
    await physicalPurchase(fixture.variantId, { phone, discount: 10000 });
  }
  const matched = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${phone}&channel=physical&amountPiasters=20000&limit=1`), 200);
  expect(matched.items.map((row: { source: { id: string } }) => row.source.id)).toEqual([original.id]);
  expect(matched.nextCursor).toBeNull();
  const legacy = await expectStatus(api("GET", `/api/internal/returns/sources?phone=${phone}&channel=physical&amountPiasters=20000`), 200);
  expect(legacy.map((row: { source: { id: string } }) => row.source.id)).toEqual([original.id]);

  const onlinePhone = "01212345678";
  const online = await deliveredPurchase(fixture, { phone: onlinePhone, branchId: fayoumId, receivedAt: "2026-09-09T12:00:00.000Z" });
  await deliveredPurchase(fixture, { phone: onlinePhone, quantity: 2, branchId: fayoumId });
  await deliveredPurchase(fixture, { phone: onlinePhone, branchId: abshwayId });
  const selected = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${onlinePhone}&branchId=${fayoumId}&amountPiasters=20000&limit=1`), 200);
  expect(selected.items).toEqual([expect.objectContaining({
    source: { kind: "delivered_online_order", id: online.id }, originalBranch: { id: fayoumId, code: "fayoum", nameAr: expect.any(String) },
  })]);
  expect(selected.nextCursor).toBeNull();
  const alternate = await deliveredPurchase(fixture, { phone: "01099999999", alternatePhone: "015 (1234) 5678" });
  const byAlternate = await expectStatus(api("GET", `/api/internal/returns/sources-page?phone=${encodeURIComponent("۰۱۵۱۲۳۴۵۶۷۸")}`), 200);
  expect(byAlternate.items.map((row: { source: { id: string } }) => row.source.id)).toEqual([alternate.id]);
}, 120_000);

async function merchandise(quantity: number) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const category = await expectStatus(api("POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` }), 201);
  const size = await expectStatus(api("POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` }), 201);
  const color = await expectStatus(api("POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` }), 201);
  const product = await expectStatus(api("POST", "/api/internal/catalog/products", {
    code: `PAGE-${suffix}`, nameAr: "منتج صفحات الإرجاع", descriptionAr: "اختبار صفحات الإرجاع", categoryId: category.id,
    defaultSellingPricePiasters: 20000, publication: "available", imageRefs: [],
    variants: [{ sizeId: size.id, colorId: color.id, sellingPricePiastersOverride: null }],
  }), 201);
  const variantId = product.variants[0].id as string;
  for (const branchId of [abshwayId, fayoumId]) {
    await expectStatus(api("POST", "/api/internal/receiving/receipts", {
      operationId: crypto.randomUUID(), receiptDate: "2026-09-01", branchId,
      lines: [{ variantId, quantity, unitCostPiasters: 9000 }],
    }), 201);
  }
  const area = await expectStatus(api("POST", "/api/internal/delivery-areas", { nameAr: `منطقة ${suffix}`, feePiasters: 0, active: true }), 201);
  return { variantId, areaId: area.id as string };
}

async function physicalPurchase(variantId: string, options: { id?: string; phone: string; discount?: number; occurredAt?: string }) {
  return expectStatus(api("POST", "/api/internal/sales", {
    saleId: options.id ?? crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: options.occurredAt ?? "2026-09-10T12:00:00.000Z", customerName: "عميل صفحات الإرجاع", customerPhone: options.phone,
    employeeDiscountPiasters: options.discount ?? 0, lines: [{ variantId, quantity: 1 }],
  }), 201);
}

async function deliveredPurchase(fixture: { variantId: string; areaId: string }, options: { phone: string; alternatePhone?: string; branchId?: string; quantity?: number; receivedAt?: string }) {
  const receivedAt = options.receivedAt ?? "2026-09-10T12:00:00.000Z";
  businessNow = new Date(`${receivedAt.slice(0, 10)}T10:00:00.000Z`);
  const lines = [{ variantId: fixture.variantId, quantity: options.quantity ?? 1 }];
  const quote = await expectStatus(api("POST", "/api/public/checkout/quote", { deliveryAreaId: fixture.areaId, lines }, true), 200);
  const submitted = await expectStatus(api("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(), quoteId: quote.quoteId, deliveryAreaId: fixture.areaId, lines,
    customerName: "عميل صفحات الإرجاع", primaryPhone: options.phone, alternatePhone: options.alternatePhone, detailedAddress: "عنوان اختبار الصفحات",
  }, true), 201);
  const orderId = submitted.orderId as string;
  const review = await expectStatus(api("POST", `/api/internal/online-orders/${orderId}/agreement-quotes`, { expectedRevision: 1, lines }), 201);
  const agreed = await expectStatus(api("POST", `/api/internal/online-orders/${orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, quoteId: review.quoteId, reviewDigest: review.reviewDigest, customerAgreed: true,
  }), 201);
  const confirmed = await expectStatus(api("POST", `/api/internal/online-orders/${orderId}/confirm`, {
    operationId: crypto.randomUUID(), expectedRevision: agreed.revision, agreedRevision: agreed.revision,
    fulfillmentBranchId: options.branchId ?? abshwayId, itemsLocatedAndSetAside: true,
  }), 201);
  businessNow = new Date(`${receivedAt.slice(0, 10)}T11:00:00.000Z`);
  const shipped = await expectStatus(api("POST", `/api/internal/online-orders/${orderId}/ship`, { operationId: crypto.randomUUID(), expectedRevision: confirmed.revision }), 201);
  businessNow = new Date(receivedAt);
  await expectStatus(api("POST", `/api/internal/online-orders/${orderId}/deliver`, {
    operationId: crypto.randomUUID(), expectedRevision: shipped.result.revision, customerReceivedAt: receivedAt,
  }), 201);
  businessNow = new Date("2026-09-15T12:00:00.000Z");
  return { id: orderId };
}

async function api(method: "GET" | "POST", url: string, payload?: unknown, publicRequest = false) {
  const response = await built.app.inject({ method, url, payload, headers: {
    origin: publicRequest ? PUBLIC_ORIGIN : INTERNAL_ORIGIN, cookie: publicRequest ? "" : manager.cookie,
  } });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}
async function expectStatus(response: Promise<{ status: number; body: any }>, status: number) {
  const result = await response;
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body;
}
