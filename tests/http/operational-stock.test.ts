import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { WAREHOUSE_BRANCH_ID } from "../../packages/contracts/src/index.ts";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: Number(process.env.BRAVOS_OPERATIONAL_STOCK_TEST_PORT ?? 55481) });
  const databaseName = `bravos_operational_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-operational-outbox-")),
  });
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
  abshwayId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code = 'abshway'")).rows[0]?.id ?? "";
  fayoumId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code = 'fayoum'")).rows[0]?.id ?? "";
  expect(abshwayId).not.toBe("");
  expect(fayoumId).not.toBe("");
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("storefront options share one retail pool and warehouse stock stays out of it", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedProduct(manager, "POOL", 100000, 90000);
  const supplier = await api(manager, "POST", "/api/internal/suppliers", { nameAr: "مورد البلياردو" });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    supplierId: supplier.body.id,
    receiptDate: cairoDate(),
    lines: [{ productId: seeded.productId, quantity: 5, unitCostPiasters: 40000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);

  const hidden = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
  expect(hidden.body.sharedAvailableQuantity).toBe(0);
  expect(hidden.body.variants).toHaveLength(2);
  expect(hidden.body.variants.every((variant: { availableQuantity: number; orderable: boolean; sellingPricePiasters: number }) =>
    variant.availableQuantity === 0 && variant.orderable === false && variant.sellingPricePiasters === 100000,
  )).toBe(true);

  const operationId = crypto.randomUUID();
  const moved = await api(manager, "POST", "/api/internal/inventory/transfers", {
    operationId,
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: abshwayId,
    productId: seeded.productId,
    quantity: 4,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(201);
  expect(moved.body.created).toBe(true);
  const replay = await api(manager, "POST", "/api/internal/inventory/transfers", {
    operationId,
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: abshwayId,
    productId: seeded.productId,
    quantity: 4,
  });
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  expect(replay.body.created).toBe(false);
  const shortage = await api(manager, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: fayoumId,
    productId: seeded.productId,
    quantity: 2,
  });
  expect(shortage.status, JSON.stringify(shortage.body)).toBe(400);
  expect(await balances(seeded.productId)).toEqual([
    { branchId: abshwayId, quantity: 4, unitCostPiasters: 40000 },
    { branchId: WAREHOUSE_BRANCH_ID, quantity: 1, unitCostPiasters: 40000 },
  ].sort((left, right) => left.branchId < right.branchId ? -1 : 1));

  const visible = await publicApi("GET", `/api/public/catalog/products/${seeded.productId}`);
  expect(visible.body.sharedAvailableQuantity).toBe(4);
  expect(visible.body.variants.map((variant: { availableQuantity: number }) => variant.availableQuantity)).toEqual([4, 4]);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr: "منطقة التجمع", feePiasters: 1500, active: true });
  expect(area.status, JSON.stringify(area.body)).toBe(201);
  const over = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [
      { variantId: seeded.blackId, quantity: 3 },
      { variantId: seeded.whiteId, quantity: 2 },
    ],
  });
  expect(over.status, JSON.stringify(over.body)).toBe(409);
  expect(over.body.error.code).toBe("INSUFFICIENT_STOCK");
  const fitted = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [
      { variantId: seeded.blackId, quantity: 2 },
      { variantId: seeded.whiteId, quantity: 2 },
    ],
  });
  expect(fitted.status, JSON.stringify(fitted.body)).toBe(200);
  expect(fitted.body.lines).toHaveLength(2);
  expect(fitted.body.merchandiseOriginalPiasters).toBe(400000);

  const report = await api(manager, "GET", "/api/internal/reports/management?period=today");
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary.purchaseCostPiasters).toBe(200000);
  expect(report.body.summary.effectiveExpensesPiasters).toBe(0);
  expect(report.body.summary.operatingProfitPiasters).toBe(0);
  expect(report.body.expenses.totalPiasters).toBe(0);
});

test("the floor blocks an excessive discount and paid history stays a product list", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seeded = await seedProduct(manager, "FLOOR", 100000, 90000);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    receiptDate: cairoDate(),
    lines: [{ productId: seeded.productId, quantity: 4, unitCostPiasters: 20000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const moved = await api(manager, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: abshwayId,
    productId: seeded.productId,
    quantity: 4,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(201);

  const below = await api(manager, "POST", "/api/internal/sales", saleBody(seeded.operationalVariantId, {
    employeeDiscountPiasters: 10001,
    customerName: "منى",
    customerPhone: "01099887766",
  }));
  expect(below.status, JSON.stringify(below.body)).toBe(400);
  expect(below.body.error.messageAr).toContain("الحد الأدنى");
  expect(await customerCount("01099887766")).toBe(0);

  const accepted = await api(manager, "POST", "/api/internal/sales", saleBody(seeded.operationalVariantId, {
    employeeDiscountPiasters: 10000,
    customerName: "منى",
    customerPhone: "٠١٠٩٩٨٨٧٧٦٦",
  }));
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect(accepted.body.finalTotalPiasters).toBe(90000);
  const anonymous = await api(manager, "POST", "/api/internal/sales", saleBody(seeded.operationalVariantId, {}));
  expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(201);
  expect(await customerCount("01099887766")).toBe(1);

  const cashier = await createCashier(manager);
  const lookup = await api(cashier, "GET", "/api/internal/customers/lookup?phone=01099887766&name=%D9%85%D9%86%D9%89");
  expect(lookup.status, JSON.stringify(lookup.body)).toBe(200);
  expect(lookup.body.customer).toMatchObject({ displayName: "منى", normalizedPhone: "01099887766" });
  const denied = await api(cashier, "GET", `/api/internal/customers/${lookup.body.customer.id}/history?period=year`);
  expect(denied.status, JSON.stringify(denied.body)).toBe(403);
  const history = await api(manager, "GET", `/api/internal/customers/${lookup.body.customer.id}/history?period=year`);
  expect(history.status, JSON.stringify(history.body)).toBe(200);
  expect(history.body.purchaseCount).toBe(1);
  expect(history.body.purchases[0].products).toEqual([{ nameAr: "منتج FLOOR", optionText: null, quantity: 1 }]);
  expect(JSON.stringify(history.body)).not.toMatch(/refund|netSpend|net_spend|استرداد|صافي/i);

  const area = await api(manager, "POST", "/api/internal/delivery-areas", { nameAr: "منطقة FLOOR", feePiasters: 0, active: true });
  const pendingQuote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [{ variantId: seeded.blackId, quantity: 1 }],
  });
  expect(pendingQuote.status, JSON.stringify(pendingQuote.body)).toBe(200);
  const pending = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: pendingQuote.body.quoteId,
    deliveryAreaId: area.body.id,
    lines: [{ variantId: seeded.blackId, quantity: 1 }],
    customerName: "منى",
    primaryPhone: "01099887766",
    detailedAddress: "شارع الجمهورية",
  });
  expect(pending.status, JSON.stringify(pending.body)).toBe(201);
  const beforeDelivery = await api(manager, "GET", `/api/internal/customers/${lookup.body.customer.id}/history?period=month`);
  expect(beforeDelivery.body.purchases.map((purchase: { channel: string }) => purchase.channel)).toEqual(["physical"]);

  const guestQuote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [{ variantId: seeded.whiteId, quantity: 1 }],
  });
  const guest = await publicApi("POST", "/api/public/checkout/orders", {
    operationId: crypto.randomUUID(),
    quoteId: guestQuote.body.quoteId,
    deliveryAreaId: area.body.id,
    lines: [{ variantId: seeded.whiteId, quantity: 1 }],
    customerName: "زائر",
    primaryPhone: "01011112222",
    detailedAddress: "عنوان الزائر",
  });
  expect(guest.status, JSON.stringify(guest.body)).toBe(201);
  expect(await customerCount("01011112222")).toBe(0);

  const review = await api(manager, "POST", `/api/internal/online-orders/${pending.body.orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId: seeded.blackId, quantity: 1 }],
  });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${pending.body.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${pending.body.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    itemsLocatedAndSetAside: true,
    fulfillmentBranchId: abshwayId,
  });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  const stillUnpaid = await api(manager, "GET", `/api/internal/customers/${lookup.body.customer.id}/history?period=year`);
  expect(stillUnpaid.body.purchaseCount).toBe(1);
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${pending.body.orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  expect(shipped.status, JSON.stringify(shipped.body)).toBe(201);
  const delivered = await api(manager, "POST", `/api/internal/online-orders/${pending.body.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: shipped.body.result.shippedAt,
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);
  const paid = await api(manager, "GET", `/api/internal/customers/${lookup.body.customer.id}/history?period=year`);
  expect(paid.body.purchaseCount).toBe(2);
  expect(paid.body.purchases.map((purchase: { channel: string }) => purchase.channel).sort()).toEqual(["online", "physical"]);
  const online = paid.body.purchases.find((purchase: { channel: string }) => purchase.channel === "online");
  expect(online.products[0]).toMatchObject({ nameAr: "منتج FLOOR", quantity: 1 });
  expect(online.products[0].optionText).toContain("أسود");
});

test("supplier purchases stay out of ordinary expenses and a product price can be maintained", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedProduct(manager, "BUY", 50000, null);
  const supplier = await api(manager, "POST", "/api/internal/suppliers", { nameAr: "مورد BUY" });
  expect(supplier.status, JSON.stringify(supplier.body)).toBe(201);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    supplierId: supplier.body.id,
    receiptDate: cairoDate(),
    lines: [{ productId: seeded.productId, quantity: 2, unitCostPiasters: 15000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const purchases = await api(manager, "GET", `/api/internal/purchases?supplierId=${supplier.body.id}`);
  expect(purchases.status, JSON.stringify(purchases.body)).toBe(200);
  expect(purchases.body).toEqual([
    expect.objectContaining({
      supplierNameAr: "مورد BUY",
      totalCostPiasters: 30000,
      products: [expect.objectContaining({ nameAr: "منتج BUY", quantity: 2, unitCostPiasters: 15000 })],
    }),
  ]);
  const totals = await api(manager, "GET", "/api/internal/expenses/totals");
  expect(totals.body.totalPiasters).toBe(0);
  const cashier = await createCashier(manager);
  expect((await api(cashier, "GET", "/api/internal/purchases")).status).toBe(403);
  expect((await api(cashier, "GET", "/api/internal/suppliers")).status).toBe(403);

  const current = await api(manager, "GET", `/api/internal/catalog/products/${seeded.productId}`);
  expect(current.status, JSON.stringify(current.body)).toBe(200);
  const updated = await api(manager, "PATCH", `/api/internal/catalog/products/${seeded.productId}`, {
    expectedRevision: current.body.editRevision,
    expectedVariantIds: current.body.variants.map((variant: { id: string }) => variant.id),
    code: current.body.code,
    nameAr: current.body.nameAr,
    descriptionAr: current.body.descriptionAr,
    categoryId: current.body.category.id,
    defaultSellingPricePiasters: 55000,
    minimumSellingPricePiasters: 50000,
    publication: current.body.publication,
    imageRefs: current.body.imageRefs,
    sizeGuideAr: current.body.sizeGuideAr,
    variants: current.body.variants.map((variant: { size: { id: string }; color: { id: string }; onlineVisible: boolean }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      onlineVisible: variant.onlineVisible,
      sellingPricePiastersOverride: null,
    })),
  });
  expect(updated.status, JSON.stringify(updated.body)).toBe(200);
  expect(updated.body.defaultSellingPricePiasters).toBe(55000);
  expect(updated.body.minimumSellingPricePiasters).toBe(50000);
  expect(updated.body.operationalVariantId).toBe(seeded.operationalVariantId);

  const override = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "BUY-OVERRIDE",
    nameAr: "سعر مستقل",
    descriptionAr: "",
    categoryId: seeded.categoryId,
    defaultSellingPricePiasters: 50000,
    minimumSellingPricePiasters: null,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: seeded.sizeId, colorId: seeded.colorId, sellingPricePiastersOverride: 70000 }],
  });
  expect(override.status, JSON.stringify(override.body)).toBe(400);
  expect(override.body.error.messageAr).toContain("سعر مستقل");
});

test("managers read customer pages and product locations without cost fields", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const cashier = await createCashier(manager);
  const stocked = await seedProduct(manager, "LOC", 80000, null);
  const empty = await seedProduct(manager, "ZERO", 10000, null);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: WAREHOUSE_BRANCH_ID,
    receiptDate: cairoDate(),
    lines: [{ productId: stocked.productId, quantity: 5, unitCostPiasters: 25000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  const moved = await api(manager, "POST", "/api/internal/inventory/transfers", {
    operationId: crypto.randomUUID(),
    sourceBranchId: WAREHOUSE_BRANCH_ID,
    destinationBranchId: abshwayId,
    productId: stocked.productId,
    quantity: 4,
  });
  expect(moved.status, JSON.stringify(moved.body)).toBe(201);

  const deniedLocations = await api(cashier, "GET", "/api/internal/inventory/product-locations");
  expect(deniedLocations.status).toBe(403);
  const locations = await api(manager, "GET", "/api/internal/inventory/product-locations");
  expect(locations.status, JSON.stringify(locations.body)).toBe(200);
  const locationText = JSON.stringify(locations.body);
  expect(locationText).not.toMatch(/cost|piaster|refund|netSpending|purchase/i);
  const stockedRow = locations.body.find((row: { productId: string }) => row.productId === stocked.productId);
  const emptyRow = locations.body.find((row: { productId: string }) => row.productId === empty.productId);
  if (!stockedRow || !emptyRow) throw new Error("product location row missing");
  expect(quantityAt(stockedRow, "warehouse")).toBe(1);
  expect(quantityAt(stockedRow, "abshway")).toBe(4);
  expect(quantityAt(stockedRow, "fayoum")).toBe(0);
  expect(quantityAt(emptyRow, "warehouse")).toBe(0);
  expect(quantityAt(emptyRow, "abshway")).toBe(0);
  expect(quantityAt(emptyRow, "fayoum")).toBe(0);

  const branch = await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  expect(branch.status, JSON.stringify(branch.body)).toBe(200);
  const firstSale = await api(manager, "POST", "/api/internal/sales", saleBody(stocked.operationalVariantId, {
    customerName: "نادر UXCUST",
    customerPhone: "01012345678",
  }));
  expect(firstSale.status, JSON.stringify(firstSale.body)).toBe(201);
  const secondSale = await api(manager, "POST", "/api/internal/sales", saleBody(stocked.operationalVariantId, {
    customerName: "هالة UXCUST",
    customerPhone: "01099998888",
  }));
  expect(secondSale.status, JSON.stringify(secondSale.body)).toBe(201);
  expect(await customerCount("01012345678")).toBe(1);
  expect(await customerCount("01099998888")).toBe(1);

  const deniedCustomers = await api(cashier, "GET", "/api/internal/customers?q=UXCUST");
  expect(deniedCustomers.status).toBe(403);
  const matched = await api(manager, "GET", "/api/internal/customers?q=UXCUST");
  expect(matched.status, JSON.stringify(matched.body)).toBe(200);
  expect(matched.body.customers.map((customer: { displayName: string }) => customer.displayName).sort()).toEqual(["نادر UXCUST", "هالة UXCUST"]);
  expect(JSON.stringify(matched.body)).not.toMatch(/refund|netSpending|cost|piaster/i);
  const byPhone = await api(manager, "GET", "/api/internal/customers?q=1234");
  expect(byPhone.body.customers).toEqual([
    expect.objectContaining({ displayName: "نادر UXCUST", normalizedPhone: "01012345678" }),
  ]);
  const page = await api(manager, "GET", "/api/internal/customers?q=UXCUST&limit=1");
  expect(page.body.customers).toHaveLength(1);
  expect(typeof page.body.nextCursor).toBe("string");
  const next = await api(manager, "GET", `/api/internal/customers?q=UXCUST&limit=1&cursor=${encodeURIComponent(page.body.nextCursor)}`);
  expect(next.body.customers).toHaveLength(1);
  expect(next.body.customers[0].id).not.toBe(page.body.customers[0].id);
  expect(next.body.nextCursor).toBeNull();
  const exact = await api(cashier, "GET", "/api/internal/customers/lookup?phone=01012345678");
  expect(exact.status, JSON.stringify(exact.body)).toBe(200);
  expect(exact.body.customer.normalizedPhone).toBe("01012345678");
});

function quantityAt(row: { locations: Array<{ code: string; quantity: number }> }, code: string): number {
  const location = row.locations.find((item) => item.code === code);
  if (!location) throw new Error(`missing location ${code}`);
  return location.quantity;
}

type Session = { cookie: string };

async function seedProduct(manager: Session, prefix: string, price: number, minimum: number | null) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  expect(category.status, JSON.stringify(category.body)).toBe(201);
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `أسود ${prefix}` });
  const white = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `أبيض ${prefix}` });
  expect(size.status, JSON.stringify(size.body)).toBe(201);
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `OP-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "",
    categoryId: category.body.id,
    defaultSellingPricePiasters: price,
    minimumSellingPricePiasters: minimum,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [
      { sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null },
      { sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const black = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr.includes("أسود"));
  const whiteVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr.includes("أبيض"));
  return {
    categoryId: category.body.id as string,
    sizeId: size.body.id as string,
    colorId: color.body.id as string,
    productId: created.body.id as string,
    operationalVariantId: created.body.operationalVariantId as string,
    blackId: black.id as string,
    whiteId: whiteVariant.id as string,
  };
}

function saleBody(variantId: string, extra: Record<string, unknown>) {
  return {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity: 1 }],
    ...extra,
  };
}

async function createCashier(manager: Session): Promise<Session> {
  const loginName = `cashier.${crypto.randomUUID().slice(0, 8)}`;
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "كاشير الاختبار",
    password: "staff-pass-1",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const cashier = await signIn(loginName, "staff-pass-1");
  const activated = await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  return cashier;
}

async function balances(productId: string) {
  const result = await built.pool.query<{ branch_id: string; quantity: number; unit_cost_piasters: number }>(
    `SELECT balance.branch_id, SUM(balance.remaining_quantity)::int AS quantity, batch.unit_cost_piasters
     FROM inventory_batch batch
     JOIN inventory_batch_balance balance ON balance.batch_id = batch.id
     WHERE batch.product_id = $1 AND balance.remaining_quantity > 0
     GROUP BY balance.branch_id, batch.unit_cost_piasters
     ORDER BY balance.branch_id`,
    [productId],
  );
  return result.rows.map((row) => ({
    branchId: row.branch_id,
    quantity: Number(row.quantity),
    unitCostPiasters: Number(row.unit_cost_piasters),
  }));
}

async function customerCount(phone: string): Promise<number> {
  const result = await built.pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM customer WHERE normalized_phone = $1",
    [phone],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function cairoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session?.cookie ?? "",
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload,
  });
  return { status: response.statusCode, body: safeJson(response.body) };
}

async function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: PUBLIC_ORIGIN,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    payload,
  });
  return { status: response.statusCode, body: safeJson(response.body) };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

function safeJson(body: string) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
