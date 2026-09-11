import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
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
  await receive(manager, seed.secondVariantId, 5, 7000);
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
  expect(secondSale.status).toBe(201);
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
  const seed = await seedShirt(manager, { extraColor: true, price: 30000 });
  const expensive = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 30000 },
      {
        sizeId: seed.sizeId,
        colorId: (await api(manager, "GET", `/api/internal/catalog/products/${seed.productId}`)).body.variants.find(
          (variant: { id: string }) => variant.id === seed.secondVariantId,
        ).color.id,
        sellingPricePiastersOverride: 20000,
      },
    ],
  });
  expect(expensive.status).toBe(200);
  await receive(manager, seed.variantId, 12, 5000);
  await receive(manager, seed.secondVariantId, 6, 5000);

  const equal = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    discountReason: "اتفاق مع الزبون",
    lines: [
      { variantId: seed.variantId, quantity: 1 },
      { variantId: seed.secondVariantId, quantity: 1 },
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
  expect(equal.body.lines.flatMap((line: { units: Array<{ paidPiasters: number }> }) => line.units.map((unit) => unit.paidPiasters)).sort((a: number, b: number) => a - b)).toEqual([
    17500, 27500,
  ]);

  const multi = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 6000,
    lines: [
      { variantId: seed.variantId, quantity: 2 },
      { variantId: seed.secondVariantId, quantity: 1 },
    ],
  });
  expect(multi.status).toBe(201);
  expect(multi.body.lines.flatMap((line: { units: Array<{ paidPiasters: number }> }) => line.units.map((unit) => unit.paidPiasters)).sort((a: number, b: number) => a - b)).toEqual([
    18000, 28000, 28000,
  ]);

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
  expect(capped.body.lines.flatMap((line: { units: Array<{ paidPiasters: number }> }) => line.units.map((unit) => unit.paidPiasters)).sort((a: number, b: number) => a - b)).toEqual([
    0, 6000,
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
  expect(leftover.body.lines[0].units.map((unit: { discountPiasters: number }) => unit.discountPiasters)).toEqual([
    34, 33, 33,
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
  const seed = await seedShirt(manager, { price: 25000, override: 22000 });
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
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 40000 }],
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
  const row = low.body.find((item: { variantId: string }) => item.variantId === seed.variantId);
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

async function receive(manager: CookieSession, variantId: string, quantity: number, unitCostPiasters: number) {
  const result = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
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
