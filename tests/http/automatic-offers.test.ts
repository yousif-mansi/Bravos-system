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
let abshwayId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55446 });
  const databaseName = `bravos_offers_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-offers-outbox-")),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("manager offer writes are protected and validate configurable rules", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const catalog = await seedCatalog(manager);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.offers",
    displayName: "كاشير العروض",
    password: "staff-pass-80",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.offers", "staff-pass-80");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const denied = await api(cashier, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض غير مصرح",
    productIds: [catalog.productId],
  }));
  expect(denied.status).toBe(403);
  expect(denied.body.error.code).toBe("FORBIDDEN");

  const badDates = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "تواريخ غير صالحة",
    productIds: [catalog.productId],
    startsOn: dateOffset(1),
    endsOn: dateOffset(-1),
  }));
  expect(badDates.status).toBe(400);
  expect(badDates.body.error.code).toBe("VALIDATION");

  const missingScope = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "نطاق غير موجود",
    productIds: [crypto.randomUUID()],
  }));
  expect(missingScope.status).toBe(400);
  expect(missingScope.body.error.messageAr).toBe("المنتج أو التصنيف المحدد غير موجود.");

  const created = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض التصنيف",
    categoryIds: [catalog.categoryId],
    allowCoupon: false,
  }));
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    nameAr: "عرض التصنيف",
    discountType: "fixed",
    fixedDiscountPiasters: 5000,
    active: true,
    allowCoupon: false,
    categoryIds: [catalog.categoryId],
  });

  const listed = await api(manager, "GET", "/api/internal/pricing/offers");
  expect(listed.status).toBe(200);
  expect(listed.body).toHaveLength(1);
  const employeeList = await api(cashier, "GET", "/api/internal/pricing/offers");
  expect(employeeList.status).toBe(403);
});

test("connected pricing chooses the greatest current Cairo saving and freezes offer plus paid units", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const catalog = await seedCatalog(manager, "PRICE");
  await receive(manager, catalog.cheapVariantId, 3);
  await receive(manager, catalog.expensiveVariantId, 3);

  const endedOffer = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض منتهي أكبر",
    fixedDiscountPiasters: 11000,
    categoryIds: [catalog.categoryId],
    startsOn: dateOffset(-5),
    endsOn: dateOffset(-1),
  }));
  expect(endedOffer.body.startsOn).toBe(dateOffset(-5));
  const futureOffer = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض قادم أكبر",
    fixedDiscountPiasters: 11000,
    categoryIds: [catalog.categoryId],
    startsOn: dateOffset(1),
    endsOn: dateOffset(5),
  }));
  expect(futureOffer.body.startsOn).toBe(dateOffset(1));
  await api(manager, "POST", "/api/internal/pricing/offers", {
    ...offerBody({ nameAr: "خصم 30 بالمئة", productIds: [catalog.productId] }),
    discountType: "percentage",
    percentageBasisPoints: 3000,
    fixedDiscountPiasters: null,
  });
  const winner = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "خصم خمسة آلاف",
    categoryIds: [catalog.categoryId],
    allowCoupon: false,
  }));
  expect(winner.status).toBe(201);

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 6000,
    discountReason: "اتفاق مع الزبون",
    lines: [
      { variantId: catalog.cheapVariantId, quantity: 1 },
      { variantId: catalog.expensiveVariantId, quantity: 1 },
    ],
  });
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
  expect(prepared.body).toMatchObject({
    originalTotalPiasters: 11000,
    automaticOfferDiscountPiasters: 5000,
    employeeDiscountPiasters: 6000,
    finalTotalPiasters: 0,
    appliedAutomaticOffer: {
      id: winner.body.id,
      nameAr: "خصم خمسة آلاف",
      discountType: "fixed",
      fixedDiscountPiasters: 5000,
      allowCoupon: false,
      discountPiasters: 5000,
    },
  });
  const cheap = prepared.body.lines.find((line: { variantId: string }) => line.variantId === catalog.cheapVariantId);
  const expensive = prepared.body.lines.find((line: { variantId: string }) => line.variantId === catalog.expensiveVariantId);
  expect(cheap).toMatchObject({
    automaticOfferDiscountPiasters: 1000,
    employeeDiscountPiasters: 0,
    discountPiasters: 1000,
    paidPiasters: 0,
  });
  expect(expensive).toMatchObject({
    automaticOfferDiscountPiasters: 4000,
    employeeDiscountPiasters: 6000,
    discountPiasters: 10000,
    paidPiasters: 0,
  });

  const edited = await api(manager, "PUT", `/api/internal/pricing/offers/${winner.body.id}`, {
    ...offerBody({
      nameAr: "عُدّل بعد قبول السعر",
      fixedDiscountPiasters: 100,
      categoryIds: [catalog.categoryId],
    }),
    active: false,
  });
  expect(edited.status).toBe(200);

  const completed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 6000,
    discountReason: "اتفاق مع الزبون",
    lines: [
      { variantId: catalog.cheapVariantId, quantity: 1 },
      { variantId: catalog.expensiveVariantId, quantity: 1 },
    ],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.finalTotalPiasters).toBe(0);
  expect(completed.body.automaticOfferDiscountPiasters).toBe(5000);
  expect(completed.body.appliedAutomaticOffer.nameAr).toBe("خصم خمسة آلاف");
  expect(completed.body.appliedAutomaticOffer.fixedDiscountPiasters).toBe(5000);

  const reread = await api(manager, "GET", `/api/internal/sales/${saleId}`);
  expect(reread.status).toBe(200);
  expect(reread.body.appliedAutomaticOffer).toEqual(completed.body.appliedAutomaticOffer);
  expect(reread.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters)).toEqual([0, 0]);
});

test("an active offer does not expand a high-quantity request before stock rejection", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const catalog = await seedCatalog(manager, "RANGE");
  await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض النطاق الكبير",
    productIds: [catalog.productId],
  }));

  const started = Date.now();
  const rejected = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: catalog.cheapVariantId, quantity: 1_000_000 }],
  });

  expect(Date.now() - started).toBeLessThan(2_000);
  expect(rejected.status).toBe(400);
  expect(rejected.body.error).toEqual({ code: "VALIDATION", messageAr: "الكمية المتاحة غير كافية." });
}, 30_000);

test("a sale quote uses one committed catalog and offer snapshot", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const catalog = await seedCatalog(manager, "SNAPSHOT");
  await receive(manager, catalog.cheapVariantId, 1);
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "عرض لقطة التسعير",
    fixedDiscountPiasters: 500,
    categoryIds: [catalog.categoryId],
    active: false,
  }));
  expect(offer.status).toBe(201);
  const product = await api(manager, "GET", `/api/internal/catalog/products/${catalog.productId}`);
  const movedCategory = await api(manager, "POST", "/api/internal/catalog/categories", {
    nameAr: "تصنيف SNAPSHOT الجديد",
  });

  const blocker = await built.pool.connect();
  let blockerOpen = true;
  try {
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE pricing_automatic_offer IN ACCESS EXCLUSIVE MODE");
    const blockerPid = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pending = api(manager, "POST", "/api/internal/sales/prepare", {
      saleId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      employeeDiscountPiasters: 0,
      lines: [{ variantId: catalog.cheapVariantId, quantity: 1 }],
    });
    await waitForBlockedOfferRead(blockerPid.rows[0]!.pid);

    const changed = await api(manager, "PATCH", `/api/internal/catalog/products/${catalog.productId}`, {
      code: product.body.code,
      nameAr: product.body.nameAr,
      descriptionAr: product.body.descriptionAr,
      categoryId: movedCategory.body.id,
      defaultSellingPricePiasters: 2000,
      publication: product.body.publication,
      imageRefs: product.body.imageRefs,
      variants: product.body.variants.map((variant: {
        size: { id: string };
        color: { id: string };
      }) => ({
        sizeId: variant.size.id,
        colorId: variant.color.id,
        sellingPricePiastersOverride: null,
      })),
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    await blocker.query("UPDATE pricing_automatic_offer SET active = TRUE WHERE id = $1", [offer.body.id]);
    await blocker.query("COMMIT");
    blockerOpen = false;

    const prepared = await pending;
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    expect(prepared.body).toMatchObject({
      originalTotalPiasters: 1000,
      automaticOfferDiscountPiasters: 0,
      finalTotalPiasters: 1000,
      appliedAutomaticOffer: null,
    });
  } finally {
    if (blockerOpen) await blocker.query("ROLLBACK");
    blocker.release();
  }
}, 30_000);

type Session = { cookie: string };

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

async function api(session: Session | undefined, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) {
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

async function waitForBlockedOfferRead(blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await built.pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity activity
         WHERE activity.datname = current_database()
           AND activity.pid <> pg_backend_pid()
           AND activity.wait_event_type = 'Lock'
           AND $1 = ANY(pg_blocking_pids(activity.pid))
           AND EXISTS (
             SELECT 1 FROM pg_locks waiting_lock
             WHERE waiting_lock.pid = activity.pid
               AND waiting_lock.granted = false
               AND waiting_lock.relation = 'pricing_automatic_offer'::regclass
           )
       ) AS waiting`,
      [blockerPid],
    );
    if (waiting.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the offer read to block.");
}

function offerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    nameAr: "عرض تلقائي",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 5000,
    startsOn: dateOffset(0),
    endsOn: dateOffset(0),
    active: true,
    allowCoupon: true,
    productIds: [],
    categoryIds: [],
    ...overrides,
  };
}

function dateOffset(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

async function seedCatalog(manager: Session, prefix = "AUTH") {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const cheapColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `فاتح ${prefix}` });
  const expensiveColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `داكن ${prefix}` });
  expect([category.status, size.status, cheapColor.status, expensiveColor.status]).toEqual([201, 201, 201, 201]);
  const cheapProduct = await createPricedProduct(manager, {
    code: `OFFER-${prefix}-LOW`,
    nameAr: `منتج رخيص ${prefix}`,
    categoryId: category.body.id,
    sizeId: size.body.id,
    colorId: cheapColor.body.id,
    price: 1000,
  });
  const expensiveProduct = await createPricedProduct(manager, {
    code: `OFFER-${prefix}-HIGH`,
    nameAr: `منتج غالي ${prefix}`,
    categoryId: category.body.id,
    sizeId: size.body.id,
    colorId: expensiveColor.body.id,
    price: 10000,
  });
  return {
    categoryId: category.body.id,
    productId: cheapProduct.productId,
    cheapVariantId: cheapProduct.variantId,
    expensiveVariantId: expensiveProduct.variantId,
  };
}

async function createPricedProduct(
  manager: Session,
  input: { code: string; nameAr: string; categoryId: string; sizeId: string; colorId: string; price: number },
) {
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: input.code,
    nameAr: input.nameAr,
    descriptionAr: "منتج لاختبار العروض",
    categoryId: input.categoryId,
    defaultSellingPricePiasters: input.price,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: input.sizeId, colorId: input.colorId, sellingPricePiastersOverride: null }],
  });
  expect(product.status, JSON.stringify(product.body)).toBe(201);
  return { productId: product.body.id as string, variantId: product.body.variants[0].id as string };
}

async function receive(manager: Session, variantId: string, quantity: number) {
  const result = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: dateOffset(0),
    lines: [{ variantId, quantity, unitCostPiasters: 500 }],
  });
  expect(result.status).toBe(201);
}
