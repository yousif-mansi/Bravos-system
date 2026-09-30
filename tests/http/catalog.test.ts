import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { applyMigrations } from "@bravos/persistence";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";

let cluster: PostgresCluster;
let databaseName = "bravos_catalog_1";
let outboxDir: string;
let mediaDir: string;
let built: BuiltApp;
let abshwayId = "";
let fayoumId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55438 });
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

test("manager creates a product with unique code, taxonomy, variants and default EGP price", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const category = await api(manager, "POST", "/api/internal/catalog/categories", {
    nameAr: "تيشيرتات",
  });
  expect(category.status).toBe(201);
  expect(category.body).toMatchObject({ nameAr: "تيشيرتات", parentId: null });

  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  expect(size.status).toBe(201);
  expect(color.status).toBe(201);

  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: category.body.id,
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      {
        sizeId: size.body.id,
        colorId: color.body.id,
        sellingPricePiastersOverride: null,
      },
    ],
  });

  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
  });
  expect(created.body.variants).toHaveLength(1);
  expect(created.body.variants[0]).toMatchObject({
    sellingPricePiastersOverride: null,
    sellingPricePiasters: 25000,
    size: { nameAr: "L" },
    color: { nameAr: "أسود" },
  });
  expect(created.body).not.toHaveProperty("availableQuantity");
  expect(created.body.variants[0]).not.toHaveProperty("availableQuantity");
  expect(created.body).not.toHaveProperty("branchPrice");
  expect(created.body).not.toHaveProperty("websitePrice");
  expect(JSON.stringify(created.body)).not.toMatch(/cost|profit|purchase|batch/i);
});

test("online variant selection keeps exact inventory pairs and leaves hidden pairs in POS", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedTaxonomy(manager);
  const secondSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "PAIR-VIS-1",
    nameAr: "قميص بتركيبتين",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    publication: "available",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, onlineVisible: false, sellingPricePiastersOverride: null },
      { sizeId: secondSize.body.id, colorId: seed.colorId, onlineVisible: true, sellingPricePiastersOverride: 32000 },
    ],
  });
  expect(created.status).toBe(201);
  expect(created.body.variants).toHaveLength(2);
  const hidden = created.body.variants.find((item: { size: { id: string } }) => item.size.id === seed.sizeId);
  const visible = created.body.variants.find((item: { size: { id: string } }) => item.size.id === secondSize.body.id);
  expect(hidden?.onlineVisible).toBe(false);
  expect(visible?.onlineVisible).toBe(true);
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-29",
    lines: [
      { variantId: hidden.id, quantity: 2, unitCostPiasters: 10000 },
      { variantId: visible.id, quantity: 3, unitCostPiasters: 11000 },
    ],
  });
  expect(received.status).toBe(201);
  const publicProduct = await api(undefined, "GET", `/api/public/catalog/products/${created.body.id}`);
  expect(publicProduct.status).toBe(200);
  expect(publicProduct.body.variants.map((item: { id: string }) => item.id)).toEqual([visible.id]);
  expect(publicProduct.body.variants[0].availableQuantity).toBe(3);
  const pos = await api(manager, "GET", "/api/internal/catalog/pos-snapshot");
  const posProduct = pos.body.find((item: { id: string }) => item.id === created.body.id);
  expect(posProduct.variants).toHaveLength(2);
  expect(posProduct.variants.find((item: { id: string }) => item.id === hidden.id).availableQuantity).toBe(2);

  const edited = await api(manager, "PATCH", `/api/internal/catalog/products/${created.body.id}`, {
    code: created.body.code,
    nameAr: created.body.nameAr,
    descriptionAr: created.body.descriptionAr,
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    publication: "available",
    imageRefs: [],
    variants: created.body.variants.map((item: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({ sizeId: item.size.id, colorId: item.color.id, sellingPricePiastersOverride: item.sellingPricePiastersOverride })),
  });
  expect(edited.status).toBe(200);
  expect(edited.body.variants.find((item: { id: string }) => item.id === hidden.id).onlineVisible).toBe(false);
});

test("a stale product edit cannot remove a variant just added through inventory intake", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedTaxonomy(manager);
  const secondSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  const initial = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "SKU-RACE-1", nameAr: "منتج", descriptionAr: "", categoryId: seed.categoryId,
    defaultSellingPricePiasters: 20000, publication: "hidden", imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, onlineVisible: false, sellingPricePiastersOverride: null }],
  });
  expect(initial.status).toBe(201);
  const base = {
    code: initial.body.code,
    nameAr: initial.body.nameAr,
    descriptionAr: initial.body.descriptionAr,
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: initial.body.defaultSellingPricePiasters,
    publication: initial.body.publication,
    imageRefs: initial.body.imageRefs,
    sizeGuideAr: initial.body.sizeGuideAr,
    expectedRevision: initial.body.editRevision,
    expectedVariantIds: initial.body.variants.map((item: { id: string }) => item.id),
  };
  const added = await api(manager, "PATCH", `/api/internal/catalog/products/${initial.body.id}`, {
    ...base,
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, onlineVisible: false, sellingPricePiastersOverride: null },
      { sizeId: secondSize.body.id, colorId: seed.colorId, onlineVisible: false, sellingPricePiastersOverride: null },
    ],
  });
  expect(added.status).toBe(200);
  expect(added.body.editRevision).toBe(initial.body.editRevision + 1);

  const stale = await api(manager, "PATCH", `/api/internal/catalog/products/${initial.body.id}`, {
    ...base,
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, onlineVisible: true, sellingPricePiastersOverride: null }],
  });
  expect(stale.status).toBe(400);
  expect(stale.body.error.messageAr).toContain("أعد تحميل");
  const current = await api(manager, "GET", `/api/internal/catalog/products/${initial.body.id}`);
  expect(current.body.variants).toHaveLength(2);
  expect(current.body.variants.every((item: { onlineVisible: boolean }) => item.onlineVisible === false)).toBe(true);
});

test("duplicate product codes are rejected case-insensitively with a useful error", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const duplicate = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "ts-001",
    nameAr: "تيشيرت آخر",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 20000,
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe("DUPLICATE_PRODUCT_CODE");
  expect(duplicate.body.error.messageAr).toBe("رمز المنتج مستخدم بالفعل.");
  expect(duplicate.status).toBeLessThan(500);
});

test("invalid taxonomy and variant combinations fail with useful validation errors", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const missingSize = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-002",
    nameAr: "قميص",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    variants: [
      {
        sizeId: "99999999-9999-4999-8999-999999999999",
        colorId: seed.colorId,
        sellingPricePiastersOverride: null,
      },
    ],
  });
  expect(missingSize.status).toBe(400);
  expect(missingSize.body.error.code).toBe("VALIDATION");
  expect(missingSize.body.error.messageAr).toBe("المقاس المحدد غير موجود.");

  const repeated = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-003",
    nameAr: "قميص مكرر",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 31000 },
    ],
  });
  expect(repeated.status).toBe(400);
  expect(repeated.body.error.code).toBe("VALIDATION");
  expect(repeated.body.error.messageAr).toBe("لا يمكن تكرار نفس المقاس واللون.");

  const nestedParent = await api(manager, "POST", "/api/internal/catalog/categories", {
    nameAr: "صيف",
    parentId: seed.categoryId,
  });
  expect(nestedParent.status).toBe(201);
  const tooDeep = await api(manager, "POST", "/api/internal/catalog/categories", {
    nameAr: "أعمق",
    parentId: nestedParent.body.id,
  });
  expect(tooDeep.status).toBe(400);
  expect(tooDeep.body.error.code).toBe("VALIDATION");
  expect(tooDeep.body.error.messageAr).toBe("التصنيف الفرعي يجب أن يتبع تصنيفاً رئيسياً.");

  const extraStock = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-004",
    nameAr: "مخزون مزيف",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 10000,
    availableQuantity: 12,
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(extraStock.status).toBe(400);
  expect(extraStock.body.error.code).toBe("VALIDATION");

  const negative = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-005",
    nameAr: "سعر سالب",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: -1,
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  expect(negative.status).toBe(400);
  expect(negative.body.error.code).toBe("VALIDATION");
  expect(negative.body.error.messageAr).toBe("سعر البيع غير صالح.");
});

test("variant price override is used and the default remains the shared listed price otherwise", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const secondColor = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض" });
  expect(secondColor.status).toBe(201);
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "TS-PRICE",
    nameAr: "تيشيرت سعرين",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 25000,
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
      { sizeId: seed.sizeId, colorId: secondColor.body.id, sellingPricePiastersOverride: 27500 },
    ],
  });
  expect(created.status).toBe(201);
  const byName = new Map(
    created.body.variants.map((variant: { color: { nameAr: string }; sellingPricePiasters: number; sellingPricePiastersOverride: number | null }) => [
      variant.color.nameAr,
      variant,
    ]),
  );
  expect(byName.get("أسود")).toMatchObject({
    sellingPricePiastersOverride: null,
    sellingPricePiasters: 25000,
  });
  expect(byName.get("أبيض")).toMatchObject({
    sellingPricePiastersOverride: 27500,
    sellingPricePiasters: 27500,
  });
  expect(created.body).not.toHaveProperty("branchPrice");
  expect(created.body).not.toHaveProperty("websitePrice");
  expect(JSON.stringify(created.body)).not.toContain("abshway");
  expect(JSON.stringify(created.body)).not.toContain(fayoumId);
});

test("manager can edit taxonomy, product details, publication and variants", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  const renamed = await api(manager, "PATCH", `/api/internal/catalog/categories/${seed.categoryId}`, {
    nameAr: "قمصان",
  });
  expect(renamed.status).toBe(200);
  expect(renamed.body.nameAr).toBe("قمصان");
  const size = await api(manager, "PATCH", `/api/internal/catalog/sizes/${seed.sizeId}`, { nameAr: "XL" });
  expect(size.status).toBe(200);
  expect(size.body.nameAr).toBe("XL");
  const color = await api(manager, "PATCH", `/api/internal/catalog/colors/${seed.colorId}`, { nameAr: "كحلي" });
  expect(color.status).toBe(200);
  expect(color.body.nameAr).toBe("كحلي");

  const extraSize = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "M" });
  const updated = await api(manager, "PATCH", `/api/internal/catalog/products/${seed.productId}`, {
    code: "TS-001",
    nameAr: "تيشيرت محدث",
    descriptionAr: "وصف جديد",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 26000,
    publication: "coming_soon",
    imageRefs: ["products/ts-001.jpg"],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 28000 },
      { sizeId: extraSize.body.id, colorId: seed.colorId, sellingPricePiastersOverride: null },
    ],
  });
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({
    nameAr: "تيشيرت محدث",
    descriptionAr: "وصف جديد",
    defaultSellingPricePiasters: 26000,
    publication: "coming_soon",
    imageRefs: ["products/ts-001.jpg"],
  });
  expect(updated.body.variants).toHaveLength(2);
  expect(updated.body.category.nameAr).toBe("قمصان");
});

test("cashier lookup selects an explicit variant, ignores website visibility, and stays unstocked", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedShirt(manager, { publication: "hidden" });
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.lookup",
    displayName: "كاشير البحث",
    password: "staff-pass-20",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.lookup", "staff-pass-20");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const found = await api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-001")}`);
  expect(found.status).toBe(200);
  expect(found.body).toMatchObject({
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
  });
  expect(found.body.variants).toHaveLength(1);
  expect(found.body.variants[0]).toEqual({
    id: expect.any(String),
    size: { id: seed.sizeId, nameAr: "L" },
    color: { id: seed.colorId, nameAr: "أسود" },
    sellingPricePiasters: 25000,
    availableQuantity: 0,
  });
  expect(found.body).not.toHaveProperty("publication");
  expect(found.body).not.toHaveProperty("imageRefs");
  expect(found.body).not.toHaveProperty("changedByStaffId");
  expect(found.body).not.toHaveProperty("cost");
  expect(JSON.stringify(found.body)).not.toMatch(/cost|profit|purchase|batch|inventoryValue/i);
  const keys = Object.keys(found.body).sort();
  expect(keys).toEqual(["categoryId", "code", "descriptionAr", "id", "nameAr", "variants"]);
  expect(found.body.categoryId).toBe(seed.categoryId);
});

test("cashier POS snapshot lists selling prices and availability without cost data", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedTaxonomy(manager);
  const created = await api(manager, "POST", "/api/internal/catalog/products", productWrite(seed));
  expect(created.status).toBe(201);
  const variantId = created.body.variants[0].id as string;
  const received = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-11",
    lines: [{ variantId, quantity: 4, unitCostPiasters: 8000 }],
  });
  expect(received.status).toBe(201);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.snapshot",
    displayName: "كاشير اللقطة",
    password: "staff-pass-40",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.snapshot", "staff-pass-40");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const snapshot = await api(cashier, "GET", "/api/internal/catalog/pos-snapshot");
  expect(snapshot.status).toBe(200);
  expect(snapshot.body).toHaveLength(1);
  expect(snapshot.body[0]).toMatchObject({
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
  });
  expect(snapshot.body[0].variants[0]).toEqual({
    id: variantId,
    size: { id: seed.sizeId, nameAr: "L" },
    color: { id: seed.colorId, nameAr: "أسود" },
    sellingPricePiasters: 25000,
    availableQuantity: 4,
  });
  expect(JSON.stringify(snapshot.body)).not.toMatch(/cost|profit|purchase|batch|inventoryValue|unitCost/i);

  const batches = await api(cashier, "GET", "/api/internal/inventory/batches");
  expect(batches.status).toBe(403);

  const noBranch = await signIn("cashier.snapshot", "staff-pass-40");
  const denied = await api(noBranch, "GET", "/api/internal/catalog/pos-snapshot");
  expect(denied.status).toBe(403);
});

test("concurrent duplicate product creates keep a precise duplicate-code error", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedTaxonomy(manager);
  const payload = productWrite(seed, { code: "RACE-1" });
  const [first, second] = await Promise.all([
    api(manager, "POST", "/api/internal/catalog/products", payload),
    api(manager, "POST", "/api/internal/catalog/products", payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([201, 409]);
  const rejected = first.status === 409 ? first : second;
  expect(rejected.body.error.code).toBe("DUPLICATE_PRODUCT_CODE");
  expect(rejected.body.error.messageAr).toBe("رمز المنتج مستخدم بالفعل.");
  expect(rejected.status).toBeLessThan(500);
  const listed = await api(manager, "GET", "/api/internal/catalog/products");
  expect(listed.status).toBe(200);
  expect(listed.body).toHaveLength(1);
  expect(listed.body[0].code).toBe("RACE-1");
});

test("duplicate taxonomy names fail with useful validation errors", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const first = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  expect(first.status).toBe(201);
  const duplicate = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  expect(duplicate.status).toBe(400);
  expect(duplicate.body.error.code).toBe("VALIDATION");
  expect(duplicate.body.error.messageAr).toBe("اسم التصنيف مستخدم بالفعل.");
  expect(duplicate.status).toBeLessThan(500);
});

test("concurrent product creates at the pool limit complete atomically", async () => {
  await startApp({ databasePoolMax: 2 });
  expect(built.pool.options.max).toBe(2);
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedTaxonomy(manager);
  const writes = [
    productWrite(seed, { code: "POOL-A", nameAr: "تيشيرت أ" }),
    productWrite(seed, { code: "POOL-B", nameAr: "تيشيرت ب" }),
    productWrite(seed, { code: "POOL-C", nameAr: "تيشيرت ج" }),
    productWrite(seed, { code: "POOL-D", nameAr: "تيشيرت د" }),
  ];
  const created = await Promise.all(
    writes.map((payload) => api(manager, "POST", "/api/internal/catalog/products", payload)),
  );
  expect(created.map((item) => item.status)).toEqual([201, 201, 201, 201]);
  expect(created.map((item) => item.body.code).sort()).toEqual(["POOL-A", "POOL-B", "POOL-C", "POOL-D"]);
  expect(created.every((item) => item.body.variants.length === 1)).toBe(true);
  const listed = await api(manager, "GET", "/api/internal/catalog/products");
  expect(listed.status).toBe(200);
  expect(listed.body.map((item: { code: string }) => item.code).sort()).toEqual([
    "POOL-A",
    "POOL-B",
    "POOL-C",
    "POOL-D",
  ]);
  expect(listed.body.every((item: { variants: unknown[] }) => item.variants.length === 1)).toBe(true);
}, 20_000);

test("catalog reads never mix default and override prices from different writes", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const seed = await seedTaxonomy(manager);
  const created = await api(
    manager,
    "POST",
    "/api/internal/catalog/products",
    productWrite(seed, {
      code: "TS-SNAP",
      defaultSellingPricePiasters: 25000,
      variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: 27500 }],
    }),
  );
  expect(created.status).toBe(201);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.snap",
    displayName: "كاشير الاتساق",
    password: "staff-pass-22",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.snap", "staff-pass-22");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const update = api(manager, "PATCH", `/api/internal/catalog/products/${created.body.id}`, {
    code: "TS-SNAP",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 30000,
    publication: "hidden",
    imageRefs: [],
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  });
  const managerReads = Array.from({ length: 20 }, () =>
    api(manager, "GET", `/api/internal/catalog/products/${created.body.id}`),
  );
  const cashierReads = Array.from({ length: 20 }, () =>
    api(cashier, "GET", `/api/internal/catalog/lookup?code=${encodeURIComponent("TS-SNAP")}`),
  );
  const [updated, ...reads] = await Promise.all([update, ...managerReads, ...cashierReads]);
  expect(updated.status).toBe(200);
  expect(updated.body).toMatchObject({
    defaultSellingPricePiasters: 30000,
    variants: [{ sellingPricePiastersOverride: null, sellingPricePiasters: 30000 }],
  });

  const consistentManager = new Set(["25000:27500:27500", "30000:null:30000"]);
  for (const read of reads.slice(0, 20)) {
    expect(read.status).toBe(200);
    const variant = read.body.variants[0];
    const snapshot = `${read.body.defaultSellingPricePiasters}:${String(variant.sellingPricePiastersOverride)}:${variant.sellingPricePiasters}`;
    expect(consistentManager.has(snapshot)).toBe(true);
  }
  for (const read of reads.slice(20)) {
    expect(read.status).toBe(200);
    expect([27500, 30000]).toContain(read.body.variants[0].sellingPricePiasters);
    expect(read.body.variants[0].sellingPricePiasters).not.toBe(25000);
  }
});

test("unauthorized catalog writes and cashier-only lookup are denied at the HTTP boundary", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedShirt(manager);
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.denied",
    displayName: "كاشير بلا صيانة",
    password: "staff-pass-21",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.denied", "staff-pass-21");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });

  const write = await api(cashier, "POST", "/api/internal/catalog/products", {
    code: "HACK-1",
    nameAr: "تجاوز",
    descriptionAr: "",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 1000,
    variants: [{ sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null }],
  }, { extraHeaders: { "x-role": "manager" } });
  expect(write.status).toBe(403);
  expect(write.body.error.code).toBe("FORBIDDEN");
  expect(write.status).toBeLessThan(500);

  const list = await api(cashier, "GET", "/api/internal/catalog/products");
  expect(list.status).toBe(403);

  const unauthenticated = await api(undefined, "POST", "/api/internal/catalog/categories", { nameAr: "ممنوع" });
  expect(unauthenticated.status).toBe(401);

  const noBranch = await signIn("cashier.denied", "staff-pass-21");
  const lookupWithoutBranch = await api(noBranch, "GET", "/api/internal/catalog/lookup?code=TS-001");
  expect(lookupWithoutBranch.status).toBe(403);
});

test("manager uploads validated local media while active content and employee uploads are rejected", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.media",
    displayName: "موظف الصور",
    password: "staff-pass-media-1",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.media", "staff-pass-media-1");

  const denied = await api(cashier, "POST", "/api/internal/catalog/media", {
    fileName: "shirt.png",
    contentType: "image/png",
    base64: PNG_BASE64,
  });
  expect(denied.status).toBe(403);
  expect(denied.body.error.code).toBe("FORBIDDEN");

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
  const activeContent = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "unsafe.svg",
    contentType: "image/svg+xml",
    base64: svg,
  });
  expect(activeContent.status).toBe(400);
  expect(activeContent.body).toEqual({
    error: {
      code: "VALIDATION",
      messageAr: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.",
    },
  });

  const oversizedBytes = Buffer.alloc(5 * 1024 * 1024 + 1);
  Buffer.from(PNG_BASE64, "base64").copy(oversizedBytes, 0, 0, 12);
  const oversized = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "too-large.png",
    contentType: "image/png",
    base64: oversizedBytes.toString("base64"),
  });
  expect(oversized.status).toBe(400);
  expect(oversized.body.error).toEqual({
    code: "VALIDATION",
    messageAr: "حجم الصورة غير صالح. الحد الأقصى 5 ميجابايت.",
  });

  const broken = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "broken.png",
    contentType: "image/png",
    base64: Buffer.concat([Buffer.from(PNG_BASE64, "base64").subarray(0, 12), Buffer.alloc(12)]).toString("base64"),
  });
  expect(broken.status).toBe(400);
  expect(broken.body.error).toEqual({
    code: "VALIDATION",
    messageAr: "ملف الصورة تالف أو غير قابل للقراءة.",
  });

  const excessiveDimensions = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "too-wide.png",
    contentType: "image/png",
    base64: makePng(8_001, 1).toString("base64"),
  });
  expect(excessiveDimensions.status).toBe(400);
  expect(excessiveDimensions.body.error).toEqual({
    code: "VALIDATION",
    messageAr: "أبعاد الصورة غير صالحة. الحد الأقصى 8000 بكسل للعرض أو الارتفاع و20 مليون بكسل إجمالاً.",
  });

  const uploaded = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "shirt.png",
    contentType: "image/png",
    base64: PNG_BASE64,
  });
  expect(uploaded.status).toBe(201);
  expect(uploaded.body).toMatchObject({ contentType: "image/png", byteLength: 68 });
  expect(uploaded.body.ref).toMatch(/^products\/[0-9a-f-]+\.png$/);

  const beforeAttachment = await publicRaw("GET", `/api/public/catalog/media/${uploaded.body.ref}`);
  expect(beforeAttachment.statusCode).toBe(404);
  const managerRead = await internalRaw(manager, `/api/internal/catalog/media/${uploaded.body.ref}`);
  expect(managerRead.statusCode).toBe(200);
  expect(managerRead.headers["content-type"]).toBe("image/png");
  expect(managerRead.headers["x-content-type-options"]).toBe("nosniff");
  expect(managerRead.rawPayload).toEqual(Buffer.from(PNG_BASE64, "base64"));
  const cashierRead = await internalRaw(cashier, `/api/internal/catalog/media/${uploaded.body.ref}`);
  expect(cashierRead.statusCode).toBe(403);
  expect(cashierRead.json().error.code).toBe("FORBIDDEN");
});

test("public catalog exposes safe live variant availability across restocking and publication changes", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const seed = await seedTaxonomy(manager);
  const white = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أبيض" });
  const uploaded = await api(manager, "POST", "/api/internal/catalog/media", {
    fileName: "public-shirt.png",
    contentType: "image/png",
    base64: PNG_BASE64,
  });
  const created = await api(manager, "POST", "/api/internal/catalog/products", {
    code: "PUBLIC-17",
    nameAr: "قميص صيفي",
    descriptionAr: "قماش قطني خفيف",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 32000,
    publication: "available",
    imageRefs: [uploaded.body.ref],
    sizeGuideAr: "L — عرض الصدر 52 سم",
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
      { sizeId: seed.sizeId, colorId: white.body.id, sellingPricePiastersOverride: 34000 },
    ],
  });
  expect(created.status).toBe(201);

  const initial = await api(undefined, "GET", `/api/public/catalog/products/${created.body.id}`);
  expect(initial.status).toBe(200);
  expect(initial.body).toMatchObject({
    id: created.body.id,
    nameAr: "قميص صيفي",
    publication: "available",
    availability: "out_of_stock",
    orderable: false,
    imageRefs: [uploaded.body.ref],
    sizeGuideAr: "L — عرض الصدر 52 سم",
  });
  expect(Object.keys(initial.body).sort()).toEqual([
    "availability", "category", "descriptionAr", "id", "imageRefs", "nameAr",
    "orderable", "publication", "sizeGuideAr", "variants",
  ]);
  expect(Object.keys(initial.body.variants[0]).sort()).toEqual([
    "availableQuantity", "color", "id", "orderable", "sellingPricePiasters", "size",
  ]);
  expect(Object.keys(initial.body.category).sort()).toEqual(["id", "nameAr"]);
  expect(initial.body).not.toHaveProperty("code");
  expect(initial.body).not.toHaveProperty("changedByStaffId");
  expect(initial.body.variants[0]).not.toHaveProperty("sellingPricePiastersOverride");
  expect(JSON.stringify(initial.body)).not.toMatch(/unitCostPiasters|profit|staffId|session|batch|receipt|sale/i);
  const initialList = await api(undefined, "GET", "/api/public/catalog/products");
  expect(initialList.status).toBe(200);
  expect(initialList.body.find((product: { id: string }) => product.id === created.body.id)).toMatchObject({
    availability: "out_of_stock",
    orderable: false,
  });

  const stockedVariant = created.body.variants.find(
    (variant: { color: { nameAr: string } }) => variant.color.nameAr === "أسود",
  );
  const emptyVariant = created.body.variants.find(
    (variant: { color: { nameAr: string } }) => variant.color.nameAr === "أبيض",
  );
  if (!stockedVariant || !emptyVariant) {
    throw new Error("Expected the two public catalog variants.");
  }
  const receipt = await api(manager, "POST", "/api/internal/receiving/receipts", {
    operationId: crypto.randomUUID(),
    branchId: abshwayId,
    receiptDate: "2026-09-14",
    lines: [{ variantId: stockedVariant.id, quantity: 3, unitCostPiasters: 17000 }],
  });
  expect(receipt.status).toBe(201);

  const restocked = await api(undefined, "GET", `/api/public/catalog/products/${created.body.id}`);
  expect(restocked.body).toMatchObject({ availability: "in_stock", orderable: true });
  expect(restocked.body.variants.find((item: { id: string }) => item.id === stockedVariant.id)).toMatchObject({
    availableQuantity: 3,
    orderable: true,
    sellingPricePiasters: 32000,
  });
  expect(restocked.body.variants.find((item: { id: string }) => item.id === emptyVariant.id)).toMatchObject({
    availableQuantity: 0,
    orderable: false,
    sellingPricePiasters: 34000,
  });
  const publicImage = await publicRaw("GET", `/api/public/catalog/media/${uploaded.body.ref}`);
  expect(publicImage.statusCode).toBe(200);
  expect(publicImage.headers["content-type"]).toBe("image/png");
  expect(publicImage.headers["cache-control"]).toBe("no-store");

  const comingSoon = await api(manager, "PATCH", `/api/internal/catalog/products/${created.body.id}`, {
    code: created.body.code,
    nameAr: created.body.nameAr,
    descriptionAr: created.body.descriptionAr,
    categoryId: created.body.category.id,
    defaultSellingPricePiasters: created.body.defaultSellingPricePiasters,
    publication: "coming_soon",
    imageRefs: created.body.imageRefs,
    sizeGuideAr: created.body.sizeGuideAr,
    variants: created.body.variants.map((variant: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(comingSoon.status).toBe(200);
  const preview = await api(undefined, "GET", `/api/public/catalog/products/${created.body.id}`);
  expect(preview.body).toMatchObject({ availability: "coming_soon", orderable: false });
  expect(preview.body.variants.every((variant: { orderable: boolean }) => !variant.orderable)).toBe(true);

  const hidden = await api(manager, "PATCH", `/api/internal/catalog/products/${created.body.id}`, {
    ...comingSoon.body,
    categoryId: comingSoon.body.category.id,
    publication: "hidden",
    variants: comingSoon.body.variants.map((variant: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(hidden.status).toBe(400);
  // Manager responses contain derived/read-only fields, so submit only the accepted write shape.
  const hiddenWrite = await api(manager, "PATCH", `/api/internal/catalog/products/${created.body.id}`, {
    code: comingSoon.body.code,
    nameAr: comingSoon.body.nameAr,
    descriptionAr: comingSoon.body.descriptionAr,
    categoryId: comingSoon.body.category.id,
    defaultSellingPricePiasters: comingSoon.body.defaultSellingPricePiasters,
    publication: "hidden",
    imageRefs: comingSoon.body.imageRefs,
    sizeGuideAr: comingSoon.body.sizeGuideAr,
    variants: comingSoon.body.variants.map((variant: { size: { id: string }; color: { id: string }; sellingPricePiastersOverride: number | null }) => ({
      sizeId: variant.size.id,
      colorId: variant.color.id,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })),
  });
  expect(hiddenWrite.status).toBe(200);
  expect((await api(undefined, "GET", `/api/public/catalog/products/${created.body.id}`)).status).toBe(404);
  const hiddenList = await api(undefined, "GET", "/api/public/catalog/products");
  expect(hiddenList.status).toBe(200);
  expect(hiddenList.body.find((product: { id: string }) => product.id === created.body.id)).toBeUndefined();
  expect((await publicRaw("GET", `/api/public/catalog/media/${uploaded.body.ref}`)).statusCode).toBe(404);

  await api(manager, "POST", "/api/internal/staff", {
    loginName: "cashier.publication",
    displayName: "كاشير النشر",
    password: "staff-pass-publication-1",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const cashier = await signIn("cashier.publication", "staff-pass-publication-1");
  await api(cashier, "POST", "/api/internal/active-branch", { branchId: abshwayId });
  const pos = await api(cashier, "GET", "/api/internal/catalog/lookup?code=PUBLIC-17");
  expect(pos.status).toBe(200);
  expect(pos.body.variants.find((variant: { id: string }) => variant.id === stockedVariant.id).availableQuantity).toBe(3);
  expect(pos.body).not.toHaveProperty("publication");
});

async function startApp(overrides: { databasePoolMax?: number } = {}) {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_catalog_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-catalog-outbox-"));
  mediaDir = await mkdtemp(path.join(tmpdir(), "bravos-catalog-media-"));
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
    productMediaDir: mediaDir,
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

async function publicRaw(method: "GET", url: string) {
  return built.app.inject({ method, url, headers: { origin: PUBLIC_ORIGIN } });
}

async function internalRaw(session: CookieSession, url: string) {
  return built.app.inject({
    method: "GET",
    url,
    headers: { origin: INTERNAL_ORIGIN, cookie: session.cookie },
  });
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(value: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function seedTaxonomy(
  manager: CookieSession,
): Promise<{ categoryId: string; sizeId: string; colorId: string }> {
  const category = await api(manager, "POST", "/api/internal/catalog/categories", { nameAr: "تيشيرتات" });
  expect(category.status).toBe(201);
  const size = await api(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  expect(size.status).toBe(201);
  const color = await api(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  expect(color.status).toBe(201);
  return {
    categoryId: category.body.id,
    sizeId: size.body.id,
    colorId: color.body.id,
  };
}

function productWrite(
  seed: { categoryId: string; sizeId: string; colorId: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    code: "TS-001",
    nameAr: "تيشيرت أساسي",
    descriptionAr: "قطن",
    categoryId: seed.categoryId,
    defaultSellingPricePiasters: 25000,
    publication: "hidden",
    imageRefs: [],
    variants: [
      { sizeId: seed.sizeId, colorId: seed.colorId, sellingPricePiastersOverride: null },
    ],
    ...overrides,
  };
}

async function seedShirt(
  manager: CookieSession,
  options?: { publication?: string },
): Promise<{ categoryId: string; sizeId: string; colorId: string; productId: string }> {
  const seed = await seedTaxonomy(manager);
  const created = await api(
    manager,
    "POST",
    "/api/internal/catalog/products",
    productWrite(seed, { publication: options?.publication ?? "hidden" }),
  );
  expect(created.status).toBe(201);
  return {
    ...seed,
    productId: created.body.id,
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
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
  options?: { extraHeaders?: Record<string, string> },
) {
  const response = await built.app.inject({
    method,
    url,
    headers: {
      origin: INTERNAL_ORIGIN,
      cookie: session?.cookie ?? "",
      ...(payload ? { "content-type": "application/json" } : {}),
      ...options?.extraHeaders,
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
