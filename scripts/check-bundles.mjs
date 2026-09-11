import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const internalDist = path.resolve("apps/internal/dist");
const storefrontNext = path.resolve("apps/storefront/.next");

const internalFiles = await collect(internalDist, /\.(js|css|html)$/);
if (internalFiles.length === 0) {
  throw new Error("Internal production build is missing.");
}
const staffChunk = internalFiles.find((file) => path.basename(file).includes("staff-management"));
if (!staffChunk) {
  throw new Error("Staff management was not split into its own chunk.");
}
const catalogChunk = internalFiles.find((file) => path.basename(file).includes("catalog-maintenance"));
if (!catalogChunk) {
  throw new Error("Catalog maintenance was not split into its own chunk.");
}
const lookupChunk = internalFiles.find((file) => path.basename(file).includes("cashier-lookup"));
if (!lookupChunk) {
  throw new Error("Cashier lookup was not split into its own chunk.");
}
const receivingChunk = internalFiles.find((file) => path.basename(file).includes("receiving-stock"));
if (!receivingChunk) {
  throw new Error("Receiving was not split into its own chunk.");
}
const salesChunk = internalFiles.find((file) => path.basename(file).includes("cashier-sales"));
if (!salesChunk) {
  throw new Error("Cashier sales was not split into its own chunk.");
}

const loginHtml = await readFile(path.join(internalDist, "index.html"), "utf8");
const referenced = [...loginHtml.matchAll(/assets\/[^\s"]+\.js/g)].map((match) => match[0]);
if (referenced.length === 0) {
  throw new Error("Internal login HTML has no JavaScript entry.");
}

const staticGraph = new Set();
for (const asset of referenced) {
  await walkStaticImports(path.join(internalDist, asset), staticGraph);
}

for (const file of staticGraph) {
  const source = await readFile(file, "utf8");
  if (source.includes("إنشاء حساب موظف") || source.includes("StaffPage")) {
    throw new Error(`${path.relative(internalDist, file)} should not include staff management for the initial login route.`);
  }
  if (source.includes("إنشاء منتج") || source.includes("CatalogPage") || source.includes("LookupPage") || source.includes("البحث برمز المنتج") || source.includes("إذن استلام جديد") || source.includes("دفعات التكلفة") || source.includes("سلة البيع") || source.includes("SalesPage")) {
    throw new Error(`${path.relative(internalDist, file)} should not include catalog, lookup, receiving or sales screens for the initial login route.`);
  }
  if (path.basename(file).includes("staff-management")) {
    throw new Error("Login entry statically imports the staff-management chunk.");
  }
  if (path.basename(file).includes("catalog-maintenance") || path.basename(file).includes("cashier-lookup") || path.basename(file).includes("receiving-stock") || path.basename(file).includes("cashier-sales")) {
    throw new Error("Login entry statically imports a catalog, lookup, receiving or sales chunk.");
  }
}

const dynamicStaff = [];
const dynamicCatalog = [];
const dynamicLookup = [];
const dynamicReceiving = [];
const dynamicSales = [];
for (const file of staticGraph) {
  const source = await readFile(file, "utf8");
  const specifiers = dynamicImportSpecifiers(source);
  dynamicStaff.push(...specifiers.filter((specifier) => specifier.includes("staff-management")));
  dynamicCatalog.push(...specifiers.filter((specifier) => specifier.includes("catalog-maintenance")));
  dynamicLookup.push(...specifiers.filter((specifier) => specifier.includes("cashier-lookup")));
  dynamicReceiving.push(...specifiers.filter((specifier) => specifier.includes("receiving-stock")));
  dynamicSales.push(...specifiers.filter((specifier) => specifier.includes("cashier-sales")));
}
if (dynamicStaff.length === 0) {
  throw new Error("Staff management chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicCatalog.length === 0) {
  throw new Error("Catalog maintenance chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicLookup.length === 0) {
  throw new Error("Cashier lookup chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicReceiving.length === 0) {
  throw new Error("Receiving chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicSales.length === 0) {
  throw new Error("Cashier sales chunk is not loaded through a dynamic import from the login graph.");
}

const storefrontFiles = await collect(storefrontNext, /\.(js|html)$/);
if (storefrontFiles.length === 0) {
  throw new Error("Public storefront production build is missing.");
}
for (const file of storefrontFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes("@bravos/identity") || source.includes("إدارة الموظفين") || source.includes("إدارة المنتجات") || source.includes("استلام المخزون") || source.includes("@bravos/catalog") || source.includes("@bravos/inventory") || source.includes("@bravos/receiving") || source.includes("@bravos/sales")) {
    throw new Error(`Public build leaked internal staff modules: ${file}`);
  }
}

console.log(
  `bundle separation ok: internal files=${internalFiles.length}, storefront files=${storefrontFiles.length}, static entry files=${staticGraph.size}`,
);

async function walkStaticImports(file, seen) {
  const resolved = path.normalize(file);
  if (seen.has(resolved)) {
    return;
  }
  seen.add(resolved);
  const source = await readFile(resolved, "utf8");
  for (const specifier of staticImportSpecifiers(source)) {
    await walkStaticImports(path.resolve(path.dirname(resolved), specifier), seen);
  }
}

function staticImportSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/(?<![\w$.])import\s*["'](\.[^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function dynamicImportSpecifiers(source) {
  return [...source.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]);
}

async function collect(dir, pattern, acc = []) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      await collect(full, pattern, acc);
    } else if (pattern.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}
