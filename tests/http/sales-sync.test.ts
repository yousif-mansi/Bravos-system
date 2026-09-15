import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { fingerprintAcceptedSalePayload } from "../../packages/sales/src/domain/fingerprint.ts";

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
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 20000 },
    ],
  });
  expect(accepted.status).toBe(201);
  expect(accepted.body.finalTotalPiasters).toBe(45000);
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
      { variantId: seed.secondVariantId, paidPiasters: 17500 },
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
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 20000 },
    ],
  });
  expect(replay.status).toBe(200);
  expect(replay.body.acknowledgement.stockVersion).toBe(ack.stockVersion);
  expect(availability(replay.body.acknowledgement, seed.variantId)).toBe(4);
  expect(availability(replay.body.acknowledgement, seed.secondVariantId)).toBe(4);
  const lookup = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(qty(lookup.body, seed.variantId)).toBe(4);
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
    lines: [{ variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 20000 }],
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

test("disabled cashier cannot accept while manager recovery keeps original 275/175 attribution", async () => {
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
      { variantId: seed.secondVariantId, quantity: 1, listedUnitPricePiasters: 20000 },
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
  expect(recovered.body.finalTotalPiasters).toBe(45000);
  const paid = recovered.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((a: number, b: number) => a - b);
  expect(paid).toEqual([17500, 27500]);
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
    variants.push({ sizeId: size.body.id, colorId: white.body.id, sellingPricePiastersOverride: 20000 });
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
