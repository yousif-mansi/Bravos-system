import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
const NOW = "2026-09-15T12:00:00.000Z";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  cluster = await startPostgresCluster({ port: 55449 });
  const databaseName = `bravos_bundles_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-bundles-outbox-")),
    businessClock: () => new Date(NOW),
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
  vi.useRealTimers();
});

test("manager configures fixed bundles and discounted cheapest rewards while employees cannot", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const catalog = await seedCatalog(manager, "CONFIG");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.bundle",
    displayName: "كاشير الحزم",
    password: "staff-pass-90",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.bundle", "staff-pass-90");

  const bundle = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "حزمة القطعتين",
    discountType: "fixed_bundle",
    bundlePricePiasters: 15_000,
    bundleItems: [
      { variantId: catalog.cheapVariantId, requiredQuantity: 2 },
      { variantId: catalog.expensiveVariantId, requiredQuantity: 1 },
    ],
  }));
  expect(bundle.status, JSON.stringify(bundle.body)).toBe(201);
  expect(bundle.body).toMatchObject({
    discountType: "fixed_bundle",
    bundlePricePiasters: 15_000,
  });
  expect(bundle.body.bundleItems).toEqual([
    { variantId: catalog.cheapVariantId, requiredQuantity: 2 },
    { variantId: catalog.expensiveVariantId, requiredQuantity: 1 },
  ].sort((left, right) => left.variantId.localeCompare(right.variantId)));

  const reward = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "اشتر قطعتين وخذ الثالثة بنصف السعر",
    discountType: "buy_x_get_y",
    buyQuantity: 2,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: 5000,
    buyCategoryIds: [catalog.categoryId],
    rewardProductIds: [catalog.productId],
  }));
  expect(reward.status, JSON.stringify(reward.body)).toBe(201);
  expect(reward.body).toMatchObject({
    discountType: "buy_x_get_y",
    buyQuantity: 2,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: 5000,
    buyCategoryIds: [catalog.categoryId],
    rewardProductIds: [catalog.productId],
  });

  const denied = await api(cashier, "POST", "/api/internal/pricing/offers", offerBody({
    discountType: "fixed_bundle",
    bundlePricePiasters: 100,
    bundleItems: [{ variantId: catalog.cheapVariantId, requiredQuantity: 1 }],
  }));
  expect(denied.status).toBe(403);

  const duplicate = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    discountType: "fixed_bundle",
    bundlePricePiasters: 100,
    bundleItems: [
      { variantId: catalog.cheapVariantId, requiredQuantity: 1 },
      { variantId: catalog.cheapVariantId, requiredQuantity: 2 },
    ],
  }));
  expect(duplicate.status).toBe(400);
  expect(duplicate.body.error.code).toBe("VALIDATION");
});

test("fixed bundles require complete contents, repeat over merged rows, allocate exactly, and retain accepted values", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const catalog = await seedCatalog(manager, "FIXED");
  await receive(manager, catalog.cheapVariantId, 4);
  await receive(manager, catalog.expensiveVariantId, 2);
  const bundleBody = offerBody({
    nameAr: "حزمة بتوزيع دقيق",
    discountType: "fixed_bundle",
    bundlePricePiasters: 29_399,
    bundleItems: [
      { variantId: catalog.cheapVariantId, requiredQuantity: 2 },
      { variantId: catalog.expensiveVariantId, requiredQuantity: 1 },
    ],
  });
  const bundle = await api(manager, "POST", "/api/internal/pricing/offers", bundleBody);
  expect(bundle.status).toBe(201);

  const incomplete = await prepare(manager, [
    { variantId: catalog.cheapVariantId, quantity: 1 },
    { variantId: catalog.expensiveVariantId, quantity: 1 },
  ]);
  expect(incomplete.status).toBe(201);
  expect(incomplete.body.automaticOfferDiscountPiasters).toBe(0);
  expect(incomplete.body.appliedAutomaticOffer).toBeNull();

  const strongerSimple = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "خصم أقل من الحزمة",
    fixedDiscountPiasters: 1000,
    productIds: [catalog.productId],
  }));
  expect(strongerSimple.status).toBe(201);

  const saleId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const multiple = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId,
    operationId,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: catalog.cheapVariantId, quantity: 1 },
      { variantId: catalog.expensiveVariantId, quantity: 2 },
      { variantId: catalog.cheapVariantId, quantity: 3 },
    ],
  });
  expect(multiple.status, JSON.stringify(multiple.body)).toBe(201);
  expect(multiple.body).toMatchObject({
    originalTotalPiasters: 60_000,
    automaticOfferDiscountPiasters: 1202,
    finalTotalPiasters: 58_798,
    appliedAutomaticOffer: {
      id: bundle.body.id,
      discountType: "fixed_bundle",
      bundlePricePiasters: 29_399,
      discountPiasters: 1202,
    },
  });
  const retainedRanges = multiple.body.lines.flatMap((line: { variantId: string; units: unknown[] }) =>
    line.units.map((unit) => ({ variantId: line.variantId, ...unit as object })));
  expect(retainedRanges.reduce((sum: number, range: { quantity: number; automaticOfferDiscountPiasters: number }) =>
    sum + range.quantity * range.automaticOfferDiscountPiasters, 0)).toBe(1202);
  expect(retainedRanges.some((range: { quantity: number; automaticOfferDiscountPiasters: number }) =>
    range.automaticOfferDiscountPiasters === 201 && range.quantity === 2)).toBe(true);

  const edited = await api(manager, "PUT", `/api/internal/pricing/offers/${bundle.body.id}`, {
    ...bundleBody,
    nameAr: "حزمة عُدلت بعد القبول",
    bundlePricePiasters: 29_999,
    active: false,
  });
  expect(edited.status).toBe(200);
  const completed = await api(manager, "POST", "/api/internal/sales", {
    saleId,
    operationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: [
      { variantId: catalog.cheapVariantId, quantity: 1 },
      { variantId: catalog.expensiveVariantId, quantity: 2 },
      { variantId: catalog.cheapVariantId, quantity: 3 },
    ],
  });
  expect(completed.status).toBe(201);
  expect(completed.body.automaticOfferDiscountPiasters).toBe(1202);
  expect(completed.body.appliedAutomaticOffer.nameAr).toBe("حزمة بتوزيع دقيق");
  expect(completed.body.lines.flatMap((line: { units: unknown[] }) => line.units)).toEqual(
    multiple.body.lines.flatMap((line: { units: unknown[] }) => line.units),
  );
});

test("Buy-X-Get-Y chooses the cheapest feasible disjoint rewards and repeated rows retain identical ranges", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تصنيف التداخل" });
  const purchaseOnly = await createSingleProduct(manager, "BUY-ONLY", category.body.id, 2000);
  const overlap = await createSingleProduct(manager, "OVERLAP", category.body.id, 1000);
  const rewardOnly = await createSingleProduct(manager, "REWARD-ONLY", category.body.id, 3000);
  const rewardTwin = await createSingleProduct(manager, "REWARD-TWIN", category.body.id, 3000);
  const purchaseOnlyReceipt = await receive(manager, purchaseOnly.variantId, 3);
  const overlapReceipt = await receive(manager, overlap.variantId, 3);
  const rewardOnlyReceipt = await receive(manager, rewardOnly.variantId, 3);
  const rewardTwinReceipt = await receive(manager, rewardTwin.variantId, 1);
  const batchByVariant = new Map([
    [purchaseOnly.variantId, purchaseOnlyReceipt.lines[0].batchId],
    [overlap.variantId, overlapReceipt.lines[0].batchId],
    [rewardOnly.variantId, rewardOnlyReceipt.lines[0].batchId],
    [rewardTwin.variantId, rewardTwinReceipt.lines[0].batchId],
  ]);

  const rewardBody = offerBody({
    nameAr: "مكافأة متداخلة ممكنة",
    discountType: "buy_x_get_y",
    buyQuantity: 2,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: 5000,
    buyProductIds: [purchaseOnly.productId, overlap.productId],
    rewardProductIds: [overlap.productId, rewardOnly.productId],
  });
  const offer = await api(manager, "POST", "/api/internal/pricing/offers", rewardBody);
  expect(offer.status, JSON.stringify(offer.body)).toBe(201);

  const discountedSaleId = crypto.randomUUID();
  const discountedOperationId = crypto.randomUUID();
  const discountedLines = [
    { variantId: purchaseOnly.variantId, quantity: 2 },
    { variantId: overlap.variantId, quantity: 2 },
    { variantId: rewardOnly.variantId, quantity: 2 },
  ];
  const merged = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: discountedSaleId,
    operationId: discountedOperationId,
    employeeDiscountPiasters: 0,
    lines: discountedLines,
  });
  const repeated = await prepare(manager, [
    { variantId: rewardOnly.variantId, quantity: 1 },
    { variantId: purchaseOnly.variantId, quantity: 1 },
    { variantId: overlap.variantId, quantity: 1 },
    { variantId: rewardOnly.variantId, quantity: 1 },
    { variantId: overlap.variantId, quantity: 1 },
    { variantId: purchaseOnly.variantId, quantity: 1 },
  ]);
  expect(merged.status).toBe(201);
  expect(repeated.status).toBe(201);
  expect(merged.body).toMatchObject({
    automaticOfferDiscountPiasters: 3000,
    appliedAutomaticOffer: {
      id: offer.body.id,
      discountType: "buy_x_get_y",
      buyQuantity: 2,
      rewardQuantity: 1,
      rewardPercentageBasisPoints: 5000,
    },
  });
  const rewardLine = merged.body.lines.find((line: { variantId: string }) => line.variantId === rewardOnly.variantId);
  const overlapLine = merged.body.lines.find((line: { variantId: string }) => line.variantId === overlap.variantId);
  expect(rewardLine).toMatchObject({ automaticOfferDiscountPiasters: 3000, paidPiasters: 3000 });
  expect(overlapLine).toMatchObject({ paidPiasters: 2000 });
  expect(overlapLine.units.every((unit: object) => !("automaticOfferDiscountPiasters" in unit))).toBe(true);
  expect(pricingRanges(repeated.body)).toEqual(pricingRanges(merged.body));

  const disabled = await api(manager, "PUT", `/api/internal/pricing/offers/${offer.body.id}`, {
    ...rewardBody,
    nameAr: "مكافأة مخفضة عُدلت بعد القبول",
    buyQuantity: 3,
    rewardPercentageBasisPoints: 1000,
    active: false,
  });
  expect(disabled.status).toBe(200);
  expect(disabled.body).toMatchObject({
    nameAr: "مكافأة مخفضة عُدلت بعد القبول",
    buyQuantity: 3,
    rewardPercentageBasisPoints: 1000,
    active: false,
  });
  const completedDiscounted = await api(manager, "POST", "/api/internal/sales", {
    saleId: discountedSaleId,
    operationId: discountedOperationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: discountedLines,
  });
  expect(completedDiscounted.status).toBe(201);
  expect(completedDiscounted.body.appliedAutomaticOffer).toMatchObject({
    id: offer.body.id,
    nameAr: "مكافأة متداخلة ممكنة",
    buyQuantity: 2,
    rewardPercentageBasisPoints: 5000,
  });
  expect(completedDiscounted.body.lines.find((line: { variantId: string }) =>
    line.variantId === rewardOnly.variantId)).toMatchObject({
    automaticOfferDiscountPiasters: 3000,
    paidPiasters: 3000,
  });
  const free = await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "مكافأة مجانية عند تعادل السعر",
    discountType: "buy_x_get_y",
    buyQuantity: 2,
    rewardQuantity: 1,
    rewardPercentageBasisPoints: null,
    buyProductIds: [purchaseOnly.productId, overlap.productId],
    rewardProductIds: [overlap.productId, rewardOnly.productId, rewardTwin.productId],
  }));
  expect(free.status).toBe(201);
  expect(free.body.rewardPercentageBasisPoints).toBe(10_000);
  const tiedSaleId = crypto.randomUUID();
  const tiedOperationId = crypto.randomUUID();
  const tiedLines = [
    { variantId: purchaseOnly.variantId, quantity: 1 },
    { variantId: overlap.variantId, quantity: 1 },
    { variantId: rewardOnly.variantId, quantity: 1 },
    { variantId: rewardTwin.variantId, quantity: 1 },
  ];
  const tied = await api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: tiedSaleId,
    operationId: tiedOperationId,
    employeeDiscountPiasters: 0,
    lines: tiedLines,
  });
  expect(tied.status).toBe(201);
  const expectedFreeVariant = [rewardOnly.variantId, rewardTwin.variantId].sort()[0];
  const freeLine = tied.body.lines.find((line: { variantId: string }) => line.variantId === expectedFreeVariant);
  const otherRewardLine = tied.body.lines.find((line: { variantId: string }) =>
    line.variantId === [rewardOnly.variantId, rewardTwin.variantId].sort()[1]);
  expect(tied.body.automaticOfferDiscountPiasters).toBe(3000);
  expect(freeLine).toMatchObject({ automaticOfferDiscountPiasters: 3000, paidPiasters: 0 });
  expect(otherRewardLine).toMatchObject({ paidPiasters: 3000 });

  const editedFree = await api(manager, "PUT", `/api/internal/pricing/offers/${free.body.id}`, {
    ...offerBody({
      nameAr: "مكافأة عُدلت بعد القبول",
      discountType: "buy_x_get_y",
      buyQuantity: 3,
      rewardQuantity: 1,
      rewardPercentageBasisPoints: 1000,
      buyProductIds: [purchaseOnly.productId],
      rewardProductIds: [rewardOnly.productId],
    }),
    active: false,
  });
  expect(editedFree.status).toBe(200);
  expect(editedFree.body).toMatchObject({
    nameAr: "مكافأة عُدلت بعد القبول",
    rewardPercentageBasisPoints: 1000,
    active: false,
  });

  const completedTied = await api(manager, "POST", "/api/internal/sales", {
    saleId: tiedSaleId,
    operationId: tiedOperationId,
    physicallyCompleted: true,
    employeeDiscountPiasters: 0,
    lines: tiedLines,
  });
  expect(completedTied.status).toBe(201);
  expect(completedTied.body.appliedAutomaticOffer).toMatchObject({
    id: free.body.id,
    nameAr: "مكافأة مجانية عند تعادل السعر",
    rewardPercentageBasisPoints: 10_000,
  });
  const retainedFreeLine = completedTied.body.lines.find((line: { variantId: string }) =>
    line.variantId === expectedFreeVariant);
  expect(retainedFreeLine).toMatchObject({ automaticOfferDiscountPiasters: 3000, paidPiasters: 0 });

  const rereadTied = await api(manager, "GET", `/api/internal/sales/${tiedSaleId}`);
  expect(rereadTied.status).toBe(200);
  expect(rereadTied.body.appliedAutomaticOffer).toEqual(completedTied.body.appliedAutomaticOffer);
  expect(pricingRanges(rereadTied.body)).toEqual(pricingRanges(completedTied.body));

  const discountedSourceResult = await api(
    manager,
    "GET",
    `/api/internal/returns/sources?reference=${discountedSaleId}`,
  );
  expect(discountedSourceResult.status).toBe(200);
  expect(discountedSourceResult.body).toHaveLength(1);
  const discountedSource = discountedSourceResult.body[0];
  const discountedRewardLine = discountedSource.lines.find((line: { variantId: string }) =>
    line.variantId === rewardOnly.variantId);
  expect(discountedRewardLine).toMatchObject({
    remainingQuantity: 2,
    remainingSuggestedPiasters: 3000,
    availablePaidRanges: [{ quantity: 2, paidUnitPiasters: 1500 }],
  });
  const discountedReturnId = crypto.randomUUID();
  const discountedDraft = await api(manager, "POST", "/api/internal/returns", {
    returnId: discountedReturnId,
    operationId: crypto.randomUUID(),
    sourceSaleId: discountedSaleId,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 1500,
    lines: [{ sourceSaleLineId: discountedRewardLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(discountedDraft.status).toBe(201);
  expect(discountedDraft.body).toMatchObject({
    suggestedRefundPiasters: 1500,
    authorizedRefundPiasters: 1500,
    lines: [{ suggestedRefundPiasters: 1500, quantity: 1, sellableQuantity: 1 }],
  });
  const discountedPosted = await api(manager, "POST", `/api/internal/returns/${discountedReturnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 1,
  });
  expect(discountedPosted.status).toBe(201);
  expect(discountedPosted.body.restorations).toEqual([
    expect.objectContaining({ batchId: batchByVariant.get(rewardOnly.variantId), quantity: 1 }),
  ]);

  const freeSourceResult = await api(manager, "GET", `/api/internal/returns/sources?reference=${tiedSaleId}`);
  expect(freeSourceResult.status).toBe(200);
  expect(freeSourceResult.body).toHaveLength(1);
  const freeSource = freeSourceResult.body[0];
  const freeSourceLine = freeSource.lines.find((line: { variantId: string }) =>
    line.variantId === expectedFreeVariant);
  const retainedSiblingVariant = [rewardOnly.variantId, rewardTwin.variantId]
    .find((variantId) => variantId !== expectedFreeVariant)!;
  const retainedSiblingBefore = freeSource.lines.find((line: { variantId: string }) =>
    line.variantId === retainedSiblingVariant);
  expect(freeSourceLine).toMatchObject({
    remainingQuantity: 1,
    remainingSuggestedPiasters: 0,
    availablePaidRanges: [{ quantity: 1, paidUnitPiasters: 0 }],
  });
  expect(retainedSiblingBefore.remainingSuggestedPiasters).toBe(3000);

  const freeReturnId = crypto.randomUUID();
  const freeDraft = await api(manager, "POST", "/api/internal/returns", {
    returnId: freeReturnId,
    operationId: crypto.randomUUID(),
    sourceSaleId: tiedSaleId,
    handlingBranchId: abshwayId,
    authorizedRefundPiasters: 0,
    lines: [{ sourceSaleLineId: freeSourceLine.saleLineId, quantity: 1, sellableQuantity: 1 }],
  });
  expect(freeDraft.status).toBe(201);
  expect(freeDraft.body).toMatchObject({
    suggestedRefundPiasters: 0,
    authorizedRefundPiasters: 0,
    lines: [{ suggestedRefundPiasters: 0, quantity: 1, sellableQuantity: 1 }],
  });
  const freePosted = await api(manager, "POST", `/api/internal/returns/${freeReturnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 1,
  });
  expect(freePosted.status).toBe(201);
  expect(freePosted.body.restorations).toEqual([
    expect.objectContaining({ batchId: batchByVariant.get(expectedFreeVariant), quantity: 1 }),
  ]);
  const batchesAfterFreePost = await batches(manager);
  const freePostReplay = await api(manager, "POST", `/api/internal/returns/${freeReturnId}/post`, {
    receivedAndInspected: true,
    expectedRevision: 1,
  });
  expect(freePostReplay.status).toBe(200);
  expect(await batches(manager)).toEqual(batchesAfterFreePost);

  const freeSourceAfter = (await api(
    manager,
    "GET",
    `/api/internal/returns/sources?reference=${tiedSaleId}`,
  )).body[0];
  expect(freeSourceAfter.lines.find((line: { variantId: string }) =>
    line.variantId === expectedFreeVariant)).toMatchObject({
    returnedQuantity: 1,
    remainingQuantity: 0,
    remainingSuggestedPiasters: 0,
  });
  expect(freeSourceAfter.lines.find((line: { variantId: string }) =>
    line.variantId === retainedSiblingVariant).remainingSuggestedPiasters).toBe(3000);
});

test("a million-unit active bundle stays range-bounded before stock rejection", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const catalog = await seedCatalog(manager, "LARGE");
  await api(manager, "POST", "/api/internal/pricing/offers", offerBody({
    nameAr: "حزمة العدد الكبير",
    discountType: "fixed_bundle",
    bundlePricePiasters: 0,
    bundleItems: [{ variantId: catalog.cheapVariantId, requiredQuantity: 1 }],
  }));
  const rejected = await prepare(manager, [{ variantId: catalog.cheapVariantId, quantity: 1_000_000 }]);
  expect(rejected.status).toBe(400);
  expect(rejected.body.error).toEqual({ code: "VALIDATION", messageAr: "الكمية المتاحة غير كافية." });
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

async function api(session: Session | undefined, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
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

function offerBody(overrides: Partial<Record<string, unknown>> = {}) {
  const body = {
    nameAr: "عرض تلقائي",
    discountType: "fixed",
    percentageBasisPoints: null,
    fixedDiscountPiasters: 100,
    bundlePricePiasters: null,
    bundleItems: [],
    buyQuantity: null,
    rewardQuantity: null,
    rewardPercentageBasisPoints: null,
    buyProductIds: [],
    buyCategoryIds: [],
    rewardProductIds: [],
    rewardCategoryIds: [],
    startsOn: dateOffset(0),
    endsOn: dateOffset(0),
    active: true,
    allowCoupon: true,
    productIds: [],
    categoryIds: [],
    ...overrides,
  };
  if (body.discountType !== "fixed") body.fixedDiscountPiasters = null;
  if (body.discountType !== "percentage") body.percentageBasisPoints = null;
  return body;
}

function dateOffset(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

async function seedCatalog(manager: Session, prefix: string) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${prefix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const cheapColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `فاتح ${prefix}` });
  const expensiveColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `داكن ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `BUNDLE-${prefix}`,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار الحزم",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20_000,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [
      { sizeId: size.body.id, colorId: cheapColor.body.id, sellingPricePiastersOverride: 5000 },
      { sizeId: size.body.id, colorId: expensiveColor.body.id, sellingPricePiastersOverride: 20_000 },
    ],
  });
  expect(product.status).toBe(201);
  const cheap = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 5000);
  const expensive = product.body.variants.find((variant: { sellingPricePiasters: number }) => variant.sellingPricePiasters === 20_000);
  return {
    categoryId: category.body.id,
    productId: product.body.id,
    cheapVariantId: cheap.id,
    expensiveVariantId: expensive.id,
  };
}

async function createSingleProduct(manager: Session, prefix: string, categoryId: string, price: number) {
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${prefix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${prefix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: prefix,
    nameAr: `منتج ${prefix}`,
    descriptionAr: "منتج لاختبار مكافآت الشراء",
    categoryId,
    defaultSellingPricePiasters: price,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  expect(product.status).toBe(201);
  return { productId: product.body.id, variantId: product.body.variants[0].id };
}

async function receive(manager: Session, variantId: string, quantity: number) {
  const result = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: dateOffset(0),
    lines: [{ variantId, quantity, unitCostPiasters: 100 }],
  });
  expect(result.status).toBe(201);
  return result.body;
}

async function batches(manager: Session) {
  return (await api(manager, "GET", "/api/internal/inventory/batches")).body;
}

async function prepare(manager: Session, lines: Array<{ variantId: string; quantity: number }>) {
  return api(manager, "POST", "/api/internal/sales/prepare", {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    employeeDiscountPiasters: 0,
    lines,
  });
}

function pricingRanges(sale: { lines: Array<{ variantId: string; units: unknown[] }> }) {
  return sale.lines.flatMap((line) => line.units.map((unit) => ({ variantId: line.variantId, ...unit as object })));
}
