import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuplicateLoginNameError } from "@bravos/identity";
import { startPostgresCluster, type PostgresCluster } from "@bravos/testkit";
import { buildApp, type BuiltApp } from "../apps/api/src/app.ts";
import { ensureOwner } from "../apps/api/src/bootstrap.ts";
import { demoIllustration } from "./storefront-demo-illustrations.ts";

// Intentionally fixed named targets: this tool cannot select an operational database.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(repoRoot, ".local/storefront-demo");
const apiOrigin = "http://127.0.0.1:3012";
const internalOrigin = "http://127.0.0.1:5175";
const publicOrigin = "http://127.0.0.1:3000";
const databaseName = "bravos_storefront_demo";
const marker = { purpose: "bravos-development-storefront-demo", version: 1, databaseName, postgresPort: 55434, apiPort: 3012 };
const markerPath = path.join(root, "target.json");
const runtimePath = path.join(root, "runtime.json");
const lockPath = path.join(root, "run.lock");
let built: BuiltApp | undefined;
let cluster: PostgresCluster | undefined;
let ownsLock = false;
let stopping: Promise<void> | undefined;

type Product = { id: string; code: string; editRevision: number; nameAr: string; descriptionAr: string; category: Named; defaultSellingPricePiasters: number;
  publication: string; imageRefs: string[]; sizeGuideAr: string | null;
  variants: Array<{ id: string; size: Named; color: Named; onlineVisible: boolean; sellingPricePiastersOverride: number | null }> };
type Named = { id: string; nameAr: string };
type Manifest = { products: Product[]; areaId: string; branches: Array<{ id: string; code: string }> };

if (process.env.NODE_ENV === "production") throw new Error("Development demo refuses production execution.");
const command = process.argv[2] ?? "start";
if (!["start", "stop", "status", "verify"].includes(command)) throw new Error("Usage: pnpm exec tsx scripts/storefront-demo.ts [start|stop|status|verify]");

await checkNamedRoot(command === "start");
if (command === "stop") {
  const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as { token: string; purpose: string };
  if (runtime.purpose !== marker.purpose) throw new Error("Unrecognized demo runtime target.");
  await assertLiveDemo();
  const response = await fetch(`${apiOrigin}/__development_demo/shutdown`, { method: "POST", headers: { authorization: `Bearer ${runtime.token}` } });
  if (!response.ok) throw new Error(`Demo shutdown failed (${response.status}).`);
  const deadline = Date.now() + 40_000;
  while ((await Promise.all([portOpen(3012), portOpen(55434)])).some(Boolean)) {
    if (Date.now() >= deadline) throw new Error("Demo accepted shutdown but its named ports have not closed; inspect before restarting.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log("Development demo API and its PostgreSQL cluster stopped; data preserved.");
} else if (command === "status") {
  await assertLiveDemo();
  console.log(`Development demo active: ${apiOrigin}; PostgreSQL 55434; ${root}`);
} else if (command === "verify") {
  await assertLiveDemo();
  await verify(JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as Manifest);
} else {
  try {
    await takeLock();
    for (const port of [3012, 55434]) {
      if (await portOpen(port)) throw new Error(`Port ${port} is occupied. Refusing to attach to or stop another process. Use this demo's stop command if it is already running.`);
    }
    cluster = await startPostgresCluster({ port: 55434, persistentDir: path.join(root, "postgres") });
    try { await cluster.createDatabase(databaseName); } catch (error) {
      if (!/already exists/i.test(String(error))) throw error;
    }
    const credentialsPath = path.join(root, "credentials.json");
    const credentials = await readJson<{ ownerLogin: string; ownerPassword: string; authSecret: string }>(credentialsPath) ?? {
      ownerLogin: "demo-owner", ownerPassword: `demo-${randomBytes(16).toString("hex")}`, authSecret: randomBytes(32).toString("hex"),
    };
    await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    built = await buildApp({
      nodeEnv: "development", databaseUrl: cluster.connectionString(databaseName), authSecret: credentials.authSecret,
      authBaseUrl: apiOrigin, internalOrigin, publicOrigin, trustedOrigins: [apiOrigin, internalOrigin], secureCookies: false,
      publicOrderingEnabled: true, ownerRecoveryAdapter: "local-outbox", ownerRecoveryOutboxDir: path.join(root, "owner-recovery-outbox"),
      productMediaDir: path.join(root, "product-media"),
    });
    try { await ensureOwner(built.services, { loginName: credentials.ownerLogin, password: credentials.ownerPassword, displayName: "مدير العرض التجريبي" }); }
    catch (error) { if (!(error instanceof DuplicateLoginNameError)) throw error; }
    const token = randomBytes(32).toString("hex");
    built.app.get("/__development_demo", async () => ({ ...marker, pid: process.pid }));
    built.app.post("/__development_demo/shutdown", async (request, reply) => {
      const actual = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.status(401).send();
      reply.raw.once("finish", () => { void stop().catch((error) => { console.error(error); process.exitCode = 1; }); });
      return { stopped: true };
    });
    await writeFile(path.join(root, "dev.env"), [
      "NODE_ENV=development", `DATABASE_URL=${cluster.connectionString(databaseName)}`, `BETTER_AUTH_SECRET=${credentials.authSecret}`,
      `BETTER_AUTH_URL=${apiOrigin}`, `BRAVOS_INTERNAL_ORIGIN=${internalOrigin}`, `BRAVOS_PUBLIC_ORIGIN=${publicOrigin}`,
      "BRAVOS_SECURE_COOKIES=false", "BRAVOS_PUBLIC_ORDERING_ENABLED=true", "BRAVOS_OWNER_RECOVERY_ADAPTER=local-outbox",
      `BRAVOS_OWNER_RECOVERY_OUTBOX_DIR=${path.join(root, "owner-recovery-outbox").replaceAll("\\", "/")}`,
      `BRAVOS_PRODUCT_MEDIA_DIR=${path.join(root, "product-media").replaceAll("\\", "/")}`, "",
    ].join("\n"), { mode: 0o600 });
    await writeFile(path.join(root, "storefront.env"), `NODE_ENV=development\nBRAVOS_API_ORIGIN=${apiOrigin}\nBRAVOS_STOREFRONT_DEMO=1\n`);
    await built.app.listen({ port: 3012, host: "127.0.0.1" });
    const manifest = await seed(credentials.ownerLogin, credentials.ownerPassword);
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
    await verify(manifest);
    await writeFile(runtimePath, JSON.stringify({ purpose: marker.purpose, pid: process.pid, token, apiOrigin, postgresPort: 55434 }), { mode: 0o600 });
    console.log(`Development demo ready: ${apiOrigin}; PostgreSQL 55434; API PID ${process.pid}.`);
    console.log(`Seed: 16 sample products, 4 categories. Env/media/data are isolated under ${root}.`);
    process.once("SIGINT", () => { void stop(); });
    process.once("SIGTERM", () => { void stop(); });
  } catch (error) { await stop(); throw error; }
}

async function checkNamedRoot(create: boolean) {
  for (const dir of [path.dirname(root), root]) {
    const stat = await lstat(dir).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error(`Demo refuses redirected directory: ${dir}`);
    if (!stat && create) await mkdir(dir, { recursive: false });
    if (!stat && !create) throw new Error("Demo has not been initialized.");
    if (path.resolve(await realpath(dir)).toLowerCase() !== dir.toLowerCase()) throw new Error(`Demo path is redirected: ${dir}`);
  }
  const existing = await readJson<typeof marker>(markerPath);
  if (!existing) {
    if (!create || (await readdir(root)).length) throw new Error("Refusing an unmarked, nonempty demo target.");
    await writeFile(markerPath, JSON.stringify(marker, null, 2), { flag: "wx" });
  } else if (JSON.stringify(existing) !== JSON.stringify(marker)) throw new Error("Demo target marker does not match the fixed database and ports.");
  for (const directory of ["postgres", "product-media", "illustrations", "owner-recovery-outbox"]) {
    const stat = await lstat(path.join(root, directory)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error(`Refusing redirected demo ${directory}.`);
  }
}

async function takeLock() {
  try { await writeFile(lockPath, String(process.pid), { flag: "wx" }); ownsLock = true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Demo lock is malformed; inspect it before retrying.");
    try { process.kill(pid, 0); } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
      await rm(lockPath); await writeFile(lockPath, String(process.pid), { flag: "wx" }); ownsLock = true; return;
    }
    throw new Error(`Demo already has an active process (${pid}). Use status/stop.`);
  }
}

async function stop() {
  stopping ??= (async () => {
    try { await built?.close(); } finally {
      try { await cluster?.stop(); } finally {
        if (ownsLock) { await rm(lockPath, { force: true }); await rm(runtimePath, { force: true }); ownsLock = false; }
      }
    }
  })();
  return stopping;
}

async function assertLiveDemo() {
  const response = await fetch(`${apiOrigin}/__development_demo`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Port 3012 does not identify this development demo.");
  const identity = await response.json() as Record<string, unknown>;
  if (Object.entries(marker).some(([key, value]) => identity[key] !== value)) throw new Error("Demo runtime identity mismatch.");
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error: NodeJS.ErrnoException) => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(false); else reject(error); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
  });
}

function operationId(name: string): string {
  const hex = createHash("sha256").update(`bravos-storefront-demo-v1:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function request<T>(method: string, route: string, payload?: unknown, cookie = ""): Promise<{ status: number; body: T }> {
  const response = await fetch(`${apiOrigin}${route}`, {
    method, headers: { origin: cookie ? internalOrigin : publicOrigin, ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() as T };
}

function accepted<T>(result: { status: number; body: T }): T {
  if (result.status < 200 || result.status >= 300) throw new Error(`Demo API rejected request (${result.status}): ${JSON.stringify(result.body)}`);
  return result.body;
}

async function seed(username: string, password: string): Promise<Manifest> {
  const login = await fetch(`${apiOrigin}/api/auth/sign-in/username`, { method: "POST", headers: { origin: internalOrigin, "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  if (!login.ok) throw new Error("Demo owner credentials could not be verified; existing accounts are never rotated.");
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const staff = async <T>(method: string, route: string, payload?: unknown) => accepted(await request<T>(method, route, payload, cookie));
  const workspace = await staff<{ authorizedBranches: Array<{ id: string; code: string }> }>("GET", "/api/internal/workspace");
  const branches = workspace.authorizedBranches;
  const branchA = branches.find((branch) => branch.code === "abshway");
  const branchB = branches.find((branch) => branch.code === "fayoum");
  if (!branchA || !branchB) throw new Error("Demo requires both application branches.");
  await staff("POST", "/api/internal/active-branch", { branchId: branchA.id });
  async function taxonomy(resource: string, nameAr: string) {
    const existing = (await staff<Named[]>("GET", `/api/internal/catalog/${resource}`)).find((item) => item.nameAr === nameAr);
    return existing ?? staff<Named>("POST", `/api/internal/catalog/${resource}`, { nameAr });
  }
  const categories = [];
  for (const name of ["تيشيرتات", "قمصان", "بناطيل", "جاكيتات"]) categories.push(await taxonomy("categories", `${name} — تجريبي`));
  const sizes = [];
  for (const name of ["M", "L", "XL"]) sizes.push(await taxonomy("sizes", name));
  const colors = [];
  for (const name of ["كريمي", "كحلي", "زيتوني"]) colors.push(await taxonomy("colors", name));
  const names = ["تيشيرت يومي كريمي", "قميص هادئ كحلي", "بنطلون مستقيم", "جاكيت خفيف", "تيشيرت زيتوني", "قميص بخطوط مبسطة", "بنطلون رملي", "جاكيت يومي", "تيشيرت واسع", "قميص بأكمام طويلة", "بنطلون كحلي", "جاكيت بلون حجري", "تيشيرت غير متوفر", "قميص فرع الفيوم", "بنطلون قريباً", "جاكيت مخفي"];
  const prices = [29000, 54000, 69000, 119000, 35000, 62000, 75000, 129000, 39000, 58000, 81000, 139000, 42000, 65000, 92000, 149000];
  const palette = ["#ddd4bd", "#354355", "#81725f", "#615f58", "#6a725a", "#c7bcaa", "#af9b7d", "#434b57"];
  const products: Product[] = [];
  let catalog = await staff<Product[]>("GET", "/api/internal/catalog/products");
  await mkdir(path.join(root, "illustrations"), { recursive: true });
  for (let index = 0; index < names.length; index++) {
    const code = `DEMO-${String(index + 1).padStart(3, "0")}`;
    let product = catalog.find((item) => item.code === code);
    if (!product) {
      const art = await demoIllustration(repoRoot, index % 4, palette[index % palette.length]!);
      await writeFile(path.join(root, "illustrations", `${code}.svg`), art.svg);
      await writeFile(path.join(root, "illustrations", `${code}.png`), art.png);
      const media = await staff<{ ref: string }>("POST", "/api/internal/catalog/media", { fileName: `${code}-sample-illustration.png`, contentType: "image/png", base64: art.png.toString("base64") });
      product = await staff<Product>("POST", "/api/internal/catalog/products", {
        code, nameAr: `${names[index]} (نموذج تجريبي)`, descriptionAr: "منتج افتراضي لتجربة المتجر فقط. الرسم توضيحي وليس صورة لمنتج حقيقي. الأسعار والمخزون بيانات اختبار.",
        categoryId: categories[index % 4]!.id, defaultSellingPricePiasters: prices[index], publication: index === 14 ? "coming_soon" : index === 15 ? "hidden" : "available",
        imageRefs: [media.ref], sizeGuideAr: "مقاسات رمزية للتجربة فقط؛ لا تمثل قياسات بضائع حقيقية.",
        // Four explicit pairs, never the Cartesian product of size and color lists.
        variants: [
          { sizeId: sizes[0]!.id, colorId: colors[0]!.id, sellingPricePiastersOverride: null },
          { sizeId: sizes[1]!.id, colorId: colors[0]!.id, sellingPricePiastersOverride: null },
          { sizeId: sizes[1]!.id, colorId: colors[1]!.id, sellingPricePiastersOverride: index % 3 === 0 ? prices[index]! + 5000 : null },
          { sizeId: sizes[2]!.id, colorId: colors[2]!.id, sellingPricePiastersOverride: prices[index]! + 8000 },
        ],
      });
      catalog = [...catalog, product];
    }
    if ((index === 0 || index === 3) && product.imageRefs.length === 1) {
      const art = await demoIllustration(repoRoot, index % 4, palette[index % palette.length]!, true);
      await writeFile(path.join(root, "illustrations", `${code}-detail.svg`), art.svg);
      await writeFile(path.join(root, "illustrations", `${code}-detail.png`), art.png);
      const media = await staff<{ ref: string }>("POST", "/api/internal/catalog/media", { fileName: `${code}-sample-detail.png`, contentType: "image/png", base64: art.png.toString("base64") });
      product = await staff<Product>("PATCH", `/api/internal/catalog/products/${product.id}`, {
        expectedRevision: product.editRevision, expectedVariantIds: product.variants.map((variant) => variant.id),
        code: product.code, nameAr: product.nameAr, descriptionAr: product.descriptionAr, categoryId: product.category.id,
        defaultSellingPricePiasters: product.defaultSellingPricePiasters, publication: product.publication, imageRefs: [...product.imageRefs, media.ref], sizeGuideAr: product.sizeGuideAr,
        variants: product.variants.map((variant) => ({ sizeId: variant.size.id, colorId: variant.color.id, onlineVisible: variant.onlineVisible, sellingPricePiastersOverride: variant.sellingPricePiastersOverride })),
      });
    }
    products.push(product);
    if (index === 12 || index === 14) continue;
    for (const branch of branches) {
      if ((index === 0 && branch.code !== "abshway") || ((index === 1 || index === 13) && branch.code !== "fayoum")) continue;
      const quantities: Record<string, number> = { "L:كحلي": 6 + index % 4, "L:كريمي": 3, "M:كريمي": 0, "XL:زيتوني": 2 };
      await staff("POST", "/api/internal/active-branch", { branchId: branch.id });
      // Stable receipt facts let the real receiving service replay without restocking consumed units.
      await staff("POST", "/api/internal/receiving/receipts", { operationId: operationId(`receipt:${code}:${branch.code}`), branchId: branch.id, receiptDate: "2026-09-29",
        lines: product.variants.flatMap((variant) => {
          const quantity = quantities[`${variant.size.nameAr}:${variant.color.nameAr}`];
          if (quantity === undefined) throw new Error(`Unexpected demo variant pair for ${code}.`);
          return quantity > 0 ? [{ variantId: variant.id, quantity, unitCostPiasters: 10000 + index * 2000 }] : [];
        }),
      });
    }
  }
  const areas = await staff<Array<Named & { feePiasters: number }>>("GET", "/api/internal/delivery-areas");
  let areaId = "";
  for (const [nameAr, feePiasters] of [["منطقة عرض تجريبي أ", 3000], ["منطقة عرض تجريبي ب", 4500]] as const) {
    const area = areas.find((item) => item.nameAr === nameAr) ?? await staff<Named>("POST", "/api/internal/delivery-areas", { nameAr, feePiasters, active: true });
    areaId ||= area.id;
  }
  // No fabricated contact accounts or delivery claims in this isolated preview.
  await staff("PATCH", "/api/internal/storefront/contacts", { whatsappUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null });
  await staff("POST", "/api/internal/active-branch", { branchId: branchA.id });
  return { products, areaId, branches };
}

async function verify(manifest: Manifest) {
  const catalog = accepted(await request<Array<{ id: string; availability: string; imageRefs: string[] }>>("GET", "/api/public/catalog/products"));
  if (catalog.length !== 15) throw new Error(`Expected 15 public demo products, found ${catalog.length}.`);
  if (/unitCost|purchaseCost|costPiasters|profit/i.test(JSON.stringify(catalog))) throw new Error("Public catalog exposed restricted costs.");
  if (catalog.some((product) => product.id === manifest.products[15]!.id)) throw new Error("Hidden demo product appeared publicly.");
  if (catalog.find((product) => product.id === manifest.products[12]!.id)?.availability !== "out_of_stock") throw new Error("Out-of-stock demo product lost its public state.");
  if (catalog.find((product) => product.id === manifest.products[14]!.id)?.availability !== "coming_soon") throw new Error("Coming-soon demo product lost its public state.");
  const hidden = await request("GET", `/api/public/catalog/products/${manifest.products[15]!.id}`);
  if (hidden.status !== 404) throw new Error("Hidden demo detail is publicly accessible.");
  const detail = accepted(await request<{ variants: Array<{ id: string; availableQuantity: number }> }>("GET", `/api/public/catalog/products/${manifest.products[0]!.id}`));
  const before = detail.variants[0]!.availableQuantity;
  const goodLines = [{ variantId: manifest.products[0]!.variants[0]!.id, quantity: 1 }, { variantId: manifest.products[2]!.variants[0]!.id, quantity: 1 }];
  const quote = accepted(await request<{ quoteId: string; finalTotalPiasters: number }>("POST", "/api/public/checkout/quote", { deliveryAreaId: manifest.areaId, lines: goodLines }));
  for (const [label, lines] of [
    ["cross-branch basket", [{ variantId: manifest.products[0]!.variants[0]!.id, quantity: 1 }, { variantId: manifest.products[1]!.variants[0]!.id, quantity: 1 }]],
    ["zero-stock variant", [{ variantId: manifest.products[0]!.variants[2]!.id, quantity: 1 }]],
    ["coming-soon product", [{ variantId: manifest.products[14]!.variants[0]!.id, quantity: 1 }]],
    ["repeated variant quantity", [{ variantId: manifest.products[0]!.variants[0]!.id, quantity: before }, { variantId: manifest.products[0]!.variants[0]!.id, quantity: 1 }]],
  ] as const) {
    const result = await request("POST", "/api/public/checkout/quote", { deliveryAreaId: manifest.areaId, lines });
    if (result.status < 400 || result.status >= 500) throw new Error(`Demo ${label} did not return a business rejection (${result.status}).`);
  }
  const mediaResponse = await fetch(`${apiOrigin}/api/public/catalog/media/${catalog[0]!.imageRefs[0]}`);
  if (!mediaResponse.ok || !mediaResponse.headers.get("content-type")?.startsWith("image/png")) throw new Error("Public demo illustration could not be loaded.");
  const storedPath = path.join(root, "verification-order.json");
  const submission = await readJson<Record<string, unknown>>(storedPath) ?? {
    operationId: operationId("verification-order"), quoteId: quote.quoteId, deliveryAreaId: manifest.areaId, lines: goodLines,
    customerName: "اختبار عرض المتجر", primaryPhone: "01000000000", detailedAddress: "عنوان افتراضي للتطوير فقط — لا يتم توصيل هذا الطلب", notes: "DEVELOPMENT DEMO — automated smoke verification; no real customer.",
  };
  // Save the exact request before submission, preserving retries even after interrupted setup.
  await writeFile(storedPath, JSON.stringify(submission, null, 2));
  const order = accepted(await request<{ orderId: string; reference: string }>("POST", "/api/public/checkout/orders", submission));
  const replay = accepted(await request<{ orderId: string; reference: string }>("POST", "/api/public/checkout/orders", submission));
  if (order.orderId !== replay.orderId || order.reference !== replay.reference) throw new Error("Demo order replay duplicated the accepted request.");
  const after = accepted(await request<{ variants: Array<{ availableQuantity: number }> }>("GET", `/api/public/catalog/products/${manifest.products[0]!.id}`));
  if (after.variants[0]!.availableQuantity !== before) throw new Error("Pending demo order deducted stock.");
  await writeFile(path.join(root, "verification.json"), JSON.stringify({ at: new Date().toISOString(), publicProductCount: catalog.length, quoteTotalPiasters: quote.finalTotalPiasters, orderReference: order.reference,
    checks: ["catalog", "media", "public cost secrecy", "whole-basket branch availability", "zero-stock rejection", "coming-soon rejection", "repeated-line limit", "guest order", "idempotent replay", "pending stock unchanged"] }, null, 2));
  console.log("Demo verification passed: catalog/media, whole-basket quotes, unavailable variants, real guest submission and duplicate-safe replay.");
}
