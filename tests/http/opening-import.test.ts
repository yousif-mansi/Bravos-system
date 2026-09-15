import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";

let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55461 });
}, 120_000);

beforeEach(async () => {
  const databaseName = `bravos_opening_import_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  const outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-opening-import-outbox-"));
  built = await buildApp({
    nodeEnv: "test",
    databaseUrl: cluster.connectionString(databaseName),
    authSecret: "test-secret-test-secret-test-secret-32",
    authBaseUrl: "http://127.0.0.1:3010",
    internalOrigin: INTERNAL_ORIGIN,
    publicOrigin: "http://127.0.0.1:3000",
    trustedOrigins: [INTERNAL_ORIGIN, "http://127.0.0.1:3010"],
    secureCookies: false,
    ownerRecoveryAdapter: "local-outbox",
    ownerRecoveryOutboxDir: outboxDir,
  });
  await ensureOwner(built.services, {
    loginName: "owner",
    displayName: "مالك برافوس",
    password: "owner-pass-1",
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id,code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
});

afterEach(async () => {
  if (built) await built.close();
});

afterAll(async () => {
  if (cluster) await cluster.stop();
});

test("manager receives an immutable preview before accepting opening CSV data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const operationId = crypto.randomUUID();
  const response = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId,
    files: {
      catalog: [
        "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp",
        "category,shirts,قمصان,,,,,,,,,,,,",
        "size,l,كبير,,,,,,,,,,,,",
        "color,black,أسود,,,,,,,,,,,,",
        "product,shirt-1,قميص كلاسيك,,BR-001,قطن,shirts,500.00,available,,, ,,,",
        "variant,shirt-1-l-black,,,,,,,,,,shirt-1,l,black,",
      ].join("\n"),
      stock: [
        "batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
        "old-stock,shirt-1-l-black,2,200.00,2026-08-01,1",
        "new-stock,shirt-1-l-black,3,240.00,2026-09-01,2",
      ].join("\n"),
      configuration: fullConfiguration(),
    },
  });

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    operationId,
    status: "ready",
    counts: { products: 1, variants: 1, batches: 2, openingQuantity: 5 },
    batches: [
      { key: "old-stock", quantity: 2, unitCostPiasters: 20000, batchOrder: 1 },
      { key: "new-stock", quantity: 3, unitCostPiasters: 24000, batchOrder: 2 },
    ],
  });
  expect(response.body.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(response.body.errors).toEqual([]);
  expect(response.body.catalog.products).toEqual([
    expect.objectContaining({ key: "shirt-1", code: "BR-001", nameAr: "قميص كلاسيك", defaultSellingPricePiasters: 50000 }),
  ]);

  const accepted = await api(manager, "POST", `/api/internal/opening-import/previews/${response.body.id}/accept`, {
    operationId,
    previewFingerprint: response.body.previewFingerprint,
  });
  expect(accepted.status).toBe(201);
  expect(accepted.body).toMatchObject({ status: "accepted", operationId, acceptedAt: expect.any(String) });

  const products = await api(manager, "GET", "/api/internal/catalog/products");
  expect(products.body).toEqual([
    expect.objectContaining({ code: "BR-001", defaultSellingPricePiasters: 50000 }),
  ]);
  const batches = await api(manager, "GET", "/api/internal/inventory/batches");
  expect(batches.body).toEqual([
    expect.objectContaining({ receivedQuantity: 2, remainingQuantity: 2, unitCostPiasters: 20000, receiptDate: "2026-08-01" }),
    expect.objectContaining({ receivedQuantity: 3, remainingQuantity: 3, unitCostPiasters: 24000, receiptDate: "2026-09-01" }),
  ]);
  const receipts = await api(manager, "GET", "/api/internal/receiving/receipts");
  expect(receipts.body).toHaveLength(1);
  expect(receipts.body[0].lines).toEqual([
    expect.objectContaining({ quantity: 2, unitCostPiasters: 20000 }),
    expect.objectContaining({ quantity: 3, unitCostPiasters: 24000 }),
  ]);
  const settings = await api(manager, "GET", "/api/internal/inventory/settings");
  expect(settings.body).toEqual({ lowStockThreshold: 3 });
  expect((await api(manager, "GET", "/api/internal/pricing/offers")).body).toEqual(expect.arrayContaining([
    expect.objectContaining({ nameAr: "اشتر 2 وخذ 1", discountType: "buy_x_get_y", buyQuantity: 2, rewardQuantity: 1 }),
    expect.objectContaining({ nameAr: "حزمة قميصين", discountType: "fixed_bundle", bundlePricePiasters: 85000, bundleItems: [expect.objectContaining({ requiredQuantity: 2 })] }),
  ]));
  expect((await api(manager, "GET", "/api/internal/pricing/coupons")).body).toEqual([
    expect.objectContaining({ code: "WELCOME", fixedDiscountPiasters: 2500, usageLimit: 10 }),
  ]);
  expect((await api(manager, "GET", "/api/internal/delivery-areas")).body).toEqual([
    expect.objectContaining({ nameAr: "وسط الفيوم", feePiasters: 5000, active: true }),
  ]);
  expect((await api(manager, "GET", "/api/internal/expense-categories")).body).toEqual([
    expect.objectContaining({ nameAr: "إيجار شهري", active: true }),
  ]);

  const replay = await api(manager, "POST", `/api/internal/opening-import/previews/${response.body.id}/accept`, {
    operationId,
    previewFingerprint: response.body.previewFingerprint,
  });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(accepted.body);
  expect((await api(manager, "GET", "/api/internal/inventory/batches")).body).toHaveLength(2);

  const collisionFiles = validFiles();
  collisionFiles.catalog = collisionFiles.catalog.split("\n")[0];
  collisionFiles.stock = collisionFiles.stock.split("\n")[0];
  collisionFiles.configuration = csv(CONFIG_HEADERS, [
    { record_type: "expense_category", key: "rent-again", name_ar: "إيجار   شهري", active: "true" },
    { record_type: "coupon", key: "welcome-again", name_ar: "welcome", active: "true", discount_type: "fixed", amount_egp: "25.00", starts_on: "2026-09-01", ends_on: "2026-12-31", allow_combination: "true", usage_limit: "10", product_keys: `id:${products.body[0].id}` },
  ]);
  const collision = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId: crypto.randomUUID(),
    files: collisionFiles,
  });
  expect(collision.body.status).toBe("invalid");
  expect(collision.body.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: "configuration.csv", line: 2, column: "name_ar", code: "COLLISION" }),
    expect.objectContaining({ file: "configuration.csv", line: 3, column: "name_ar", code: "COLLISION" }),
  ]));
});

test("invalid quoted CSV reports the physical line and cannot partially import", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const files = validFiles();
  files.catalog = [
    "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp",
    "category,shirts,قمصان,,,,,,,,,,,,",
    "size,l,كبير,,,,,,,,,,,,",
    "color,black,أسود,,,,,,,,,,,,",
    'product,shirt-1,قميص كلاسيك,,BR-001,"وصف أول\nوصف ثان",shirts,500.00,available,,,,,,',
    "unknown,bad,صف غير صالح,,,,,,,,,,,,",
  ].join("\n");
  const operationId = crypto.randomUUID();
  const preview = await api(manager, "POST", "/api/internal/opening-import/previews", { operationId, files });
  expect(preview.status).toBe(201);
  expect(preview.body.status).toBe("invalid");
  expect(preview.body.errors).toContainEqual(expect.objectContaining({ file: "catalog.csv", line: 7, code: "UNKNOWN_RECORD_TYPE" }));

  const accept = await api(manager, "POST", `/api/internal/opening-import/previews/${preview.body.id}/accept`, {
    operationId,
    previewFingerprint: preview.body.previewFingerprint,
  });
  expect(accept.status).toBe(400);
  expect((await api(manager, "GET", "/api/internal/catalog/products")).body).toEqual([]);
  expect((await api(manager, "GET", "/api/internal/inventory/batches")).body).toEqual([]);
});

test("preview rejects invalid owning-feature configuration and preserves explicit-reference provenance", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const files = validFiles();
  files.catalog = files.catalog.split("\n")[0];
  files.stock = [
    "batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
    "",
    "",
    "",
    "",
    "",
    "missing-stock,id:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,1,10.00,2026-02-28,1",
    "bad-date,id:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb,1,10.00,2026-02-30,2",
  ].join("\n");
  files.configuration = csv(CONFIG_HEADERS, [
    { record_type: "delivery_area", key: "long-area", name_ar: "م".repeat(121), fee_egp: "10.00", active: "true" },
    { record_type: "storefront_contact", key: "whatsapp", value: "http://example.com/not-whatsapp" },
    { record_type: "online_order_settings", key: "policy", value: "48", usage_limit: "101" },
  ]);

  const preview = await api(manager, "POST", "/api/internal/opening-import/previews", {
    operationId: crypto.randomUUID(),
    files,
  });

  expect(preview.status).toBe(201);
  expect(preview.body.status).toBe("invalid");
  expect(preview.body.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: "opening-stock.csv", line: 7, column: "variant_key", code: "UNKNOWN_REFERENCE" }),
    expect.objectContaining({ file: "opening-stock.csv", line: 8, column: "receipt_date", code: "INVALID_DATE" }),
    expect.objectContaining({ file: "configuration.csv", line: 2, column: "name_ar", code: "INVALID_VALUE" }),
    expect.objectContaining({ file: "configuration.csv", line: 3, column: "value", code: "INVALID_VALUE" }),
    expect.objectContaining({ file: "configuration.csv", line: 4, column: "value", code: "INVALID_VALUE" }),
  ]));
});

test("catalog collisions and post-preview state changes block acceptance without overwrite", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const operationId = crypto.randomUUID();
  const preview = await api(manager, "POST", "/api/internal/opening-import/previews", { operationId, files: validFiles() });
  expect(preview.body.status).toBe("ready");

  const existing = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "جاكيتات" });
  expect(existing.status).toBe(201);
  const stale = await api(manager, "POST", `/api/internal/opening-import/previews/${preview.body.id}/accept`, {
    operationId,
    previewFingerprint: preview.body.previewFingerprint,
  });
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe("OPENING_IMPORT_STALE");
  expect((await api(manager, "GET", "/api/internal/catalog/products")).body).toEqual([]);

  await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "قمصان" });
  const collision = await api(manager, "POST", "/api/internal/opening-import/previews", { operationId: crypto.randomUUID(), files: validFiles() });
  expect(collision.body.status).toBe("invalid");
  expect(collision.body.errors).toContainEqual(expect.objectContaining({ code: "COLLISION", column: "name_ar" }));
});

test("manager can import opening batches for an explicitly referenced existing variant", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const category = await api(manager,"POST","/api/internal/catalog/categories",{nameAr:"بنطلونات"});
  const size = await api(manager,"POST","/api/internal/catalog/sizes",{nameAr:"32"});
  const color = await api(manager,"POST","/api/internal/catalog/colors",{nameAr:"كحلي"});
  const product = await api(manager,"POST","/api/internal/catalog/products",{code:"TR-1",nameAr:"بنطلون",descriptionAr:"",categoryId:category.body.id,defaultSellingPricePiasters:60000,publication:"hidden",imageRefs:[],sizeGuideAr:null,variants:[{sizeId:size.body.id,colorId:color.body.id,sellingPricePiastersOverride:null}]});
  const variantId = product.body.variants[0].id;
  const files = validFiles();
  files.catalog = files.catalog.split("\n")[0];
  files.stock = `batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order\nmanual-stock,id:${variantId.toUpperCase()},4,300.00,2026-09-01,1`;
  files.configuration = files.configuration.split("\n")[0];
  const operationId=crypto.randomUUID();
  const preview=await api(manager,"POST","/api/internal/opening-import/previews",{operationId,files});
  expect(preview.body).toMatchObject({status:"ready",counts:{products:0,variants:0,batches:1,openingQuantity:4}});
  const accepted=await api(manager,"POST",`/api/internal/opening-import/previews/${preview.body.id}/accept`,{operationId,previewFingerprint:preview.body.previewFingerprint});
  expect(accepted.status).toBe(201);
  expect((await api(manager,"GET","/api/internal/inventory/batches")).body).toEqual([expect.objectContaining({variantId,receivedQuantity:4,unitCostPiasters:30000})]);
});

test("employees cannot preview, accept, or download cost-bearing opening import data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager,"POST","/api/internal/staff",{loginName:"cashier.import",displayName:"موظف",password:"staff-pass-import-1",grants:[{branchId:abshwayId,cashier:true,orderRepresentative:false}]});
  const employee=await signIn("cashier.import","staff-pass-import-1");
  const denied=await api(employee,"POST","/api/internal/opening-import/previews",{operationId:crypto.randomUUID(),files:validFiles()});
  expect(denied.status).toBe(403);
  const template=await built.app.inject({method:"GET",url:"/api/internal/opening-import/templates/opening-stock.csv",headers:{origin:INTERNAL_ORIGIN,cookie:employee.cookie}});
  expect(template.statusCode).toBe(403);
});

type CookieSession = { cookie: string };

async function signIn(username: string, password: string): Promise<CookieSession> {
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

async function api(session: CookieSession, method: "GET" | "POST", url: string, payload?: unknown) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session.cookie,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    payload,
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

function validFiles() {
  return {
    catalog: [
      "record_type,key,name_ar,parent_key,product_code,description_ar,category_key,default_price_egp,publication,image_refs,size_guide_ar,product_key,size_key,color_key,price_override_egp",
      "category,shirts,قمصان,,,,,,,,,,,,",
      "size,l,كبير,,,,,,,,,,,,",
      "color,black,أسود,,,,,,,,,,,,",
      "product,shirt-1,قميص كلاسيك,,BR-001,قطن,shirts,500.00,available,,,,,,",
      "variant,shirt-1-l-black,,,,,,,,,,shirt-1,l,black,",
    ].join("\n"),
    stock: [
      "batch_key,variant_key,quantity,unit_cost_egp,receipt_date,batch_order",
      "old-stock,shirt-1-l-black,2,200.00,2026-08-01,1",
      "new-stock,shirt-1-l-black,3,240.00,2026-09-01,2",
    ].join("\n"),
    configuration: fullConfiguration(),
  };
}

const CONFIG_HEADERS = ["record_type","key","name_ar","value","variant_key","fee_egp","active","discount_type","percentage","amount_egp","starts_on","ends_on","allow_combination","usage_limit","product_keys","category_keys","buy_quantity","reward_quantity","reward_percentage","bundle_total_egp","offer_key","required_quantity","buy_product_keys","buy_category_keys","reward_product_keys","reward_category_keys"] as const;

function fullConfiguration() {
  return csv(CONFIG_HEADERS, [
    { record_type: "inventory_default_threshold", key: "default", value: "3" },
    { record_type: "expense_category", key: "rent", name_ar: "إيجار شهري", active: "true" },
    { record_type: "delivery_area", key: "fayoum-center", name_ar: "وسط الفيوم", fee_egp: "50.00", active: "true" },
    { record_type: "storefront_contact", key: "whatsapp", value: "https://wa.me/201000000000" },
    { record_type: "online_order_settings", key: "unreachable-policy", value: "48", usage_limit: "2" },
    { record_type: "automatic_offer", key: "two-shirts", name_ar: "حزمة قميصين", active: "true", discount_type: "fixed_bundle", starts_on: "2026-09-01", ends_on: "2026-12-31", allow_combination: "true", bundle_total_egp: "850.00" },
    { record_type: "bundle_item", key: "two-shirts-item", variant_key: "shirt-1-l-black", offer_key: "two-shirts", required_quantity: "2" },
    { record_type: "automatic_offer", key: "bogo", name_ar: "اشتر 2 وخذ 1", active: "true", discount_type: "buy_x_get_y", starts_on: "2026-09-01", ends_on: "2026-12-31", allow_combination: "true", buy_quantity: "2", reward_quantity: "1", reward_percentage: "100", buy_product_keys: "shirt-1", reward_product_keys: "shirt-1" },
    { record_type: "coupon", key: "welcome", name_ar: "WELCOME", active: "true", discount_type: "fixed", amount_egp: "25.00", starts_on: "2026-09-01", ends_on: "2026-12-31", allow_combination: "true", usage_limit: "10", product_keys: "shirt-1" },
  ]);
}

function csv(headers: readonly string[], rows: Array<Record<string, string>>) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => quoteCsv(row[header] ?? "")).join(","))].join("\n");
}

function quoteCsv(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
