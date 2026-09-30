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
let databaseName = "bravos_receiving_1";
let outboxDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55454 });
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

test("manager receiving in two branches keeps separate FIFO cost batches", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();

  const first = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 10000 }],
  });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 10000 }],
  });
  expect(first.body.id).toEqual(expect.any(String));
  expect(first.body.lines[0].batchId).toEqual(expect.any(String));
  expect(first.body.branchId).toBe(abshwayId);

  const second = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: fayoumId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 10, unitCostPiasters: 14000 }],
  });
  expect(second.status).toBe(201);
  expect(second.body.lines[0].batchId).not.toBe(first.body.lines[0].batchId);
  expect(second.body.lines[0].unitCostPiasters).toBe(14000);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  expect(batches.body).toHaveLength(2);
  expect(batches.body.map((batch: { unitCostPiasters: number }) => batch.unitCostPiasters).sort((a: number, b: number) => a - b)).toEqual([
    10000, 14000,
  ]);
  expect(batches.body.every((batch: { remainingQuantity: number; receivedQuantity: number }) => batch.remainingQuantity === 10 && batch.receivedQuantity === 10)).toBe(true);
  expect(batches.body).toEqual(expect.arrayContaining([
    expect.objectContaining({ branchBalances: [expect.objectContaining({ branchId: abshwayId, availableQuantity: 10 })] }),
    expect.objectContaining({ branchBalances: [expect.objectContaining({ branchId: fayoumId, availableQuantity: 10 })] }),
  ]));
  expect(batches.body[0].recordedAt <= batches.body[1].recordedAt).toBe(true);
  const average = (10000 + 14000) / 2;
  expect(batches.body.some((batch: { unitCostPiasters: number }) => batch.unitCostPiasters === average)).toBe(false);
  expect(JSON.stringify(batches.body)).not.toMatch(/abshway|fayoum|branchPrice|inventoryValue|profit/i);

  const listed = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(listed.status).toBe(200);
  expect(listed.body).toHaveLength(2);
  const details = await api(manager, "GET", `/api/internal/receiving/receipts/${first.body.id}`);
  expect(details.status).toBe(200);
  expect(details.body.lines[0]).toMatchObject({
    quantity: 10,
    unitCostPiasters: 10000,
    batchId: first.body.lines[0].batchId,
  });
  const byOperation = await api(manager, "GET", `/api/internal/receiving/operations/${operationId}`);
  expect(byOperation.status).toBe(200);
  expect(byOperation.body.id).toBe(first.body.id);
  expect(byOperation.body.operationId).toBe(operationId);

  const sale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: "2026-09-12T12:00:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(sale.status).toBe(201);
  expect((await built.inventory.quantitiesFor(abshwayId, [seed.variantId])).get(seed.variantId)).toBe(9);
  expect((await built.inventory.quantitiesFor(fayoumId, [seed.variantId])).get(seed.variantId)).toBe(10);
});

test("manager links a 100-to-140 cost correction while a new 140 receipt stays separate", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const original = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 2, unitCostPiasters: 10000 }],
  });
  expect(original.status).toBe(201);

  const correctionOperationId = crypto.randomUUID();
  const corrected = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    {
      operationId: correctionOperationId,
      expectedRevision: 0,
      reason: "تصحيح تكلفة المورد",
      lines: [{
        lineId: original.body.lines[0].id,
        quantity: 2,
        unitCostPiasters: 14000,
      }],
    },
  );
  expect(corrected.status).toBe(201);
  expect(corrected.body).toMatchObject({
    id: original.body.id,
    correctionRevision: 1,
    lines: [{
      id: original.body.lines[0].id,
      quantity: 2,
      unitCostPiasters: 10000,
      effectiveQuantity: 2,
      effectiveUnitCostPiasters: 14000,
      remainingQuantity: 2,
      allocatedQuantity: 0,
    }],
    corrections: [{
      operationId: correctionOperationId,
      revision: 1,
      reason: "تصحيح تكلفة المورد",
      changedByStaffId: expect.any(String),
      changedAt: expect.any(String),
      lines: [{
        lineId: original.body.lines[0].id,
        originalQuantity: 2,
        originalUnitCostPiasters: 10000,
        previousQuantity: 2,
        previousUnitCostPiasters: 10000,
        effectiveQuantity: 2,
        effectiveUnitCostPiasters: 14000,
        quantityDelta: 0,
        unitCostDeltaPiasters: 4000,
      }],
    }],
  });

  const newReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-12",
    lines: [{ variantId: seed.variantId, quantity: 1, unitCostPiasters: 14000 }],
  });
  expect(newReceipt.status).toBe(201);
  expect(newReceipt.body.lines[0].batchId).not.toBe(original.body.lines[0].batchId);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  expect(batches.body).toEqual([
    expect.objectContaining({
      id: original.body.lines[0].batchId,
      receivedQuantity: 2,
      unitCostPiasters: 10000,
      effectiveReceivedQuantity: 2,
      effectiveUnitCostPiasters: 14000,
      remainingQuantity: 2,
    }),
    expect.objectContaining({
      id: newReceipt.body.lines[0].batchId,
      receivedQuantity: 1,
      unitCostPiasters: 14000,
      effectiveReceivedQuantity: 1,
      effectiveUnitCostPiasters: 14000,
      remainingQuantity: 1,
    }),
  ]);
});

test("accepted receipt and correction responses replay their original state after later allocation and correction", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  const receiptCommand = {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 2, unitCostPiasters: 10000 }],
  };
  const original = await api(manager, "POST", "/api/internal/receiving/receipts", receiptCommand);
  expect(original.status).toBe(201);
  const firstCorrection = {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    reason: "تصحيح أول إلى مائة وأربعين",
    lines: [{ lineId: original.body.lines[0].id, quantity: 2, unitCostPiasters: 14000 }],
  };
  const acceptedFirst = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    firstCorrection,
  );
  expect(acceptedFirst.status).toBe(201);
  expect(acceptedFirst.body.lines[0]).toMatchObject({
    effectiveUnitCostPiasters: 14000,
    remainingQuantity: 2,
    allocatedQuantity: 0,
  });

  const sale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    physicallyCompleted: true,
    occurredAt: "2026-09-12T12:00:00.000Z",
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(sale.status).toBe(201);
  const acceptedSecond = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      reason: "تصحيح ثان إلى مائة وخمسين",
      lines: [{ lineId: original.body.lines[0].id, quantity: 2, unitCostPiasters: 15000 }],
    },
  );
  expect(acceptedSecond.status).toBe(201);
  expect(acceptedSecond.body).toMatchObject({
    correctionRevision: 2,
    lines: [{ effectiveUnitCostPiasters: 15000, remainingQuantity: 1, allocatedQuantity: 1 }],
  });

  const replayFirst = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    firstCorrection,
  );
  expect(replayFirst.status).toBe(200);
  expect(replayFirst.body).toEqual(acceptedFirst.body);
  const replayReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", receiptCommand);
  expect(replayReceipt.status).toBe(200);
  expect(replayReceipt.body).toEqual(original.body);
  const current = await api(manager, "GET", `/api/internal/receiving/receipts/${original.body.id}`);
  expect(current.body).toEqual(acceptedSecond.body);
});

test("a cost correction flows through an existing allocation and its later sellable return", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  const original = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-10",
    lines: [{ variantId: seed.variantId, quantity: 1, unitCostPiasters: 10000 }],
  });
  expect(original.status).toBe(201);

  const sale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: seed.variantId, quantity: 1 }],
  });
  expect(sale.status).toBe(201);

  const corrected = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      reason: "فاتورة المورد الصحيحة",
      lines: [{ lineId: original.body.lines[0].id, quantity: 1, unitCostPiasters: 14000 }],
    },
  );
  expect(corrected.status).toBe(201);
  expect(corrected.body.lines[0]).toMatchObject({
    quantity: 1,
    unitCostPiasters: 10000,
    effectiveQuantity: 1,
    effectiveUnitCostPiasters: 14000,
    remainingQuantity: 0,
    allocatedQuantity: 1,
  });
  const saleDetail = await api(manager, "GET", `/api/internal/sales/${sale.body.id}`);
  expect(saleDetail.status).toBe(200);
  expect(saleDetail.body.allocations).toEqual([
    expect.objectContaining({
      batchId: original.body.lines[0].batchId,
      unitCostPiasters: 10000,
      effectiveUnitCostPiasters: 14000,
    }),
  ]);

  const sources = await api(manager, "GET", `/api/internal/returns/sources?reference=${sale.body.id}`);
  expect(sources.status).toBe(200);
  const returnId = crypto.randomUUID();
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId,
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: sale.body.finalTotalPiasters,
    lines: [{
      sourceSaleLineId: sources.body[0].lines[0].saleLineId,
      quantity: 1,
      sellableQuantity: 1,
    }],
  });
  expect(draft.status).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  expect(posted.body.restorations).toEqual([
    expect.objectContaining({
      batchId: original.body.lines[0].batchId,
      quantity: 1,
      unitCostPiasters: 10000,
      effectiveUnitCostPiasters: 14000,
    }),
  ]);

  const laterCorrection = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${original.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      reason: "تصحيح تكلفة لاحق",
      lines: [{ lineId: original.body.lines[0].id, quantity: 1, unitCostPiasters: 15000 }],
    },
  );
  expect(laterCorrection.status).toBe(201);
  const refreshedReturn = await api(manager, "GET", `/api/internal/returns/${returnId}`);
  expect(refreshedReturn.status).toBe(200);
  expect(refreshedReturn.body.restorations).toEqual([
    expect.objectContaining({
      batchId: original.body.lines[0].batchId,
      quantity: 1,
      unitCostPiasters: 10000,
      effectiveUnitCostPiasters: 15000,
    }),
  ]);

  const afterReturn = await api(manager, "GET", `/api/internal/receiving/receipts/${original.body.id}`);
  expect(afterReturn.status).toBe(200);
  expect(afterReturn.body.lines[0]).toMatchObject({
    quantity: 1,
    unitCostPiasters: 10000,
    effectiveQuantity: 1,
    effectiveUnitCostPiasters: 15000,
    remainingQuantity: 1,
    allocatedQuantity: 0,
  });
});

test("cross-branch return keeps stock in receiving branch through cost correction and blocks source-branch quantity reduction", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), branchId: abshwayId, receiptDate: "2026-09-25",
    lines: [{ variantId: seed.variantId, quantity: 2, unitCostPiasters: 10000 }],
  });
  expect(receipt.status).toBe(201);
  const sale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    employeeDiscountPiasters: 0, lines: [{ variantId: seed.variantId, quantity: 2 }],
  });
  expect(sale.status).toBe(201);
  const sources = await api(manager, "GET", `/api/internal/returns/sources?reference=${sale.body.id}`);
  const returnId = crypto.randomUUID();
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId, operationId: crypto.randomUUID(), sourceSaleId: sale.body.id,
    handlingBranchId: fayoumId, authorizedRefundPiasters: sale.body.finalTotalPiasters / 2,
    lines: [{ sourceSaleLineId: sources.body[0].lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status).toBe(201);
  const posted = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true, expectedRevision: draft.body.revision,
  });
  expect(posted.status, JSON.stringify(posted.body)).toBe(201);
  expect((await built.inventory.quantitiesFor(abshwayId, [seed.variantId])).get(seed.variantId)).toBe(0);
  expect((await built.inventory.quantitiesFor(fayoumId, [seed.variantId])).get(seed.variantId)).toBe(1);

  const costOnly = await api(manager, "POST", `/api/internal/receiving/receipts/${receipt.body.id}/corrections`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, reason: "تصحيح تكلفة المورد",
    lines: [{ lineId: receipt.body.lines[0].id, quantity: 2, unitCostPiasters: 14000 }],
  });
  expect(costOnly.status).toBe(201);
  expect(costOnly.body.lines[0].effectiveUnitCostPiasters).toBe(14000);
  const reduced = await api(manager, "POST", `/api/internal/receiving/receipts/${receipt.body.id}/corrections`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, reason: "تقليل كمية المورد",
    lines: [{ lineId: receipt.body.lines[0].id, quantity: 1, unitCostPiasters: 14000 }],
  });
  expect(reduced.status).toBe(400);
  expect(reduced.body.error.messageAr).toContain("فرع الاستلام");
  expect((await built.inventory.quantitiesFor(fayoumId, [seed.variantId])).get(seed.variantId)).toBe(1);
});

test("quantity correction rolls back every line and the same identity retries after an intervening return", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { extraColor: true });
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-10",
    lines: [seed.variantId, seed.secondVariantId].map((variantId) => ({
      variantId,
      quantity: 3,
      unitCostPiasters: 10000,
    })),
  });
  expect(receipt.status).toBe(201);
  const ordered = [...receipt.body.lines].sort((left: { batchId: string }, right: { batchId: string }) =>
    left.batchId.localeCompare(right.batchId));
  const validLine = ordered[0];
  const consumedLine = ordered[1];

  const sale = await api(manager, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [{ variantId: consumedLine.variantId, quantity: 2 }],
  });
  expect(sale.status).toBe(201);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId,
    expectedRevision: 0,
    reason: "تصحيح العد الفعلي",
    lines: receipt.body.lines.map((line: { id: string }) => ({
      lineId: line.id,
      quantity: line.id === validLine.id ? 5 : 1,
      unitCostPiasters: 10000,
    })),
  };

  const rejected = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    payload,
  );
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.messageAr).toBe("لا يمكن تقليل كمية الاستلام عن الوحدات المستهلكة حالياً.");
  const unchanged = await api(manager, "GET", `/api/internal/receiving/receipts/${receipt.body.id}`);
  expect(unchanged.body).toMatchObject({ correctionRevision: 0, corrections: [] });
  expect(unchanged.body.lines.find((line: { id: string }) => line.id === validLine.id)).toMatchObject({
    effectiveQuantity: 3,
    remainingQuantity: 3,
  });

  const sources = await api(manager, "GET", `/api/internal/returns/sources?reference=${sale.body.id}`);
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: sale.body.id,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: Math.floor(sale.body.finalTotalPiasters / 2),
    lines: [{
      sourceSaleLineId: sources.body[0].lines[0].saleLineId,
      quantity: 1,
      sellableQuantity: 1,
    }],
  });
  expect(draft.status).toBe(201);
  const returned = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(returned.status, JSON.stringify(returned.body)).toBe(201);

  const corrected = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    payload,
  );
  expect(corrected.status).toBe(201);
  expect(corrected.body).toMatchObject({ correctionRevision: 1 });
  expect(corrected.body.lines.find((line: { id: string }) => line.id === validLine.id)).toMatchObject({
    quantity: 3,
    effectiveQuantity: 5,
    remainingQuantity: 5,
    allocatedQuantity: 0,
  });
  expect(corrected.body.lines.find((line: { id: string }) => line.id === consumedLine.id)).toMatchObject({
    quantity: 3,
    effectiveQuantity: 1,
    remainingQuantity: 0,
    allocatedQuantity: 1,
  });

  const replay = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    payload,
  );
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(corrected.body);
  const changedReplay = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    { ...payload, reason: "بيانات مختلفة" },
  );
  expect(changedReplay.status).toBe(409);
});

test("receiving correction is manager-only and retains each effective revision with its Arabic actor", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 2, unitCostPiasters: 10000 }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.receiving.correction",
    displayName: "كاشير بلا تصحيح",
    password: "staff-pass-91",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.receiving.correction", "staff-pass-91");
  const firstPayload = {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    reason: "تصحيح أول",
    lines: [{ lineId: receipt.body.lines[0].id, quantity: 2, unitCostPiasters: 14000 }],
  };
  const denied = await api(
    cashier,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    firstPayload,
  );
  expect(denied.status).toBe(403);

  const first = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    firstPayload,
  );
  expect(first.status).toBe(201);
  expect(first.body.corrections[0]).toMatchObject({
    revision: 1,
    changedByDisplayName: "مالك برافوس",
  });
  const stale = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      reason: "نسخة قديمة",
      lines: [{ lineId: receipt.body.lines[0].id, quantity: 3, unitCostPiasters: 15000 }],
    },
  );
  expect(stale.status).toBe(409);
  expect(stale.body.error.messageAr).toBe("تم تعديل إذن الاستلام. حدّث البيانات ثم أعد المحاولة.");

  const second = await api(
    manager,
    "POST",
    `/api/internal/receiving/receipts/${receipt.body.id}/corrections`,
    {
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      reason: "تصحيح نهائي",
      lines: [{ lineId: receipt.body.lines[0].id, quantity: 3, unitCostPiasters: 15000 }],
    },
  );
  expect(second.status).toBe(201);
  expect(second.body).toMatchObject({
    correctionRevision: 2,
    lines: [{
      quantity: 2,
      unitCostPiasters: 10000,
      effectiveQuantity: 3,
      effectiveUnitCostPiasters: 15000,
    }],
    corrections: [
      { revision: 1, reason: "تصحيح أول", changedByDisplayName: "مالك برافوس" },
      {
        revision: 2,
        reason: "تصحيح نهائي",
        changedByDisplayName: "مالك برافوس",
        lines: [{
          originalQuantity: 2,
          originalUnitCostPiasters: 10000,
          previousQuantity: 2,
          previousUnitCostPiasters: 14000,
          effectiveQuantity: 3,
          effectiveUnitCostPiasters: 15000,
          quantityDelta: 1,
          unitCostDeltaPiasters: 1000,
        }],
      },
    ],
  });
});

test("identical receiving operation identity returns the original result and changed payload fails", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-10",
    lines: [{ variantId: seed.variantId, quantity: 4, unitCostPiasters: 8000 }],
  };
  const created = await api(manager, "POST", "/api/internal/receiving/receipts", payload);
  expect(created.status).toBe(201);

  const replay = await api(manager, "POST", "/api/internal/receiving/receipts", payload);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(created.body);

  const reordered = await api(manager, "POST", "/api/internal/receiving/receipts", {
    branchId: abshwayId,
    receiptDate: "2026-09-10",
    operationId,
    lines: [{ unitCostPiasters: 8000, quantity: 4, variantId: seed.variantId }],
  });
  expect(reordered.status).toBe(200);
  expect(reordered.body.id).toBe(created.body.id);

  const changed = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-10",
    lines: [{ variantId: seed.variantId, quantity: 5, unitCostPiasters: 8000 }],
  });
  expect(changed.status).toBe(409);
  expect(changed.body.error.code).toBe("CONFLICT");
  expect(changed.body.error.messageAr).toBe("تعذر إعادة تنفيذ العملية ببيانات مختلفة.");
  expect(changed.status).toBeLessThan(500);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0].receivedQuantity).toBe(4);
});

test("concurrent duplicate receiving identities keep one stock effect", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const payload = {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-09",
    lines: [{ variantId: seed.variantId, quantity: 6, unitCostPiasters: 9000 }],
  };
  const [first, second] = await Promise.all([
    api(manager, "POST", "/api/internal/receiving/receipts", payload),
    api(manager, "POST", "/api/internal/receiving/receipts", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([200, 201]);
  expect(first.body.id).toBe(second.body.id);
  expect(first.body.lines[0].batchId).toBe(second.body.lines[0].batchId);
  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.body).toHaveLength(1);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0].remainingQuantity).toBe(6);
});

test("a failing multi-line receiving operation rolls back receipt and stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const operationId = crypto.randomUUID();
  const failed = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [
      { variantId: seed.variantId, quantity: 8, unitCostPiasters: 7000 },
      {
        variantId: "99999999-9999-4999-8999-999999999999",
        quantity: 3,
        unitCostPiasters: 7000,
      },
    ],
  });
  expect(failed.status).toBe(400);
  expect(failed.body.error.code).toBe("VALIDATION");
  expect(failed.body.error.messageAr).toBe("المتغير المحدد غير موجود.");
  expect(failed.status).toBeLessThan(500);

  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(200);
  expect(receipts.body).toEqual([]);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toEqual([]);

  const retried = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId,
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 8, unitCostPiasters: 7000 }],
  });
  expect(retried.status).toBe(201);
  expect(retried.body.lines).toHaveLength(1);
  expect(retried.body.lines[0].quantity).toBe(8);
  const afterRetry = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(afterRetry.body).toHaveLength(1);
  expect(afterRetry.body[0].remainingQuantity).toBe(8);
});

test("low-stock evaluates each branch using persisted default 3 and per-variant override", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager, { extraColor: true });
  const settings = await api(manager, "GET", "/api/internal/inventory/settings");
  expect(settings.status).toBe(200);
  expect(settings.body).toEqual({ lowStockThreshold: 3 });
  const unstocked = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(unstocked.status).toBe(200);
  expect(unstocked.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variantId: seed.variantId, availableQuantity: 0, threshold: 3, thresholdSource: "global" }),
      expect.objectContaining({ variantId: seed.secondVariantId, availableQuantity: 0, threshold: 3, thresholdSource: "global" }),
    ]),
  );

  await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [
      { variantId: seed.variantId, quantity: 3, unitCostPiasters: 5000 },
      { variantId: seed.secondVariantId, quantity: 4, unitCostPiasters: 5000 },
    ],
  });
  const initial = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(initial.status).toBe(200);
  const initialAbshway = initial.body.filter((item: { branchId: string }) => item.branchId === abshwayId);
  expect(initialAbshway.map((item: { variantId: string }) => item.variantId)).toEqual([seed.variantId]);
  expect(initialAbshway[0]).toMatchObject({
    availableQuantity: 3,
    threshold: 3,
    thresholdSource: "global",
  });

  const raised = await api(manager, "PATCH", "/api/internal/inventory/settings", { lowStockThreshold: 4 });
  expect(raised.status).toBe(200);
  expect(raised.body).toEqual({ lowStockThreshold: 4 });
  const afterGlobal = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterGlobal.body.filter((item: { branchId: string }) => item.branchId === abshwayId).map((item: { variantId: string }) => item.variantId).sort()).toEqual(
    [seed.secondVariantId, seed.variantId].sort(),
  );

  const override = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${seed.variantId}/low-stock-threshold`,
    { lowStockThreshold: 2 },
  );
  expect(override.status).toBe(200);
  expect(override.body).toMatchObject({ variantId: seed.variantId, lowStockThreshold: 2 });
  const afterOverride = await api(manager, "GET", "/api/internal/inventory/low-stock");
  const afterOverrideAbshway = afterOverride.body.filter((item: { branchId: string }) => item.branchId === abshwayId);
  expect(afterOverrideAbshway).toHaveLength(1);
  expect(afterOverrideAbshway[0]).toMatchObject({
    variantId: seed.secondVariantId,
    availableQuantity: 4,
    threshold: 4,
    thresholdSource: "global",
  });

  const persisted = await api(manager, "GET", "/api/internal/inventory/settings");
  expect(persisted.body.lowStockThreshold).toBe(4);

  const cleared = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${seed.variantId}/low-stock-threshold`,
    { lowStockThreshold: null },
  );
  expect(cleared.status).toBe(200);
  expect(cleared.body).toMatchObject({
    variantId: seed.variantId,
    lowStockThreshold: null,
  });
  expect(cleared.body.updatedByStaffId).toEqual(expect.any(String));
  expect(cleared.body.updatedAt).toEqual(expect.any(String));
  const afterClear = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterClear.body.filter((item: { branchId: string }) => item.branchId === abshwayId).map((item: { variantId: string }) => item.variantId).sort()).toEqual(
    [seed.secondVariantId, seed.variantId].sort(),
  );

  const zero = await api(manager, "PATCH", "/api/internal/inventory/settings", { lowStockThreshold: 0 });
  expect(zero.status).toBe(200);
  expect(zero.body).toEqual({ lowStockThreshold: 0 });
  const afterZero = await api(manager, "GET", "/api/internal/inventory/low-stock");
  expect(afterZero.body.filter((item: { branchId: string }) => item.branchId === abshwayId)).toEqual([]);
  expect(afterZero.body.filter((item: { branchId: string }) => item.branchId === fayoumId)).toHaveLength(2);
});

test("cashier lookup uses active branch availability and selling prices without cost data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager);
  await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 12, unitCostPiasters: 6500 }],
  });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.stock",
    displayName: "كاشير المخزون",
    password: "staff-pass-30",
    grants: [
      { branchId: abshwayId, cashier: true, orderRepresentative: false },
      { branchId: fayoumId, cashier: true, orderRepresentative: false },
    ],
  });
  const cashier = await signIn("cashier.stock", "staff-pass-30");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: fayoumId });
  const found = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(found.status).toBe(200);
  expect(found.body.variants[0]).toEqual({
    id: seed.variantId,
    size: { id: seed.sizeId, nameAr: "L" },
    color: { id: seed.colorId, nameAr: "أسود" },
    sellingPricePiasters: 25000,
    availableQuantity: 0,
  });
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const stocked = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(stocked.body.variants[0].availableQuantity).toBe(12);
  expect(JSON.stringify(found.body)).not.toMatch(/cost|profit|purchase|batch|inventoryValue|6500/i);
  expect(Object.keys(found.body).sort()).toEqual(["categoryId", "code", "descriptionAr", "id", "nameAr", "variants"]);
  expect(found.body.categoryId).toBe(seed.categoryId);

  const receipts = await api(cashier, "GET", "/api/internal/receiving/receipts");
  expect(receipts.status).toBe(403);
  expect(receipts.body.error.code).toBe("FORBIDDEN");
  expect(receipts.status).toBeLessThan(500);
  const batches = await api(cashier, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(403);
  expect(batches.body.error.code).toBe("FORBIDDEN");
  const settings = await api(cashier, "GET", "/api/internal/inventory/settings");
  expect(settings.status).toBe(403);
  const receive = await api(cashier, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId: seed.variantId, quantity: 1, unitCostPiasters: 1000 }],
  });
  expect(receive.status).toBe(403);
  expect(receive.status).toBeLessThan(500);
  const unauthenticated = await api(undefined, "GET", "/api/internal/inventory/batches");
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.body.error.code).toBe("UNAUTHENTICATED");
  expect(unauthenticated.status).toBeLessThan(500);

  const created = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(created.status).toBe(200);
  const operationId = created.body[0].operationId;
  const cashierLookup = await api(cashier, "GET", `/api/internal/receiving/operations/${operationId}`);
  expect(cashierLookup.status).toBe(403);
  expect(cashierLookup.body.error.code).toBe("FORBIDDEN");
  expect(cashierLookup.status).toBeLessThan(500);
  const unknown = await api(manager, "GET", `/api/internal/receiving/operations/${crypto.randomUUID()}`);
  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe("NOT_FOUND");
  expect(unknown.body.error.messageAr).toBe("لم يُحفظ إذن الاستلام بعد.");
  expect(unknown.status).toBeLessThan(500);
});

test("catalog price edits keep received variant and batch identity, and referenced removal is rejected", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-08",
    lines: [{ variantId: seed.variantId, quantity: 7, unitCostPiasters: 11000 }],
  });
  expect(received.status).toBe(201);
  const batchId = received.body.lines[0].batchId;

  const renamed = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 }],
  });
  expect(renamed.status).toBe(200);
  expect(renamed.body.variants[0].id).toBe(seed.variantId);
  expect(renamed.body.variants[0].sellingPricePiasters).toBe(28000);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toHaveLength(1);
  expect(batches.body[0]).toMatchObject({
    id: batchId,
    variantId: seed.variantId,
    remainingQuantity: 7,
    unitCostPiasters: 11000,
  });

  const extraSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  const removed = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: extraSize.body.id, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(removed.status).toBe(409);
  expect(removed.body.error.code).toBe("VARIANT_REFERENCED");
  expect(removed.body.error.messageAr).toBe("لا يمكن حذف متغير مرتبط بسجلات مخزون.");
  expect(removed.status).toBeLessThan(500);

  const stillThere = await api(manager, "GET", `/api/internal/catalog/products/${seed.productId}`);
  expect(stillThere.body.variants[0].id).toBe(seed.variantId);
  const stillBatch = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(stillBatch.body[0].id).toBe(batchId);

  const extraColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أخضر" });
  const withDraft = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 },
      { sizeId: extraSize.body.id, colorId: extraColor.body.id, sellingPricePiastersOverride: null },
    ],
  });
  expect(withDraft.status).toBe(200);
  const draftId = withDraft.body.variants.find((variant: { id: string }) => variant.id !== seed.variantId).id;
  const draftThreshold = await api(
    manager,
    "PUT",
    `/api/internal/inventory/variants/${draftId}/low-stock-threshold`,
    { lowStockThreshold: 1 },
  );
  expect(draftThreshold.status).toBe(200);
  const dropDraft = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "قطن ثقيل",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 27000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 }],
  });
  expect(dropDraft.status).toBe(200);
  expect(dropDraft.body.variants).toHaveLength(1);
  expect(dropDraft.body.variants[0].id).toBe(seed.variantId);
  const stillReceived = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(stillReceived.body[0].id).toBe(batchId);
});

async function startApp(overrides: { databasePoolMax?: number } = {}) {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_receiving_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-receiving-outbox-"));
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

async function seedShirt(
  manager: CookieSession,
  options?: { extraColor?: boolean },
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
  const variants = [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }];
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
    defaultSellingPricePiasters: 25000,
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

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
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
