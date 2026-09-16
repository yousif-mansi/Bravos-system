import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "@ayocore/exceljs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
const NOW = new Date("2026-09-16T10:00:00.000Z");

let cluster: PostgresCluster;
let built: BuiltApp;
let branchId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({
    port: Number(process.env.BRAVOS_ANALYTICS_TEST_PORT ?? 55466),
  });
  const databaseName = `bravos_analytics_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-analytics-outbox-")),
    businessClock: () => new Date(NOW),
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
  branchId = (await built.pool.query<{ id: string }>("SELECT id FROM branch WHERE code='fayoum'"))
    .rows[0]?.id ?? "";
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  if (cluster) await cluster.stop();
});

test("public activity events are anonymous, validated and replay-safe while the manager sees honest aggregate definitions", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedPublicProduct(manager, "ANALYTICS", 3);
  const visitOperationId = crypto.randomUUID();

  const visit = await publicApi("POST", "/api/public/analytics/events", {
    operationId: visitOperationId,
    eventType: "visit",
  });
  expect(visit.status).toBe(201);
  expect(visit.body).toEqual({
    operationId: visitOperationId,
    eventType: "visit",
    recordedAt: NOW.toISOString(),
  });
  const replay = await publicApi("POST", "/api/public/analytics/events", {
    operationId: visitOperationId,
    eventType: "visit",
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(visit.body);

  const changedReuse = await publicApi("POST", "/api/public/analytics/events", {
    operationId: visitOperationId,
    eventType: "product_view",
    productId: seeded.productId,
  });
  expect(changedReuse.status).toBe(409);
  expect(changedReuse.body.error.code).toBe("OPERATION_CONFLICT");

  const viewed = await publicApi("POST", "/api/public/analytics/events", {
    operationId: crypto.randomUUID(),
    eventType: "product_view",
    productId: seeded.productId,
  });
  expect(viewed.status).toBe(201);
  const added = await publicApi("POST", "/api/public/analytics/events", {
    operationId: crypto.randomUUID(),
    eventType: "cart_addition",
    productId: seeded.productId,
    variantId: seeded.variantId,
    quantity: 2,
  });
  expect(added.status).toBe(201);

  const unavailableQuantity = await publicApi("POST", "/api/public/analytics/events", {
    operationId: crypto.randomUUID(),
    eventType: "cart_addition",
    productId: seeded.productId,
    variantId: seeded.variantId,
    quantity: 4,
  });
  expect(unavailableQuantity.status).toBe(400);
  expect(unavailableQuantity.body.error.code).toBe("VALIDATION");
  const profilingField = await publicApi("POST", "/api/public/analytics/events", {
    operationId: crypto.randomUUID(),
    eventType: "visit",
    visitorId: "persistent-person-profile",
  });
  expect(profilingField.status).toBe(400);

  const summary = await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16");
  expect(summary.status).toBe(200);
  expect(summary.body).toEqual({
    period: { fromCairoDate: "2026-09-16", toCairoDateInclusive: "2026-09-16" },
    metrics: {
      visits: { count: 1, definitionAr: expect.stringContaining("تحميل كامل للمتجر") },
      productViews: { count: 1, definitionAr: expect.any(String) },
      successfulCartAdditions: { count: 1, definitionAr: expect.any(String) },
      acceptedOrderSubmissions: { count: 0, definitionAr: expect.any(String) },
      completedOnlineSales: { count: 0, definitionAr: expect.any(String) },
    },
  });
  expect(JSON.stringify(summary.body)).not.toMatch(/customer|phone|address|cost|profit/i);

  const tableColumns = await built.pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='public_analytics_event'
     ORDER BY ordinal_position`,
  );
  expect(tableColumns.rows.map((row) => row.column_name)).toEqual([
    "operation_id",
    "payload_fingerprint",
    "event_type",
    "product_id",
    "variant_id",
    "quantity",
    "recorded_at",
  ]);

  const employee = await createEmployee(manager);
  expect((await api(employee, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16")).status).toBe(403);
  expect((await api(undefined, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16")).status).toBe(401);
  expect((await publicApi("GET", "/api/public/analytics")).status).toBe(404);
  expect((await api(manager, "GET", "/api/internal/analytics?from=2025-01-01&to=2026-09-16")).status).toBe(400);
  expect((await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16&visitorId=x")).status).toBe(400);
});

test("accepted submissions and delivered sales come from durable order operations and are counted once", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seeded = await seedOrder(manager, "BUSINESS-FACT");
  const beforeDelivery = await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16");
  expect(beforeDelivery.body.metrics).toMatchObject({
    acceptedOrderSubmissions: { count: 1 },
    completedOnlineSales: { count: 0 },
  });

  const replayedSubmission = await publicApi("POST", "/api/public/checkout/orders", seeded.submission);
  expect(replayedSubmission.status).toBe(200);
  expect(replayedSubmission.body.orderId).toBe(seeded.orderId);
  const afterReplay = await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16");
  expect(afterReplay.body.metrics.acceptedOrderSubmissions.count).toBe(1);

  const review = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/agreement-quotes`, {
    expectedRevision: 1,
    lines: [{ variantId: seeded.variantId, quantity: 1 }],
  });
  const agreed = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/agreed-revisions`, {
    operationId: crypto.randomUUID(),
    expectedRevision: 1,
    quoteId: review.body.quoteId,
    reviewDigest: review.body.reviewDigest,
    customerAgreed: true,
  });
  const confirmed = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/confirm`, {
    operationId: crypto.randomUUID(),
    expectedRevision: agreed.body.revision,
    agreedRevision: agreed.body.revision,
    itemsLocatedAndSetAside: true,
  });
  const shipped = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/ship`, {
    operationId: crypto.randomUUID(),
    expectedRevision: confirmed.body.revision,
  });
  const delivered = await api(manager, "POST", `/api/internal/online-orders/${seeded.orderId}/deliver`, {
    operationId: crypto.randomUUID(),
    expectedRevision: shipped.body.result.revision,
    customerReceivedAt: shipped.body.result.shippedAt,
  });
  expect(delivered.status, JSON.stringify(delivered.body)).toBe(201);

  const completed = await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16");
  expect(completed.body.metrics).toMatchObject({
    acceptedOrderSubmissions: { count: 1 },
    completedOnlineSales: { count: 1 },
  });
  await built.pool.query(
    `INSERT INTO public_analytics_event
       (operation_id,payload_fingerprint,event_type,product_id,variant_id,quantity,recorded_at)
     VALUES ($1,repeat('a',64),'visit',NULL,NULL,NULL,$2)`,
    [crypto.randomUUID(), NOW],
  );
  const trackingCannotForgeBusinessFacts = await api(manager, "GET", "/api/internal/analytics?from=2026-09-16&to=2026-09-16");
  expect(trackingCannotForgeBusinessFacts.body.metrics).toMatchObject({
    acceptedOrderSubmissions: { count: 1 },
    completedOnlineSales: { count: 1 },
  });
});

test("analytics date ranges use the first real Cairo instant across the 2026 DST gap and rollback", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const instants = [
    "2026-04-23T21:59:59.999Z",
    "2026-04-23T22:00:00.000Z",
    "2026-04-24T20:59:59.999Z",
    "2026-04-24T21:00:00.000Z",
    "2026-10-28T20:59:59.999Z",
    "2026-10-28T21:00:00.000Z",
    "2026-10-29T21:59:59.999Z",
    "2026-10-29T22:00:00.000Z",
    "2026-10-30T21:59:59.999Z",
    "2026-10-30T22:00:00.000Z",
  ];
  for (const instant of instants) {
    await built.pool.query(
      `INSERT INTO public_analytics_event
         (operation_id,payload_fingerprint,event_type,product_id,variant_id,quantity,recorded_at)
       VALUES ($1,repeat('b',64),'visit',NULL,NULL,NULL,$2)`,
      [crypto.randomUUID(), instant],
    );
  }

  const springGapDay = await api(manager, "GET", "/api/internal/analytics?from=2026-04-24&to=2026-04-24");
  expect(springGapDay.status).toBe(200);
  expect(springGapDay.body.metrics.visits.count).toBe(2);

  const autumnRollbackDay = await api(manager, "GET", "/api/internal/analytics?from=2026-10-29&to=2026-10-29");
  expect(autumnRollbackDay.status).toBe(200);
  expect(autumnRollbackDay.body.metrics.visits.count).toBe(2);

  const firstStandardTimeDay = await api(manager, "GET", "/api/internal/analytics?from=2026-10-30&to=2026-10-30");
  expect(firstStandardTimeDay.status).toBe(200);
  expect(firstStandardTimeDay.body.metrics.visits.count).toBe(2);
});

test("manager exports the exact authorized management report as bounded PDF and formula-safe RTL XLSX", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  expect((await api(manager, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  const category = await api(manager, "POST", "/api/internal/expense-categories", { nameAr: "اختبار التصدير" });
  const formulaLikeDescription = "=HYPERLINK(\"https://invalid.example\",\"فتح\")";
  const expense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 1_234,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: formulaLikeDescription,
  });
  expect(expense.status, JSON.stringify(expense.body)).toBe(201);
  const cancelledExpense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 999,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: "مصروف ملغى للتصدير",
  });
  expect(cancelledExpense.status, JSON.stringify(cancelledExpense.body)).toBe(201);
  const cancellation = await api(manager, "POST", `/api/internal/expenses/${cancelledExpense.body.id}/changes`, {
    operationId: crypto.randomUUID(), expectedRevision: 0, type: "cancellation", reason: "لم يحدث",
  });
  expect(cancellation.status, JSON.stringify(cancellation.body)).toBe(201);

  const reportUrl = "/api/internal/reports/management?period=day&date=2026-09-16";
  const report = await api(manager, "GET", reportUrl);
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.summary.effectiveExpensesPiasters).toBeGreaterThanOrEqual(1_234);

  const xlsx = await rawInternal(
    manager,
    "GET",
    "/api/internal/reports/management/export?format=xlsx&period=day&date=2026-09-16",
  );
  expect(xlsx.statusCode).toBe(200);
  expect(xlsx.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(xlsx.headers["content-disposition"]).toBe(
    'attachment; filename="bravos-management-report-2026-09-16-2026-09-16.xlsx"',
  );
  expect(xlsx.headers["cache-control"]).toBe("no-store");
  expect(xlsx.headers["x-content-type-options"]).toBe("nosniff");
  expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.rawPayload);
  const summarySheet = workbook.getWorksheet("الملخص");
  if (!summarySheet) throw new Error("Expected the Arabic summary worksheet.");
  expect(summarySheet.views[0]).toMatchObject({ rightToLeft: true });
  const summaryValues = new Map<string, unknown>();
  summarySheet.eachRow((row) => summaryValues.set(String(row.getCell(1).value), row.getCell(2).value));
  expect(summaryValues.get("المصروفات الفعلية (ج.م)")).toBe(report.body.summary.effectiveExpensesPiasters / 100);
  expect(summaryValues.get("صافي مبيعات البضاعة (ج.م)")).toBe(report.body.summary.netMerchandiseSalesPiasters / 100);
  expect(summaryValues.get("تكلفة المشتريات (ج.م)")).toBe(report.body.summary.purchaseCostPiasters / 100);
  expect(summaryValues.get("عدد المبيعات المكتملة")).toBe(report.body.summary.completedCount);
  workbook.eachSheet((sheet) => {
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true });
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    expect(headers.some((header) => header.includes("(قرش)")), sheet.name).toBe(false);
  });
  const purchaseCorrections = workbook.getWorksheet("تصحيحات المشتريات");
  expect((purchaseCorrections?.getRow(1).values as unknown[]).slice(1)).toContain("اسم المنفذ");
  const expenseSheet = workbook.getWorksheet("المصروفات");
  const expenseRows: unknown[][] = [];
  expenseSheet?.eachRow((row, index) => { if (index > 1) expenseRows.push((row.values as unknown[]).slice(1)); });
  expect(expenseRows.some((row) => row.includes(`'${formulaLikeDescription}`))).toBe(true);
  const expenseCorrections = workbook.getWorksheet("تصحيحات المصروفات");
  const correctionHeaders = (expenseCorrections?.getRow(1).values as unknown[]).slice(1).map(String);
  expect(correctionHeaders).toContain("الوقت (القاهرة)");
  expect(report.body.completedSales).toEqual([
    expect.objectContaining({ channel: "online", occurredAt: "2026-09-16T10:00:00.000Z" }),
  ]);
  const salesSheet = workbook.getWorksheet("المبيعات المكتملة");
  const salesHeaders = (salesSheet?.getRow(1).values as unknown[]).slice(1).map(String);
  const completedAt = (salesSheet?.getRow(2).values as unknown[]).slice(1)[salesHeaders.indexOf("وقت الإكمال (القاهرة)")];
  expect(completedAt).toBe("2026-09-16 13:00:00");

  const longDescription = `بداية النص الطويل ${"تفاصيل عربية كاملة يجب أن تنتقل بين صفحات التقرير دون حذف أو اقتطاع. ".repeat(600)} نهاية النص الطويل`;
  const longExpense = await api(manager, "POST", "/api/internal/expenses", {
    operationId: crypto.randomUUID(),
    amountPiasters: 4_321,
    expenseDate: "2026-09-16",
    categoryId: category.body.id,
    description: longDescription,
  });
  expect(longExpense.status, JSON.stringify(longExpense.body)).toBe(201);

  const longReport = await api(manager, "GET", reportUrl);
  expect(longReport.status, JSON.stringify(longReport.body)).toBe(200);
  expect(longReport.body.summary.effectiveExpensesPiasters).toBeGreaterThanOrEqual(5_555);
  expect(longReport.body.expenses.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ expenseId: longExpense.body.id, description: longDescription }),
  ]));

  const longXlsx = await rawInternal(
    manager,
    "GET",
    "/api/internal/reports/management/export?format=xlsx&period=day&date=2026-09-16",
  );
  expect(longXlsx.statusCode).toBe(400);
  expect(longXlsx.json()).toMatchObject({
    error: {
      code: "VALIDATION",
      messageAr: expect.stringContaining("Excel"),
    },
  });

  const pdf = await rawInternal(
    manager,
    "GET",
    "/api/internal/reports/management/export?format=pdf&period=day&date=2026-09-16",
  );
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers["content-type"]).toBe("application/pdf");
  expect(pdf.headers["content-disposition"]).toBe(
    'attachment; filename="bravos-management-report-2026-09-16-2026-09-16.pdf"',
  );
  expect(pdf.headers["cache-control"]).toBe("no-store");
  expect(pdf.headers["x-content-type-options"]).toBe("nosniff");
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.rawPayload.byteLength).toBeGreaterThan(2_000);
  expect(pdf.rawPayload.includes(Buffer.from("Cairo-Regular"))).toBe(true);

  const artifactDir = process.env.BRAVOS_EXPORT_ARTIFACT_DIR;
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await Promise.all([
      writeFile(path.join(artifactDir, "management-report.json"), JSON.stringify(report.body, null, 2)),
      writeFile(path.join(artifactDir, "management-report-pdf.json"), JSON.stringify(longReport.body, null, 2)),
      writeFile(path.join(artifactDir, "management-report.xlsx"), xlsx.rawPayload),
      writeFile(path.join(artifactDir, "management-report.pdf"), pdf.rawPayload),
    ]);
  }

  const { safeSpreadsheetText } = await import("@bravos/report-export/node");
  expect(safeSpreadsheetText(formulaLikeDescription)).toBe(`'${formulaLikeDescription}`);
  expect(safeSpreadsheetText("وصف عادي")).toBe("وصف عادي");

  const employee = await createEmployee(manager);
  expect((await rawInternal(employee, "GET", "/api/internal/reports/management/export?format=pdf&period=today")).statusCode).toBe(403);
  expect((await rawInternal(undefined, "GET", "/api/internal/reports/management/export?format=xlsx&period=today")).statusCode).toBe(401);
  expect((await rawInternal(manager, "GET", "/api/internal/reports/management/export?format=csv&period=today")).statusCode).toBe(400);
  expect((await rawInternal(manager, "GET", "/api/internal/reports/management/export?format=pdf&period=today&detailPage=1")).statusCode).toBe(400);
  expect((await rawInternal(manager, "GET", "/api/internal/reports/management/export?format=pdf&period=today&visitorId=x")).statusCode).toBe(400);

  await seedExpenseVolume(expense.body.id, 5_001);
  const oversizedPdf = await rawInternal(
    manager,
    "GET",
    "/api/internal/reports/management/export?format=pdf&period=day&date=2026-09-16",
  );
  expect(oversizedPdf.statusCode).toBe(400);
  expect(oversizedPdf.json()).toMatchObject({
    error: { code: "VALIDATION", messageAr: "التقرير كبير جداً للتصدير. اختر فترة أو مرشحات أضيق." },
  });
});

async function seedExpenseVolume(sourceExpenseId: string, rows: number) {
  const client = await built.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE TEMP TABLE export_volume ON COMMIT DROP AS
       SELECT gen_random_uuid() AS expense_id,gen_random_uuid() AS operation_id FROM generate_series(1,$1::int)`,
      [rows],
    );
    await client.query(
      `INSERT INTO expense_operation (
       operation_id,payload_fingerprint,actor_staff_id,operation_type,expense_id,result_revision,recorded_at
     ) SELECT volume.operation_id,'export-volume',source.created_by_staff_id,'create',NULL,NULL,source.recorded_at
       FROM export_volume volume CROSS JOIN expense_record source WHERE source.id=$1`,
      [sourceExpenseId],
    );
    await client.query(
      `INSERT INTO expense_record (
       id,operation_id,payload_fingerprint,branch_id,created_by_staff_id,amount_piasters,expense_date,
       category_id,category_name_ar,description,recorded_at
     ) SELECT volume.expense_id,volume.operation_id,'export-volume',source.branch_id,
              source.created_by_staff_id,source.amount_piasters,source.expense_date,source.category_id,
              source.category_name_ar,'سجل حجم تصدير',source.recorded_at
       FROM export_volume volume CROSS JOIN expense_record source WHERE source.id=$1`,
      [sourceExpenseId],
    );
    await client.query(
      `UPDATE expense_operation operation SET expense_id=volume.expense_id,result_revision=0
       FROM export_volume volume WHERE operation.operation_id=volume.operation_id`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type Session = { cookie: string };

async function signIn(username: string, password: string): Promise<Session> {
  const response = await built.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/username",
    headers: { origin: INTERNAL_ORIGIN, "content-type": "application/json" },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { cookie: values.map((value) => value.split(";")[0]).join("; ") };
}

async function api(
  session: Session | undefined,
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  origin = INTERNAL_ORIGIN,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function publicApi(method: "GET" | "POST", url: string, payload?: unknown) {
  return api(undefined, method, url, payload, PUBLIC_ORIGIN);
}

function rawInternal(session: Session | undefined, method: "GET", url: string) {
  return built.app.inject({
    method,
    url,
    headers: { origin: INTERNAL_ORIGIN, cookie: session?.cookie ?? "" },
  });
}

async function seedPublicProduct(manager: Session, suffix: string, quantity: number) {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: `تصنيف ${suffix}` });
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: `مقاس ${suffix}` });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: `لون ${suffix}` });
  const product = await api(manager, "POST", "/api/internal/catalog/products", {
    code: `AN-${suffix}`,
    nameAr: `منتج ${suffix}`,
    descriptionAr: "منتج لقياس النشاط المجمع",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 20_000,
    publication: "available",
    imageRefs: [],
    sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const variantId = product.body.variants[0].id as string;
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    receiptDate: "2026-09-16",
    lines: [{ variantId, quantity, unitCostPiasters: 9_000 }],
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  return { productId: product.body.id as string, variantId };
}

async function seedOrder(manager: Session, suffix: string) {
  const product = await seedPublicProduct(manager, suffix, 1);
  const area = await api(manager, "POST", "/api/internal/delivery-areas", {
    nameAr: `منطقة ${suffix}`,
    feePiasters: 2_500,
    active: true,
  });
  const quote = await publicApi("POST", "/api/public/checkout/quote", {
    deliveryAreaId: area.body.id,
    lines: [{ variantId: product.variantId, quantity: 1 }],
  });
  const submission = {
    operationId: crypto.randomUUID(),
    quoteId: quote.body.quoteId,
    deliveryAreaId: area.body.id,
    lines: [{ variantId: product.variantId, quantity: 1 }],
    customerName: "عميل التحليلات",
    primaryPhone: "01012345678",
    detailedAddress: "عنوان اختبار التحليلات",
  };
  const submitted = await publicApi("POST", "/api/public/checkout/orders", submission);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  return { orderId: submitted.body.orderId as string, variantId: product.variantId, submission };
}

async function createEmployee(manager: Session): Promise<Session> {
  const loginName = `analytics.staff.${crypto.randomUUID().slice(0, 8)}`;
  const created = await api(manager, "POST", "/api/internal/staff", {
    loginName,
    displayName: "موظف التحليلات",
    password: "staff-pass-analytics-1",
    grants: [{ branchId, cashier: true, orderRepresentative: false }],
  });
  expect(created.status).toBe(201);
  const employee = await signIn(loginName, "staff-pass-analytics-1");
  expect((await api(employee, "POST", "/api/internal/active-branch", { branchId })).status).toBe(200);
  return employee;
}
