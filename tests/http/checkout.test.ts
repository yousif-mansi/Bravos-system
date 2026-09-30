import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { loadConfig } from "../../apps/api/src/config.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";
let databaseUrl = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_CHECKOUT_TEST_PORT ?? 55456) });
  const databaseName = `bravos_checkout_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  databaseUrl = cluster.connectionString(databaseName);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl,
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-checkout-outbox-")),
  });
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='fayoum'")).rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("production configuration defaults public ordering closed and requires an exact override", () => {
  const environment = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://operator@example/bravos",
    BETTER_AUTH_SECRET: "operator-secret-operator-secret-32",
    BRAVOS_PRODUCT_MEDIA_DIR: "C:/BravosPrivate/media",
  };
  expect(loadConfig(environment)).toMatchObject({ publicOrderingEnabled: false, secureCookies: true });
  expect(loadConfig({ ...environment, BRAVOS_PUBLIC_ORDERING_ENABLED: "true" }).publicOrderingEnabled).toBe(true);
  expect(() => loadConfig({ ...environment, BRAVOS_PUBLIC_ORDERING_ENABLED: "yes" })).toThrow(/exactly true or false/i);
  expect(loadConfig({ ...environment, BRAVOS_LOOPBACK_REHEARSAL: "true" }).secureCookies).toBe(false);
  expect(() => loadConfig({
    ...environment,
    BRAVOS_LOOPBACK_REHEARSAL: "true",
    BRAVOS_PUBLIC_ORIGIN: "https://shop.example",
  })).toThrow(/fixed production-build loopback origins/i);
  expect(() => loadConfig({
    ...environment,
    BRAVOS_LOOPBACK_REHEARSAL: "true",
    BRAVOS_TRUSTED_ORIGINS: "https://extra.example",
  })).toThrow(/fixed production-build loopback origins/i);
  expect(() => loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: environment.DATABASE_URL,
    BETTER_AUTH_SECRET: environment.BETTER_AUTH_SECRET,
  })).toThrow(/BRAVOS_PRODUCT_MEDIA_DIR is required/i);
});

test("manager maintains supported delivery areas while public checkout sees only active safe fields", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const created = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr: "مدينة الفيوم", feePiasters: 5000, active: true });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body).toMatchObject({ nameAr: "مدينة الفيوم", feePiasters: 5000, active: true });

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "checkout.cashier", displayName: "كاشير", password: "staff-pass-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("checkout.cashier", "staff-pass-1");
  const denied = await api(cashier, "GET", "/api/internal/delivery-areas");
  expect(denied.status).toBe(403);

  const publicList = await api(undefined, "GET", "/api/public/checkout/delivery-areas", undefined, PUBLIC_ORIGIN);
  expect(publicList.body).toEqual([{ id: created.body.id, nameAr: "مدينة الفيوم", feePiasters: 5000 }]);
  expect(publicList.body[0]).not.toHaveProperty("changedByStaffId");

  const updated = await api(manager, "PUT", `/api/internal/delivery-areas/${created.body.id}`, { nameAr: "مدينة الفيوم", feePiasters: 6500, active: false });
  expect(updated.body).toMatchObject({ feePiasters: 6500, active: false });
  const hidden = await api(undefined, "GET", "/api/public/checkout/delivery-areas", undefined, PUBLIC_ORIGIN);
  expect(hidden.body).toEqual([]);
});

test("public ordering gate is authoritative while browsing remains available", async () => {
  const databaseName = `bravos_checkout_gate_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const disabled = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-checkout-gate-outbox-")),
    publicOrderingEnabled: false,
  });
  try {
    const runtime = await disabled.app.inject({ method: "GET", url: "/api/public/runtime", headers: { origin: PUBLIC_ORIGIN } });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toEqual({ publicOrderingEnabled: false });

    const catalog = await disabled.app.inject({ method: "GET", url: "/api/public/catalog/products", headers: { origin: PUBLIC_ORIGIN } });
    expect(catalog.statusCode).toBe(200);

    for (const url of ["/api/public/checkout/quote", "/api/public/checkout/orders"]) {
      const response = await disabled.app.inject({
        method: "POST",
        url,
        headers: { origin: PUBLIC_ORIGIN, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: { code: "PUBLIC_ORDERING_DISABLED", messageAr: "الطلب عبر المتجر غير متاح حالياً." },
      });
    }
    const effects = await disabled.pool.query<{ quotes: string; orders: string }>(
      `SELECT
         (SELECT count(*)::text FROM online_checkout_quote) AS quotes,
         (SELECT count(*)::text FROM online_order) AS orders`,
    );
    expect(effects.rows[0]).toEqual({ quotes: "0", orders: "0" });
  } finally {
    await disabled.close();
  }
});

test("guest quote applies configured offer, coupon and fee while pending submission holds no stock or coupon use", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedCheckout(manager, "TOTALS", 2, 30000);
  const area = await createArea(manager, "سنورس TOTALS", 5000);
  await api(manager, "POST", "/api/internal/pricing/offers", {
    nameAr: "خصم الطلب", discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 5000,
    startsOn: today(), endsOn: today(), active: true, allowCoupon: true,
    productIds: [seeded.productId], categoryIds: [],
  });
  await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "WEB1000", discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 1000,
    startsOn: today(), endsOn: today(), active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [seeded.productId], categoryIds: [],
  });

  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.id, couponCode: "web1000",
    lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  expect(quote.body).toMatchObject({
    merchandiseOriginalPiasters: 30000, automaticOfferDiscountPiasters: 5000,
    couponDiscountPiasters: 1000, merchandiseTotalPiasters: 24000,
    deliveryFeePiasters: 5000, finalTotalPiasters: 29000,
    appliedAutomaticOffer: { nameAr: "خصم الطلب", discountPiasters: 5000 },
    appliedCoupon: { code: "WEB1000", discountPiasters: 1000 },
  });

  const submitted = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(), quoteId: quote.body.quoteId,
    deliveryAreaId: area.id, couponCode: "web1000", lines: [{ variantId: seeded.variantId, quantity: 1 }],
    customerName: "عميل تجريبي", primaryPhone: "01012345678", detailedAddress: "شارع الجمهورية، منزل ١٠",
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  expect(submitted.body).toMatchObject({ status: "pending", quote: { finalTotalPiasters: 29000 } });
  expect(submitted.body).not.toHaveProperty("customerName");

  const product = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(product.body.variants[0].availableQuantity).toBe(2);
  const coupons = await api(manager, "GET", "/api/internal/pricing/coupons");
  expect(coupons.body.find((coupon: { code: string }) => coupon.code === "WEB1000").usedCount).toBe(0);
  const detail = await api(manager, "GET", `/api/internal/online-orders/${submitted.body.orderId}`);
  expect(detail.body).toMatchObject({
    customerName: "عميل تجريبي", primaryPhone: "01012345678", alternatePhone: null,
    landmark: null, notes: null, requestedFinalTotalPiasters: 29000,
    lines: [{ requestedQuantity: 1, requestedListedUnitPricePiasters: 30000 }],
  });
});

test("checkout aggregates duplicate variant rows and rejects an old basket above current stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedCheckout(manager, "SHORT", 2, 10000);
  const area = await createArea(manager, "إطسا SHORT", 3000);
  const response = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.id,
    lines: [{ variantId: seeded.variantId, quantity: 1 }, { variantId: seeded.variantId, quantity: 2 }],
  });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe("INSUFFICIENT_STOCK");
});

test("exact concurrent submission and later lost-response retry return one stable PII-free result", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId });
  const seeded = await seedCheckout(manager, "REPLAY", 1, 12000);
  const area = await createArea(manager, "أبشواي REPLAY", 2500);
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.id, lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  const payload = {
    operationId: crypto.randomUUID(), quoteId: quote.body.quoteId, deliveryAreaId: area.id,
    lines: [{ variantId: seeded.variantId, quantity: 1 }], customerName: "عميل إعادة",
    primaryPhone: "01112345678", detailedAddress: "عنوان إعادة المحاولة", notes: "اتصل مساءً",
  };
  const [first, second] = await Promise.all([
    publicApi("POST", "/api/public/checkout/orders", payload),
    publicApi("POST", "/api/public/checkout/orders", payload),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 201]);
  expect(first.body).toEqual(second.body);
  expect(first.body).not.toHaveProperty("notes");

  const sold = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    employeeDiscountPiasters: 0, lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  expect(sold.status, JSON.stringify(sold.body)).toBe(201);
  await api(manager, "PUT", `/api/internal/delivery-areas/${area.id}`, { nameAr: area.nameAr, feePiasters: 9999, active: true });
  const replay = await publicApi("POST", "/api/public/checkout/orders", payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const conflict = await publicApi("POST", "/api/public/checkout/orders", { ...payload, customerName: "عميل مختلف" });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe("OPERATION_CONFLICT");
});

test("closed public ordering recovers only an exact accepted submission without new order or stock effects", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedCheckout(manager, "CLOSED-REPLAY", 2, 18000);
  const area = await createArea(manager, "استعادة طلب بعد الإغلاق", 2000);
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.id, lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  expect(quote.status).toBe(200);
  const payload = {
    operationId: crypto.randomUUID(), quoteId: quote.body.quoteId, deliveryAreaId: area.id,
    lines: [{ variantId: seeded.variantId, quantity: 1 }], customerName: "عميل فقد الرد",
    primaryPhone: "01012345678", detailedAddress: "عنوان الطلب السابق", notes: "ملاحظة خاصة",
  };
  const accepted = await publicApi("POST", "/api/public/checkout/orders", payload);
  expect(accepted.status).toBe(201);
  await api(manager, "PUT", `/api/internal/delivery-areas/${area.id}`, {
    nameAr: area.nameAr, feePiasters: 9000, active: false,
  });
  const effectsBefore = await built.pool.query(
    "SELECT (SELECT count(*) FROM online_order) AS orders, (SELECT count(*) FROM online_checkout_quote) AS quotes, (SELECT count(*) FROM inventory_movement) AS movements",
  );
  const closed = await buildApp({
    nodeEnv: "test", databaseUrl,
    authSecret: "test-secret-test-secret-test-secret-32", authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN, publicOrigin: PUBLIC_ORIGIN,
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"], secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-checkout-replay-outbox-")),
    publicOrderingEnabled: false,
  });
  const post = (body: unknown) => closed.app.inject({
    method: "POST", url: "/api/public/checkout/orders",
    headers: { origin: PUBLIC_ORIGIN, "content-type": "application/json" }, payload: body,
  });
  try {
    const replay = await post(payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(accepted.body);
    expect(JSON.stringify(replay.json())).not.toMatch(/primaryPhone|customerName|detailedAddress|notes|cost|profit/i);
    const changed = await post({ ...payload, notes: "محاولة مختلفة" });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("OPERATION_CONFLICT");
    const newOperation = await post({ ...payload, operationId: crypto.randomUUID() });
    expect(newOperation.statusCode).toBe(503);
    expect(newOperation.json().error.code).toBe("PUBLIC_ORDERING_DISABLED");
    const effectsAfter = await built.pool.query(
      "SELECT (SELECT count(*) FROM online_order) AS orders, (SELECT count(*) FROM online_checkout_quote) AS quotes, (SELECT count(*) FROM inventory_movement) AS movements",
    );
    expect(effectsAfter.rows).toEqual(effectsBefore.rows);
  } finally {
    await closed.close();
  }
});

test("submission requires renewed review when the configured delivery fee changes", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedCheckout(manager, "STALE", 1, 15000);
  const area = await createArea(manager, "يوسف الصديق STALE", 2000);
  const quote = await publicApi("POST", "/api/public/checkout/quote", { deliveryAreaId: area.id, lines: [{ variantId: seeded.variantId, quantity: 1 }] });
  await api(manager, "PUT", `/api/internal/delivery-areas/${area.id}`, { nameAr: area.nameAr, feePiasters: 3500, active: true });
  const response = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(), quoteId: quote.body.quoteId, deliveryAreaId: area.id,
    lines: [{ variantId: seeded.variantId, quantity: 1 }], customerName: "عميل",
    primaryPhone: "01212345678", detailedAddress: "عنوان واضح",
  });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe("QUOTE_STALE");
});

test("submission rechecks public eligibility and mandatory guest details without creating a pending effect", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedCheckout(manager, "ELIGIBILITY", 2, 18000);
  const area = await createArea(manager, "طامية ELIGIBILITY", 2400);
  await api(manager, "POST", "/api/internal/pricing/coupons", {
    code: "ELIGIBLE500", discountType: "fixed", percentageBasisPoints: null, fixedDiscountPiasters: 500,
    startsOn: today(), endsOn: today(), active: true, allowAutomaticOffer: true, usageLimit: 1,
    productIds: [seeded.productId], categoryIds: [],
  });
  const ordersBefore = await api(manager, "GET", "/api/internal/online-orders");

  const quotedHidden = await quoteFor(seeded.variantId, area.id, "ELIGIBLE500");
  await setPublication(manager, seeded.productId, "hidden");
  const hidden = await submitQuoted(quotedHidden.body.quoteId, seeded.variantId, area.id, { couponCode: "ELIGIBLE500" });
  expect(hidden.status).toBe(409);
  expect(hidden.body.error.code).toBe("VARIANT_NOT_ORDERABLE");
  const hiddenQuote = await quoteFor(seeded.variantId, area.id, "ELIGIBLE500");
  expect(hiddenQuote.status).toBe(409);
  expect(hiddenQuote.body.error.code).toBe("VARIANT_NOT_ORDERABLE");

  await setPublication(manager, seeded.productId, "available");
  const quotedComingSoon = await quoteFor(seeded.variantId, area.id, "ELIGIBLE500");
  await setPublication(manager, seeded.productId, "coming_soon");
  const comingSoon = await submitQuoted(quotedComingSoon.body.quoteId, seeded.variantId, area.id, { couponCode: "ELIGIBLE500" });
  expect(comingSoon.status).toBe(409);
  expect(comingSoon.body.error.code).toBe("VARIANT_NOT_ORDERABLE");
  const comingSoonQuote = await quoteFor(seeded.variantId, area.id, "ELIGIBLE500");
  expect(comingSoonQuote.status).toBe(409);
  expect(comingSoonQuote.body.error.code).toBe("VARIANT_NOT_ORDERABLE");

  await setPublication(manager, seeded.productId, "available");
  const quotedGuest = await quoteFor(seeded.variantId, area.id, "ELIGIBLE500");
  const missingPhone = await submitQuoted(quotedGuest.body.quoteId, seeded.variantId, area.id, {
    couponCode: "ELIGIBLE500", omitPrimaryPhone: true,
  });
  expect(missingPhone.status).toBe(400);
  expect(missingPhone.body.error.code).toBe("VALIDATION");
  const missingAddress = await submitQuoted(quotedGuest.body.quoteId, seeded.variantId, area.id, {
    couponCode: "ELIGIBLE500", omitDetailedAddress: true,
  });
  expect(missingAddress.status).toBe(400);
  expect(missingAddress.body.error.code).toBe("VALIDATION");

  await api(manager, "PUT", `/api/internal/delivery-areas/${area.id}`, {
    nameAr: area.nameAr, feePiasters: area.feePiasters, active: false,
  });
  const inactiveArea = await submitQuoted(quotedGuest.body.quoteId, seeded.variantId, area.id, { couponCode: "ELIGIBLE500" });
  expect(inactiveArea.status).toBe(400);
  expect(inactiveArea.body.error.code).toBe("UNSUPPORTED_DELIVERY_AREA");

  const ordersAfter = await api(manager, "GET", "/api/internal/online-orders");
  expect(ordersAfter.body).toHaveLength(ordersBefore.body.length);
  const product = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(product.body.variants[0].availableQuantity).toBe(2);
  const coupons = await api(manager, "GET", "/api/internal/pricing/coupons");
  expect(coupons.body.find((coupon: { code: string }) => coupon.code === "ELIGIBLE500").usedCount).toBe(0);
});

type Session = { cookie: string };
async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST", url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" }, payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, origin = INTERNAL_ORIGIN) {
  const response = await built.app.inject({
    method, url,
    headers: { origin, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  return api(undefined, method, url, payload, PUBLIC_ORIGIN);
}

function quoteFor(variantId: string, deliveryAreaId: string, couponCode: string) {
  return publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId, couponCode, lines: [{ variantId, quantity: 1 }],
  });
}

function submitQuoted(
  quoteId: string,
  variantId: string,
  deliveryAreaId: string,
  overrides: { couponCode?: string; omitPrimaryPhone?: boolean; omitDetailedAddress?: boolean } = {},
) {
  const payload: Record<string, unknown> = {
    operationId: crypto.randomUUID(), quoteId, deliveryAreaId,
    lines: [{ variantId, quantity: 1 }], customerName: "عميل الأهلية",
    primaryPhone: "01098765432", detailedAddress: "عنوان اختبار الأهلية",
    ...(overrides.couponCode ? { couponCode: overrides.couponCode } : {}),
  };
  if (overrides.omitPrimaryPhone) delete payload.primaryPhone;
  if (overrides.omitDetailedAddress) delete payload.detailedAddress;
  return publicApi("POST", "/api/public/checkout/orders", payload);
}

async function createArea(manager: Session, nameAr: string, feePiasters: number) {
  const response = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr, feePiasters, active: true });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

async function seedCheckout(manager: Session, prefix: string, quantity: number, price: number) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `CHECKOUT-${prefix}`, nameAr: `منتج ${prefix}`, descriptionAr: "منتج لاختبار الطلب",
    categoryId: category.body.id, defaultSellingPricePiasters: price, publication: "available",
    imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id;
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId, receiptDate: today(), lines: [{ variantId, quantity, unitCostPiasters: 5000 }],
  });
  expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
  return { productId: product.body.id, variantId };
}

async function setPublication(manager: Session, productId: string, publication: "available" | "coming_soon" | "hidden") {
  const product = await api(manager, "GET", `/api/internal/catalog/products/${productId}`);
  const updated = await api(manager, "PATCH", `/api/internal/catalog/products/${productId}`, {
    code: product.body.code,
    nameAr: product.body.nameAr,
    descriptionAr: product.body.descriptionAr,
    categoryId: product.body.category.id,
    defaultSellingPricePiasters: product.body.defaultSellingPricePiasters,
    publication,
    imageRefs: product.body.imageRefs,
    sizeGuideAr: product.body.sizeGuideAr,
    variants: product.body.variants.map((variant: {
      size: { id: string };
      color: { id: string };
      sellingPricePiastersOverride: number | null;
    }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
