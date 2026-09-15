import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp, type BuiltApp } from "../../apps/api/src/app.ts";
import { ensureOwner } from "../../apps/api/src/bootstrap.ts";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";

const INTERNAL_ORIGIN = "http://127.0.0.1:5173";
const PUBLIC_ORIGIN = "http://127.0.0.1:3000";
let cluster: PostgresCluster;
let built: BuiltApp;
let abshwayId = "";

beforeAll(async () => {
  cluster = await startPostgresCluster({ port: 55448 });
}, 120_000);

afterAll(async () => {
  if (built) await built.close();
  await cluster.stop();
});

beforeEach(async () => {
  if (built) await built.close();
  const databaseName = `bravos_storefront_${crypto.randomUUID().replaceAll("-", "")}`;
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
    ownerRecoveryOutboxDir: await mkdtemp(path.join(tmpdir(), "bravos-storefront-outbox-")),
  });
  const branches = await built.pool.query<{ id: string; code: string }>("SELECT id, code FROM branch");
  abshwayId = branches.rows.find((row) => row.code === "abshway")?.id ?? "";
  await ensureOwner(built.services, { loginName: "owner", displayName: "مالك برافوس", password: "owner-pass-1" });
});

test("contact links are empty until a manager configures safe real URLs", async () => {
  const empty = await request(undefined, "GET", "/api/public/storefront/contacts", undefined, PUBLIC_ORIGIN);
  expect(empty.status).toBe(200);
  expect(empty.body).toEqual({ whatsappUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null });
  expect(empty.headers["cache-control"]).toContain("no-store");

  const manager = await signIn("owner", "owner-pass-1");
  await request(manager, "POST", "/api/internal/staff", {
    loginName: "cashier", displayName: "كاشير", password: "staff-pass-1",
    grants: [{ branchId: abshwayId, cashier: true, orderRepresentative: false }],
  });
  const employee = await signIn("cashier", "staff-pass-1");
  const input = {
    whatsappUrl: "https://wa.me/201000000000",
    facebookUrl: "https://www.facebook.com/bravos-test",
    instagramUrl: null,
    tiktokUrl: "https://www.tiktok.com/@bravos-test",
  };
  expect((await request(undefined, "GET", "/api/internal/storefront/contacts")).status).toBe(401);
  expect((await request(employee, "PATCH", "/api/internal/storefront/contacts", input)).status).toBe(403);
  const invalid = await request(manager, "PATCH", "/api/internal/storefront/contacts", { ...input, whatsappUrl: "http://wa.me/123" });
  expect(invalid.status).toBe(400);
  expect(invalid.body.error.code).toBe("VALIDATION");
  const invalidPlatformUrls = [
    { whatsappUrl: "https://facebook.com/bravos" },
    { facebookUrl: "https://instagram.com/bravos" },
    { instagramUrl: "https://tiktok.com/@bravos" },
    { tiktokUrl: "https://wa.me/201000000000" },
    { facebookUrl: "https://facebook.com.evil.test/bravos" },
    { instagramUrl: "https://user:secret@instagram.com/bravos" },
  ];
  for (const replacement of invalidPlatformUrls) {
    const response = await request(manager, "PATCH", "/api/internal/storefront/contacts", { ...input, ...replacement });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION");
  }

  const saved = await request(manager, "PATCH", "/api/internal/storefront/contacts", input);
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject(input);
  expect(saved.body.changedByStaffId).toBeTruthy();
  expect(saved.body.changedAt).toBeTruthy();

  const publicLinks = await request(undefined, "GET", "/api/public/storefront/contacts", undefined, PUBLIC_ORIGIN);
  expect(publicLinks.body).toEqual(input);
  expect(publicLinks.body).not.toHaveProperty("changedByStaffId");
  expect(JSON.stringify(publicLinks.body)).not.toMatch(/staff|cost|profit|inventory/i);

  await built.pool.query(`UPDATE storefront_contacts SET facebook_url = 'https://example.com/not-facebook' WHERE id = 'default'`);
  const filteredLinks = await request(undefined, "GET", "/api/public/storefront/contacts", undefined, PUBLIC_ORIGIN);
  expect(filteredLinks.body.facebookUrl).toBeNull();
  expect(filteredLinks.body.whatsappUrl).toBe(input.whatsappUrl);
});

test("public browsing searches published summaries and excludes hidden details", async () => {
  const manager = await signIn("owner", "owner-pass-1");
  const shirts = await request(manager, "POST", "/api/internal/catalog/categories", { nameAr: "قمصان" });
  const jackets = await request(manager, "POST", "/api/internal/catalog/categories", { nameAr: "جاكيتات" });
  const size = await request(manager, "POST", "/api/internal/catalog/sizes", { nameAr: "L" });
  const color = await request(manager, "POST", "/api/internal/catalog/colors", { nameAr: "أسود" });
  const product = (code: string, nameAr: string, categoryId: string, publication: string) => ({
    code, nameAr, descriptionAr: `وصف ${nameAr}`, categoryId,
    defaultSellingPricePiasters: 37500, publication, imageRefs: [], sizeGuideAr: null,
    variants: [{ sizeId: size.body.id, colorId: color.body.id, sellingPricePiastersOverride: null }],
  });
  const visible = await request(manager, "POST", "/api/internal/catalog/products", product("SF-1", "قميص مميز", shirts.body.id, "available"));
  await request(manager, "POST", "/api/internal/catalog/products", product("SF-2", "جاكيت شتوي", jackets.body.id, "coming_soon"));
  await request(manager, "POST", "/api/internal/catalog/products", product("SF-3", "قميص مخفي", shirts.body.id, "hidden"));

  const result = await request(undefined, "GET", `/api/public/storefront/catalog?q=${encodeURIComponent("قميص")}&categoryId=${shirts.body.id}`, undefined, PUBLIC_ORIGIN);
  expect(result.status).toBe(200);
  expect(result.headers["cache-control"]).toContain("no-store");
  expect(result.body.categories).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: shirts.body.id, nameAr: "قمصان" }),
    expect.objectContaining({ id: jackets.body.id, nameAr: "جاكيتات" }),
  ]));
  expect(result.body.products).toEqual([{
    id: visible.body.id,
    nameAr: "قميص مميز",
    category: { id: shirts.body.id, nameAr: "قمصان" },
    availability: "out_of_stock",
    previewImageRef: null,
    lowestSellingPricePiasters: 37500,
  }]);
  expect(JSON.stringify(result.body)).not.toMatch(/قميص مخفي|description|variant|availableQuantity|cost|profit|batch/i);
  expect((await request(undefined, "GET", "/api/public/storefront/catalog?categoryId=bad", undefined, PUBLIC_ORIGIN)).status).toBe(400);
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
  return { cookie: collectCookies(response.headers["set-cookie"]) };
}

async function request(
  session: CookieSession | undefined,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
  origin = INTERNAL_ORIGIN,
) {
  const response = await built.app.inject({
    method,
    url,
    headers: { origin, cookie: session?.cookie ?? "", ...(payload ? { "content-type": "application/json" } : {}) },
    payload,
  });
  return { status: response.statusCode, body: safeJson(response.body), headers: response.headers };
}

function collectCookies(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((value) => value.split(";")[0]).filter(Boolean).join("; ");
}

function safeJson(body: string) {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}
