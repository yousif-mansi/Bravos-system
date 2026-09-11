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
let databaseName = "bravos_catalog_1";
let outboxDir: string;
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
  expect(keys).toEqual(["code", "descriptionAr", "id", "nameAr", "variants"]);
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

async function startApp(overrides: { databasePoolMax?: number } = {}) {
  if (built) {
    await built.close();
  }
  databaseName = `bravos_catalog_${crypto.randomUUID().replaceAll("-", "")}`;
  await cluster.createDatabase(databaseName);
  outboxDir = await mkdtemp(path.join(tmpdir(), "bravos-catalog-outbox-"));
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
