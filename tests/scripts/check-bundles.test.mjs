import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../../scripts/check-bundles.mjs", import.meta.url));
const chunks = [
  "staff-management", "catalog-maintenance", "cashier-lookup", "receiving-stock",
  "cashier-sales", "expenses-online", "offer-management", "physical-returns",
  "recording-corrections", "storefront-settings", "online-order-operations", "opening-import",
  "management-reports", "storefront-analytics", "manager-backup", "manager-restore",
];
const productionStorefront = {
  BUILD_ID: "fixture-build",
  "build-manifest.json": JSON.stringify({
    devFiles: [], rootMainFiles: ["static/chunks/main.js"],
    lowPriorityFiles: ["static/fixture-build/_buildManifest.js"],
  }),
  "static/chunks/main.js": "export {};",
  "static/fixture-build/_buildManifest.js": "self.__BUILD_MANIFEST = {};",
};

async function checkFixture(entry, storefrontFiles = productionStorefront) {
  const fixture = await mkdtemp(path.join(tmpdir(), "bravos-bundle-guard-"));
  try {
    const internal = path.join(fixture, "apps/internal/dist");
    const assets = path.join(internal, "assets");
    const storefront = path.join(fixture, "apps/storefront/.next");
    await mkdir(assets, { recursive: true });
    await mkdir(storefront, { recursive: true });
    await Promise.all([
      writeFile(path.join(internal, "index.html"), '<script type="module" src="/assets/index.js"></script>'),
      writeFile(path.join(assets, "index.js"), `${entry}\n${chunks.map((chunk) => `import("./${chunk}-fixture.js");`).join("\n")}`),
      ...chunks.map((chunk) => writeFile(path.join(assets, `${chunk}-fixture.js`), "export {};")),
      writeFile(path.join(assets, "LookupPage-fixture.css"), ".pos-browser {}"),
      writeFile(path.join(internal, "sw.js"), 'const schemaVersion = 1; const precache = ["cashier-lookup", "cashier-sales"];'),
      ...Object.entries(storefrontFiles).map(async ([name, source]) => {
        const file = path.join(storefront, name);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, source);
      }),
    ]);
    return spawnSync(process.execPath, [checker], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("bravos-bundle-guard-"));
    await rm(fixture, { recursive: true, force: true });
  }
}

test("lazy preload CSS asset names do not count as embedded operational screens", async () => {
  const result = await checkFixture(`const preload = ["assets/LookupPage-fixture.css", 'assets/CatalogPage-fixture.css'];`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bundle separation ok/);
});

for (const [name, source] of [
  ["an eager screen function", 'function LookupPage() { return "screen"; }'],
  ["a bare screen marker", 'const label = "LookupPage";'],
  ["actual POS screen content", 'const label = "سلة البيع";'],
  ["a filename outside the generated assets namespace", 'const label = "LookupPage-fixture.css";'],
  ["a screen beside harmless CSS metadata", 'const preload = ["assets/LookupPage-fixture.css"]; function LookupPage() {}'],
]) {
  test(`screen marker guard still rejects ${name}`, async () => {
    const result = await checkFixture(source);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /should not include optional operational screens/);
  });
}

test("a static optional JavaScript import is rejected even beside CSS preload metadata", async () => {
  const result = await checkFixture('const preload = ["assets/LookupPage-fixture.css"]; import "./cashier-lookup-fixture.js";');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /Login entry statically imports an optional operational chunk/);
});

test("development-only storefront output cannot satisfy the production build check", async () => {
  const result = await checkFixture("", { "dev/static/chunks/main.js": "export {};" });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /production build metadata is missing or unreadable/);
});

for (const [name, overrides, message] of [
  ["an empty build identifier", { BUILD_ID: " \n" }, /production build metadata is invalid/],
  ["malformed build metadata", { "build-manifest.json": "{" }, /metadata is missing or unreadable/],
  ["a development manifest", { "build-manifest.json": JSON.stringify({ devFiles: ["dev.js"], rootMainFiles: [] }) }, /production build metadata is invalid/],
  ["a missing referenced production asset", { "build-manifest.json": JSON.stringify({
    devFiles: [], rootMainFiles: ["static/chunks/missing.js"],
    lowPriorityFiles: ["static/fixture-build/_buildManifest.js"],
  }) }, /references a missing JavaScript asset/],
  ["a reference into development output", { "build-manifest.json": JSON.stringify({
    devFiles: [], rootMainFiles: ["static/../dev/main.js"],
    lowPriorityFiles: ["static/fixture-build/_buildManifest.js"],
  }), "dev/main.js": "export {};" }, /invalid JavaScript asset path/],
]) {
  test(`production metadata validation rejects ${name}`, async () => {
    const result = await checkFixture("", { ...productionStorefront, ...overrides });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, message);
  });
}

test("supported production output passes without scanning or counting retained development files", async () => {
  const result = await checkFixture("", {
    ...productionStorefront,
    "dev/static/chunks/old.js": 'const unused = "@bravos/identity";',
    "dev/server/old.html": "@bravos/backup",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /storefront files=2,/);
});

for (const [name, file, source, message] of [
  ["internal staff modules", "static/chunks/main.js", 'const leak = "@bravos/identity";', /Public build leaked internal staff modules/],
  ["private archive implementation", "server/page.html", "@bravos/backup", /Public build leaked manager backup/],
  ["server-only export runtime", "static/fixture-build/_buildManifest.js", 'const leak = "@react-pdf/renderer";', /Public build contains server-only report export runtime/],
]) {
  test(`production scanning still rejects ${name} beside development output`, async () => {
    const result = await checkFixture("", {
      ...productionStorefront, [file]: source, "dev/static/chunks/old.js": "export {};",
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, message);
  });
}
