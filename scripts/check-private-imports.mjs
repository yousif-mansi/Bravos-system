import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/identity(?:\/node)?/,
    message: "Frontend/contracts cannot import the identity package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/catalog(?:\/node)?/,
    message: "Frontend/contracts cannot import the catalog package.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/identity\/src\//,
    message: "Deep identity imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/catalog\/src\//,
    message: "Deep catalog imports are not part of the public interface.",
  },
  {
    from: ["packages/identity/src/domain", "packages/identity/src/application", "packages/catalog/src/domain", "packages/catalog/src/application"],
    pattern: /from ["'](better-auth|fastify|pg|react|next|vite)/,
    message: "Inner feature layers cannot import infrastructure SDKs.",
  },
  {
    from: ["packages/identity/src/domain", "packages/identity/src/application", "packages/catalog/src/domain", "packages/catalog/src/application"],
    pattern: /\bHeaders\b/,
    message: "Application/domain cannot depend on HTTP Headers.",
  },
  {
    from: ["packages/catalog/src/domain"],
    pattern: /@bravos\/identity/,
    message: "Catalog domain cannot import identity.",
  },
  {
    from: ["packages/identity"],
    pattern: /@bravos\/catalog/,
    message: "Identity cannot import catalog.",
  },
];

const files = [];
await walk(path.join(root, "apps"));
await walk(path.join(root, "packages"));

let failures = 0;
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  for (const rule of forbidden) {
    if (!rule.from.some((prefix) => relative.startsWith(prefix))) {
      continue;
    }
    if (rule.pattern.test(source)) {
      console.error(`${relative}: ${rule.message}`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log(`private-import check passed (${files.length} files)`);

async function walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") {
      continue;
    }
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(full);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      files.push(full);
    }
  }
}
