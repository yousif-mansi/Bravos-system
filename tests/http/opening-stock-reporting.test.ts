import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "@ayocore/exceljs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { renderManagementReportPdf } from "@bravos/report-export/node";

const ORIGIN = "http://127.0.0.1:5173";
const ACCEPTANCE = new Date("2026-10-10T12:00:00.000Z");
const ACCEPTANCE_DATE = cairoDate(ACCEPTANCE);
const OPENING_CORRECTION_REASON = "تصحيح كمية المخزون الافتتاحي";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55493 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  const database = `bravos_opening_report_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(database);
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(database),
    authSecret: "opening-report-secret-opening-report",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-opening-report-outbox-")),
    businessClock: () => ACCEPTANCE,
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  fayoumId = branches.rows.find((row) => row.code === "fayoum")?.id ?? "";
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
});

test("accepted CSV opening stock is reported apart from purchases without changing audit dates, FIFO or stock", async () => {
  expect(ACCEPTANCE_DATE).toBe("2026-10-10");
  expect(abshwayId).not.toBe("");
  expect(fayoumId).not.toBe("");
  const manager = await signIn("owner", "owner-pass-1");
  const openingOperationId = crypto.randomUUID();
  const openingPreview = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId: openingOperationId,
    files: {
      catalog: catalogCsv(),
      stock: [
        "batch_key,branch_code,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
        "old-stock,abshway,os-shirt,2,200.00,2026-08-01,1",
        "new-stock,fayoum,os-shirt,3,240.00,2026-09-01,2",
      ].join("\n"),
      configuration: configurationCsv([
        { record_type: "inventory_default_threshold", key: "default", value: "3" },
      ]),
    },
  });
  expect(openingPreview.status, JSON.stringify(openingPreview.body)).toBe(201);
  expect(openingPreview.body).toMatchObject({
    status: "ready",
    operationId: openingOperationId,
    counts: { batches: 2, openingQuantity: 5 },
  });
  const accepted = await api(manager, "POST", `/api/internal/opening-import/previews/${openingPreview.body.id}/accept`, {
    operationId: openingOperationId,
    previewFingerprint: openingPreview.body.previewFingerprint,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  expect(accepted.body).toMatchObject({
    status: "accepted",
    operationId: openingOperationId,
    acceptedAt: expect.any(String),
    createdAt: openingPreview.body.createdAt,
  });

  const products = await api(manager, "GET", "/api/internal/catalog/products");
  expect(products.status).toBe(200);
  const variantId = products.body[0].variants[0].id as string;
  const configOperationId = crypto.randomUUID();
  const configPreview = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId: configOperationId,
    files: {
      catalog: catalogCsv().split("\n")[0] ?? "",
      stock: "batch_key,branch_code,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
      configuration: configurationCsv([
        { record_type: "expense_category", key: "stationery", name_ar: "أدوات الافتتاح", active: "true" },
      ]),
    },
  });
  expect(configPreview.status, JSON.stringify(configPreview.body)).toBe(201);
  expect(configPreview.body).toMatchObject({ status: "ready", counts: { batches: 0, openingQuantity: 0 } });
  const configAccepted = await api(manager, "POST", `/api/internal/opening-import/previews/${configPreview.body.id}/accept`, {
    operationId: configOperationId,
    previewFingerprint: configPreview.body.previewFingerprint,
  });
  expect(configAccepted.status, JSON.stringify(configAccepted.body)).toBe(201);
  expect(configAccepted.body.status).toBe("accepted");

  const unacceptedOperationId = crypto.randomUUID();
  const unaccepted = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId: unacceptedOperationId,
    files: {
      catalog: catalogCsv().split("\n")[0] ?? "",
      stock: [
        "batch_key,branch_code,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
        `planned-only,abshway,id:${variantId},9,111.00,2026-07-01,1`,
      ].join("\n"),
      configuration: configurationCsv([
        { record_type: "inventory_default_threshold", key: "default", value: "3" },
      ]),
    },
  });
  expect(unaccepted.status, JSON.stringify(unaccepted.body)).toBe(201);
  expect(unaccepted.body).toMatchObject({ status: "ready", counts: { batches: 1, openingQuantity: 9 } });

  const configReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: configOperationId,
    branchId: abshwayId,
    receiptDate: ACCEPTANCE_DATE,
    lines: [{ variantId, quantity: 4, unitCostPiasters: 10_000 }],
  });
  expect(configReceipt.status, JSON.stringify(configReceipt.body)).toBe(201);
  const unacceptedReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: unacceptedOperationId,
    branchId: fayoumId,
    receiptDate: ACCEPTANCE_DATE,
    lines: [{ variantId, quantity: 1, unitCostPiasters: 5_000 }],
  });
  expect(unacceptedReceipt.status, JSON.stringify(unacceptedReceipt.body)).toBe(201);
  const outsideReceipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-15",
    lines: [{ variantId, quantity: 2, unitCostPiasters: 8_000 }],
  });
  expect(outsideReceipt.status, JSON.stringify(outsideReceipt.body)).toBe(201);

  const receiptsBeforeCorrection = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receiptsBeforeCorrection.status).toBe(200);
  const openingReceipts = (receiptsBeforeCorrection.body as ReceiptBody[]).filter((receipt) => receipt.operationId === openingOperationId);
  expect(openingReceipts.map((receipt) => receipt.branchId).sort()).toEqual([abshwayId, fayoumId].sort());
  expect(new Set(openingReceipts.map((receipt) => receipt.operationId)).size).toBe(1);
  expect(openingReceipts.map((receipt) => receipt.receiptDate)).toEqual([ACCEPTANCE_DATE, ACCEPTANCE_DATE]);
  const abshwayOpening = openingReceipts.find((receipt) => receipt.branchId === abshwayId);
  if (!abshwayOpening) throw new Error("Expected the Abshway opening receipt.");
  const corrected = await api(manager, "POST", `/api/internal/receiving/receipts/${abshwayOpening.id}/corrections`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 0,
    reason: OPENING_CORRECTION_REASON,
    lines: [{ lineId: abshwayOpening.lines[0]?.id, quantity: 1, unitCostPiasters: 20_000 }],
  });
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(201);

  const replay = await api(manager, "POST", `/api/internal/opening-import/previews/${openingPreview.body.id}/accept`, {
    operationId: openingOperationId,
    previewFingerprint: openingPreview.body.previewFingerprint,
  });
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  expect(replay.body).toEqual(accepted.body);

  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(200);
  expect(batches.body).toEqual(expect.arrayContaining([
    expect.objectContaining({
      receiptDate: "2026-08-01",
      receivedQuantity: 2,
      effectiveReceivedQuantity: 1,
      remainingQuantity: 1,
      unitCostPiasters: 20_000,
      effectiveUnitCostPiasters: 20_000,
    }),
    expect.objectContaining({
      receiptDate: "2026-09-01",
      receivedQuantity: 3,
      effectiveReceivedQuantity: 3,
      remainingQuantity: 3,
      unitCostPiasters: 24_000,
      effectiveUnitCostPiasters: 24_000,
    }),
  ]));
  expect(batches.body).toHaveLength(5);
  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.body).toHaveLength(5);
  const persistedPreview = await api(manager, "GET", `/api/internal/opening-import/previews/${openingPreview.body.id}`);
  expect(persistedPreview.body).toMatchObject({
    status: "accepted",
    createdAt: accepted.body.createdAt,
    acceptedAt: accepted.body.acceptedAt,
  });
  const stillUnaccepted = await api(manager, "GET", `/api/internal/opening-import/previews/${unaccepted.body.id}`);
  expect(stillUnaccepted.body.status).toBe("ready");
  const beforeReads = await durableSnapshot();

  const employee = await createEmployee(manager);
  const cashier = await signIn("report.cashier", "staff-pass-23");
  const forbidden = await api(cashier, "GET", `/api/internal/reports/management?period=day&date=${ACCEPTANCE_DATE}`);
  expect(forbidden.status).toBe(403);
  expect(forbidden.body.error.code).toBe("FORBIDDEN");
  expect((await raw(cashier, `/api/internal/reports/management/export?format=pdf&period=day&date=${ACCEPTANCE_DATE}`)).statusCode).toBe(403);
  expect((await raw(cashier, `/api/internal/reports/management/export?format=xlsx&period=day&date=${ACCEPTANCE_DATE}`)).statusCode).toBe(403);
  expect((await raw(undefined, `/api/internal/reports/management/export?format=xlsx&period=day&date=${ACCEPTANCE_DATE}`)).statusCode).toBe(401);

  const pageOne = await api(manager, "GET", `/api/internal/reports/management?period=day&date=${ACCEPTANCE_DATE}&detailPage=1&detailPageSize=1`);
  expect(pageOne.status, JSON.stringify(pageOne.body)).toBe(200);
  expect(pageOne.body.summary).toMatchObject({
    completedCount: 0,
    grossFinalSalesPiasters: 0,
    grossMerchandiseSalesPiasters: 0,
    merchandiseRefundPiasters: 0,
    netMerchandiseSalesPiasters: 0,
    knownNetMerchandiseCostPiasters: 0,
    merchandiseGrossProfitPiasters: 0,
    effectiveExpensesPiasters: 0,
    operatingProfitPiasters: 0,
    purchaseCostPiasters: 45_000,
    openingStockCostPiasters: 92_000,
    costsIncomplete: false,
  });
  expect(pageOne.body.purchases.totalPiasters).toBe(45_000);
  expect(pageOne.body.openingStock.totalPiasters).toBe(92_000);
  expect(pageOne.body.pageInfo).toMatchObject({
    page: 1,
    pageSize: 1,
    totalCompletedSales: 0,
    totalRefunds: 0,
    totalPurchases: 2,
    totalOpeningReceipts: 2,
    totalExpenses: 0,
    hasMore: true,
  });
  expect(pageOne.body.purchases.receipts).toHaveLength(1);
  expect(pageOne.body.openingStock.receipts).toHaveLength(1);
  expect(pageOne.body.inventory).toMatchObject({
    availableQuantity: 11,
    availableValuePiasters: 153_000,
    costsIncomplete: false,
  });

  const pageTwo = await api(manager, "GET", `/api/internal/reports/management?period=day&date=${ACCEPTANCE_DATE}&detailPage=2&detailPageSize=1`);
  expect(pageTwo.status, JSON.stringify(pageTwo.body)).toBe(200);
  expect(pageTwo.body.pageInfo).toMatchObject({ page: 2, totalPurchases: 2, totalOpeningReceipts: 2, hasMore: false });
  expect(pageTwo.body.purchases.totalPiasters).toBe(45_000);
  expect(pageTwo.body.openingStock.totalPiasters).toBe(92_000);
  expect(pageTwo.body.summary.purchaseCostPiasters).toBe(45_000);
  expect(pageTwo.body.summary.openingStockCostPiasters).toBe(92_000);
  expect(pageTwo.body.summary.operatingProfitPiasters).toBe(0);
  expect(pageTwo.body.purchases.receipts).toHaveLength(1);
  expect(pageTwo.body.openingStock.receipts).toHaveLength(1);

  const purchaseIds = receiptIds(pageOne.body.purchases.receipts, pageTwo.body.purchases.receipts);
  const openingIds = receiptIds(pageOne.body.openingStock.receipts, pageTwo.body.openingStock.receipts);
  expect(purchaseIds).toEqual([configReceipt.body.id, unacceptedReceipt.body.id].sort());
  expect(openingIds).toEqual(openingReceipts.map((receipt) => receipt.id).sort());
  expect(purchaseIds).not.toContain(outsideReceipt.body.id);
  expect(openingIds).not.toContain(outsideReceipt.body.id);
  const openingDetails = [...pageOne.body.openingStock.receipts, ...pageTwo.body.openingStock.receipts];
  expect(openingDetails.map((receipt: ReceiptReport) => receipt.receiptDate)).toEqual([ACCEPTANCE_DATE, ACCEPTANCE_DATE]);
  expect(openingDetails.reduce((sum: number, receipt: ReceiptReport) => sum + receipt.effectiveCostPiasters, 0)).toBe(92_000);
  expect(openingDetails.reduce((sum: number, receipt: ReceiptReport) => sum + receipt.effectiveQuantity, 0)).toBe(4);
  const correctedDetail = openingDetails.find((receipt: ReceiptReport) => receipt.receiptId === abshwayOpening.id);
  expect(correctedDetail).toMatchObject({
    effectiveQuantity: 1,
    effectiveCostPiasters: 20_000,
    corrections: [{ revision: 1, reason: OPENING_CORRECTION_REASON, changedByDisplayName: "مالك برافوس" }],
  });
  const fayoumDetail = openingDetails.find((receipt: ReceiptReport) => receipt.receiptId !== abshwayOpening.id);
  expect(fayoumDetail).toMatchObject({ effectiveQuantity: 3, effectiveCostPiasters: 72_000, corrections: [] });
  expect([...pageOne.body.purchases.receipts, ...pageTwo.body.purchases.receipts].every((receipt: ReceiptReport) => receipt.corrections.length === 0)).toBe(true);

  const filtered = await api(
    manager,
    "GET",
    `/api/internal/reports/management?period=day&date=${ACCEPTANCE_DATE}&branchId=${fayoumId}&channel=physical&employeeId=${employee.id}&detailPageSize=10`,
  );
  expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
  expect(filtered.body.purchases.totalPiasters).toBe(45_000);
  expect(filtered.body.openingStock.totalPiasters).toBe(92_000);
  expect(filtered.body.pageInfo).toMatchObject({ totalPurchases: 2, totalOpeningReceipts: 2, hasMore: false });
  expect(filtered.body.summary.operatingProfitPiasters).toBe(0);
  expect(filtered.body.summary.effectiveExpensesPiasters).toBe(0);

  const august = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-08&detailPageSize=10");
  expect(august.body.pageInfo).toMatchObject({ totalPurchases: 0, totalOpeningReceipts: 0 });
  expect(august.body.purchases.totalPiasters).toBe(0);
  expect(august.body.openingStock.totalPiasters).toBe(0);
  expect(august.body.inventory.availableQuantity).toBe(11);
  const september = await api(manager, "GET", "/api/internal/reports/management?period=month&month=2026-09&detailPageSize=10");
  expect(september.body.pageInfo).toMatchObject({ totalPurchases: 1, totalOpeningReceipts: 0 });
  expect(september.body.purchases.totalPiasters).toBe(16_000);
  expect(september.body.purchases.receipts.map((receipt: ReceiptReport) => receipt.receiptId)).toEqual([outsideReceipt.body.id]);
  expect(september.body.openingStock).toMatchObject({ totalPiasters: 0, receipts: [] });

  expect(await durableSnapshot()).toEqual(beforeReads);
  const previewAfter = await api(manager, "GET", `/api/internal/opening-import/previews/${openingPreview.body.id}`);
  expect(previewAfter.body).toMatchObject({
    status: "accepted",
    createdAt: accepted.body.createdAt,
    acceptedAt: accepted.body.acceptedAt,
  });
  const batchesAfter = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batchesAfter.body).toEqual(batches.body);

  const xlsxResponse = await raw(manager, `/api/internal/reports/management/export?format=xlsx&period=day&date=${ACCEPTANCE_DATE}`);
  expect(xlsxResponse.statusCode).toBe(200);
  expect(xlsxResponse.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxResponse.rawPayload);
  const summary = worksheetMap(workbook, "الملخص");
  expect(summary.get("تكلفة المشتريات (ج.م)")).toBe(450);
  expect(summary.get("قيمة المخزون الافتتاحي (ج.م)")).toBe(920);
  expect(summary.get("عدد تفاصيل المشتريات")).toBe(2);
  expect(summary.get("عدد تفاصيل المخزون الافتتاحي")).toBe(2);
  expect(summary.get("المصروفات الفعلية (ج.م)")).toBe(0);
  expect(summary.get("الربح التشغيلي (ج.م)")).toBe(0);
  expect(summary.get("نطاق المشتريات والمخزون الافتتاحي")).toBe("جميع الفروع، ويتجاهل فلاتر فرع البيع والموظف وقناة البيع");
  expect(summary.get("طبيعة المخزون الافتتاحي")).toBe("رصيد افتتاحي منفصل، وليس عملية شراء جديدة ولا مصروفاً تشغيلياً");
  const purchaseRows = worksheetRows(workbook, "المشتريات");
  const openingRows = worksheetRows(workbook, "المخزون الافتتاحي");
  expect(purchaseRows.map((row) => row[0]).sort()).toEqual(purchaseIds);
  expect(openingRows.map((row) => row[0]).sort()).toEqual(openingIds);
  const fayoumOpening = openingReceipts.find((receipt) => receipt.branchId === fayoumId);
  if (!fayoumOpening) throw new Error("Expected the Fayoum opening receipt.");
  const purchaseCosts = costByReceipt(purchaseRows);
  const openingCosts = costByReceipt(openingRows);
  expect(purchaseCosts.get(configReceipt.body.id)).toBe(400);
  expect(purchaseCosts.get(unacceptedReceipt.body.id)).toBe(50);
  expect(openingCosts.get(abshwayOpening.id)).toBe(200);
  expect(openingCosts.get(fayoumOpening.id)).toBe(720);
  const openingCorrections = worksheetRows(workbook, "تصحيحات المخزون الافتتاحي");
  expect(openingCorrections).toEqual([
    expect.arrayContaining([abshwayOpening.id, OPENING_CORRECTION_REASON, "مالك برافوس"]),
  ]);
  expect(worksheetRows(workbook, "تصحيحات المشتريات")).toEqual([]);
  expect(worksheetRows(workbook, "المصروفات").some((row) => row.includes(920) || row.includes(450))).toBe(false);

  const pdfResponse = await raw(manager, `/api/internal/reports/management/export?format=pdf&period=day&date=${ACCEPTANCE_DATE}`);
  expect(pdfResponse.statusCode).toBe(200);
  expect(pdfResponse.headers["content-type"]).toBe("application/pdf");
  expect(pdfResponse.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  const pdfPages = await readPdfPages(pdfResponse.rawPayload);
  const summaryPage = pdfPages.find((items) => items.some((item) => PDF_PURCHASE_COST_LABELS.includes(item.text)));
  if (!summaryPage) throw new Error("PDF summary page is missing the purchase cost label.");
  expect(amountRightOf(summaryPage, PDF_PURCHASE_COST_LABELS)).toBe("450.00");
  expect(amountRightOf(summaryPage, PDF_OPENING_COST_LABELS)).toBe("920.00");
  for (const line of PDF_SCOPE_LINES) expect(summaryPage.some((item) => item.text === line), line).toBe(true);
  const classifiedReceiptIds = [...openingIds, ...purchaseIds];
  const purchasePages = sectionPages(pdfPages, PDF_PURCHASE_HEADINGS, PDF_PURCHASE_NEXT_HEADINGS);
  const openingPages = sectionPages(pdfPages, PDF_OPENING_HEADINGS, PDF_OPENING_NEXT_HEADINGS);
  const correctionPages = sectionPages(pdfPages, PDF_OPENING_CORRECTION_HEADINGS, PDF_EXPENSE_HEADINGS);
  if (purchasePages.length === 0 || openingPages.length === 0 || correctionPages.length === 0) {
    throw new Error("PDF section headings did not bound purchases, opening stock, and opening corrections.");
  }
  const fayoumBlocks = receiptBlocks(openingPages, fayoumOpening.id, classifiedReceiptIds);
  const abshwayBlocks = receiptBlocks(openingPages, abshwayOpening.id, classifiedReceiptIds);
  const configBlocks = receiptBlocks(purchasePages, configReceipt.body.id, classifiedReceiptIds);
  const unacceptedBlocks = receiptBlocks(purchasePages, unacceptedReceipt.body.id, classifiedReceiptIds);
  expect(fayoumBlocks.some((block) => hasAmount(block, "720.00"))).toBe(true);
  expect(abshwayBlocks.some((block) => hasAmount(block, "200.00"))).toBe(true);
  const reasonIndex = correctionPages.findIndex((items) => receiptBlocks([items], abshwayOpening.id, classifiedReceiptIds).some((block) => PDF_CORRECTION_REASONS.some((reason) => block.includes(reason))));
  expect(reasonIndex).toBeGreaterThanOrEqual(0);
  const correctionAttribution = [correctionPages[reasonIndex] ?? [], correctionPages[reasonIndex + 1] ?? []];
  expect(correctionAttribution.some((items) => items.some((item) => item.text === "اسم المنفذ: مالك برافوس"))).toBe(true);
  expect(configBlocks.some((block) => hasAmount(block, "400.00"))).toBe(true);
  expect(unacceptedBlocks.some((block) => hasAmount(block, "50.00"))).toBe(true);
  for (const block of [...fayoumBlocks, ...abshwayBlocks]) {
    expect(block.includes(configReceipt.body.id)).toBe(false);
    expect(block.includes(unacceptedReceipt.body.id)).toBe(false);
  }
  for (const block of [...configBlocks, ...unacceptedBlocks]) {
    expect(PDF_CORRECTION_REASONS.some((reason) => block.includes(reason))).toBe(false);
    expect(block.includes(abshwayOpening.id)).toBe(false);
    expect(block.includes(fayoumOpening.id)).toBe(false);
  }

  // Numeric-only leading UUID groups must remain in their original order in the RTL PDF.
  const numericLeadingId = "46591414-2163-413a-a438-2edb0572959d";
  const fixtureReport = structuredClone(pageOne.body);
  fixtureReport.purchases.receipts[0].receiptId = numericLeadingId;
  fixtureReport.purchases.receipts[0].effectiveCostPiasters = 5_000;
  const fixturePdf = await renderManagementReportPdf(fixtureReport);
  const fixturePages = await readPdfPages(Buffer.from(fixturePdf.bytes));
  const fixturePurchases = sectionPages(fixturePages, PDF_PURCHASE_HEADINGS, PDF_PURCHASE_NEXT_HEADINGS);
  expect(
    receiptBlocks(fixturePurchases, numericLeadingId, [numericLeadingId]).some((block) => hasAmount(block, "50.00")),
    `Expected ${numericLeadingId} and its amount in the purchase section: ${JSON.stringify(fixturePurchases)}`,
  ).toBe(true);
  expect(await durableSnapshot()).toEqual(beforeReads);
}, 120_000);

type Session = { cookie: string };
type ReceiptBody = { id: string; operationId: string; branchId: string; receiptDate: string; lines: Array<{ id: string }> };
type ReceiptReport = {
  receiptId: string;
  receiptDate: string;
  effectiveQuantity: number;
  effectiveCostPiasters: number;
  corrections: Array<{ revision: number; reason: string; changedByDisplayName: string }>;
};

function receiptIds(...groups: ReceiptReport[][]) {
  return groups.flat().map((receipt) => receipt.receiptId).sort();
}

function cairoDate(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function catalogCsv() {
  return [
    "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp",
    "category,shirts,قمصان,,,,,,,,,,,,",
    "size,l,كبير,,,,,,,,,,,,",
    "color,black,أسود,,,,,,,,,,,,",
    "product,os-product,قميص الافتتاح,,OS-OPEN-1,قطن,shirts,500.00,hidden,,,,,,",
    "variant,os-shirt,,,,,,,,,,os-product,l,black,",
  ].join("\n");
}

const CONFIG_HEADERS = ["record_type", "key", "name_ar", "value", "variant_key", "fee_egp", "active", "discount_type", "percentage", "amount_egp", "starts_on", "ends_on", "allow_combination", "usage_limit", "product_keys", "category_keys", "buy_quantity", "reward_quantity", "reward_percentage", "bundle_total_egp", "offer_key", "required_quantity", "buy_product_keys", "buy_category_keys", "reward_product_keys", "reward_category_keys"] as const;

function configurationCsv(rows: Array<Record<string, string>>) {
  return [CONFIG_HEADERS.join(","), ...rows.map((row) => CONFIG_HEADERS.map((header) => row[header] ?? "").join(","))].join("\n");
}

async function durableSnapshot() {
  const [previews, batches, movements, receipts] = await Promise.all([
    built.pool.query<{ id: string; status: string; created_at: Date; accepted_at: Date | null }>(
      "SELECT id, status, created_at, accepted_at FROM opening_import_preview ORDER BY created_at, id",
    ),
    built.pool.query<{ id: string; receipt_date: string; recorded_at: Date }>(
      "SELECT id, receipt_date::text AS receipt_date, recorded_at FROM inventory_batch ORDER BY receipt_date, id",
    ),
    built.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM inventory_movement"),
    built.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM receiving_receipt"),
  ]);
  return {
    previews: previews.rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      acceptedAt: row.accepted_at?.toISOString() ?? null,
    })),
    batches: batches.rows.map((row) => ({
      id: row.id,
      receiptDate: row.receipt_date,
      recordedAt: row.recorded_at.toISOString(),
    })),
    movements: movements.rows[0]?.count,
    receipts: receipts.rows[0]?.count,
  };
}

function worksheetMap(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Missing worksheet ${name}.`);
  const values = new Map<string, ExcelJS.CellValue>();
  sheet.eachRow((row) => values.set(String(row.getCell(1).value), row.getCell(2).value));
  return values;
}

function worksheetRows(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Missing worksheet ${name}.`);
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow((row, index) => {
    if (index > 1) rows.push((row.values as ExcelJS.CellValue[]).slice(1));
  });
  return rows;
}

function costByReceipt(rows: ExcelJS.CellValue[][]) {
  const costs = new Map<string, number>();
  for (const row of rows) {
    if (typeof row[0] !== "string") throw new Error("Receipt sheet row is missing its id.");
    costs.set(row[0], Number(row[4]));
  }
  return costs;
}

type PdfTextItem = { text: string; x: number; y: number };

// pdfjs-dist 6.4.299 has no isEvalSupported switch. This call does not enable PDF scripting.
// The second spelling is the current Cairo/react-pdf extraction of that same summary label.
const PDF_PURCHASE_COST_LABELS = ["تكلفة المشتريات (ج.م)", "تكلفة المشرتيات )ج.م("];
const PDF_OPENING_COST_LABELS = ["قيمة المخزون الافتتاحي (ج.م)", "قيمة المخزون االفتتاحي )ج.م("];
// Exact pdfjs item text from this renderer. Ligatures reorder a few letters; XLSX keeps canonical Arabic.
const PDF_CORRECTION_REASONS = ["تصحيح كمية المخزون الافتتاحي", "تصحيح كمية المخزون االفتتاحي"];
const PDF_PURCHASE_HEADINGS = ["المشتريات", "المشرتيات"];
const PDF_PURCHASE_NEXT_HEADINGS = ["تفاصيل المشتريات", "تفاصيل المشرتيات"];
const PDF_OPENING_HEADINGS = ["المخزون الافتتاحي", "المخزون االفتتاحي"];
const PDF_OPENING_NEXT_HEADINGS = ["تفاصيل المخزون الافتتاحي", "تفاصيل المخزون االفتتاحي"];
const PDF_OPENING_CORRECTION_HEADINGS = ["تصحيحات المخزون الافتتاحي", "تصحيحات المخزون االفتتاحي"];
const PDF_EXPENSE_HEADINGS = ["المصروفات", "المرصوفات"];
const PDF_SCOPE_LINES = [
  "جميع الفروع، ويتجاهل فالتر فرع البيع",
  "والموظف وقناة البيع",
  "ًرصيد افتتاحي منفصل، وليس عملية رشاء",
  "جديدة وال مرصوفا ً تشغيليا",
];

const require = createRequire(import.meta.url);
const standardFontDataUrl = pathToFileURL(
  path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep,
).href;

async function readPdfPages(pdf: Buffer): Promise<PdfTextItem[][]> {
  const loadingTask = getDocument({ data: new Uint8Array(pdf), standardFontDataUrl, verbosity: 0 });
  const pages: PdfTextItem[][] = [];
  try {
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items: PdfTextItem[] = [];
        for (const item of content.items) {
          if (!("str" in item) || item.str.length === 0) continue;
          items.push({ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 });
        }
        pages.push(items);
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function amountRightOf(items: PdfTextItem[], labels: readonly string[]): string {
  const anchor = items.find((item) => labels.includes(item.text));
  if (!anchor) throw new Error(`Missing PDF label ${labels[0]}.`);
  const nearest = items
    .filter((item) => /^\d+\.\d{2}$/.test(item.text) && Math.abs(item.y - anchor.y) <= 1.5 && item.x > anchor.x + 0.5)
    .sort((left, right) => (left.x - anchor.x) - (right.x - anchor.x))[0];
  if (!nearest) throw new Error(`No amount to the right of ${anchor.text}.`);
  return nearest.text;
}

function sectionPages(pages: PdfTextItem[][], startHeadings: readonly string[], endHeadings: readonly string[]): PdfTextItem[][] {
  const selected: PdfTextItem[][] = [];
  let inside = false;
  for (const items of pages) {
    const ordered = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
    const kept: PdfTextItem[] = [];
    for (const item of ordered) {
      if (inside && endHeadings.includes(item.text)) {
        inside = false;
        continue;
      }
      if (startHeadings.includes(item.text)) {
        inside = true;
        continue;
      }
      if (inside) kept.push(item);
    }
    if (kept.length > 0) selected.push(kept);
  }
  return selected;
}

function hasAmount(block: string, amount: string): boolean {
  return new RegExp(`(^|\\D)${amount.replace(".", "\\.")}(\\D|$)`).test(block);
}

function receiptBlocks(pages: PdfTextItem[][], id: string, receiptIds: readonly string[]): string[] {
  const blocks: string[] = [];
  for (const items of pages) {
    const ordered = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
    for (let index = 0; index < ordered.length; index += 1) {
      const start = ordered[index];
      if (!start?.text.includes(id)) continue;
      const parts = [start.text];
      for (const item of ordered.slice(index + 1)) {
        if (receiptIds.some((receiptId) => receiptId !== id && item.text.includes(receiptId))) break;
        parts.push(item.text);
      }
      blocks.push(parts.join("\n"));
    }
  }
  return blocks;
}

async function createEmployee(manager: Session) {
  const response = await api(manager, "POST", "/api/internal/staff", {
    loginName: "report.cashier",
    displayName: "موظف التقرير",
    password: "staff-pass-23",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string };
}

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const rawCookie = response.headers["set-cookie"];
  const values = Array.isArray(rawCookie) ? rawCookie : rawCookie ? [rawCookie] : [];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(session: Session | undefined, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin: ORIGIN, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function raw(session: Session | undefined, url: string) {
  return built.app.inject({ method: "GET", url, headers: { origin: ORIGIN, cookie: session?.cookie ?? "" } });
}
