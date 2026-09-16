import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const internalDist = path.resolve("apps/internal/dist");
const storefrontNext = path.resolve("apps/storefront/.next");

const internalFiles = await collect(internalDist, /\.(js|css|html)$/);
if (internalFiles.length === 0) {
  throw new Error("Internal production build is missing.");
}
const serverOnlyExportTokens = ["@react-pdf/renderer", "@ayocore/exceljs", "Cairo-Regular", "BravosArabic"];
for (const file of internalFiles) {
  const source = await readFile(file, "utf8");
  if (serverOnlyExportTokens.some((token) => source.includes(token))) {
    throw new Error(`Internal browser build contains server-only report export runtime: ${file}`);
  }
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
const expensesChunk = internalFiles.find((file) => path.basename(file).includes("expenses-online"));
if (!expensesChunk) {
  throw new Error("Expenses was not split into its own chunk.");
}
const offersChunk = internalFiles.find((file) => path.basename(file).includes("offer-management"));
if (!offersChunk) {
  throw new Error("Offer management was not split into its own chunk.");
}
const returnsChunk = internalFiles.find((file) => path.basename(file).includes("physical-returns"));
if (!returnsChunk) {
  throw new Error("Returns was not split into its own chunk.");
}
const correctionsChunk = internalFiles.find((file) => path.basename(file).includes("recording-corrections"));
if (!correctionsChunk) {
  throw new Error("Recording corrections were not split into their own chunk.");
}
const storefrontSettingsChunk = internalFiles.find((file) => path.basename(file).includes("storefront-settings"));
if (!storefrontSettingsChunk) {
  throw new Error("Storefront settings were not split into their own chunk.");
}
const onlineOrdersChunk = internalFiles.find((file) => path.basename(file).includes("online-order-operations"));
if (!onlineOrdersChunk) {
  throw new Error("Online order operations were not split into their own chunk.");
}
const openingImportChunk = internalFiles.find((file) => path.basename(file).includes("opening-import"));
if (!openingImportChunk) {
  throw new Error("Opening import was not split into its own chunk.");
}
const managementReportsChunk = internalFiles.find((file) => path.basename(file).includes("management-reports"));
if (!managementReportsChunk) {
  throw new Error("Management reports were not split into their own chunk.");
}
const storefrontAnalyticsChunk = internalFiles.find((file) => path.basename(file).includes("storefront-analytics"));
if (!storefrontAnalyticsChunk) {
  throw new Error("Storefront analytics were not split into their own chunk.");
}
const managerBackupChunk = internalFiles.find((file) => path.basename(file).includes("manager-backup"));
if (!managerBackupChunk) {
  throw new Error("Manager backup was not split into its own chunk.");
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
  if (file === openingImportChunk) {
    throw new Error("Login entry statically imports opening import.");
  }
  if (file === onlineOrdersChunk) {
    throw new Error("Login entry statically imports online order operations.");
  }
  if (file === managementReportsChunk) {
    throw new Error("Login entry statically imports management reports.");
  }
  if (file === storefrontAnalyticsChunk) {
    throw new Error("Login entry statically imports storefront analytics.");
  }
  if (file === managerBackupChunk) {
    throw new Error("Login entry statically imports manager backup.");
  }
  const source = await readFile(file, "utf8");
  if (source.includes("نسخة احتياطية للبيانات") || source.includes("/api/internal/backups")) {
    throw new Error(`${path.relative(internalDist, file)} should not include manager backup for the initial login route.`);
  }
  if (source.includes("إنشاء حساب موظف") || source.includes("StaffPage")) {
    throw new Error(`${path.relative(internalDist, file)} should not include staff management for the initial login route.`);
  }
  if (source.includes("إنشاء منتج") || source.includes("CatalogPage") || source.includes("LookupPage") || source.includes("البحث برمز المنتج") || source.includes("إذن استلام جديد") || source.includes("دفعات التكلفة") || source.includes("سلة البيع") || source.includes("SalesPage") || source.includes("ExpensePage") || source.includes("مصروف جديد") || source.includes("OffersPage") || source.includes("عرض جديد") || source.includes("ReturnsPage") || source.includes("اختيار البيع الأصلي") || source.includes("CorrectionsPage") || source.includes("الإلغاء وحده لا يعيد بضاعة") || source.includes("StorefrontSettingsPage") || source.includes("إعداد روابط التواصل في المتجر")) {
    throw new Error(`${path.relative(internalDist, file)} should not include optional operational screens for the initial login route.`);
  }
  if (path.basename(file).includes("staff-management")) {
    throw new Error("Login entry statically imports the staff-management chunk.");
  }
  if (path.basename(file).includes("catalog-maintenance") || path.basename(file).includes("cashier-lookup") || path.basename(file).includes("receiving-stock") || path.basename(file).includes("cashier-sales") || path.basename(file).includes("expenses-online") || path.basename(file).includes("offer-management") || path.basename(file).includes("physical-returns") || path.basename(file).includes("recording-corrections") || path.basename(file).includes("storefront-settings")) {
    throw new Error("Login entry statically imports an optional operational chunk.");
  }
}

const dynamicStaff = [];
const dynamicCatalog = [];
const dynamicLookup = [];
const dynamicReceiving = [];
const dynamicSales = [];
const dynamicExpenses = [];
const dynamicOffers = [];
const dynamicReturns = [];
const dynamicCorrections = [];
const dynamicStorefrontSettings = [];
const dynamicOnlineOrders = [];
const dynamicOpeningImport = [];
const dynamicManagementReports = [];
const dynamicStorefrontAnalytics = [];
const dynamicManagerBackup = [];
for (const file of staticGraph) {
  const source = await readFile(file, "utf8");
  const specifiers = dynamicImportSpecifiers(source);
  dynamicStaff.push(...specifiers.filter((specifier) => specifier.includes("staff-management")));
  dynamicCatalog.push(...specifiers.filter((specifier) => specifier.includes("catalog-maintenance")));
  dynamicLookup.push(...specifiers.filter((specifier) => specifier.includes("cashier-lookup")));
  dynamicReceiving.push(...specifiers.filter((specifier) => specifier.includes("receiving-stock")));
  dynamicSales.push(...specifiers.filter((specifier) => specifier.includes("cashier-sales")));
  dynamicExpenses.push(...specifiers.filter((specifier) => specifier.includes("expenses-online")));
  dynamicOffers.push(...specifiers.filter((specifier) => specifier.includes("offer-management")));
  dynamicReturns.push(...specifiers.filter((specifier) => specifier.includes("physical-returns")));
  dynamicCorrections.push(...specifiers.filter((specifier) => specifier.includes("recording-corrections")));
  dynamicStorefrontSettings.push(...specifiers.filter((specifier) => specifier.includes("storefront-settings")));
  dynamicOnlineOrders.push(...specifiers.filter((specifier) => specifier.includes("online-order-operations")));
  dynamicOpeningImport.push(...specifiers.filter((specifier) => specifier.includes("opening-import")));
  dynamicManagementReports.push(...specifiers.filter((specifier) => specifier.includes("management-reports")));
  dynamicStorefrontAnalytics.push(...specifiers.filter((specifier) => specifier.includes("storefront-analytics")));
  dynamicManagerBackup.push(...specifiers.filter((specifier) => specifier.includes("manager-backup")));
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
if (dynamicExpenses.length === 0) {
  throw new Error("Expenses chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicOffers.length === 0) {
  throw new Error("Offer management chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicReturns.length === 0) {
  throw new Error("Returns chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicCorrections.length === 0) {
  throw new Error("Recording corrections chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicStorefrontSettings.length === 0) {
  throw new Error("Storefront settings chunk is not loaded through a dynamic import from the login graph.");
}
if (dynamicOnlineOrders.length === 0) {
  throw new Error("Online order operations are not loaded through a dynamic import from the login graph.");
}
if (dynamicOpeningImport.length === 0) {
  throw new Error("Opening import is not loaded through a dynamic import from the login graph.");
}
if (dynamicManagementReports.length === 0) {
  throw new Error("Management reports are not loaded through a dynamic import from the login graph.");
}
if (dynamicStorefrontAnalytics.length === 0) {
  throw new Error("Storefront analytics are not loaded through a dynamic import from the login graph.");
}
if (dynamicManagerBackup.length === 0) {
  throw new Error("Manager backup is not loaded through a dynamic import from the login graph.");
}

for (const file of internalFiles) {
  const source = await readFile(file, "utf8");
  if (
    source.includes("@bravos/backup")
    || source.includes("decodeBackupArchive")
    || source.includes("createNodeBackupCrypto")
    || source.includes("BRAVOS-BACKUP")
  ) {
    throw new Error(`Internal browser build contains private server archive implementation: ${file}`);
  }
}

const swFile = internalFiles.find((file) => /(^|\/)sw\.js$/.test(file.replaceAll("\\", "/")));
if (!swFile) {
  throw new Error("Production service worker is missing.");
}
const swSource = await readFile(swFile, "utf8");
if (serverOnlyExportTokens.some((token) => swSource.includes(token))) {
  throw new Error("Service worker contains server-only report export runtime.");
}
if (swSource.includes("opening-import")) {
  throw new Error("Service worker precaches online-only opening import.");
}
if (swSource.includes("online-order-operations")) {
  throw new Error("Service worker precaches online-only order operations.");
}
if (swSource.includes("management-reports")) {
  throw new Error("Service worker precaches manager-only reports.");
}
if (swSource.includes("storefront-analytics")) {
  throw new Error("Service worker precaches manager-only storefront analytics.");
}
if (swSource.includes("manager-backup")) {
  throw new Error("Service worker precaches online-only manager backup.");
}
if (!swSource.includes("cashier-lookup")) {
  throw new Error("Service worker does not precache the essential POS lookup chunk.");
}
if (!swSource.includes("cashier-sales")) {
  throw new Error("Service worker does not precache the essential POS sales chunk.");
}
if (!swSource.includes("POS_SW_SCHEMA_VERSION") && !swSource.includes("schemaVersion")) {
  throw new Error("Service worker does not publish POS schema version to waiting clients.");
}
if (swSource.includes("staff-management") || swSource.includes("catalog-maintenance") || swSource.includes("receiving-stock") || swSource.includes("expenses-online") || swSource.includes("offer-management") || swSource.includes("physical-returns") || swSource.includes("recording-corrections") || swSource.includes("storefront-settings")) {
  throw new Error("Service worker precaches optional manager/receiving/returns chunks.");
}
if (/\/api\/(?:auth|internal)/.test(swSource) && swSource.includes("CacheFirst")) {
  throw new Error("Service worker must not cache auth or privileged APIs with CacheFirst.");
}
if (swSource.includes("unitCostPiasters") || swSource.includes("inventoryValue")) {
  throw new Error("Service worker precache contains restricted cost data.");
}

const storefrontFiles = await collect(storefrontNext, /\.(js|html)$/);
if (storefrontFiles.length === 0) {
  throw new Error("Public storefront production build is missing.");
}
for (const file of storefrontFiles) {
  const source = await readFile(file, "utf8");
  if (serverOnlyExportTokens.some((token) => source.includes(token))) {
    throw new Error(`Public build contains server-only report export runtime: ${file}`);
  }
  if (source.includes("@bravos/opening-import") || source.includes("OpeningImportPage") || source.includes("مراجعة واستيراد البيانات الافتتاحية")) {
    throw new Error(`Public build leaked opening import: ${file}`);
  }
  if (
    source.includes("@bravos/backup")
    || source.includes("BackupPage")
    || source.includes("manager-backup")
    || source.includes("/api/internal/backups")
    || source.includes("x-bravos-backup-sha256")
    || source.includes("نسخة احتياطية للبيانات")
  ) {
    throw new Error(`Public build leaked manager backup: ${file}`);
  }
  if (source.includes("@bravos/identity") || source.includes("إدارة الموظفين") || source.includes("إدارة المنتجات") || source.includes("استلام المخزون") || source.includes("الإلغاء وحده لا يعيد بضاعة") || source.includes("مصروف جديد") || source.includes("ExpensesPage") || source.includes("CorrectionsPage") || source.includes("@bravos/catalog") || source.includes("@bravos/inventory") || source.includes("@bravos/receiving") || source.includes("@bravos/sales") || source.includes("@bravos/expenses") || source.includes("@bravos/corrections")) {
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
