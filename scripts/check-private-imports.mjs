import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/pricing(?:\/node)?/,
    message: "Frontend/contracts cannot import the pricing package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/identity(?:\/node)?/,
    message: "Frontend/contracts cannot import the identity package.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/pricing\/src\//,
    message: "Deep pricing imports are not part of the public interface.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/catalog(?:\/node)?/,
    message: "Frontend/contracts cannot import the catalog package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/inventory(?:\/node)?/,
    message: "Frontend/contracts cannot import the inventory package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/receiving(?:\/node)?/,
    message: "Frontend/contracts cannot import the receiving package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/expenses(?:\/node)?/,
    message: "Frontend/contracts cannot import the expenses package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/storefront-config(?:\/node)?/,
    message: "Frontend/contracts cannot import the storefront configuration package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/sales(?!\/browser)/,
    message: "Frontend/contracts cannot import server sales adapters; use @bravos/sales/browser.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/returns(?:\/node)?/,
    message: "Frontend/contracts cannot import the returns server package.",
  },
  {
    from: ["apps/internal", "apps/storefront", "packages/contracts"],
    pattern: /@bravos\/corrections(?:\/node)?/,
    message: "Frontend/contracts cannot import the corrections server package.",
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
    from: ["apps", "packages"],
    pattern: /@bravos\/inventory\/src\//,
    message: "Deep inventory imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/receiving\/src\//,
    message: "Deep receiving imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/sales\/src\//,
    message: "Deep sales imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/expenses\/src\//,
    message: "Deep expenses imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/returns\/src\//,
    message: "Deep returns imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/corrections\/src\//,
    message: "Deep corrections imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/storefront-config\/src\//,
    message: "Deep storefront configuration imports are not part of the public interface.",
  },
  {
    from: ["apps", "packages"],
    pattern: /@bravos\/online-orders\/src\//,
    message: "Deep online-orders imports are not part of the public interface.",
  },
  {
    from: ["packages/online-orders/src/domain", "packages/online-orders/src/application"],
    pattern: /from ["'](better-auth|fastify|pg|react|next|vite|dexie)/,
    message: "Online-order inner layers cannot import infrastructure SDKs.",
  },
  {
    from: ["packages/online-orders"],
    pattern: /@bravos\/(catalog|inventory|receiving|pricing|sales|expenses|returns|corrections|storefront-config|persistence)/,
    message: "Online orders must coordinate other features through its own declared ports.",
  },
  {
    from: ["packages/identity/src/domain", "packages/identity/src/application", "packages/catalog/src/domain", "packages/catalog/src/application", "packages/inventory/src/domain", "packages/inventory/src/application", "packages/receiving/src/domain", "packages/receiving/src/application", "packages/pricing/src/domain", "packages/pricing/src/application", "packages/sales/src/domain", "packages/sales/src/application", "packages/expenses/src/domain", "packages/expenses/src/application", "packages/returns/src/domain", "packages/returns/src/application", "packages/corrections/src/domain", "packages/corrections/src/application", "packages/storefront-config/src/domain", "packages/storefront-config/src/application"],
    pattern: /from ["'](better-auth|fastify|pg|react|next|vite|dexie)/,
    message: "Inner feature layers cannot import infrastructure SDKs.",
  },
  {
    from: ["packages/identity/src/domain", "packages/identity/src/application", "packages/catalog/src/domain", "packages/catalog/src/application", "packages/inventory/src/domain", "packages/inventory/src/application", "packages/receiving/src/domain", "packages/receiving/src/application", "packages/pricing/src/domain", "packages/pricing/src/application", "packages/sales/src/domain", "packages/sales/src/application", "packages/expenses/src/domain", "packages/expenses/src/application", "packages/returns/src/domain", "packages/returns/src/application", "packages/corrections/src/domain", "packages/corrections/src/application", "packages/storefront-config/src/domain", "packages/storefront-config/src/application"],
    pattern: /\bHeaders\b/,
    message: "Application/domain cannot depend on HTTP Headers.",
  },
  {
    from: ["packages/pricing"],
    pattern: /@bravos\/(catalog|inventory|receiving|sales)/,
    message: "Pricing cannot import catalog, inventory, receiving or sales.",
  },
  {
    from: ["packages/catalog/src/domain"],
    pattern: /@bravos\/identity/,
    message: "Catalog domain cannot import identity.",
  },
  {
    from: ["packages/inventory/src/domain"],
    pattern: /@bravos\/identity/,
    message: "Inventory domain cannot import identity.",
  },
  {
    from: ["packages/receiving/src/domain"],
    pattern: /@bravos\/(identity|inventory|catalog|sales)/,
    message: "Receiving domain cannot import other feature packages.",
  },
  {
    from: ["packages/sales/src/domain"],
    pattern: /@bravos\/(identity|inventory|catalog|receiving)/,
    message: "Sales domain cannot import other feature packages.",
  },
  {
    from: ["packages/returns/src/domain"],
    pattern: /@bravos\/(identity|inventory|catalog|receiving|sales)/,
    message: "Returns domain cannot import other feature packages.",
  },
  {
    from: ["packages/corrections/src/domain"],
    pattern: /@bravos\/(identity|inventory|catalog|receiving|pricing|sales|expenses|returns|storefront-config)/,
    message: "Corrections domain cannot import other feature packages.",
  },
  {
    from: ["packages/identity"],
    pattern: /@bravos\/(catalog|inventory|receiving|sales|expenses)/,
    message: "Identity cannot import catalog, inventory, receiving, sales or expenses.",
  },
  {
    from: ["packages/catalog"],
    pattern: /@bravos\/(inventory|receiving|sales|expenses)/,
    message: "Catalog cannot import inventory, receiving, sales or expenses.",
  },
  {
    from: ["packages/inventory"],
    pattern: /@bravos\/(catalog|receiving|sales|expenses)/,
    message: "Inventory cannot import catalog, receiving, sales or expenses.",
  },
  {
    from: ["packages/receiving"],
    pattern: /@bravos\/(catalog|expenses)/,
    message: "Receiving cannot import the catalog or expenses package.",
  },
  {
    from: ["packages/sales"],
    pattern: /@bravos\/(catalog|receiving|expenses)/,
    message: "Sales cannot import the catalog, receiving or expenses packages.",
  },
  {
    from: ["packages/expenses"],
    pattern: /@bravos\/(catalog|inventory|receiving|sales)/,
    message: "Expenses cannot import catalog, inventory, receiving or sales.",
  },
  {
    from: ["packages/corrections"],
    pattern: /@bravos\/(catalog|receiving|pricing|sales|expenses|returns|storefront-config|persistence)/,
    message: "Corrections cannot import other owned business features.",
  },
  {
    from: ["packages/identity", "packages/catalog", "packages/inventory", "packages/receiving", "packages/pricing", "packages/sales", "packages/expenses", "packages/returns", "packages/storefront-config"],
    pattern: /@bravos\/corrections/,
    message: "Owned features cannot import the corrections coordinator.",
  },
  {
    from: ["packages/storefront-config"],
    pattern: /@bravos\/(catalog|inventory|receiving|sales|expenses|persistence)/,
    message: "Storefront configuration cannot import other business features.",
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
