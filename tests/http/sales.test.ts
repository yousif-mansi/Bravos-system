import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { priceSaleLines } from "../../packages/sales/src/domain/discount.ts";
import { evaluatePosUpdate, isDeclaredSafeMigration } from "../../packages/sales/src/domain/pos-update.ts";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let databaseName = "bravos_sales_1";
let outboxDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55442 });
}, 120_000);

afterAll(async () => {
  if (built) {
    await built.close();
  }
  await cluster.stop();
});

beforeEach(async () => {
  await startApp();
});

test("completed sales allocate consecutive official POS references without burning quotes or retries", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 12000 });
  await receive(manager, seed.variantId, 8, 4000);

  const first = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(first.status).toBe(201);
  expect(first.body.reference).toBe("POS-000001");
  const second = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(second.status).toBe(201);
  expect(second.body.reference).toBe("POS-000002");

  const quoteId = crypto.randomUUID();
  const quoteOperation = crypto.randomUUID();
  const quoted = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: quoteId,
    operationId: quoteOperation,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(quoted.status).toBe(201);
  expect(quoted.body.reference).toBe(quoteId);
  expect(quoted.body.physicallyCompleted).toBe(false);
  const afterQuote = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(afterQuote.body.reference).toBe("POS-000003");

  const completedQuote = await api(manager, "POST", "/api/internal/sales", {
    saleId: quoteId,
    operationId: quoteOperation,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(completedQuote.status).toBe(201);
  expect(completedQuote.body.reference).toBe("POS-000004");
  const replay = await api(manager, "POST", "/api/internal/sales", {
    saleId: quoteId,
    operationId: quoteOperation,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.reference).toBe("POS-000004");

  const concurrentBodies = [saleBody(seed.variantId, 1), saleBody(seed.variantId, 1)];
  const concurrent = await Promise.all(concurrentBodies.map((body) => api(manager, "POST", "/api/internal/sales", body)));
  expect(concurrent.map((item) => item.status).sort()).toEqual([201, 201]);
  expect(concurrent.map((item) => item.body.reference).sort()).toEqual(["POS-000005", "POS-000006"]);

  const retryable = saleBody(seed.variantId, 1);
  await built.pool.query(`
    CREATE FUNCTION fail_sale_line_for_numbering_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Injected failure after the sale number is allocated';
    END;
    $$;
    CREATE TRIGGER fail_sale_line_for_numbering_test
    BEFORE INSERT ON sales_sale_line FOR EACH ROW EXECUTE FUNCTION fail_sale_line_for_numbering_test();
  `);
  try {
    expect((await api(manager, "POST", "/api/internal/sales", retryable)).status).toBe(500);
  } finally {
    await built.pool.query(`
      DROP TRIGGER fail_sale_line_for_numbering_test ON sales_sale_line;
      DROP FUNCTION fail_sale_line_for_numbering_test();
    `);
  }
  const afterRollback = await api(manager, "POST", "/api/internal/sales", retryable);
  expect(afterRollback).toMatchObject({ status: 201, body: { reference: "POS-000007" } });
});

test("unauthenticated cash-sale completion is rejected", async () => {
  const result = await api(undefined, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: crypto.randomUUID(), quantity: 1 }],
  });
  expect(result.status).toBe(401);
  expect(result.body.error.code).toBe("UNAUTHENTICATED");
  expect(result.body.error.messageAr).toBe("يلزم تسجيل الدخول.");
  expect(result.status).toBeLessThan(500);
});

test("branch sale records full online and split tender exactly once", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 30000 });
  await receive(manager, seed.variantId, 5, 10000);

  const onlineBody = saleBody(seed.variantId, 1, {
    payment: { method: "online", cashPiasters: 0, onlinePiasters: 30000 },
  });
  const online = await api(manager, "POST", "/api/internal/sales", onlineBody);
  expect(online.status).toBe(201);
  expect(online.body.payment).toEqual(onlineBody.payment);
  expect(online.body.cashReceivedPiasters).toBe(0);

  const splitBody = saleBody(seed.variantId, 1, {
    payment: { method: "split", cashPiasters: 15000, onlinePiasters: 15000 },
  });
  const split = await api(manager, "POST", "/api/internal/sales", splitBody);
  expect(split.status).toBe(201);
  expect(split.body.payment).toEqual(splitBody.payment);
  expect(split.body.finalTotalPiasters).toBe(30000);

  const replay = await api(manager, "POST", "/api/internal/sales", splitBody);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(split.body.id);
  const changedTender = await api(manager, "POST", "/api/internal/sales", {
    ...splitBody,
    payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 },
  });
  expect(changedTender.status).toBe(409);

  const legacyCashBody = saleBody(seed.variantId, 1);
  const legacyCash = await api(manager, "POST", "/api/internal/sales", legacyCashBody);
  expect(legacyCash.status).toBe(201);
  expect(legacyCash.body.payment).toEqual({ method: "cash", cashPiasters: 30000, onlinePiasters: 0 });
  expect((await api(manager, "POST", "/api/internal/sales", legacyCashBody)).status).toBe(200);
  const changedLegacyTender = await api(manager, "POST", "/api/internal/sales", {
    ...legacyCashBody,
    payment: { method: "online", cashPiasters: 0, onlinePiasters: 30000 },
  });
  expect(changedLegacyTender.status).toBe(409);

  for (const payment of [
    { method: "split", cashPiasters: 14999, onlinePiasters: 15000 },
    { method: "online", cashPiasters: 1, onlinePiasters: 29999 },
    { method: "split", cashPiasters: -100, onlinePiasters: 30100 },
  ]) {
    const invalid = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1, { payment }));
    expect(invalid.status).toBe(400);
  }
});

test("unassigned, representative-only and spoofed actors cannot complete a connected sale", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager, { price: 25000 });
  await receive(manager, seed.variantId, 4, 8000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "rep.only",
    displayName: "مندوب فقط",
    password: "staff-pass-30",
    grants: [{ branchId: abshwayId, cashier: false, orderRepresentative: true }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.abshway",
    displayName: "كاشير أبشواي",
    password: "staff-pass-31",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });

  const unassigned = await signIn("cashier.abshway", "staff-pass-31");
  const noBranch = await api(unassigned, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(noBranch.status).toBe(403);
  expect(noBranch.body.error.code).toBe("FORBIDDEN");
  expect(noBranch.status).toBeLessThan(500);

  const representative = await signIn("rep.only", "staff-pass-30");
  await api(representative, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const asRep = await api(representative, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(asRep.status).toBe(403);
  expect(asRep.body.error.code).toBe("FORBIDDEN");
  expect(asRep.status).toBeLessThan(500);

  await api(unassigned, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const spoofed = await api(unassigned, "POST", "/api/internal/sales", {
    ...saleBody(seed.variantId, 1),
    soldByStaffId: "someone-else",
    branchId: fayoumId,
    listedUnitPricePiasters: 1,
  });
  expect(spoofed.status).toBe(400);
  expect(spoofed.body.error.code).toBe("VALIDATION");
  expect(spoofed.body.error.messageAr).toBe("بيانات البيع غير صالحة.");
  expect(spoofed.status).toBeLessThan(500);

  const created = await api(unassigned, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(created.status).toBe(201);
  expect(created.body.soldByStaffId).toBeDefined();
  expect(created.body.branch.code).toBe("abshway");
  expect(created.body.soldByDisplayName).toBe("كاشير أبشواي");
  expect(created.body.lines[0].listedUnitPricePiasters).toBe(25000);
});

test("managers see every completed sale and employees see only their own authorized records", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 18000, extraColor: true });
  await receive(manager, seed.variantId, 5, 7000);
  await receive(manager, seed.secondVariantId, 5, 7000, fayoumId);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.one",
    displayName: "كاشير واحد",
    password: "staff-pass-32",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.two",
    displayName: "كاشير اثنان",
    password: "staff-pass-33",
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: false }],
  });

  const first = await signIn("cashier.one", "staff-pass-32");
  await api(first, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const firstSale = await api(first, "POST", "/api/internal/sales", {
    ...saleBody(seed.variantId, 1),
    customerName: "عميل نقدي",
    customerPhone: "01000000000",
  });
  expect(firstSale.status).toBe(201);
  expect(firstSale.body.customerName).toBe("عميل نقدي");
  expect(firstSale.body.branch.code).toBe("abshway");
  expect(JSON.stringify(firstSale.body)).not.toMatch(/unitCostPiasters|inventoryValue|profit|purchase/i);

  await api(first, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const switchedReplay = await api(first, "POST", "/api/internal/sales", {
    saleId: firstSale.body.id,
    operationId: firstSale.body.operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    customerName: "عميل نقدي",
    customerPhone: "01000000000",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(switchedReplay.status).toBe(200);
  expect(switchedReplay.body.branch.code).toBe("abshway");
  expect(switchedReplay.body.id).toBe(firstSale.body.id);

  const second = await signIn("cashier.two", "staff-pass-33");
  await api(second, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const secondSale = await api(second, "POST", "/api/internal/sales", saleBody(seed.secondVariantId, 1));
  expect(secondSale.status, JSON.stringify(secondSale.body)).toBe(201);
  expect(secondSale.body.branch.code).toBe("fayoum");

  const ownList = await api(first, "GET", "/api/internal/sales");
  expect(ownList.status).toBe(200);
  expect(ownList.body.map((row: { id: string }) => row.id)).toEqual([firstSale.body.id]);
  const foreignDetail = await api(first, "GET", `/api/internal/sales/${secondSale.body.id}`);
  expect(foreignDetail.status).toBe(403);
  expect(foreignDetail.body.error.code).toBe("FORBIDDEN");
  expect(foreignDetail.status).toBeLessThan(500);
  const otherList = await api(second, "GET", "/api/internal/sales");
  expect(otherList.body.map((row: { id: string }) => row.id)).toEqual([secondSale.body.id]);

  const managerList = await api(manager, "GET", "/api/internal/sales");
  expect(managerList.status).toBe(200);
  expect(managerList.body.map((row: { id: string }) => row.id).sort()).toEqual(
    [firstSale.body.id, secondSale.body.id].sort(),
  );
  const managerDetail = await api(manager, "GET", `/api/internal/sales/${firstSale.body.id}`);
  expect(managerDetail.status).toBe(200);
  expect(managerDetail.body.allocations[0]).toMatchObject({
    variantId: seed.variantId,
    quantity: 1,
    unitCostPiasters: 7000,
  });
  expect(managerDetail.body.costsIncomplete).toBe(false);
});

test("repeated variant lines are aggregated and known stock two rejects a request for three", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 12000 });
  await receive(manager, seed.variantId, 2, 4000);
  await receive(manager, seed.secondVariantId, 5, 4000);

  const rejected = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 2 },
      { variantId: seed.variantId, quantity: 1 },
    ],
  });
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.code).toBe("VALIDATION");
  expect(rejected.body.error.messageAr).toBe("الكمية المتاحة غير كافية.");
  expect(rejected.status).toBeLessThan(500);

  const mixed = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 2 },
      { variantId: seed.secondVariantId, quantity: 1 },
    ],
  });
  expect(mixed.status).toBe(201);
  expect(mixed.body.lines.map((line: { quantity: number }) => line.quantity).sort()).toEqual([1, 2]);

  const prepareRejected = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 3 }],
  });
  expect(prepareRejected.status).toBe(400);
  expect(prepareRejected.body.error.messageAr).toBe("الكمية المتاحة غير كافية.");

  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toHaveLength(1);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body.find((batch: { variantId: string }) => batch.variantId === seed.variantId).remainingQuantity).toBe(0);
});

test("ten received at 100 then ten at 140 and a sale of three leaves seven old and ten new", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 20000 });
  await receive(manager, seed.variantId, 10, 10000);
  await receive(manager, seed.variantId, 10, 14000);

  const sold = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 3));
  expect(sold.status).toBe(201);
  expect(sold.body.lines[0].quantity).toBe(3);
  expect(sold.body.allocations).toEqual([
    expect.objectContaining({ variantId: seed.variantId, quantity: 3, unitCostPiasters: 10000 }),
  ]);
  expect(sold.body.allocations.some((item: { unitCostPiasters: number }) => item.unitCostPiasters === 12000)).toBe(false);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  const remaining = batches.body
    .filter((batch: { variantId: string }) => batch.variantId === seed.variantId)
    .map((batch: { remainingQuantity: number; unitCostPiasters: number }) => ({
      remainingQuantity: batch.remainingQuantity,
      unitCostPiasters: batch.unitCostPiasters,
    }));
  expect(remaining).toEqual([
    { remainingQuantity: 7, unitCostPiasters: 10000 },
    { remainingQuantity: 10, unitCostPiasters: 14000 },
  ]);
});

test("employee deduction is nonnegative, permits zero, rejects negative, and allocates equally with caps", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 30000 });
  const secondColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض الخصم" });
  const secondSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "خصم" });
  expect(secondColor.status).toBe(201);
  expect(secondSize.status).toBe(201);
  const cheaper = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-200",
    nameAr: "تيشيرت أقل",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 20000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: secondSize.body.id, colorId: secondColor.body.id, sellingPricePiastersOverride: null }],
  });
  expect(cheaper.status).toBe(201);
  const cheaperVariantId = cheaper.body.variants[0].id as string;
  await receive(manager, seed.variantId, 12, 5000);
  await receive(manager, cheaperVariantId, 6, 5000);

  const equal = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    discountReason: "اتفاق مع الزبون",
    lines: [
      { variantId: seed.variantId, quantity: 1 },
      { variantId: cheaperVariantId, quantity: 1 },
    ],
  });
  expect(equal.status).toBe(201);
  expect(equal.body.originalTotalPiasters).toBe(50000);
  expect(equal.body.employeeDiscountPiasters).toBe(5000);
  expect(equal.body.finalTotalPiasters).toBe(45000);
  expect(equal.body.discountReason).toBe("اتفاق مع الزبون");
  expect(equal.body.discountedByStaffId).toEqual(expect.any(String));
  const paidEqual = equal.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((a: number, b: number) => a - b);
  expect(paidEqual).toEqual([17500, 27500]);
  expect(
    equal.body.lines
      .flatMap((line: { units: Array<{ quantity: number; paidPiasters: number }> }) => line.units)
      .sort((left: { paidPiasters: number }, right: { paidPiasters: number }) => left.paidPiasters - right.paidPiasters),
  ).toEqual([
    { unitIndex: 0, quantity: 1, listedPiasters: 20000, discountPiasters: 2500, paidPiasters: 17500 },
    { unitIndex: 0, quantity: 1, listedPiasters: 30000, discountPiasters: 2500, paidPiasters: 27500 },
  ]);

  const multi = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 6000,
    lines: [
      { variantId: seed.variantId, quantity: 2 },
      { variantId: cheaperVariantId, quantity: 1 },
    ],
  });
  expect(multi.status).toBe(201);
  expect(
    multi.body.lines
      .map((line: { variantId: string; quantity: number; units: Array<{ unitIndex: number; quantity: number; listedPiasters: number; discountPiasters: number; paidPiasters: number }> }) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        units: line.units,
      }))
      .sort((left: { variantId: string }, right: { variantId: string }) => (left.variantId < right.variantId ? -1 : 1)),
  ).toEqual(
    [
      {
        variantId: cheaperVariantId,
        quantity: 1,
        units: [{ unitIndex: 0, quantity: 1, listedPiasters: 20000, discountPiasters: 2000, paidPiasters: 18000 }],
      },
      {
        variantId: seed.variantId,
        quantity: 2,
        units: [{ unitIndex: 0, quantity: 2, listedPiasters: 30000, discountPiasters: 2000, paidPiasters: 28000 }],
      },
    ].sort((left, right) => (left.variantId < right.variantId ? -1 : 1)),
  );

  const cheapColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أحمر" });
  const cheapSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "S" });
  const cheapProduct = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-CHEAP",
    nameAr: "تيشيرت رخيص",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 1000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: cheapSize.body.id, colorId: cheapColor.body.id, sellingPricePiastersOverride: null },
    ],
  });
  const expensiveProduct = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-HIGH",
    nameAr: "تيشيرت أعلى",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 10000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: cheapSize.body.id, colorId: cheapColor.body.id, sellingPricePiastersOverride: null }],
  });
  const cheapId = cheapProduct.body.variants[0].id;
  const highId = expensiveProduct.body.variants[0].id;
  await receive(manager, cheapId, 2, 200);
  await receive(manager, highId, 2, 200);
  const capped = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    lines: [
      { variantId: cheapId, quantity: 1 },
      { variantId: highId, quantity: 1 },
    ],
  });
  expect(capped.status).toBe(201);
  expect(
    capped.body.lines
      .flatMap((line: { units: Array<{ quantity: number; paidPiasters: number }> }) => line.units)
      .sort((left: { paidPiasters: number }, right: { paidPiasters: number }) => left.paidPiasters - right.paidPiasters)
      .map((unit: { quantity: number; paidPiasters: number }) => ({ quantity: unit.quantity, paidPiasters: unit.paidPiasters })),
  ).toEqual([
    { quantity: 1, paidPiasters: 0 },
    { quantity: 1, paidPiasters: 6000 },
  ]);
  expect(capped.body.finalTotalPiasters).toBe(6000);

  const leftover = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 100,
    lines: [{ variantId: seed.variantId, quantity: 3 }],
  });
  expect(leftover.status).toBe(201);
  expect(leftover.body.lines[0].units).toEqual([
    { unitIndex: 0, quantity: 1, listedPiasters: 30000, discountPiasters: 34, paidPiasters: 29966 },
    { unitIndex: 1, quantity: 2, listedPiasters: 30000, discountPiasters: 33, paidPiasters: 29967 },
  ]);
  expect(leftover.body.finalTotalPiasters).toBe(89900);

  const zero = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 30000,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(zero.status).toBe(201);
  expect(zero.body.finalTotalPiasters).toBe(0);
  expect(zero.body.lines[0].paidPiasters).toBe(0);

  const negative = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 30001,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(negative.status).toBe(400);
  expect(negative.body.error.messageAr).toBe("لا يمكن أن يكون إجمالي البيع سالباً.");
  expect(negative.status).toBeLessThan(500);

  const belowZero = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: -1,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(belowZero.status).toBe(400);
  expect(belowZero.body.error.code).toBe("VALIDATION");
});

test("compact paid-unit ranges persist every ordinal through sale re-read", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 100 });
  await receive(manager, seed.variantId, 5000, 40);
  const created = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 2500,
    lines: [{ variantId: seed.variantId, quantity: 5000 }],
  });
  expect(created.status).toBe(201);
  expect(created.body.lines[0].quantity).toBe(5000);
  expect(created.body.originalTotalPiasters).toBe(500000);
  expect(created.body.employeeDiscountPiasters).toBe(2500);
  expect(created.body.finalTotalPiasters).toBe(497500);
  expect(created.body.lines[0].units).toEqual([
    { unitIndex: 0, quantity: 2500, listedPiasters: 100, discountPiasters: 1, paidPiasters: 99 },
    { unitIndex: 2500, quantity: 2500, listedPiasters: 100, discountPiasters: 0, paidPiasters: 100 },
  ]);
  expect(created.body.lines[0].units[0].quantity * created.body.lines[0].units[0].paidPiasters).toBe(247500);
  expect(created.body.lines[0].units[1].quantity * created.body.lines[0].units[1].paidPiasters).toBe(250000);
  const loaded = await api(manager, "GET", `/api/internal/sales/${created.body.id}`);
  expect(loaded.status).toBe(200);
  expect(loaded.body.lines[0].quantity).toBe(5000);
  expect(loaded.body.finalTotalPiasters).toBe(497500);
  expect(loaded.body.lines[0].units).toEqual([
    { unitIndex: 0, quantity: 2500, listedPiasters: 100, discountPiasters: 1, paidPiasters: 99 },
    { unitIndex: 2500, quantity: 2500, listedPiasters: 100, discountPiasters: 0, paidPiasters: 100 },
  ]);
});

test("sale totals above 32-bit integers round-trip and unrepresentable arithmetic is rejected", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 1_000_000_000 });
  await receive(manager, seed.variantId, 3, 100);
  const created = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 3 }],
  });
  expect(created.status).toBe(201);
  expect(created.body.originalTotalPiasters).toBe(3_000_000_000);
  expect(created.body.finalTotalPiasters).toBe(3_000_000_000);
  expect(created.body.lines[0].originalPiasters).toBe(3_000_000_000);
  expect(created.body.lines[0].paidPiasters).toBe(3_000_000_000);
  expect(created.body.lines[0].units).toEqual([
    { unitIndex: 0, quantity: 3, listedPiasters: 1_000_000_000, discountPiasters: 0, paidPiasters: 1_000_000_000 },
  ]);
  const loaded = await api(manager, "GET", `/api/internal/sales/${created.body.id}`);
  expect(loaded.status).toBe(200);
  expect(loaded.body.originalTotalPiasters).toBe(3_000_000_000);
  expect(loaded.body.finalTotalPiasters).toBe(3_000_000_000);
  expect(loaded.body.lines[0].paidPiasters).toBe(3_000_000_000);
  expect(loaded.body.lines[0].units).toEqual([
    { unitIndex: 0, quantity: 3, listedPiasters: 1_000_000_000, discountPiasters: 0, paidPiasters: 1_000_000_000 },
  ]);
  expect(() =>
    priceSaleLines(
      [{ variantId: seed.variantId, quantity: 2, listedUnitPricePiasters: Number.MAX_SAFE_INTEGER }],
      0,
    ),
  ).toThrow("تعذر تمثيل مبلغ البيع.");
});

test("identical sale identity returns the original result and a changed payload conflicts", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 15000 });
  await receive(manager, seed.variantId, 4, 6000);
  const payload = saleBody(seed.variantId, 1);
  const created = await api(manager, "POST", "/api/internal/sales", payload);
  expect(created.status).toBe(201);

  const replay = await api(manager, "POST", "/api/internal/sales", payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(created.body);

  const reordered = await api(manager, "POST", "/api/internal/sales", {
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    operationId: payload.operationId,
    saleId: payload.saleId,
    lines: [{ quantity: 1, variantId: seed.variantId }],
  });
  expect(reordered.status).toBe(200);
  expect(reordered.body.id).toBe(created.body.id);

  const changed = await api(manager, "POST", "/api/internal/sales", {
    ...payload,
    lines: [{ variantId: seed.variantId, quantity: 2 }],
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe("CONFLICT");
  expect(changed.body.error.messageAr).toBe("تعذر إعادة تنفيذ العملية ببيانات مختلفة.");
  expect(changed.status).toBeLessThan(500);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(3);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toHaveLength(1);
});

test("concurrent duplicate sale identities keep one stock effect", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 16000 });
  await receive(manager, seed.variantId, 5, 5000);
  const payload = saleBody(seed.variantId, 2);
  const [first, second] = await Promise.all([
    api(manager, "POST", "/api/internal/sales", payload),
    api(manager, "POST", "/api/internal/sales", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 201]);
  expect(first.body.id).toBe(second.body.id);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toHaveLength(1);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(3);
});

test("a failing multi-line sale rolls back then the same identity can complete the corrected payload", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 14000 });
  await receive(manager, seed.variantId, 5, 4000);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const failed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 2 },
      { variantId: "99999999-9999-4999-8999-999999999999", quantity: 1 },
    ],
  });
  expect(failed.status).toBe(400);
  expect(failed.body.error.code).toBe("VALIDATION");
  expect(failed.body.error.messageAr).toBe("المتغير المحدد غير موجود.");
  expect(failed.status).toBeLessThan(500);

  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(5);

  const retried = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 2 }],
  });
  expect(retried.status).toBe(201);
  expect(retried.body.lines[0].quantity).toBe(2);
  const after = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(after.body[0].remainingQuantity).toBe(3);
});

test("accepted listed prices are server-authoritative and saved sales are not repriced", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 22000 });
  await receive(manager, seed.variantId, 6, 8000);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  expect(prepared.body.lines[0].listedUnitPricePiasters).toBe(22000);
  expect(prepared.body.physicallyCompleted).toBe(false);

  const raised = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 40000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(raised.status).toBe(200);

  const completed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.lines[0].listedUnitPricePiasters).toBe(22000);
  expect(completed.body.originalTotalPiasters).toBe(22000);

  const later = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 50000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(later.status).toBe(200);
  const details = await api(manager, "GET", `/api/internal/sales/${completed.body.id}`);
  expect(details.body.lines[0].listedUnitPricePiasters).toBe(22000);
  const replay = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.lines[0].listedUnitPricePiasters).toBe(22000);

  const fresh = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(fresh.status).toBe(201);
  expect(fresh.body.lines[0].listedUnitPricePiasters).toBe(50000);
});

test("a previously valid physically completed sale is kept when a concurrent allocation wins", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 17000 });
  await receive(manager, seed.variantId, 1, 9000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.race",
    displayName: "كاشير السباق",
    password: "staff-pass-34",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.race", "staff-pass-34");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const preparedId = crypto.randomUUID();
  const preparedOperation = crypto.randomUUID();
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: preparedId,
    operationId: preparedOperation,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  expect(prepared.body.physicallyCompleted).toBe(false);

  const competing = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(competing.status).toBe(201);
  expect(competing.body.lines[0].allocatedQuantity).toBe(1);

  const kept = await api(cashier, "POST", "/api/internal/sales", {
    saleId: preparedId,
    operationId: preparedOperation,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(kept.status).toBe(201);
  expect(kept.body.physicallyCompleted).toBe(true);
  expect(kept.body.discrepancy).toMatchObject({
    unallocatedQuantity: 1,
    messageAr: "لم تُخصص كل الكمية من المخزون المسجّل.",
  });
  expect(kept.body.lines[0].allocatedQuantity).toBe(0);
  expect(kept.body.lines[0].unallocatedQuantity).toBe(1);
  expect(JSON.stringify(kept.body)).not.toMatch(/unitCostPiasters|inventoryValue|profit|purchase/i);

  const managerView = await api(manager, "GET", `/api/internal/sales/${preparedId}`);
  expect(managerView.body.costsIncomplete).toBe(true);
  expect(managerView.body.allocations).toEqual([]);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(0);
  expect(batches.body[0].remainingQuantity).toBeGreaterThanOrEqual(0);
  expect(batches.body.some((batch: { unitCostPiasters: number; remainingQuantity: number }) => batch.remainingQuantity < 0)).toBe(false);
});

test("prepare and complete replays authorize the actor before returning sale or customer data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 21000 });
  await receive(manager, seed.variantId, 4, 6000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.alpha",
    displayName: "كاشير ألفا",
    password: "staff-pass-40",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.beta",
    displayName: "كاشير بيتا",
    password: "staff-pass-41",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const alpha = await signIn("cashier.alpha", "staff-pass-40");
  await api(alpha, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const payload = {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    customerName: "زبون سري",
    customerPhone: "01011111111",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  };
  const prepared = await api(alpha, "POST", "/api/internal/sales/prepare", payload);
  expect(prepared.status).toBe(201);
  expect(prepared.body.customerName).toBe("زبون سري");

  const beta = await signIn("cashier.beta", "staff-pass-41");
  await api(beta, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const stolenPrepare = await api(beta, "POST", "/api/internal/sales/prepare", payload);
  expect(stolenPrepare.status).toBe(403);
  expect(stolenPrepare.body.error.code).toBe("FORBIDDEN");
  expect(stolenPrepare.status).toBeLessThan(500);
  expect(JSON.stringify(stolenPrepare.body)).not.toMatch(/زبون سري|01011111111/);

  const stolenComplete = await api(beta, "POST", "/api/internal/sales", {
    ...payload,
    physicallyCompleted: true,
  });
  expect(stolenComplete.status).toBe(403);
  expect(JSON.stringify(stolenComplete.body)).not.toMatch(/زبون سري|01011111111/);

  const completed = await api(alpha, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true });
  expect(completed.status).toBe(201);
  const stolenReplay = await api(beta, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true });
  expect(stolenReplay.status).toBe(403);
  expect(JSON.stringify(stolenReplay.body)).not.toMatch(/زبون سري/);
});

test("completing a prepared sale keeps the original branch after a session switch and requires cashier there", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 19000 });
  await receive(manager, seed.variantId, 3, 5000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.switcher",
    displayName: "كاشير التحويل",
    password: "staff-pass-42",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const cashier = await signIn("cashier.switcher", "staff-pass-42");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const pendingId = crypto.randomUUID();
  const pendingOperation = crypto.randomUUID();
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  expect(prepared.body.branch.code).toBe("abshway");
  const stillOpen = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: pendingId,
    operationId: pendingOperation,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(stillOpen.status).toBe(201);

  await api(cashier, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const completed = await api(cashier, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.branch.code).toBe("abshway");
  expect(completed.body.soldByDisplayName).toBe("كاشير التحويل");

  await api(manager, "POST", `/api/internal/staff/${completed.body.soldByStaffId}/grants`, {
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: false }],
  });
  const revokedPending = await api(cashier, "POST", "/api/internal/sales", {
    saleId: pendingId,
    operationId: pendingOperation,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(revokedPending.status).toBe(403);
  expect(revokedPending.status).toBeLessThan(500);
  const listed = await api(cashier, "GET", "/api/internal/sales");
  expect(listed.body.some((row: { id: string }) => row.id === completed.body.id)).toBe(false);
});

test("concurrent identical preparations return the original result and changed payload conflicts", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 15000 });
  await receive(manager, seed.variantId, 8, 4000);
  const payload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  };
  const [first, second] = await Promise.all([
    api(manager, "POST", "/api/internal/sales/prepare", payload),
    api(manager, "POST", "/api/internal/sales/prepare", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 201]);
  expect(first.status).toBeLessThan(500);
  expect(second.status).toBeLessThan(500);
  expect(first.body.id).toBe(second.body.id);
  expect(first.body.physicallyCompleted).toBe(false);

  const changed = await api(manager, "POST", "/api/internal/sales/prepare", {
    ...payload,
    lines: [{ variantId: seed.variantId, quantity: 2 }],
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe("CONFLICT");
  expect(changed.status).toBeLessThan(500);

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.otherprep",
    displayName: "كاشير آخر",
    password: "staff-pass-43",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.prep.b",
    displayName: "كاشير ب",
    password: "staff-pass-45",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const other = await signIn("cashier.otherprep", "staff-pass-43");
  const otherB = await signIn("cashier.prep.b", "staff-pass-45");
  await api(other, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  await api(otherB, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const otherPayload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    customerName: "زبون التحضير",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  };
  const raced = await Promise.all([
    api(other, "POST", "/api/internal/sales/prepare", otherPayload),
    api(otherB, "POST", "/api/internal/sales/prepare", otherPayload),
  ]);
  const raceStatuses = raced.map((item) => item.status).sort();
  expect(raceStatuses).toEqual([201, 403]);
  const accepted = raced.find((item) => item.status === 201);
  const forbidden = raced.find((item) => item.status === 403);
  expect(accepted?.body.physicallyCompleted).toBe(false);
  expect(["كاشير آخر", "كاشير ب"]).toContain(accepted?.body.soldByDisplayName);
  expect(forbidden?.body.error.code).toBe("FORBIDDEN");
  expect(JSON.stringify(forbidden?.body)).not.toMatch(/زبون التحضير|كاشير آخر|كاشير ب|soldByStaffId/);
  expect(forbidden?.status).toBeLessThan(500);
});

test("reusing another sale's operation identity conflicts without changing stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 15500 });
  await receive(manager, seed.variantId, 3, 4000);
  const operationId = crypto.randomUUID();
  const saleA = crypto.randomUUID();
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: saleA,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  const hijack = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(hijack.status).toBe(409);
  expect(hijack.body.error.code).toBe("CONFLICT");
  expect(hijack.status).toBeLessThan(500);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(3);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
  const completed = await api(manager, "POST", "/api/internal/sales", {
    saleId: saleA,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.id).toBe(saleA);
  expect(completed.body.physicallyCompleted).toBe(true);
  const after = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(after.body[0].remainingQuantity).toBe(2);
});

test("concurrent prepare and complete of the same identity persist one completed sale", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 16500 });
  await receive(manager, seed.variantId, 4, 3500);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const payload = {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  };
  const [prepared, completed] = await Promise.all([
    api(manager, "POST", "/api/internal/sales/prepare", payload),
    api(manager, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true }),
  ]);
  expect([prepared.status, completed.status].every((status) => status < 500)).toBe(true);
  const completion = completed.status >= 200 && completed.status < 300 ? completed : prepared;
  expect(completion.body.physicallyCompleted).toBe(true);
  expect(completion.body.id).toBe(saleId);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toHaveLength(1);
  expect(listed.body[0].physicallyCompleted).toBe(true);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(3);
  const replay = await api(manager, "POST", "/api/internal/sales", { ...payload, physicallyCompleted: true });
  expect(replay.status).toBe(200);
  expect(replay.body.physicallyCompleted).toBe(true);
  const after = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(after.body[0].remainingQuantity).toBe(3);
});

test("concurrent cashiers racing the same completion identity yield one owner and one forbidden", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 17500 });
  await receive(manager, seed.variantId, 3, 3600);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.race.a",
    displayName: "كاشير سباق أ",
    password: "staff-pass-46",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.race.b",
    displayName: "كاشير سباق ب",
    password: "staff-pass-47",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const first = await signIn("cashier.race.a", "staff-pass-46");
  const second = await signIn("cashier.race.b", "staff-pass-47");
  await api(first, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  await api(second, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const payload = saleBody(seed.variantId, 1, { customerName: "زبون السباق" });
  const raced = await Promise.all([
    api(first, "POST", "/api/internal/sales", payload),
    api(second, "POST", "/api/internal/sales", payload),
  ]);
  const statuses = raced.map((item) => item.status).sort();
  expect(statuses).toEqual([201, 403]);
  const accepted = raced.find((item) => item.status === 201);
  const forbidden = raced.find((item) => item.status === 403);
  expect(accepted?.body.physicallyCompleted).toBe(true);
  expect(["كاشير سباق أ", "كاشير سباق ب"]).toContain(accepted?.body.soldByDisplayName);
  expect(accepted?.body.customerName).toBe("زبون السباق");
  expect(forbidden?.body.error.code).toBe("FORBIDDEN");
  expect(JSON.stringify(forbidden?.body)).not.toMatch(/زبون السباق|كاشير سباق|soldByStaffId/);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toHaveLength(1);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body[0].remainingQuantity).toBe(2);
});

test("preparation and direct completion at pool max two finish four concurrent requests", async () => {
  await startApp({ databasePoolMax: 2 });
  expect(built.pool.options.max).toBe(2);
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 16000 });
  await receive(manager, seed.variantId, 20, 3000);
  await receive(manager, seed.secondVariantId, 20, 3000);
  const prepares = await Promise.all(
    [0, 1, 2, 3].map((index) =>
      api(manager, "POST", "/api/internal/sales/prepare", {
        saleId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        employeeDiscountPiasters: 0,
        lines: [{ variantId: seed.variantId, quantity: 1 }],
      }),
    ),
  );
  expect(prepares.map((item) => item.status)).toEqual([201, 201, 201, 201]);
  const completes = await Promise.all(
    [0, 1, 2, 3].map(() => api(manager, "POST", "/api/internal/sales", saleBody(seed.secondVariantId, 1))),
  );
  expect(completes.map((item) => item.status)).toEqual([201, 201, 201, 201]);
  expect(completes.every((item) => item.status < 500)).toBe(true);
});

test("merged quantity is rejected before expanding an unstocked large request", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 11000 });
  await receive(manager, seed.variantId, 2, 2000);
  const started = Date.now();
  const rejected = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 500000 },
      { variantId: seed.variantId, quantity: 500000 },
    ],
  });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.messageAr).toBe("الكمية المتاحة غير كافية.");
  expect(rejected.status).toBeLessThan(500);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
});

test("unresolved shortage stays unavailable after later receiving", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 17000 });
  await receive(manager, seed.variantId, 1, 8000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.hold",
    displayName: "كاشير الحجز",
    password: "staff-pass-44",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.hold", "staff-pass-44");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  const competing = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(competing.status).toBe(201);
  const kept = await api(cashier, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(kept.body.discrepancy.unallocatedQuantity).toBe(1);

  await receive(manager, seed.variantId, 10, 9000);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookup.status).toBe(200);
  const lookedUp = lookup.body.variants.find((variant: { id: string }) => variant.id === seed.variantId);
  expect(lookedUp.availableQuantity).toBe(0);
  const over = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 10 }],
  });
  expect(over.status).toBe(400);
  const one = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(one.status).toBe(400);
  const direct = await api(manager, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(direct.status).toBe(400);
  const low = await api(manager, "GET", "/api/internal/inventory/low-stock");
  const row = low.body.find((item: { variantId: string; branchId: string }) => item.variantId === lookup.body.operationalVariantId && item.branchId === abshwayId);
  expect(row.availableQuantity).toBe(0);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  const costs = batches.body
    .filter((batch: { variantId: string }) => batch.variantId === seed.variantId)
    .map((batch: { unitCostPiasters: number }) => batch.unitCostPiasters)
    .sort((a: number, b: number) => a - b);
  expect(costs).toEqual([8000, 9000]);
  expect(costs.includes(8500)).toBe(false);
});

test("physical completion records occurrence time separately from preparation and server receipt", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 13000 });
  await receive(manager, seed.variantId, 2, 3000);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  const preparedOccurred = prepared.body.occurredAt;
  const handover = "2026-09-12T00:20:00.000+03:00";
  const completed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    occurredAt: handover,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.occurredAt).toBe(new Date(handover).toISOString());
  expect(completed.body.occurredAt).not.toBe(preparedOccurred);
  expect(completed.body.recordedAt).toEqual(expect.any(String));
  expect(completed.body.recordedAt).not.toBe(completed.body.occurredAt);
  const replay = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    occurredAt: "2026-09-13T12:00:00.000Z",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.occurredAt).toBe(completed.body.occurredAt);
  expect(replay.body.recordedAt).toBe(completed.body.recordedAt);
});

test("a later valid-line stock failure rolls back the first allocation then retries the same identity", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 14000 });
  const [firstVariant, secondVariant] = [seed.variantId, seed.secondVariantId].sort();
  await receive(manager, firstVariant, 5, 4000);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const failed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: firstVariant, quantity: 2 },
      { variantId: secondVariant, quantity: 1 },
    ],
  });
  expect(failed.status).toBe(400);
  expect(failed.body.error.messageAr).toBe("الكمية المتاحة غير كافية.");
  expect(failed.status).toBeLessThan(500);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body.find((batch: { variantId: string }) => batch.variantId === firstVariant).remainingQuantity).toBe(5);
  expect(batches.body.find((batch: { variantId: string }) => batch.variantId === secondVariant)).toBeUndefined();

  const retried = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: firstVariant, quantity: 2 }],
  });
  expect(retried.status).toBe(201);
  expect(retried.body.lines[0].variantId).toBe(firstVariant);
  const after = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(after.body.find((batch: { variantId: string }) => batch.variantId === firstVariant).remainingQuantity).toBe(3);
});

test("authorized lookup of a prepared operation returns the accepted payload before completion", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 18000 });
  await receive(manager, seed.variantId, 2, 4000);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 200,
    customerName: "عميل مؤجل",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  const byOperation = await api(manager, "GET", `/api/internal/sales/operations/${operationId}`);
  expect(byOperation.status).toBe(200);
  expect(byOperation.body.physicallyCompleted).toBe(false);
  expect(byOperation.body.customerName).toBe("عميل مؤجل");
  expect(byOperation.body.employeeDiscountPiasters).toBe(200);
  expect(byOperation.body.lines[0].listedUnitPricePiasters).toBe(18000);
  const listed = await api(manager, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
});

test("issued POS snapshot keeps the accepted product price after later catalog reprice", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 30000 });
  const product = await api(manager, "GET", `/api/internal/catalog/products/${seed.productId}`);
  expect(product.status).toBe(200);
  const whiteColorId = product.body.variants.find((variant: { id: string }) => variant.id === seed.secondVariantId)
    .color.id;
  const priced = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
      { sizeId: seed.sizeId, colorId: whiteColorId, sellingPricePiastersOverride: null },
    ],
  });
  expect(priced.status).toBe(200);
  await receive(manager, seed.variantId, 2, 9000);
  await receive(manager, seed.secondVariantId, 2, 9000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.offline",
    displayName: "كاشير دون اتصال",
    password: "staff-pass-50",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const cashier = await signIn("cashier.offline", "staff-pass-50");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  expect(snapshot.body.deviceId).toBe(deviceId);
  expect(snapshot.body.branch.code).toBe("abshway");
  const snapshotPrices = snapshot.body.products
    .flatMap((item: { variants: Array<{ id: string; sellingPricePiasters: number }> }) => item.variants)
    .map((variant: { id: string; sellingPricePiasters: number }) => ({
      id: variant.id,
      sellingPricePiasters: variant.sellingPricePiasters,
    }))
    .sort((left: { id: string }, right: { id: string }) => (left.id < right.id ? -1 : 1));
  expect(snapshotPrices).toEqual(
    [
      { id: seed.variantId, sellingPricePiasters: 30000 },
      { id: seed.secondVariantId, sellingPricePiasters: 30000 },
    ].sort((left, right) => (left.id < right.id ? -1 : 1)),
  );
  expect(JSON.stringify(snapshot.body)).not.toMatch(/cost|profit|purchase|batch|inventoryValue|unitCost/i);

  const repriced = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 90000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
      { sizeId: seed.sizeId, colorId: whiteColorId, sellingPricePiastersOverride: null },
    ],
  });
  expect(repriced.status).toBe(200);
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: fayoumId });

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T10:15:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    discountReason: "اتفاق الصندوق",
    lines: [
      { variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 },
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 30000 },
    ],
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect(accepted.body.soldByDisplayName).toBe("كاشير دون اتصال");
  expect(accepted.body.branch.code).toBe("abshway");
  expect(accepted.body.occurredAt).toBe("2026-09-11T10:15:00.000Z");
  expect(accepted.body.originalTotalPiasters).toBe(60000);
  expect(accepted.body.employeeDiscountPiasters).toBe(5000);
  expect(accepted.body.finalTotalPiasters).toBe(55000);
  const paid = accepted.body.lines
    .map((line: { variantId: string; paidPiasters: number; listedUnitPricePiasters: number }) => ({
      variantId: line.variantId,
      listedUnitPricePiasters: line.listedUnitPricePiasters,
      paidPiasters: line.paidPiasters,
    }))
    .sort((left: { variantId: string }, right: { variantId: string }) =>
      left.variantId < right.variantId ? -1 : 1,
    );
  expect(paid).toEqual(
    [
      { variantId: seed.secondVariantId, listedUnitPricePiasters: 30000, paidPiasters: 27500 },
      { variantId: seed.variantId, listedUnitPricePiasters: 30000, paidPiasters: 27500 },
    ].sort((left, right) => (left.variantId < right.variantId ? -1 : 1)),
  );

  const refreshed = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(refreshed.status).toBe(201);
  expect(refreshed.body.snapshotId).not.toBe(snapshot.body.snapshotId);
  const refreshedBlack = refreshed.body.products
    .flatMap((item: { variants: Array<{ id: string; sellingPricePiasters: number }> }) => item.variants)
    .find((variant: { id: string }) => variant.id === seed.variantId);
  expect(refreshedBlack.sellingPricePiasters).toBe(90000);

  const replay = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T10:15:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    discountReason: "اتفاق الصندوق",
    lines: [
      { variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 },
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 30000 },
    ],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(accepted.body.id);
  expect(replay.body.finalTotalPiasters).toBe(55000);
  expect(replay.body.lines.find((line: { variantId: string }) => line.variantId === seed.variantId).listedUnitPricePiasters).toBe(
    30000,
  );

  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const connected = await api(cashier, "POST", "/api/internal/sales", saleBody(seed.variantId, 1));
  expect(connected.status, JSON.stringify(connected.body)).toBe(201);
  expect(connected.body.lines[0].listedUnitPricePiasters).toBe(90000);
});

test("tampered listed prices or a fabricated snapshot cannot authorize old catalog prices", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 25000 });
  await receive(manager, seed.variantId, 3, 8000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.trusted",
    displayName: "كاشير موثوق",
    password: "staff-pass-51",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.trusted", "staff-pass-51");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);

  const tampered = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T11:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 1000 }],
  });
  expect(tampered.status).toBe(400);
  expect(tampered.body.error.code).toBe("VALIDATION");

  const fabricated = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: crypto.randomUUID(),
    occurredAt: "2026-09-11T11:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(fabricated.status).toBe(404);

  const missing = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    occurredAt: "2026-09-11T11:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(missing.status).toBe(400);

  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookup.status).toBe(200);
  expect(lookup.body.variants[0].availableQuantity).toBe(3);
  const listed = await api(cashier, "GET", "/api/internal/sales");
  expect(listed.body).toEqual([]);
});

test("another cashier cannot submit or reattribute an issued snapshot before or after acceptance", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 25000 });
  await receive(manager, seed.variantId, 3, 8000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.alpha",
    displayName: "كاشير ألف",
    password: "staff-pass-53",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.beta",
    displayName: "كاشير باء",
    password: "staff-pass-54",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const alpha = await signIn("cashier.alpha", "staff-pass-53");
  await api(alpha, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const beta = await signIn("cashier.beta", "staff-pass-54");
  await api(beta, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(alpha, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const payload = {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T12:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  };

  const stolen = await api(beta, "POST", "/api/internal/sales/accepted", payload);
  expect(stolen.status).toBe(403);
  expect(JSON.stringify(stolen.body)).not.toMatch(/كاشير ألف/);
  expect(stolen.body.soldByDisplayName).toBeUndefined();
  expect(stolen.body.snapshotId).toBeUndefined();

  const remainingBefore = await api(alpha, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(remainingBefore.body.variants[0].availableQuantity).toBe(3);

  const accepted = await api(alpha, "POST", "/api/internal/sales/accepted", payload);
  expect(accepted.status).toBe(201);
  expect(accepted.body.soldByDisplayName).toBe("كاشير ألف");
  expect(accepted.body.finalTotalPiasters).toBe(25000);

  const replay = await api(alpha, "POST", "/api/internal/sales/accepted", payload);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(accepted.body.id);

  const conflict = await api(alpha, "POST", "/api/internal/sales/accepted", {
    ...payload,
    employeeDiscountPiasters: 1000,
  });
  expect(conflict.status).toBe(409);

  const borrowedSnapshot = await api(beta, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T12:05:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(borrowedSnapshot.status).toBe(403);
  expect(JSON.stringify(borrowedSnapshot.body)).not.toMatch(/كاشير ألف/);

  const betaDevice = crypto.randomUUID();
  const betaSnapshot = await api(beta, "POST", "/api/internal/sales/pos-snapshots", { deviceId: betaDevice });
  expect(betaSnapshot.status).toBe(201);
  const betaSale = await api(beta, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId: betaDevice,
    snapshotId: betaSnapshot.body.snapshotId,
    occurredAt: "2026-09-11T12:10:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(betaSale.status).toBe(201);
  expect(betaSale.body.soldByDisplayName).toBe("كاشير باء");

  const remaining = await api(alpha, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(remaining.body.variants[0].availableQuantity).toBe(1);
});

test("accepted replay is checked before merged-quantity pricing and huge repeated lines stay bounded", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 25000 });
  await receive(manager, seed.variantId, 2, 8000);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.bound",
    displayName: "كاشير الحدود",
    password: "staff-pass-55",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.bound", "staff-pass-55");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T13:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(accepted.status).toBe(201);

  const started = Date.now();
  const conflictingHuge = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T13:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 1_000_000, listedUnitPricePiasters: 25000 },
      { variantId: seed.variantId, quantity: 1_000_000, listedUnitPricePiasters: 25000 },
    ],
  });
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(conflictingHuge.status).toBe(409);
  expect(conflictingHuge.body.error.code).toBe("CONFLICT");

  const hugeNew = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-11T13:05:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: seed.variantId, quantity: 1_000_000, listedUnitPricePiasters: 25000 },
      { variantId: seed.variantId, quantity: 1_000_000, listedUnitPricePiasters: 25000 },
    ],
  });
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(hugeNew.status).toBe(400);
  expect(hugeNew.body.error.code).toBe("VALIDATION");
  expect(hugeNew.body.error.messageAr).toBe("الكمية غير صالحة.");

  const listed = await api(cashier, "GET", "/api/internal/sales");
  const mine = listed.body.filter((sale: { soldByDisplayName: string }) => sale.soldByDisplayName === "كاشير الحدود");
  expect(mine).toHaveLength(1);
  expect(mine[0].id).toBe(accepted.body.id);
  expect(mine[0].lines[0].quantity).toBe(1);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(1);
});

test("POS update activation defers undeclared schema jumps", () => {
  expect(isDeclaredSafeMigration(1, 2)).toBe(true);
  expect(isDeclaredSafeMigration(2, 3)).toBe(true);
  expect(isDeclaredSafeMigration(2, 99)).toBe(false);
  expect(evaluatePosUpdate({ storedSchemaVersion: 3, incomingSchemaVersion: 3, incomingMigrationSafe: true })).toBe(
    "activate",
  );
  expect(evaluatePosUpdate({ storedSchemaVersion: 2, incomingSchemaVersion: 3, incomingMigrationSafe: true })).toBe(
    "activate",
  );
  expect(evaluatePosUpdate({ storedSchemaVersion: 1, incomingSchemaVersion: 2, incomingMigrationSafe: true })).toBe(
    "activate",
  );
  expect(evaluatePosUpdate({ storedSchemaVersion: 3, incomingSchemaVersion: 99, incomingMigrationSafe: false })).toBe(
    "defer",
  );
  expect(evaluatePosUpdate({ storedSchemaVersion: 3, incomingSchemaVersion: 1, incomingMigrationSafe: true })).toBe(
    "defer",
  );
});

async function startApp(overrides: { databasePoolMax?: number } = {}) {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_sales_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-sales-outbox-"));
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
    ownerRecoveryOutboxDir: outboxDir,
    ...overrides,
  });
  await applyMigrations(built.pool);
  const branches = await built.pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM branch ORDER BY code",
  );
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
}

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: {
      origin: INTERNAL_ORIGIN,
      "content-type": "application/json",
    },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function saleBody(variantId: string, quantity: number, extra: Record<string, unknown> = {}) {
  return {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId, quantity }],
    ...extra,
  };
}

async function receive(manager: CookieSession, variantId: string, quantity: number, unitCostPiasters: number, branchId = abshwayId) {
  const result = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId,
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function seedShirt(
  manager: CookieSession,
  options?: { extraColor?: boolean; price?: number; override?: number | null },
): Promise<{
  categoryId: string;
  sizeId: string;
  colorId: string;
  productId: string;
  variantId: string;
  secondVariantId: string;
}> {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  expect(category.status).toBe(201);
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  expect(size.status).toBe(201);
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  expect(color.status).toBe(201);
  const variants = [
    {
      sizeId: size.body.id,
      colorId: color.body.id,
      sellingPricePiastersOverride: options?.override ?? null,
    },
  ];
  let secondColorId = "";
  if (options?.extraColor) {
    const white = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض" });
    expect(white.status).toBe(201);
    secondColorId = white.body.id;
    variants.push({ sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: null });
  }
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: options?.price ?? 25000,
    publication: "hidden",
    imageRefs: [],
    variants,
  });
  expect(created.status).toBe(201);
  const firstVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أسود");
  const secondVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أبيض");
  return {
    categoryId: category.body.id,
    sizeId: size.body.id,
    colorId: color.body.id,
    productId: created.body.id,
    variantId: firstVariant.id,
    secondVariantId: secondVariant?.id ?? "",
  };
}

async function api(
  session: CookieSession | undefined,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) {
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
  return {
    status: response.statusCode,
    body: safeJson(response.body),
  };
}

function safeJson(body: string) {
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
