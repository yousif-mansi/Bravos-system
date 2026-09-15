import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { applyMigrations, listAppliedMigrations, revertLastMigration } from "@bravos/persistence";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const NOW = new Date("2026-09-15T12:00:00.000Z");
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55453 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  const database = `bravos_returns_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(database),
    authSecret: "returns-secret-returns-secret-32xx",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-returns-outbox-")),
    businessClock: () => new Date(NOW),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
});

test("an inspected return credits current-offer replacement merchandise and records only the collected cash", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const originalProduct = await seedProduct(manager, [28000]);
  const replacementProduct = await seedProduct(manager, [40000]);
  const originalBatch = await receive(manager, originalProduct.variantIds[0]!, 1, 10000);
  const replacementBatch = await receive(manager, replacementProduct.variantIds[0]!, 2, 15000);
  await api(manager, "POST", "/api/internal/pricing/offers", {
    nameAr: "خصم الاستبدال الحالي",
    discountType: "percentage",
    percentageBasisPoints: 2000,
    fixedDiscountPiasters: null,
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    active: true,
    allowCoupon: true,
    productIds: [replacementProduct.productId],
    categoryIds: [],
  });
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: originalProduct.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  const quote = await exchangeQuote(manager, drafted.body.id, drafted.body.revision, [
    { variantId: replacementProduct.variantIds[0], quantity: 1 },
  ]);
  expect(quote.body).toMatchObject({
    replacementMerchandisePiasters: 32000,
    creditAvailablePiasters: 28000,
    creditAppliedPiasters: 28000,
    cashCollectedPiasters: 4000,
    cashRefundPiasters: 0,
    appliedAutomaticOffer: { nameAr: "خصم الاستبدال الحالي" },
  });
  await api(manager, "POST", "/api/internal/pricing/offers", {
    nameAr: "عرض أقوى بعد قبول الفرق",
    discountType: "percentage", percentageBasisPoints: 5000, fixedDiscountPiasters: null,
    startsOn: "2026-09-01", endsOn: "2026-09-30", active: true, allowCoupon: true,
    productIds: [replacementProduct.productId], categoryIds: [],
  });
  const quoteReplay = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange-quote`, quote.request);
  expect(quoteReplay.status).toBe(200);
  expect(quoteReplay.body).toEqual(quote.body);
  const command = {
    ...quote.body.settlement,
    receivedAndInspected: true,
    expectedRevision: drafted.body.revision,
    cashRefundStatus: "owed",
    quoteId: quote.body.id,
  };

  const exchanged = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, command);
  expect(exchanged.status).toBe(201);
  expect(exchanged.body).toMatchObject({
    status: "posted",
    exchange: {
      id: command.exchangeId,
      operationId: command.operationId,
      replacementSaleId: command.replacementSaleId,
      replacementMerchandisePiasters: 32000,
      creditAppliedPiasters: 28000,
      cashCollectedPiasters: 4000,
      cashRefund: { status: "none", owedPiasters: 0, paidPiasters: 0 },
      allocations: [expect.objectContaining({ batchId: replacementBatch.lines[0].batchId, quantity: 1, unitCostPiasters: 15000 })],
    },
    refund: { status: "none", owedPiasters: 0, paidPiasters: 0 },
    restorations: [expect.objectContaining({ batchId: originalBatch.lines[0].batchId, quantity: 1, unitCostPiasters: 10000 })],
  });

  const replacementSale = await api(manager, "GET", `/api/internal/sales/${command.replacementSaleId}`);
  expect(replacementSale.status).toBe(200);
  expect(replacementSale.body).toMatchObject({
    finalTotalPiasters: 32000,
    exchangeCreditAppliedPiasters: 28000,
    cashReceivedPiasters: 4000,
    appliedAutomaticOffer: { nameAr: "خصم الاستبدال الحالي" },
  });
  const correction = await api(manager, "GET", `/api/internal/corrections/sales/${command.replacementSaleId}`);
  expect(correction.body.actual).toMatchObject({ originalCashReceivedPiasters: 4000, netCashReceivedPiasters: 4000 });
  const replacementSource = await api(manager, "GET", `/api/internal/returns/sources?reference=${command.replacementSaleId}`);
  expect(replacementSource.body[0].lines[0].remainingSuggestedPiasters).toBe(32000);

  const afterFirst = await batches(manager);
  const replay = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, command);
  expect(replay.status).toBe(200);
  expect(replay.body.exchange.id).toBe(command.exchangeId);
  expect(await batches(manager)).toEqual(afterFirst);
  const secondSettlement = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, {
    ...command,
    exchangeId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    replacementSaleId: crypto.randomUUID(),
    replacementSaleOperationId: crypto.randomUUID(),
  });
  expect(secondSettlement.status).toBe(409);
  expect(await batches(manager)).toEqual(afterFirst);
});

test("a cheaper replacement applies only its merchandise value as credit and pays the remaining cash refund", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 20000]);
  const originalBatch = await receive(manager, products.variantIds[0]!, 1, 10000);
  const replacementBatch = await receive(manager, products.variantIds[1]!, 1, 9000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: fayoumId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  const quote = await exchangeQuote(manager, drafted.body.id, drafted.body.revision, [
    { variantId: products.variantIds[1], quantity: 1 },
  ]);
  const command = {
    ...quote.body.settlement,
    receivedAndInspected: true, expectedRevision: drafted.body.revision, cashRefundStatus: "owed",
    quoteId: quote.body.id,
  };

  const exchanged = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, command);
  expect(exchanged.status).toBe(201);
  expect(exchanged.body).toMatchObject({
    exchange: {
      replacementMerchandisePiasters: 20000,
      creditAppliedPiasters: 20000,
      cashCollectedPiasters: 0,
      cashRefund: { acceptedStatus: "owed", status: "owed", owedPiasters: 8000, paidPiasters: 0 },
      allocations: [expect.objectContaining({ batchId: replacementBatch.lines[0].batchId, quantity: 1 })],
    },
    refund: { status: "owed", owedPiasters: 8000, paidPiasters: 0 },
    restorations: [],
  });
  expect((await batches(manager)).find((batch: { id: string }) => batch.id === originalBatch.lines[0].batchId).remainingQuantity).toBe(0);
  const replacementSale = await api(manager, "GET", `/api/internal/sales/${command.replacementSaleId}`);
  expect(replacementSale.body).toMatchObject({
    finalTotalPiasters: 20000,
    exchangeCreditAppliedPiasters: 20000,
    cashReceivedPiasters: 0,
  });

  const paid = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/refund`, {
    operationId: crypto.randomUUID(), status: "paid", amountPiasters: 8000,
  });
  expect(paid.status).toBe(201);
  expect(paid.body.refund).toMatchObject({ status: "paid", owedPiasters: 0, paidPiasters: 8000 });
  expect(paid.body.exchange.cashRefund).toMatchObject({ status: "paid", owedPiasters: 0, paidPiasters: 8000 });
  const settledReplay = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, command);
  expect(settledReplay.status).toBe(200);
  expect(settledReplay.body.exchange).toMatchObject({
    replacementMerchandisePiasters: 20000,
    creditAppliedPiasters: 20000,
    cashCollectedPiasters: 0,
    cashRefund: { acceptedStatus: "owed", status: "paid", owedPiasters: 0, paidPiasters: 8000 },
  });
  const returnCorrection = await api(manager, "GET", `/api/internal/corrections/returns/${drafted.body.id}`);
  expect(returnCorrection.body.actual).toMatchObject({ originalRefundPaidPiasters: 8000, netRefundPaidPiasters: 8000 });

  const appliedBeforeDowngrade = await listAppliedMigrations(built.pool);
  while ((await listAppliedMigrations(built.pool)).at(-1) !== "018_exchanges.sql") {
    expect(await revertLastMigration(built.pool)).toBeTruthy();
  }
  const beforeGuard = await listAppliedMigrations(built.pool);
  await expect(revertLastMigration(built.pool)).rejects.toMatchObject({ code: "55000" });
  expect(await listAppliedMigrations(built.pool)).toEqual(beforeGuard);
  await applyMigrations(built.pool);
  expect(await listAppliedMigrations(built.pool)).toEqual(appliedBeforeDowngrade);
  const retainedAfterGuard = await api(manager, "GET", `/api/internal/returns/${drafted.body.id}`);
  expect(retainedAfterGuard.body.exchange).toEqual(paid.body.exchange);
});

test("repeated replacement lines share one quantity limit and shortage rolls back the inspected return", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [28000]);
  const stock = await receive(manager, product.variantIds[0]!, 3, 10000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: product.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const drafted = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  const quote = await exchangeQuote(manager, drafted.body.id, drafted.body.revision, [
    { variantId: product.variantIds[0], quantity: 1 },
    { variantId: product.variantIds[0], quantity: 2 },
  ]);
  const command = {
    ...quote.body.settlement,
    receivedAndInspected: true, expectedRevision: drafted.body.revision, cashRefundStatus: "owed",
    quoteId: quote.body.id,
  };

  const rejected = await api(manager, "POST", `/api/internal/returns/${drafted.body.id}/exchange`, command);
  expect(rejected.status).toBe(400);
  expect(rejected.body.error.messageAr).toMatch(/الكمية المتاحة غير كافية/);
  const unchanged = await api(manager, "GET", `/api/internal/returns/${drafted.body.id}`);
  expect(unchanged.body).toMatchObject({ status: "draft", exchange: null, restorations: [] });
  expect((await batches(manager)).find((batch: { id: string }) => batch.id === stock.lines[0].batchId).remainingQuantity).toBe(2);
  expect((await api(manager, "GET", `/api/internal/sales/${command.replacementSaleId}`)).status).toBe(404);
});

test("a free reward suggests zero while the manager may authorize exchange credit without repricing its retained sibling", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const rewarded = await seedProduct(manager, [30000, 20000]);
  const replacement = await seedProduct(manager, [40000]);
  await receive(manager, rewarded.variantIds[0]!, 1, 12000);
  await receive(manager, rewarded.variantIds[1]!, 1, 8000);
  await receive(manager, replacement.variantIds[0]!, 1, 15000);
  await api(manager, "POST", "/api/internal/pricing/offers", {
    nameAr: "مكافأة مجانية",
    discountType: "buy_x_get_y",
    percentageBasisPoints: null,
    fixedDiscountPiasters: null,
    bundlePricePiasters: null,
    bundleItems: [],
    buyQuantity: 1,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: 10000,
    buyProductIds: [rewarded.productId],
    buyCategoryIds: [],
    rewardProductIds: [rewarded.productId],
    rewardCategoryIds: [],
    startsOn: "2026-09-01", endsOn: "2026-09-30", active: true, allowCoupon: true,
    productIds: [], categoryIds: [],
  });
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: rewarded.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  });
  const originalSource = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const freeLine = originalSource.lines.find((line: { remainingSuggestedPiasters: number }) => line.remainingSuggestedPiasters === 0);
  const retainedLine = originalSource.lines.find((line: { saleLineId: string }) => line.saleLineId !== freeLine.saleLineId);
  expect(freeLine).toMatchObject({ remainingSuggestedPiasters: 0, availablePaidRanges: [{ quantity: 1, paidUnitPiasters: 0 }] });
  expect(retainedLine.remainingSuggestedPiasters).toBe(30000);
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: freeLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.body).toMatchObject({ suggestedRefundPiasters: 0, authorizedRefundPiasters: 28000 });
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: replacement.variantIds[0], quantity: 1 },
  ]);
  const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement,
    receivedAndInspected: true, expectedRevision: draft.body.revision, cashRefundStatus: "owed",
    quoteId: quote.body.id,
  });
  expect(exchanged.status).toBe(201);
  expect(exchanged.body.exchange).toMatchObject({
    replacementMerchandisePiasters: 40000,
    creditAppliedPiasters: 28000,
    cashCollectedPiasters: 12000,
  });
  const after = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  expect(after.lines.find((line: { saleLineId: string }) => line.saleLineId === retainedLine.saleLineId).remainingSuggestedPiasters).toBe(30000);
});

test("simultaneous identical exchange settlement creates one linked sale and replays the same outcome", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 32000]);
  const originalBatch = await receive(manager, products.variantIds[0]!, 1, 10000);
  const replacementBatch = await receive(manager, products.variantIds[1]!, 1, 15000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: products.variantIds[1], quantity: 1 },
  ]);
  const command = {
    ...quote.body.settlement,
    receivedAndInspected: true, expectedRevision: draft.body.revision, cashRefundStatus: "owed",
    quoteId: quote.body.id,
  };

  const settled = await Promise.all([
    api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, command),
    api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, command),
  ]);
  expect(settled.map((result) => result.status).sort()).toEqual([200, 201]);
  expect(settled[0].body.exchange).toEqual(settled[1].body.exchange);
  const after = await batches(manager);
  expect(after.find((batch: { id: string }) => batch.id === originalBatch.lines[0].batchId).remainingQuantity).toBe(1);
  expect(after.find((batch: { id: string }) => batch.id === replacementBatch.lines[0].batchId).remainingQuantity).toBe(0);
  const replacementSales = (await api(manager, "GET", "/api/internal/sales")).body
    .filter((candidate: { id: string }) => candidate.id === command.replacementSaleId);
  expect(replacementSales).toHaveLength(1);
});

test("an accepted exchange quote is rejected after the Return credit is edited", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 32000]);
  await receive(manager, products.variantIds[0]!, 1, 10000);
  const replacementBatch = await receive(manager, products.variantIds[1]!, 1, 15000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const lines = [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000, lines,
  });
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: products.variantIds[1], quantity: 1 },
  ]);
  const edited = await api(manager, "PATCH", `/api/internal/returns/${draft.body.id}`, {
    expectedRevision: draft.body.revision,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 29000,
    lines,
  });
  expect(edited.status).toBe(200);

  const rejected = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement,
    quoteId: quote.body.id,
    receivedAndInspected: true,
    expectedRevision: quote.body.returnRevision,
    cashRefundStatus: "owed",
  });
  expect(rejected.status).toBe(409);
  expect((await api(manager, "GET", `/api/internal/returns/${draft.body.id}`)).body).toMatchObject({
    status: "draft", revision: edited.body.revision, authorizedRefundPiasters: 29000, exchange: null,
  });
  expect((await batches(manager)).find((batch: { id: string }) => batch.id === replacementBatch.lines[0].batchId).remainingQuantity).toBe(1);
  expect((await api(manager, "GET", `/api/internal/sales/${quote.body.settlement.replacementSaleId}`)).status).toBe(404);
});

test("a posted corrected Return uses its effective credit and records only the cash refund", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 20000]);
  await receive(manager, products.variantIds[0]!, 1, 10000);
  await receive(manager, products.variantIds[1]!, 1, 9000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true, expectedRevision: draft.body.revision,
  });
  const correctionDetail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const returnLine = correctionDetail.body.original.lines[0];
  const corrected = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "تصحيح الرصيد قبل الاستبدال",
    effective: {
      authorizedRefundPiasters: 30000,
      lines: [{ lineId: returnLine.returnLineId, quantity: 1, sellableQuantity: 0 }],
    },
    merchandise: [], cash: null,
  });
  expect(corrected.status).toBe(201);
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: products.variantIds[1], quantity: 1 },
  ]);
  expect(quote.body).toMatchObject({
    correctionRevision: 1, creditAvailablePiasters: 30000,
    replacementMerchandisePiasters: 20000, creditAppliedPiasters: 20000,
    cashCollectedPiasters: 0, cashRefundPiasters: 10000,
  });
  const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement,
    quoteId: quote.body.id,
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
    cashRefundStatus: "paid",
  });
  expect(exchanged.status).toBe(201);
  expect(exchanged.body).toMatchObject({
    authorizedRefundPiasters: 30000,
    exchange: {
      creditAppliedPiasters: 20000, cashCollectedPiasters: 0,
      cashRefund: { status: "paid", owedPiasters: 0, paidPiasters: 10000 },
    },
    refund: { status: "paid", owedPiasters: 0, paidPiasters: 10000 },
  });
  const actual = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  expect(actual.body.actual).toMatchObject({
    originalRefundPaidPiasters: 10000,
    exchangeCreditAppliedPiasters: 20000,
    netRefundPaidPiasters: 10000,
  });
  const creditAsCash = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "cancellation", reason: "محاولة خاطئة لاسترداد الرصيد كنقد",
    effective: null, merchandise: [], cash: { direction: "recovered", amountPiasters: 20000 },
  });
  expect(creditAsCash.status).toBe(400);
  const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 1, type: "cancellation", reason: "إلغاء الإرجاع واسترداد النقد المدفوع فقط",
    effective: null, merchandise: [], cash: { direction: "recovered", amountPiasters: 10000 },
  });
  expect(cancelled.status).toBe(201);
  expect(cancelled.body).toMatchObject({
    status: "cancelled",
    actual: { exchangeCreditAppliedPiasters: 20000, netRefundPaidPiasters: 0 },
  });
  expect((await api(manager, "GET", `/api/internal/returns/${draft.body.id}`)).body).toMatchObject({
    refund: { status: "cancelled", owedPiasters: 0, paidPiasters: 0 },
    exchange: { cashRefund: { status: "cancelled", owedPiasters: 0, paidPiasters: 0 } },
  });
});

test("cancelling an exchanged Return ends what is owed while preserving unrecovered cash", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 20000]);
  await receive(manager, products.variantIds[0]!, 2, 10000);
  await receive(manager, products.variantIds[1]!, 2, 9000);

  for (const recoverCash of [false, true]) {
    const originalSale = await sale(manager, {
      occurredAt: "2026-09-10T12:00:00.000Z",
      lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
    });
    const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
    const draft = await api(manager, "POST", "/api/internal/returns", {
      returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
      handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
      lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
    });
    const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
      { variantId: products.variantIds[1], quantity: 1 },
    ]);
    const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
      ...quote.body.settlement,
      quoteId: quote.body.id,
      receivedAndInspected: true,
      expectedRevision: draft.body.revision,
      cashRefundStatus: "paid",
    });
    expect(exchanged.status).toBe(201);
    expect(exchanged.body.exchange.cashRefund).toMatchObject({
      acceptedStatus: "paid", acceptedAmountPiasters: 8000,
      status: "paid", owedPiasters: 0, paidPiasters: 8000,
    });
    const correctionDetail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
    const cancelled = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
      operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "إلغاء تسجيل الإرجاع بعد الاستبدال",
      effective: null,
      merchandise: [],
      cash: recoverCash ? { direction: "recovered", amountPiasters: 8000 } : null,
    });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.original.lines[0].returnLineId).toBe(correctionDetail.body.original.lines[0].returnLineId);
    const current = await api(manager, "GET", `/api/internal/returns/${draft.body.id}`);
    const expectedPaid = recoverCash ? 0 : 8000;
    expect(current.body).toMatchObject({
      refund: { status: "cancelled", owedPiasters: 0, paidPiasters: expectedPaid },
      exchange: {
        cashRefund: {
          acceptedStatus: "paid", acceptedAmountPiasters: 8000,
          status: "cancelled", owedPiasters: 0, paidPiasters: expectedPaid,
        },
      },
    });
  }
});

test("a correction to exchange credit and recovered cash does not recreate an old refund obligation", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const products = await seedProduct(manager, [28000, 20000]);
  await receive(manager, products.variantIds[0]!, 1, 10000);
  await receive(manager, products.variantIds[1]!, 1, 9000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: products.variantIds[0]!, quantity: 1 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: originalSale.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
  });
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: products.variantIds[1], quantity: 1 },
  ]);
  const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement,
    quoteId: quote.body.id,
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
    cashRefundStatus: "paid",
  });
  expect(exchanged.body.exchange.cashRefund).toMatchObject({
    acceptedAmountPiasters: 8000, status: "paid", paidPiasters: 8000, owedPiasters: 0,
  });
  const correctionDetail = await api(manager, "GET", `/api/internal/corrections/returns/${draft.body.id}`);
  const line = correctionDetail.body.original.lines[0];
  const corrected = await api(manager, "POST", `/api/internal/corrections/returns/${draft.body.id}`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "correction", reason: "خفض الرصيد واسترداد فرق النقد",
    effective: {
      authorizedRefundPiasters: 24000,
      lines: [{ lineId: line.returnLineId, quantity: 1, sellableQuantity: 0 }],
    },
    merchandise: [],
    cash: { direction: "recovered", amountPiasters: 4000 },
  });
  expect(corrected.status).toBe(201);
  const current = await api(manager, "GET", `/api/internal/returns/${draft.body.id}`);
  expect(current.body).toMatchObject({
    authorizedRefundPiasters: 24000,
    refund: { status: "paid", owedPiasters: 0, paidPiasters: 4000 },
    exchange: {
      creditAppliedPiasters: 20000,
      cashRefund: {
        acceptedStatus: "paid", acceptedAmountPiasters: 8000,
        status: "paid", owedPiasters: 0, paidPiasters: 4000,
      },
    },
  });
});

test("manager picks an unattributed-phone sale, drafts cross-branch, restores the original batch once, and pays the edited refund separately", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [30000, 20000]);
  const oldReceipt = await receive(manager, product.variantIds[0]!, 1, 10000);
  await receive(manager, product.variantIds[0]!, 2, 14000);
  await receive(manager, product.variantIds[1]!, 2, 8000);
  const originalSale = await sale(manager, {
    occurredAt: "2026-09-01T12:00:00.000Z",
    employeeDiscountPiasters: 5000,
    lines: product.variantIds.map((variantId) => ({ variantId, quantity: 1 })),
  });
  expect(originalSale.body.customerPhone).toBeNull();
  expect(originalSale.body.lines.map((line: { paidPiasters: number }) => line.paidPiasters).sort((a: number, b: number) => a - b)).toEqual([17500, 27500]);

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.return.denied",
    displayName: "كاشير بلا إرجاع",
    password: "staff-pass-71",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.return.denied", "staff-pass-71");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const denied = await api(cashier, "GET", "/api/internal/returns/sources");
  expect(denied.status).toBe(403);

  const picked = await api(manager, "GET", `/api/internal/returns/sources?reference=${originalSale.body.id}&date=2026-09-01&branchId=${abshwayId}&item=${encodeURIComponent("قميص مرتجع")}&amountPiasters=45000`);
  expect(picked.status).toBe(200);
  expect(picked.body).toHaveLength(1);
  expect(picked.body[0]).toMatchObject({ saleId: originalSale.body.id, customerPhone: null, soldByStaffId: expect.any(String) });
  const returnedLine = picked.body[0].lines.find((line: { variantId: string }) => line.variantId === product.variantIds[0]);
  expect(returnedLine.remainingSuggestedPiasters).toBe(27500);

  const returnId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const draftPayload = {
    returnId,
    operationId,
    sourceSaleId: originalSale.body.id,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 30000,
    lines: [{ sourceSaleLineId: returnedLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  };
  const beforeDraft = await batches(manager);
  const draft = await api(manager, "POST", "/api/internal/returns", draftPayload);
  expect(draft.status).toBe(201);
  expect(draft.body).toMatchObject({
    status: "draft",
    revision: 1,
    suggestedRefundPiasters: 27500,
    authorizedRefundPiasters: 30000,
    handlingBranch: { code: "fayoum" },
    source: { originalBranch: { code: "abshway" }, soldByStaffId: originalSale.body.soldByStaffId },
    refund: { status: "none", owedPiasters: 0, paidPiasters: 0, recordedByStaffId: null, recordedAt: null },
  });
  expect(await batches(manager)).toEqual(beforeDraft);

  const editPayload = {
    expectedRevision: 1,
    handlingBranchId: fayoumId,
    authorizedRefundPiasters: 31000,
    lines: draftPayload.lines,
  };
  const edited = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, editPayload);
  expect(edited.status).toBe(200);
  expect(edited.body).toMatchObject({
    id: returnId,
    operationId,
    status: "draft",
    revision: 2,
    suggestedRefundPiasters: 27500,
    authorizedRefundPiasters: 31000,
    refund: { status: "none", owedPiasters: 0, paidPiasters: 0 },
  });
  expect(await batches(manager)).toEqual(beforeDraft);

  const editReplay = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, editPayload);
  expect(editReplay.status).toBe(200);
  expect(editReplay.body).toMatchObject({ revision: 2, authorizedRefundPiasters: 31000 });

  const createReplay = await api(manager, "POST", "/api/internal/returns", draftPayload);
  expect(createReplay.status).toBe(200);
  expect(createReplay.body).toMatchObject({ revision: 2, authorizedRefundPiasters: 31000 });

  const changedCreateReplay = await api(manager, "POST", "/api/internal/returns", {
    ...draftPayload,
    authorizedRefundPiasters: 29000,
  });
  expect(changedCreateReplay.status).toBe(409);

  const staleEdit = await api(manager, "PATCH", `/api/internal/returns/${returnId}`, {
    expectedRevision: 1,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 20000,
    lines: draftPayload.lines,
  });
  expect(staleEdit.status).toBe(409);

  const stalePost = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 1,
  });
  expect(stalePost.status).toBe(409);

  const posted = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 2,
  });
  expect(posted.status).toBe(201);
  expect(posted.body.status).toBe("posted");
  expect(posted.body.restorations).toEqual([
    expect.objectContaining({ batchId: oldReceipt.lines[0].batchId, quantity: 1, unitCostPiasters: 10000 }),
  ]);
  const afterPost = await batches(manager);
  expect(afterPost.find((batch: { id: string }) => batch.id === oldReceipt.lines[0].batchId).remainingQuantity).toBe(1);
  const stockVersion = await built.pool.query<{ version: string }>("SELECT version FROM inventory_stock_clock WHERE id = true");
  expect(Number(stockVersion.rows[0]?.version)).toBe(5);

  const postReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 2,
  });
  expect(postReplay.status).toBe(200);
  expect(await batches(manager)).toEqual(afterPost);

  const paymentOperation = crypto.randomUUID();
  const paid = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 31000,
  });
  expect(paid.status).toBe(201);
  expect(paid.body.refund).toMatchObject({ status: "paid", owedPiasters: 0, paidPiasters: 31000, recordedByStaffId: expect.any(String) });
  const paymentReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 31000,
  });
  expect(paymentReplay.status).toBe(200);
  expect(paymentReplay.body.refund.events).toHaveLength(1);

  const changedReplay = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: paymentOperation,
    status: "paid",
    amountPiasters: 30000,
  });
  expect(changedReplay.status).toBe(409);

  const secondPaymentIdentity = await api(manager, "POST", `/api/internal/returns/${returnId}/refund`, {
    operationId: crypto.randomUUID(),
    status: "paid",
    amountPiasters: 31000,
  });
  expect(secondPaymentIdentity.status).toBe(409);
  expect(await batches(manager)).toEqual(afterPost);
});

test("the receipt-plus-14 Cairo-day cutoff is inclusive before and at the instant and rejects immediately after", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [85000]);
  await receive(manager, product.variantIds[0]!, 3, 40000);
  const occurrences = [
    "2026-09-01T12:00:00.001Z",
    "2026-09-01T12:00:00.000Z",
    "2026-09-01T11:59:59.999Z",
  ];
  const outcomes: number[] = [];
  for (const occurredAt of occurrences) {
    const original = await sale(manager, { occurredAt, lines: [{ variantId: product.variantIds[0]!, quantity: 1 }] });
    const sourceResult = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`);
    expect(sourceResult.status).toBe(200);
    const source = sourceResult.body[0];
    expect(source.lines[0].remainingSuggestedPiasters).toBe(85000);
    const draft = await api(manager, "POST", "/api/internal/returns", {
      returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
      handlingBranchId: abshwayId, authorizedRefundPiasters: 85000,
      lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
    });
    const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
      receivedAndInspected: true,
      expectedRevision: draft.body.revision,
    });
    outcomes.push(posted.status);
  }
  expect(outcomes).toEqual([201, 201, 400]);
});

test("concurrent partial postings cannot return the same units and unsellable quantities never re-enter stock", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [12000]);
  await receive(manager, product.variantIds[0]!, 2, 5000);
  const original = await sale(manager, { occurredAt: "2026-09-10T12:00:00.000Z", lines: [{ variantId: product.variantIds[0]!, quantity: 2 }] });
  const sourceResult = await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`);
  expect(sourceResult.status).toBe(200);
  const source = sourceResult.body[0];
  const draftBodies = [0, 1].map(() => ({
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: abshwayId, authorizedRefundPiasters: 24000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 2, sellableQuantity: 0 }],
  }));
  const drafts = await Promise.all(draftBodies.map((body) => api(manager, "POST", "/api/internal/returns", body)));
  expect(drafts.map((row) => row.status)).toEqual([201, 201]);
  const raced = await Promise.all(drafts.map((draft) => api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  })));
  expect(raced.map((row) => row.status).sort()).toEqual([201, 400]);
  expect((await batches(manager))[0].remainingQuantity).toBe(0);
  const listed = await api(manager, "GET", "/api/internal/returns");
  expect(listed.body.items.filter((row: { status: string }) => row.status === "posted")).toHaveLength(1);
  expect(listed.body.items[0]).toMatchObject({ source: { kind: "physical_sale", id: original.body.id } });
  expect(listed.body.items[0]).not.toHaveProperty("lines");
});

test("return history uses bounded summaries and a stable cursor", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [12000]);
  await receive(manager, product.variantIds[0]!, 2, 5000);
  const original = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: product.variantIds[0]!, quantity: 2 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  for (let index = 0; index < 2; index += 1) {
    const created = await api(manager, "POST", "/api/internal/returns", {
      returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
      handlingBranchId: abshwayId, authorizedRefundPiasters: 12000,
      lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 0 }],
    });
    expect(created.status).toBe(201);
  }

  const first = await api(manager, "GET", "/api/internal/returns?limit=1");
  expect(first.status).toBe(200);
  expect(first.body.items).toHaveLength(1);
  expect(first.body.nextCursor).toEqual(expect.any(String));
  expect(first.body.items[0]).toMatchObject({ status: "draft", refundStatus: "none" });
  expect(first.body.items[0]).toMatchObject({ source: { kind: "physical_sale", id: original.body.id } });
  expect(first.body.items[0]).not.toHaveProperty("lines");

  const second = await api(manager, "GET", `/api/internal/returns?limit=1&cursor=${first.body.nextCursor}`);
  expect(second.status).toBe(200);
  expect(second.body.items).toHaveLength(1);
  expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  expect(second.body.nextCursor).toBeNull();
});

test("a partial sellable return spanning FIFO costs restores each original batch without averaging", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [30000]);
  const old = await receive(manager, product.variantIds[0]!, 1, 10000);
  const newer = await receive(manager, product.variantIds[0]!, 2, 14000);
  const original = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    lines: [{ variantId: product.variantIds[0]!, quantity: 3 }],
  });
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: fayoumId, authorizedRefundPiasters: 60000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 2, sellableQuantity: 2 }],
  });
  expect(draft.body.suggestedRefundPiasters).toBe(60000);
  const posted = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/post`, {
    receivedAndInspected: true,
    expectedRevision: draft.body.revision,
  });
  expect(posted.status).toBe(201);
  expect(posted.body.restorations).toEqual(expect.arrayContaining([
    expect.objectContaining({ batchId: old.lines[0].batchId, quantity: 1, unitCostPiasters: 10000 }),
    expect.objectContaining({ batchId: newer.lines[0].batchId, quantity: 1, unitCostPiasters: 14000 }),
  ]));
  const restored = await batches(manager);
  expect(restored.find((batch: { id: string }) => batch.id === old.lines[0].batchId).remainingQuantity).toBe(1);
  expect(restored.find((batch: { id: string }) => batch.id === newer.lines[0].batchId).remainingQuantity).toBe(1);
});

test("an exchange and later replacement return retain the corrected cost of their original FIFO batch", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const product = await seedProduct(manager, [32000]);
  const receipt = await receive(manager, product.variantIds[0]!, 1, 10000);
  const original = await sale(manager, {
    occurredAt: "2026-09-10T12:00:00.000Z",
    employeeDiscountPiasters: 4000,
    lines: [{ variantId: product.variantIds[0]!, quantity: 1 }],
  });
  const amended = await api(manager, "POST", `/api/internal/receiving/receipts/${receipt.id}/corrections`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, reason: "تصحيح تكلفة دفعة الاستبدال",
    lines: [{ lineId: receipt.lines[0].id, quantity: 1, unitCostPiasters: 14000 }],
  });
  expect(amended.status).toBe(201);
  const source = (await api(manager, "GET", `/api/internal/returns/sources?reference=${original.body.id}`)).body[0];
  const draft = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: original.body.id,
    handlingBranchId: fayoumId, authorizedRefundPiasters: 28000,
    lines: [{ sourceSaleLineId: source.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(draft.status).toBe(201);
  const quote = await exchangeQuote(manager, draft.body.id, draft.body.revision, [
    { variantId: product.variantIds[0]!, quantity: 1 },
  ]);
  const exchanged = await api(manager, "POST", `/api/internal/returns/${draft.body.id}/exchange`, {
    ...quote.body.settlement, quoteId: quote.body.id,
    receivedAndInspected: true, expectedRevision: draft.body.revision, cashRefundStatus: "owed",
  });
  expect(exchanged.status).toBe(201);
  const retainedBatchCost = {
    batchId: receipt.lines[0].batchId, quantity: 1,
    unitCostPiasters: 10000, effectiveUnitCostPiasters: 14000,
  };
  expect(exchanged.body.restorations).toEqual([expect.objectContaining(retainedBatchCost)]);
  expect(exchanged.body.exchange).toMatchObject({
    replacementMerchandisePiasters: 32000, creditAppliedPiasters: 28000, cashCollectedPiasters: 4000,
    allocations: [expect.objectContaining(retainedBatchCost)],
  });
  const replacementId = quote.body.settlement.replacementSaleId;
  const replacement = await api(manager, "GET", `/api/internal/sales/${replacementId}`);
  expect(replacement.body).toMatchObject({
    finalTotalPiasters: 32000, exchangeCreditAppliedPiasters: 28000, cashReceivedPiasters: 4000,
    allocations: [expect.objectContaining(retainedBatchCost)],
  });
  const replacementSource = (await api(manager, "GET", `/api/internal/returns/sources?reference=${replacementId}`)).body[0];
  const replacementReturn = await api(manager, "POST", "/api/internal/returns", {
    returnId: crypto.randomUUID(), operationId: crypto.randomUUID(), sourceSaleId: replacementId,
    handlingBranchId: fayoumId, authorizedRefundPiasters: 32000,
    lines: [{ sourceSaleLineId: replacementSource.lines[0].saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(replacementReturn.status).toBe(201);
  expect(replacementReturn.body.suggestedRefundPiasters).toBe(32000);
  const restored = await api(manager, "POST", `/api/internal/returns/${replacementReturn.body.id}/post`, {
    receivedAndInspected: true, expectedRevision: replacementReturn.body.revision,
  });
  expect(restored.status).toBe(201);
  expect(restored.body.restorations).toEqual([expect.objectContaining(retainedBatchCost)]);
  expect((await batches(manager)).find((batch: { id: string }) => batch.id === receipt.lines[0].batchId)).toMatchObject({
    remainingQuantity: 1, unitCostPiasters: 10000, effectiveUnitCostPiasters: 14000,
  });
});


async function seedProduct(session: Session, prices: number[]) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const category = await api(session, "POST", "/api/internal/catalog/categories", { nameAr: `مرتجعات ${suffix}` });
  const size = await api(session, "POST", "/api/internal/catalog/sizes", { nameAr: `L مرتجع ${suffix}` });
  const variants: Array<{ sizeId: string; colorId: string; sellingPricePiastersOverride: number | null }> = [];
  for (const [index, price] of prices.entries()) {
    const color = await api(session, "POST", "/api/internal/catalog/colors", { nameAr: `لون مرتجع ${suffix} ${index}` });
    variants.push({ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: price });
  }
  const product = await api(session, "POST", "/api/internal/catalog/products", {
    code: `RET-${crypto.randomUUID().slice(0, 6)}`,
    nameAr: "قميص مرتجع",
    descriptionAr: "اختبار الإرجاع",
    categoryId: category.body.id,
    defaultSellingPricePiasters: prices[0],
    publication: "hidden",
    imageRefs: [],
    variants,
  });
  return {
    productId: product.body.id as string,
    variantIds: product.body.variants.map((variant: { id: string }) => variant.id) as string[],
  };
}

async function receive(session: Session, variantId: string, quantity: number, unitCostPiasters: number) {
  const result = await api(session, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(), receiptDate: "2026-08-01", lines: [{ variantId, quantity, unitCostPiasters }],
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function sale(session: Session, input: { occurredAt: string; employeeDiscountPiasters?: number; lines: Array<{ variantId: string; quantity: number }> }) {
  const result = await api(session, "POST", "/api/internal/sales", {
    saleId: crypto.randomUUID(), operationId: crypto.randomUUID(), physicallyCompleted: true,
    occurredAt: input.occurredAt, employeeDiscountPiasters: input.employeeDiscountPiasters ?? 0, lines: input.lines,
  });
  expect(result.status).toBe(201);
  return result;
}

async function batches(session: Session) {
  return (await api(session, "GET", "/api/internal/inventory/batches")).body;
}

async function exchangeQuote(
  session: Session,
  returnId: string,
  expectedRevision: number,
  replacementLines: Array<{ variantId: string; quantity: number }>,
) {
  const request = {
    quoteId: crypto.randomUUID(),
    exchangeId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    replacementSaleId: crypto.randomUUID(),
    replacementSaleOperationId: crypto.randomUUID(),
    expectedRevision,
    replacementLines,
  };
  const result = await api(session, "POST", `/api/internal/returns/${returnId}/exchange-quote`, request);
  expect(result.status).toBe(201);
  return { ...result, request };
}

type Session = { cookie: string };
async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST", url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" }, payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const values = Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [response.headers["set-cookie"]].filter(Boolean) as string[];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method, url,
    headers: { origin: INTERNAL_ORIGIN, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}
