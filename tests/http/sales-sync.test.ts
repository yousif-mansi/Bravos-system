import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { fingerprintAcceptedSalePayload } from "../../packages/sales/src/domain/fingerprint.ts";
import { formatReceiptReference } from "../../packages/sales/src/domain/receipt-number.ts";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let databaseName = "bravos_sales_sync_1";
let outboxDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55444 });
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

test("issued product stock uses the locked balance when intake follows the catalog read", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  await seedShirt(manager, { price: 30000 });
  const lookup = await api(manager, "GET", "/api/internal/catalog/lookup?code=TS-001");
  expect(lookup.status).toBe(200);
  const operationalVariantId = lookup.body.operationalVariantId as string;
  const original = built.catalog.listCashierCatalog.bind(built.catalog);
  const catalogRead = vi.spyOn(built.catalog, "listCashierCatalog").mockImplementationOnce(async (auth) => {
    const products = await original(auth);
    expect(products.find((product) => product.operationalVariantId === operationalVariantId)?.availableQuantity).toBe(0);
    await receive(manager, operationalVariantId, 2, 10000);
    return products;
  });
  try {
    const snapshot = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId: crypto.randomUUID() });
    expect(snapshot.status, JSON.stringify(snapshot.body)).toBe(201);
    expect(snapshot.body.products.find((product: { operationalVariantId: string }) =>
      product.operationalVariantId === operationalVariantId)?.availableQuantity).toBe(2);
  } finally {
    catalogRead.mockRestore();
  }
});

test("accepted sale returns a coherent acknowledgement covering both variants and does not repeat stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 30000 });
  await receive(manager, seed.variantId, 5, 10000);
  await receive(manager, seed.secondVariantId, 5, 14000);
  const cashier = await provisionCashier(manager, "sync.one", "كاشير المزامنة", "staff-pass-60");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  expect(snapshot.body.stockVersion).toEqual(expect.any(Number));
  expect(snapshot.body.includedOperationIds).toEqual([]);
  const xBefore = qty(snapshot.body, seed.variantId);
  const yBefore = qty(snapshot.body, seed.secondVariantId);
  expect(xBefore).toBe(5);
  expect(yBefore).toBe(5);

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    lines: [
      { variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 },
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 30000 },
    ],
  });
  expect(accepted.status).toBe(201);
  expect(accepted.body.finalTotalPiasters).toBe(55000);
  const paid = accepted.body.lines
    .map((line: { variantId: string; paidPiasters: number }) => ({
      variantId: line.variantId,
      paidPiasters: line.paidPiasters,
    }))
    .sort((left: { variantId: string }, right: { variantId: string }) =>
      left.variantId < right.variantId ? -1 : 1,
    );
  expect(paid).toEqual(
    [
      { variantId: seed.secondVariantId, paidPiasters: 27500 },
      { variantId: seed.variantId, paidPiasters: 27500 },
    ].sort((left, right) => (left.variantId < right.variantId ? -1 : 1)),
  );
  const ack = accepted.body.acknowledgement;
  expect(ack.acknowledgedOperationIds).toEqual([operationId]);
  expect(ack.includedOperationIds).toContain(operationId);
  expectOpaqueProof(ack.includedOperations[0], {
    operationId,
    saleId,
    contentDigest: fingerprintAcceptedSalePayload({
      saleId,
      snapshotId: snapshot.body.snapshotId,
      customerName: null,
      customerPhone: null,
      employeeDiscountPiasters: 5000,
      discountReason: null,
      lines: [
        { variantId: seed.variantId, quantity: 1 },
        { variantId: seed.secondVariantId, quantity: 1 },
      ],
    }),
  });
  expect(ack.stockVersion).toBeGreaterThan(snapshot.body.stockVersion);
  expect(availability(ack, seed.variantId)).toBe(4);
  expect(availability(ack, seed.secondVariantId)).toBe(4);
  expect(JSON.stringify(ack)).not.toMatch(/unitCostPiasters|inventoryValue|profit|purchase/i);

  const replay = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    pendingOperationIds: [operationId],
    lines: [
      { variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 },
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 30000 },
    ],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.acknowledgement.stockVersion).toBe(ack.stockVersion);
  expect(availability(replay.body.acknowledgement, seed.variantId)).toBe(4);
  expect(availability(replay.body.acknowledgement, seed.secondVariantId)).toBe(4);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(qty(lookup.body, seed.variantId)).toBe(4);

  const onlineSale = {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), deviceId,
    snapshotId: snapshot.body.snapshotId, occurredAt: "2026-09-14T08:01:00.000Z",
    physicallyCompleted: true, employeeDiscountPiasters: 0,
    payment: { method: "online" as const, cashPiasters: 0, onlinePiasters: 30000 },
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 }],
  };
  const onlineAccepted = await api(cashier, "POST", "/api/internal/sales/accepted", onlineSale);
  expect(onlineAccepted.status, JSON.stringify(onlineAccepted.body)).toBe(201);
  expect(onlineAccepted.body.payment).toEqual(onlineSale.payment);
  expect(onlineAccepted.body.acknowledgement.includedOperations).toEqual(expect.arrayContaining([expect.objectContaining({
    operationId: onlineSale.operationId,
    contentDigest: fingerprintAcceptedSalePayload({
      saleId: onlineSale.saleId, snapshotId: onlineSale.snapshotId,
      customerName: null, customerPhone: null, employeeDiscountPiasters: 0, discountReason: null,
      payment: onlineSale.payment,
      lines: [{ variantId: seed.variantId, quantity: 1 }],
    }),
  })]));
  expect((await api(cashier, "POST", "/api/internal/sales/accepted", onlineSale)).status).toBe(200);
  expect((await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...onlineSale, payment: { method: "cash", cashPiasters: 30000, onlinePiasters: 0 },
  })).status).toBe(409);
});

test("a later sale includes a lost earlier operation id without subtracting it twice", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 25000 });
  await receive(manager, seed.variantId, 5, 8000);
  await receive(manager, seed.secondVariantId, 5, 9000);
  const cashier = await provisionCashier(manager, "sync.lost", "كاشير الفقد", "staff-pass-61");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const firstOp = crypto.randomUUID();
  const first = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: firstOp,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:10:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(first.status).toBe(201);
  expect(availability(first.body.acknowledgement, seed.variantId)).toBe(4);

  const secondOp = crypto.randomUUID();
  const second = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: secondOp,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:11:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    pendingOperationIds: [firstOp, secondOp],
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
  });
  expect(second.status).toBe(201);
  expect(availability(second.body.acknowledgement, seed.variantId)).toBe(3);
  expect(second.body.acknowledgement.includedOperationIds.sort()).toEqual([firstOp, secondOp].sort());
  expect(second.body.acknowledgement.includedOperationIds).not.toContain(crypto.randomUUID());
});

test("a real conflicting payload stays 409 and later inclusion proof keeps the original sale identity", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 18000 });
  await receive(manager, seed.variantId, 4, 7000);
  await receive(manager, seed.secondVariantId, 4, 7000);
  const alpha = await provisionCashier(manager, "sync.alpha", "كاشير ألف", "staff-pass-70");
  const beta = await provisionCashier(manager, "sync.beta", "كاشير باء", "staff-pass-71");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(alpha, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const original = await api(alpha, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:40:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    customerName: "زبون سري",
    customerPhone: "01000000000",
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 18000 }],
  });
  expect(original.status).toBe(201);
  const originalDigest = fingerprintAcceptedSalePayload({
    saleId,
    snapshotId: snapshot.body.snapshotId,
    customerName: "زبون سري",
    customerPhone: "01000000000",
    employeeDiscountPiasters: 0,
    discountReason: null,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expectOpaqueProof(original.body.acknowledgement.includedOperations[0], {
    operationId,
    saleId,
    contentDigest: originalDigest,
  });
  const conflict = await api(alpha, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:40:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 1000,
    customerName: "زبون سري",
    customerPhone: "01000000000",
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 18000 }],
  });
  expect(conflict.status).toBe(409);
  expect(JSON.stringify(conflict.body)).not.toMatch(/زبون سري|01000000000/);
  const betaDevice = crypto.randomUUID();
  const betaSnapshot = await api(beta, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: betaDevice,
    pendingOperationIds: [operationId],
  });
  expect(betaSnapshot.status).toBe(201);
  const included = betaSnapshot.body.includedOperations.find(
    (proof: { operationId: string }) => proof.operationId === operationId,
  );
  expectOpaqueProof(included, { operationId, saleId, contentDigest: originalDigest });
  expectNoForeignSaleDetails(betaSnapshot.body, ["زبون سري", "01000000000", original.body.soldByStaffId]);
  const listed = await api(alpha, "GET", "/api/internal/sales");
  expect(listed.body.filter((sale: { id: string }) => sale.id === saleId)).toHaveLength(1);
  expect(listed.body[0].finalTotalPiasters).toBe(18000);
  expect(listed.body[0].customerPhone).toBe("01000000000");
});

test("changed phone, discount reason, or snapshot stay 409 and keep the original digest", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 19000 });
  await receive(manager, seed.variantId, 4, 6000);
  const cashier = await provisionCashier(manager, "sync.fields", "كاشير الحقول", "staff-pass-72");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const payload = {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:45:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 1000,
    customerName: "زبون الحقول",
    customerPhone: "01011111111",
    discountReason: "سبب أصلي",
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 19000 }],
  };
  const original = await api(cashier, "POST", "/api/internal/sales/accepted", payload);
  expect(original.status).toBe(201);
  const originalDigest = fingerprintAcceptedSalePayload({
    saleId,
    snapshotId: snapshot.body.snapshotId,
    customerName: "زبون الحقول",
    customerPhone: "01011111111",
    employeeDiscountPiasters: 1000,
    discountReason: "سبب أصلي",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expectOpaqueProof(original.body.acknowledgement.includedOperations[0], {
    operationId,
    saleId,
    contentDigest: originalDigest,
  });

  const phoneConflict = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...payload,
    customerPhone: "01022222222",
  });
  expect(phoneConflict.status).toBe(409);
  expect(JSON.stringify(phoneConflict.body)).not.toMatch(/زبون الحقول|01011111111|01022222222|سبب أصلي/);

  const reasonConflict = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...payload,
    discountReason: "سبب مختلف",
  });
  expect(reasonConflict.status).toBe(409);
  expect(JSON.stringify(reasonConflict.body)).not.toMatch(/سبب أصلي|سبب مختلف|01011111111/);

  const laterSnapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(laterSnapshot.status).toBe(201);
  const snapshotConflict = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...payload,
    snapshotId: laterSnapshot.body.snapshotId,
  });
  expect(snapshotConflict.status).toBe(409);

  const replay = await api(cashier, "POST", "/api/internal/sales/accepted", payload);
  expect(replay.status).toBe(200);
  expectOpaqueProof(replay.body.acknowledgement.includedOperations[0], {
    operationId,
    saleId,
    contentDigest: originalDigest,
  });
  const listed = await api(cashier, "GET", "/api/internal/sales");
  expect(listed.body[0].customerPhone).toBe("01011111111");
  expect(listed.body[0].discountReason).toBe("سبب أصلي");
  expect(listed.body[0].finalTotalPiasters).toBe(18000);
});

test("a later cashier snapshot can reconcile a lost acknowledgement without other-account sale details", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 21000 });
  await receive(manager, seed.variantId, 3, 7000);
  await receive(manager, seed.secondVariantId, 2, 8000);
  const alpha = await provisionCashier(manager, "sync.lostack", "كاشير الفقد السري", "staff-pass-73");
  const beta = await provisionCashier(manager, "sync.observer", "كاشير المراقب", "staff-pass-74");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(alpha, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = await api(alpha, "POST", "/api/internal/sales/accepted", {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:50:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 1000,
    customerName: "زبون الخصوصية",
    customerPhone: "01099887766",
    discountReason: "سبب سري للاختبار",
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 21000 }],
  });
  expect(accepted.status).toBe(201);
  const digest = fingerprintAcceptedSalePayload({
    saleId,
    snapshotId: snapshot.body.snapshotId,
    customerName: "زبون الخصوصية",
    customerPhone: "01099887766",
    employeeDiscountPiasters: 1000,
    discountReason: "سبب سري للاختبار",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  const betaDevice = crypto.randomUUID();
  const betaSnapshot = await api(beta, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: betaDevice,
    pendingOperationIds: [operationId, crypto.randomUUID()],
  });
  expect(betaSnapshot.status).toBe(201);
  expect(qty(betaSnapshot.body, seed.variantId)).toBe(2);
  expect(betaSnapshot.body.includedOperationIds).toEqual([operationId]);
  expectOpaqueProof(betaSnapshot.body.includedOperations[0], {
    operationId,
    saleId,
    contentDigest: digest,
  });
  expectNoForeignSaleDetails(betaSnapshot.body, [
    "زبون الخصوصية",
    "01099887766",
    "سبب سري للاختبار",
    "كاشير الفقد السري",
    accepted.body.soldByStaffId,
  ]);
  expect(JSON.stringify(betaSnapshot.body.includedOperations)).not.toMatch(
    /soldByStaffId|finalTotalPiasters|employeeDiscountPiasters|customerName|customerPhone|lines/,
  );
  const betaAck = await api(beta, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId: betaDevice,
    snapshotId: betaSnapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:51:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    pendingOperationIds: [operationId],
    lines: [{ variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 21000 }],
  });
  expect(betaAck.status).toBe(201);
  expect(betaAck.body.acknowledgement.includedOperationIds).toContain(operationId);
  expectOpaqueProof(
    betaAck.body.acknowledgement.includedOperations.find((proof: { operationId: string }) => proof.operationId === operationId),
    { operationId, saleId, contentDigest: digest },
  );
  expectNoForeignSaleDetails(betaAck.body.acknowledgement, [
    "زبون الخصوصية",
    "01099887766",
    "سبب سري للاختبار",
    "كاشير الفقد السري",
    accepted.body.soldByStaffId,
  ]);
});

test("forged pending operation ids are ignored unless the sale actually committed", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 18000 });
  await receive(manager, seed.variantId, 3, 7000);
  const cashier = await provisionCashier(manager, "sync.forge", "كاشير التزوير", "staff-pass-62");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const fake = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:20:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    pendingOperationIds: [fake, operationId],
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 18000 }],
  });
  expect(accepted.status).toBe(201);
  expect(accepted.body.acknowledgement.includedOperationIds).toEqual([operationId]);
  expect(accepted.body.acknowledgement.includedOperationIds).not.toContain(fake);
});

test("two concurrent accepts of the same operation deduct once and share one acknowledgement version", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 22000 });
  await receive(manager, seed.variantId, 2, 6000);
  const cashier = await provisionCashier(manager, "sync.tab", "كاشير التبويب", "staff-pass-63");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  const payload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T08:30:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 22000 }],
  };
  const [first, second] = await Promise.all([
    api(cashier, "POST", "/api/internal/sales/accepted", payload),
    api(cashier, "POST", "/api/internal/sales/accepted", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 201]);
  expect(first.body.id).toBe(second.body.id);
  expect(first.body.acknowledgement.stockVersion).toBe(second.body.acknowledgement.stockVersion);
  expect(availability(first.body.acknowledgement, seed.variantId)).toBe(1);
  expect(availability(second.body.acknowledgement, seed.variantId)).toBe(1);
  expect([...first.body.acknowledgement.includedOperationIds].sort()).toEqual(
    [...second.body.acknowledgement.includedOperationIds].sort(),
  );
  expectOpaqueProof(first.body.acknowledgement.includedOperations[0], {
    operationId: payload.operationId,
    saleId: payload.saleId,
    contentDigest: fingerprintAcceptedSalePayload({
      saleId: payload.saleId,
      snapshotId: payload.snapshotId,
      customerName: null,
      customerPhone: null,
      employeeDiscountPiasters: 0,
      discountReason: null,
      lines: [{ variantId: seed.variantId, quantity: 1 }],
    }),
  });
  expect(first.body.acknowledgement.includedOperations[0]).toEqual(second.body.acknowledgement.includedOperations[0]);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(1);
});

test("receiving advances the stock clock so a later snapshot is not labelled with a stale quantity", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 15000 });
  await receive(manager, seed.variantId, 2, 4000);
  const cashier = await provisionCashier(manager, "sync.recv", "كاشير الاستلام", "staff-pass-64");
  const deviceId = crypto.randomUUID();
  const before = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(qty(before.body, seed.variantId)).toBe(2);
  await receive(manager, seed.variantId, 3, 5000);
  const after = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(after.body.stockVersion).toBeGreaterThan(before.body.stockVersion);
  expect(qty(after.body, seed.variantId)).toBe(5);
});

test("disabled cashier cannot accept while manager recovery keeps the accepted equal split", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true, price: 30000 });
  await receive(manager, seed.variantId, 2, 9000);
  await receive(manager, seed.secondVariantId, 2, 9000);
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "sync.revoked",
    displayName: "كاشير ملغى",
    password: "staff-pass-65",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const me = await api(manager, "GET", "/api/internal/workspace");
  const cashier = await signIn("sync.revoked", "staff-pass-65");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  await api(manager, "POST", `/api/internal/staff/${created.body.id}/disable`);
  const payload = {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T09:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 5000,
    lines: [
      { variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 30000 },
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 30000 },
    ],
  };
  const denied = await api(cashier, "POST", "/api/internal/sales/accepted", payload);
  expect(denied.status).toBe(401);
  const other = await provisionCashier(manager, "sync.other", "كاشير آخر", "staff-pass-66");
  const stolen = await api(other, "POST", "/api/internal/sales/recover", payload);
  expect(stolen.status).toBe(403);
  expect(JSON.stringify(stolen.body)).not.toMatch(/كاشير ملغى|زبون/);
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", payload);
  expect(recovered.status).toBe(201);
  expect(recovered.body.soldByDisplayName).toBe("كاشير ملغى");
  expect(recovered.body.soldByStaffId).toBe(created.body.id);
  expect(recovered.body.recoveredByStaffId).toBe(me.body.staff.id);
  expect(recovered.body.branch.code).toBe("abshway");
  expect(recovered.body.occurredAt).toBe("2026-09-14T09:00:00.000Z");
  expect(recovered.body.recoveredAt).toEqual(expect.any(String));
  expect(recovered.body.recoveredAt).not.toBe(recovered.body.occurredAt);
  expect(recovered.body.finalTotalPiasters).toBe(55000);
  const paid = recovered.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((a: number, b: number) => a - b);
  expect(paid).toEqual([27500, 27500]);
  const lookupBeforeReplay = await api(manager, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  const remaining = lookupBeforeReplay.body.variants.find((variant: { id: string }) => variant.id === seed.variantId)
    .availableQuantity;
  const replay = await api(manager, "POST", "/api/internal/sales/recover", payload);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(recovered.body.id);
  expect(replay.body.soldByDisplayName).toBe("كاشير ملغى");
  expect(replay.body.recoveredByStaffId).toBe(me.body.staff.id);
  const lookupAfterReplay = await api(manager, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookupAfterReplay.body.variants.find((variant: { id: string }) => variant.id === seed.variantId).availableQuantity).toBe(
    remaining,
  );
});

test("manager recovery of a prepared connected sale keeps original prices and actor", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 21000 });
  await receive(manager, seed.variantId, 2, 5000);
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "sync.prepared",
    displayName: "كاشير التحضير",
    password: "staff-pass-67",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("sync.prepared", "staff-pass-67");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    occurredAt: "2026-09-13T20:30:00.000Z",
    employeeDiscountPiasters: 1000,
    customerName: "زبون محفوظ",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  expect(prepared.body.occurredAt).toBe("2026-09-13T20:30:00.000Z");
  const me = await api(manager, "GET", "/api/internal/workspace");
  await api(manager, "POST", `/api/internal/staff/${created.body.id}/disable`);
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId,
    operationId,
    physicallyCompleted: true,
    occurredAt: "2026-09-13T22:30:00.000Z",
  });
  expect(recovered.status).toBe(201);
  expect(recovered.body.soldByDisplayName).toBe("كاشير التحضير");
  expect(recovered.body.soldByStaffId).toBe(created.body.id);
  expect(recovered.body.branch.code).toBe("abshway");
  expect(recovered.body.employeeDiscountPiasters).toBe(1000);
  expect(recovered.body.finalTotalPiasters).toBe(20000);
  expect(recovered.body.lines[0].listedUnitPricePiasters).toBe(21000);
  expect(recovered.body.customerName).toBe("زبون محفوظ");
  expect(recovered.body.occurredAt).toBe("2026-09-13T22:30:00.000Z");
  expect(recovered.body.recoveredByStaffId).toBe(me.body.staff.id);
  expect(recovered.body.recoveredAt).toEqual(expect.any(String));
  expect(recovered.body.physicallyCompleted).toBe(true);
  const remaining = (
    await api(manager, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`)
  ).body.variants[0].availableQuantity;
  const replay = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId,
    operationId,
    physicallyCompleted: true,
    occurredAt: "2026-09-13T22:30:00.000Z",
  });
  expect(replay.status).toBe(200);
  expect(replay.body.occurredAt).toBe("2026-09-13T22:30:00.000Z");
  expect(
    (await api(manager, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`)).body.variants[0]
      .availableQuantity,
  ).toBe(remaining);
});

test("late accepted sale keeps FIFO 100 then 140 costs and holds leftover availability", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 30000 });
  await receive(manager, seed.variantId, 10, 10000);
  await receive(manager, seed.variantId, 10, 14000);
  const cashier = await provisionCashier(manager, "sync.late", "كاشير التأخير", "staff-pass-68");
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(qty(snapshot.body, seed.variantId)).toBe(20);
  const competing = await api(cashier, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 18 }],
  });
  expect(competing.status).toBe(201);
  expect(competing.body.lines[0].allocatedQuantity).toBe(18);
  const late = await api(cashier, "POST", "/api/internal/sales/accepted", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T10:00:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 5, listedUnitPricePiasters: 30000 }],
  });
  expect(late.status).toBe(201);
  expect(late.body.discrepancy.unallocatedQuantity).toBe(3);
  expect(late.body.lines[0].allocatedQuantity).toBe(2);
  const managerView = await api(manager, "GET", `/api/internal/sales/${late.body.id}`);
  expect(managerView.body.costsIncomplete).toBe(true);
  expect(managerView.body.allocations).toEqual([{ batchId: expect.any(String), variantId: seed.variantId, quantity: 2, unitCostPiasters: 14000, effectiveUnitCostPiasters: 14000 }]);
  await receive(manager, seed.variantId, 5, 16000);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(lookup.body.variants[0].availableQuantity).toBe(0);
});

test("revoking branch A while retaining branch B blocks prepared connected work pinned to A", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 16000 });
  await receive(manager, seed.variantId, 2, 5000);
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "sync.branchkeep",
    displayName: "كاشير الفرعين",
    password: "staff-pass-75",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const cashier = await signIn("sync.branchkeep", "staff-pass-75");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(snapshot.status).toBe(201);
  expect(snapshot.body.branch.code).toBe("abshway");
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    occurredAt: "2026-09-14T11:00:00.000Z",
    employeeDiscountPiasters: 0,
    customerName: "زبون الفرع الملغى",
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  expect(prepared.body.branch.code).toBe("abshway");
  expect(prepared.body.physicallyCompleted).toBe(false);
  const updated = await api(manager, "POST", `/api/internal/staff/${created.body.id}/grants`, {
    grants: [{ branchId: fayoumId, cashier: true, orderRepresentative: false }],
  });
  expect(updated.status).toBe(200);
  const blockedComplete = await api(cashier, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(blockedComplete.status).toBe(403);
  const blockedSnapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId: crypto.randomUUID() });
  expect(blockedSnapshot.status).toBe(403);
  const blockedPrepare = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(blockedPrepare.status).toBe(403);
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const fayoumSnapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId: crypto.randomUUID() });
  expect(fayoumSnapshot.status).toBe(201);
  expect(fayoumSnapshot.body.branch.code).toBe("fayoum");
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId,
    operationId,
    physicallyCompleted: true,
    occurredAt: "2026-09-14T11:15:00.000Z",
  });
  expect(recovered.status).toBe(201);
  expect(recovered.body.soldByStaffId).toBe(created.body.id);
  expect(recovered.body.soldByDisplayName).toBe("كاشير الفرعين");
  expect(recovered.body.branch.code).toBe("abshway");
  expect(recovered.body.occurredAt).toBe("2026-09-14T11:15:00.000Z");
  expect(recovered.body.recoveredByStaffId).toBe((await api(manager, "GET", "/api/internal/workspace")).body.staff.id);
  expect(recovered.body.customerName).toBe("زبون الفرع الملغى");
  expect(recovered.body.finalTotalPiasters).toBe(16000);
});

test("revoked cashier cannot start a new snapshot after reconnect", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName: "sync.grant",
    displayName: "كاشير الصلاحية",
    password: "staff-pass-69",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("sync.grant", "staff-pass-69");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const updated = await api(manager, "POST", `/api/internal/staff/${created.body.id}/grants`, {
    grants: [{ branchId: abshwayId, cashier: false, orderRepresentative: true }],
  });
  expect(updated.status).toBe(200);
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId: crypto.randomUUID() });
  expect(snapshot.status).toBe(403);
});

test("snapshot receipt registration is optional, idempotent, and does not use the POS reference sequence", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const legacy = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId });
  expect(legacy.status).toBe(201);
  expect(legacy.body.receiptRegistration).toBeUndefined();

  const invalid = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    receiptRegistrationId: "not-a-uuid",
  });
  expect(invalid.status).toBe(400);

  const registrationId = crypto.randomUUID();
  const first = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, receiptRegistrationId: registrationId });
  expect(first.status).toBe(201);
  expect(first.body.receiptRegistration).toEqual({ registrationId, deviceId, prefix: "1" });

  const retry = await api(manager, "POST", "/api/internal/sales/pos-snapshots", { deviceId, receiptRegistrationId: registrationId });
  expect(retry.status).toBe(201);
  expect(retry.body.receiptRegistration).toEqual(first.body.receiptRegistration);
  expect(retry.body.snapshotId).not.toBe(first.body.snapshotId);

  const caseRetry = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: deviceId.toUpperCase(),
    receiptRegistrationId: registrationId.toUpperCase(),
  });
  expect(caseRetry.status).toBe(201);
  expect(caseRetry.body.receiptRegistration).toEqual({ registrationId, deviceId, prefix: "1" });

  const mismatch = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: crypto.randomUUID(),
    receiptRegistrationId: registrationId,
  });
  expect(mismatch.status).toBe(400);
  const afterMismatch = await built.pool.query<{ last_value: string; is_called: boolean }>(
    "SELECT last_value::text, is_called FROM sales_receipt_prefix_seq",
  );
  expect(afterMismatch.rows[0]).toEqual({ last_value: "1", is_called: true });

  const otherDeviceId = crypto.randomUUID();
  const otherRegistrationId = crypto.randomUUID();
  const second = await api(manager, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId: otherDeviceId,
    receiptRegistrationId: otherRegistrationId,
  });
  expect(second.status).toBe(201);
  expect(second.body.receiptRegistration).toEqual({
    registrationId: otherRegistrationId,
    deviceId: otherDeviceId,
    prefix: "2",
  });

  const rows = await built.pool.query<{ id: string; device_id: string; prefix: string }>(
    "SELECT id, device_id, prefix FROM sales_receipt_registration ORDER BY prefix::bigint",
  );
  expect(rows.rows).toEqual([
    { id: registrationId, device_id: deviceId, prefix: "1" },
    { id: otherRegistrationId, device_id: otherDeviceId, prefix: "2" },
  ]);
  const posCounter = await built.pool.query<{ last_number: string }>(
    "SELECT last_number::text FROM sales_pos_reference_counter WHERE singleton",
  );
  expect(posCounter.rows[0]?.last_number).toBe("0");
});

test("concurrent receipt registration ids that differ only by case take one prefix", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const deviceId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const [left, right] = await Promise.all([
    api(manager, "POST", "/api/internal/sales/pos-snapshots", {
      deviceId,
      receiptRegistrationId: registrationId.toUpperCase(),
    }),
    api(manager, "POST", "/api/internal/sales/pos-snapshots", {
      deviceId: deviceId.toUpperCase(),
      receiptRegistrationId: registrationId,
    }),
  ]);
  expect(left.status).toBe(201);
  expect(right.status).toBe(201);
  expect(left.body.receiptRegistration).toEqual({ registrationId, deviceId, prefix: "1" });
  expect(right.body.receiptRegistration).toEqual(left.body.receiptRegistration);
  const rows = await built.pool.query<{ id: string; prefix: string }>(
    "SELECT id, prefix FROM sales_receipt_registration",
  );
  expect(rows.rows).toEqual([{ id: registrationId, prefix: "1" }]);
  const sequence = await built.pool.query<{ last_value: string; is_called: boolean }>(
    "SELECT last_value::text, is_called FROM sales_receipt_prefix_seq",
  );
  expect(sequence.rows[0]).toEqual({ last_value: "1", is_called: true });
});

test("receipt claims stay staff metadata and a paid sale survives unknown, colliding, and oversized numbers", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { price: 25000 });
  await receive(manager, seed.variantId, 10, 8000);
  const cashier = await provisionCashier(manager, "sync.receipt", "كاشير الإيصال", "staff-pass-81");
  const deviceId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const snapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", { deviceId, receiptRegistrationId: registrationId });
  expect(snapshot.status).toBe(201);
  const secondRegistrationId = crypto.randomUUID();
  const secondSnapshot = await api(cashier, "POST", "/api/internal/sales/pos-snapshots", {
    deviceId,
    receiptRegistrationId: secondRegistrationId,
  });
  expect(secondSnapshot.body.receiptRegistration.prefix).toBe("2");

  const legacy = await api(cashier, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: "2026-09-14T09:00:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(legacy.status).toBe(201);
  expect(legacy.body.receiptReference).toBeUndefined();
  expect(legacy.body.receiptNumberingConflict).toBeUndefined();
  expect(legacy.body.reference).toMatch(/^POS-/);

  const assignedClaim = receiptClaim(registrationId, deviceId, "1", "1");
  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const accepted = {
    saleId,
    operationId,
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T09:01:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
    receiptClaim: assignedClaim,
  };
  const created = await api(cashier, "POST", "/api/internal/sales/accepted", accepted);
  expect(created.status).toBe(201);
  expect(created.body.reference).toMatch(/^POS-/);
  expect(created.body.receiptReference).toBe("BRV-001-000001");
  expect(created.body.receiptNumberingConflict).toBeUndefined();
  expect(await stockQuantity(seed.variantId)).toBe("8");

  const replay = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...accepted,
    receiptClaim: receiptClaim(registrationId.toUpperCase(), deviceId.toUpperCase(), "1", "1"),
  });
  expect(replay.status).toBe(200);
  expect(replay.body.receiptReference).toBe("BRV-001-000001");
  expect(replay.body.receiptNumberingConflict).toBeUndefined();
  expect(await stockQuantity(seed.variantId)).toBe("8");

  const disagreed = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...accepted,
    receiptClaim: receiptClaim(registrationId, deviceId, "1", "2"),
  });
  expect(disagreed.status).toBe(200);
  expect(disagreed.body.receiptReference).toBe("BRV-001-000001");
  expect(disagreed.body.receiptNumberingConflict).toBe(true);
  expect(await stockQuantity(seed.variantId)).toBe("8");

  const collision = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...accepted,
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt: "2026-09-14T09:02:00.000Z",
  });
  expect(collision.status).toBe(201);
  expect(collision.body.receiptReference).toBe("BRV-001-000001");
  expect(collision.body.receiptNumberingConflict).toBe(true);
  const reserved = await api(cashier, "GET", `/api/internal/sales/${saleId}`);
  expect(reserved.body.receiptReference).toBe("BRV-001-000001");
  expect(await stockQuantity(seed.variantId)).toBe("7");

  const longSequence = "9".repeat(80);
  const longClaim = receiptClaim(crypto.randomUUID(), deviceId, "1", longSequence);
  const unknown = await api(cashier, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    physicallyCompleted: true,
    occurredAt: "2026-09-14T09:03:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
    receiptClaim: longClaim,
  });
  expect(unknown.status).toBe(201);
  expect(unknown.body.receiptReference).toBe(longClaim.reference);
  expect(unknown.body.receiptNumberingConflict).toBe(true);
  expect(await stockQuantity(seed.variantId)).toBe("6");

  const malformed = await api(cashier, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    physicallyCompleted: true,
    occurredAt: "2026-09-14T09:04:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
    receiptClaim: { reference: "desk-copy" },
  });
  expect(malformed.status).toBe(201);
  expect(malformed.body.receiptReference).toBe("desk-copy");
  expect(malformed.body.receiptNumberingConflict).toBe(true);

  const btreeSaleId = crypto.randomUUID();
  const btreeOperationId = crypto.randomUUID();
  const btreeClaim = receiptClaim(registrationId, deviceId, "1", variedDecimalSequence(7000, 0x5a17));
  const beforeBtree = await stockQuantity(seed.variantId);
  const btreeLimited = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...accepted,
    saleId: btreeSaleId,
    operationId: btreeOperationId,
    occurredAt: "2026-09-14T09:05:00.000Z",
    receiptClaim: btreeClaim,
  });
  expect(btreeLimited.status).toBe(201);
  expect(btreeLimited.body.receiptReference).toBe(btreeClaim.reference);
  expect(btreeLimited.body.receiptNumberingConflict).toBe(true);
  expect(await stockQuantity(seed.variantId)).toBe(String(Number(beforeBtree) - 1));
  await expectPreservedConflictSale(btreeSaleId, btreeOperationId, btreeClaim.reference, snapshot.body.snapshotId, seed.variantId);

  const tupleSaleId = crypto.randomUUID();
  const tupleOperationId = crypto.randomUUID();
  const tupleClaim = receiptClaim(registrationId, deviceId, "1", variedDecimalSequence(25000, 0x25000));
  const beforeTuple = await stockQuantity(seed.variantId);
  const tupleLimited = await api(cashier, "POST", "/api/internal/sales/accepted", {
    ...accepted,
    saleId: tupleSaleId,
    operationId: tupleOperationId,
    occurredAt: "2026-09-14T09:05:30.000Z",
    receiptClaim: tupleClaim,
  });
  expect(tupleLimited.status).toBe(201);
  expect(tupleLimited.body.receiptReference).toBe(tupleClaim.reference);
  expect(tupleLimited.body.receiptNumberingConflict).toBe(true);
  expect(await stockQuantity(seed.variantId)).toBe(String(Number(beforeTuple) - 1));
  await expectPreservedConflictSale(tupleSaleId, tupleOperationId, tupleClaim.reference, snapshot.body.snapshotId, seed.variantId);
  expect(await stockQuantity(seed.variantId)).toBe("3");

  const connected = await api(cashier, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    physicallyCompleted: true,
    occurredAt: "2026-09-14T09:06:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
    receiptClaim: receiptClaim(secondRegistrationId, deviceId, "2", "1"),
  });
  expect(connected.status).toBe(201);
  expect(connected.body.receiptReference).toBe("BRV-002-000001");
  expect(connected.body.receiptNumberingConflict).toBeUndefined();

  const preparedId = crypto.randomUUID();
  const preparedOperationId = crypto.randomUUID();
  const prepared = await api(cashier, "POST", "/api/internal/sales/prepare", {
    saleId: preparedId,
    operationId: preparedOperationId,
    occurredAt: "2026-09-14T09:07:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(prepared.status).toBe(201);
  const recovered = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId: preparedId,
    operationId: preparedOperationId,
    deviceId,
    physicallyCompleted: true,
    occurredAt: "2026-09-14T09:07:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
    receiptClaim: receiptClaim(secondRegistrationId, deviceId, "2", "2"),
  });
  expect(recovered.status).toBe(201);
  expect(recovered.body.receiptReference).toBe("BRV-002-000002");
  expect(recovered.body.receiptNumberingConflict).toBeUndefined();

  const acceptedRecovered = await api(manager, "POST", "/api/internal/sales/recover", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    deviceId,
    snapshotId: snapshot.body.snapshotId,
    occurredAt: "2026-09-14T09:08:00.000Z",
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1, listedUnitPricePiasters: 25000 }],
    receiptClaim: receiptClaim(registrationId, deviceId, "1", "3"),
  });
  expect(acceptedRecovered.status).toBe(201);
  expect(acceptedRecovered.body.receiptReference).toBe("BRV-001-000003");
  expect(acceptedRecovered.body.receiptNumberingConflict).toBeUndefined();
  expect(await stockQuantity(seed.variantId)).toBe("0");
});

function receiptClaim(registrationId: string, deviceId: string, prefix: string, sequence: string) {
  return { registrationId, deviceId, prefix, sequence, reference: formatReceiptReference(prefix, sequence) };
}

function variedDecimalSequence(length: number, seed: number): string {
  let state = seed >>> 0;
  let digits = "";
  while (digits.length < length) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    digits += String(state % 10);
  }
  return digits.startsWith("0") ? `1${digits.slice(1)}` : digits;
}

async function expectPreservedConflictSale(
  saleId: string,
  operationId: string,
  reference: string,
  snapshotId: string,
  variantId: string,
) {
  const stored = await built.pool.query<{
    sales: string;
    payload_fingerprint: string;
    reference: string;
    status: string;
  }>(
    `SELECT COUNT(*)::text AS sales,
            MAX(payload_fingerprint) AS payload_fingerprint,
            MAX(receipt_identity->>'reference') AS reference,
            MAX(receipt_identity->>'status') AS status
     FROM sales_sale
     WHERE id = $1 AND operation_id = $2`,
    [saleId, operationId],
  );
  const row = stored.rows[0];
  expect(row?.sales).toBe("1");
  expect(row?.status).toBe("conflict");
  expect(row?.reference).toBe(reference);
  expect(row?.payload_fingerprint).toBe(fingerprintAcceptedSalePayload({
    saleId,
    snapshotId,
    customerName: null,
    customerPhone: null,
    couponCode: null,
    employeeDiscountPiasters: 0,
    discountReason: null,
    lines: [{ variantId, quantity: 1 }],
  }));
}

async function stockQuantity(variantId: string): Promise<string> {
  const result = await built.pool.query<{ quantity: string }>(
    `SELECT COALESCE(SUM(balance.remaining_quantity), 0)::text AS quantity
     FROM inventory_batch_balance balance
     JOIN inventory_batch batch ON batch.id = balance.batch_id
     WHERE batch.variant_id = $1`,
    [variantId],
  );
  return result.rows[0]?.quantity ?? "0";
}

async function startApp() {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_sales_sync_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-sales-sync-outbox-"));
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
  });
  await applyMigrations(built.pool);
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch ORDER BY code");
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
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
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

async function provisionCashier(manager: CookieSession, loginName: string, displayName: string, password: string) {
  await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName,
    password,
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn(loginName, password);
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  return cashier;
}

async function receive(manager: CookieSession, variantId: string, quantity: number, unitCostPiasters: number) {
  const result = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function seedShirt(manager: CookieSession, options?: { extraColor?: boolean; price?: number }) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  const variants = [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null as number | null }];
  if (options?.extraColor) {
    const white = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض" });
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
  const firstVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أسود");
  const secondVariant = created.body.variants.find((variant: { color: { nameAr: string } }) => variant.color.nameAr === "أبيض");
  return {
    variantId: firstVariant.id as string,
    secondVariantId: (secondVariant?.id ?? "") as string,
  };
}

function qty(body: { products?: Array<{ variants: Array<{ id: string; availableQuantity: number }> }>; variants?: Array<{ id: string; availableQuantity: number }> }, variantId: string) {
  const variants = body.products?.flatMap((item) => item.variants) ?? body.variants ?? [];
  return variants.find((variant) => variant.id === variantId)?.availableQuantity;
}

function availability(ack: { availability: Array<{ variantId: string; availableQuantity: number }> }, variantId: string) {
  return ack.availability.find((item) => item.variantId === variantId)?.availableQuantity;
}

function expectOpaqueProof(
  proof: { operationId?: string; saleId?: string; contentDigest?: string } | undefined,
  expected: { operationId: string; saleId: string; contentDigest: string },
) {
  expect(proof).toEqual(expected);
  expect(Object.keys(proof ?? {}).sort()).toEqual(["contentDigest", "operationId", "saleId"]);
  expect(expected.contentDigest).toMatch(/^[0-9a-f]{64}$/);
}

function expectNoForeignSaleDetails(body: unknown, secrets: string[]) {
  const serialized = JSON.stringify(body);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).not.toMatch(/unitCostPiasters|inventoryValue|profit|purchase/i);
}

async function api(session: CookieSession | undefined, method: "GET" | "POST", url: string, payload?: unknown) {
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
  return { status: response.statusCode, body: safeJson(response.body) };
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
