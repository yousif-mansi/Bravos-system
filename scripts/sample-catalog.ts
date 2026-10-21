import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEVELOPMENT_API_ORIGIN = "http://127.0.0.1:3010";
export const DEVELOPMENT_INTERNAL_ORIGIN = "http://127.0.0.1:5173";
export const SAMPLE_VERSION = "bravos-sample-range-2026-10-13-v1";
export const SAMPLE_RECEIPT_DATE = "2026-10-13";
export const SAMPLE_QUANTITY = 5;
export const MEDIA_BYTE_LIMIT = 5 * 1024 * 1024;
export const MEDIA_DIMENSION_LIMIT = 8_000;
export const MEDIA_PIXEL_LIMIT = 20_000_000;
export const MANIFEST_RELATIVE_PATH = path.join("assets", "sample-catalog", "catalog.json");

const EXPECTED_BRANCH_CODES = ["abshway", "fayoum"] as const;
const CATEGORY_ORDER = ["Pants", "Jackets", "Shirts", "T-Shirts"] as const;
const CATEGORY_COUNTS: Record<(typeof CATEGORY_ORDER)[number], number> = {
  Pants: 8,
  Jackets: 6,
  Shirts: 8,
  "T-Shirts": 8,
};
const CATEGORY_DEFAULTS: Record<(typeof CATEGORY_ORDER)[number], {
  pricePiasters: number;
  costPiasters: number;
  sizes: readonly string[];
}> = {
  Pants: { pricePiasters: 109900, costPiasters: 55000, sizes: ["30", "32", "34", "36"] },
  Jackets: { pricePiasters: 169900, costPiasters: 90000, sizes: ["S", "M", "L", "XL"] },
  Shirts: { pricePiasters: 89900, costPiasters: 45000, sizes: ["S", "M", "L", "XL"] },
  "T-Shirts": { pricePiasters: 39900, costPiasters: 18000, sizes: ["S", "M", "L", "XL"] },
};
const PRODUCT_CODE_PATTERN = /^BRV-SAMPLE-(0[0-2][0-9]|030)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_REF_PATTERN = /^products\/[0-9A-Za-z][0-9A-Za-z._-]{0,119}\.(?:png|webp)$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const COST_TOKENS = ["unitCostPiasters", "costPiasters", "purchaseCost", "effectiveUnitCost", "\"profit\""];

export class SampleCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleCatalogError";
  }
}

export type SampleCategoryName = (typeof CATEGORY_ORDER)[number];

export type SampleProductSpec = {
  code: string;
  category: SampleCategoryName;
  name: string;
  color: string;
  description: string;
  image: string;
  pricePiasters: number;
  costPiasters: number;
  sizes: readonly string[];
};

export type SampleManifest = {
  version: typeof SAMPLE_VERSION;
  receiptDate: typeof SAMPLE_RECEIPT_DATE;
  quantityPerVariantPerBranch: typeof SAMPLE_QUANTITY;
  products: SampleProductSpec[];
};

export type WorkspaceBranch = {
  id: string;
  code: (typeof EXPECTED_BRANCH_CODES)[number];
  nameAr: string;
};

export type NormalizedVariant = {
  id: string;
  sizeId: string;
  sizeName: string;
  colorId: string;
  colorName: string;
  onlineVisible: boolean;
  sellingPricePiastersOverride: number | null;
  sellingPricePiasters: number;
};

export type NormalizedProduct = {
  id: string;
  editRevision: number;
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  categoryName: string;
  categoryParentId: string | null;
  defaultSellingPricePiasters: number;
  publication: "available" | "coming_soon" | "hidden";
  imageRefs: string[];
  sizeGuideAr: string | null;
  variants: NormalizedVariant[];
};

export type HiddenProductPayload = {
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultSellingPricePiasters: number;
  publication: "hidden";
  imageRefs: [];
  sizeGuideAr: null;
  variants: Array<{
    sizeId: string;
    colorId: string;
    onlineVisible: false;
    sellingPricePiastersOverride: null;
  }>;
};

export type PublishPayload = {
  expectedRevision: number;
  expectedVariantIds: string[];
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultSellingPricePiasters: number;
  publication: "available";
  imageRefs: [string];
  sizeGuideAr: null;
  variants: Array<{
    sizeId: string;
    colorId: string;
    onlineVisible: true;
    sellingPricePiastersOverride: null;
  }>;
};

export type ReceiptPayload = {
  operationId: string;
  branchId: string;
  receiptDate: typeof SAMPLE_RECEIPT_DATE;
  lines: Array<{ variantId: string; quantity: typeof SAMPLE_QUANTITY; unitCostPiasters: number }>;
};

export type TaxonomyIds = {
  categoryIds: Record<SampleCategoryName, string>;
  sizeIds: Record<string, string>;
  colorIds: Record<string, string>;
};

type CliCommand = {
  command: "plan" | "apply" | "verify";
  apiOrigin: string;
  internalOrigin: string;
  credentialsFile?: string;
};

type ImageReadiness = { missingCodes: string[]; invalidCodes: string[] };

type OwnerCredentials = { username: string; password: string };

type ApiResult = { status: number; body: unknown; setCookies: string[] };

type BaselineSnapshot = {
  version: typeof SAMPLE_VERSION;
  branches: WorkspaceBranch[];
  categories: Array<{ id: string; nameAr: string; parentId: string | null }>;
  sizes: Array<{ id: string; nameAr: string }>;
  colors: Array<{ id: string; nameAr: string }>;
  products: NormalizedProduct[];
  receipts: ReceiptFingerprint[];
};

type ReceiptFingerprint = {
  id: string;
  operationId: string;
  branchId: string;
  receiptDate: string;
  correctionRevision: number;
  lines: Array<{
    variantId: string;
    quantity: number;
    unitCostPiasters: number;
    effectiveQuantity: number;
    effectiveUnitCostPiasters: number;
  }>;
};

type UploadIntent = { fileName: string; contentType: SampleImageContentType; byteLength: number; sha256: string };
type UploadResponse = { ref: string; contentType: string; byteLength: number; source: "upload" | "existing-product-media" };
type ProductCheckpoint = { id: string; code: string; variantIds: string[] };

export function parseSampleManifest(input: unknown): SampleManifest {
  const body = objectValue(input, "Sample manifest is not an object.");
  assertExactKeys(body, ["version", "purpose", "receiptDate", "quantityPerVariantPerBranch", "categoryDefaults", "products"], "Sample manifest");
  if (body.version !== SAMPLE_VERSION) {
    throw new SampleCatalogError("Sample manifest version is not the authorized 2026-10-13 range.");
  }
  if (typeof body.purpose !== "string" || body.purpose.trim().length < 1) {
    throw new SampleCatalogError("Sample manifest purpose is missing.");
  }
  if (body.receiptDate !== SAMPLE_RECEIPT_DATE) {
    throw new SampleCatalogError("Sample receipt date must stay 2026-10-13.");
  }
  if (body.quantityPerVariantPerBranch !== SAMPLE_QUANTITY) {
    throw new SampleCatalogError("Sample quantity must stay 5 units per variant per branch.");
  }
  const defaults = objectValue(body.categoryDefaults, "Sample category defaults are invalid.");
  assertExactKeys(defaults, [...CATEGORY_ORDER], "Sample category defaults");
  for (const category of CATEGORY_ORDER) {
    const entry = objectValue(defaults[category], `Sample ${category} defaults are invalid.`);
    assertExactKeys(entry, ["pricePiasters", "costPiasters", "sizes"], `Sample ${category} defaults`);
    const expected = CATEGORY_DEFAULTS[category];
    if (entry.pricePiasters !== expected.pricePiasters || entry.costPiasters !== expected.costPiasters) {
      throw new SampleCatalogError(`Sample ${category} price or cost does not match the authorized manifest.`);
    }
    if (!sameStrings(entry.sizes, expected.sizes)) {
      throw new SampleCatalogError(`Sample ${category} sizes do not match the authorized manifest.`);
    }
  }
  if (!Array.isArray(body.products) || body.products.length !== 30) {
    throw new SampleCatalogError("Sample manifest must contain exactly 30 products.");
  }
  const products = body.products.map((entry, index) => parseProduct(entry, index));
  const counts = { Pants: 0, Jackets: 0, Shirts: 0, "T-Shirts": 0 };
  for (const product of products) counts[product.category] += 1;
  for (const category of CATEGORY_ORDER) {
    if (counts[category] !== CATEGORY_COUNTS[category]) {
      throw new SampleCatalogError(`Sample ${category} count does not match the authorized manifest.`);
    }
  }
  return {
    version: SAMPLE_VERSION,
    receiptDate: SAMPLE_RECEIPT_DATE,
    quantityPerVariantPerBranch: SAMPLE_QUANTITY,
    products,
  };
}

export function stableUuid(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function receiptOperationId(code: string, branchId: string): string {
  return stableUuid(`bravos-sample-catalog:${SAMPLE_VERSION}:receipt:${code}:${branchId}`);
}

export function assertDevelopmentTarget(input: {
  apiOrigin: string;
  internalOrigin: string;
  nodeEnv: string | undefined;
  loopbackRehearsal: string | undefined;
  configuredApiOrigin: string | undefined;
  configuredInternalOrigin: string | undefined;
}): void {
  if (input.nodeEnv === "production") {
    throw new SampleCatalogError("Sample intake refuses to run when NODE_ENV=production.");
  }
  if (input.loopbackRehearsal === "true") {
    throw new SampleCatalogError("Sample intake refuses a production loopback rehearsal environment.");
  }
  if (input.configuredApiOrigin !== undefined && input.configuredApiOrigin !== DEVELOPMENT_API_ORIGIN) {
    throw new SampleCatalogError("Sample intake refuses BRAVOS_API_ORIGIN when it is not http://127.0.0.1:3010.");
  }
  if (input.configuredInternalOrigin !== undefined && input.configuredInternalOrigin !== DEVELOPMENT_INTERNAL_ORIGIN) {
    throw new SampleCatalogError("Sample intake refuses BRAVOS_INTERNAL_ORIGIN when it is not http://127.0.0.1:5173.");
  }
  if (input.apiOrigin !== DEVELOPMENT_API_ORIGIN) {
    throw new SampleCatalogError("Sample intake accepts only the development loopback API http://127.0.0.1:3010.");
  }
  if (input.internalOrigin !== DEVELOPMENT_INTERNAL_ORIGIN) {
    throw new SampleCatalogError("Sample intake accepts only the development internal origin http://127.0.0.1:5173.");
  }
}

export function assertExpectedBranches(branches: unknown): WorkspaceBranch[] {
  if (!Array.isArray(branches)) {
    throw new SampleCatalogError("Workspace branches were not a list. Sample intake stopped.");
  }
  if (branches.length !== 2) {
    throw new SampleCatalogError(`Expected 2 configured branches, found ${branches.length}. Sample intake stopped.`);
  }
  const parsed = branches.map((entry) => {
    const body = objectValue(entry, "A workspace branch was not an object.");
    const id = typeof body.id === "string" ? body.id : "";
    const code = body.code;
    const nameAr = typeof body.nameAr === "string" ? body.nameAr : "";
    if (!UUID_PATTERN.test(id) || (code !== "abshway" && code !== "fayoum") || nameAr.trim().length < 1) {
      throw new SampleCatalogError("Configured branches are not the two expected workspace branches. Sample intake stopped.");
    }
    return { id, code, nameAr };
  });
  const codes = new Set(parsed.map((branch) => branch.code));
  const ids = new Set(parsed.map((branch) => branch.id));
  if (codes.size !== 2 || ids.size !== 2 || !codes.has("abshway") || !codes.has("fayoum")) {
    throw new SampleCatalogError("Configured branches are not the two expected workspace branches. Sample intake stopped.");
  }
  return [...parsed].sort((left, right) => left.code.localeCompare(right.code));
}

export function parseOwnerCredentials(text: string): OwnerCredentials {
  let username: string | undefined;
  let password: string | undefined;
  for (const line of text.split(/\n/)) {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    const login = /^owner login:\s*(.*)$/i.exec(trimmed);
    if (login) {
      if (username !== undefined) throw new SampleCatalogError("Credentials file has more than one owner login.");
      username = login[1] ?? "";
    }
    const secret = /^owner password:(.*)$/i.exec(trimmed);
    if (secret) {
      if (password !== undefined) throw new SampleCatalogError("Credentials file has more than one owner password.");
      password = (secret[1] ?? "").replace(/^ /, "");
    }
  }
  if (!username || username.trim().length < 1 || !password || password === "unknown") {
    throw new SampleCatalogError("Owner credentials are missing or unverified in the credentials file.");
  }
  return { username, password };
}

export function selectOwnerCredentials(input: {
  envUsername: string | undefined;
  envPassword: string | undefined;
  fileText: string | undefined;
}): OwnerCredentials {
  const envUsername = blankToUndefined(input.envUsername);
  const envPassword = input.envPassword === undefined || input.envPassword.length === 0 ? undefined : input.envPassword;
  if ((envUsername === undefined) !== (envPassword === undefined)) {
    throw new SampleCatalogError("Set both BRAVOS_SAMPLE_CATALOG_USERNAME and BRAVOS_SAMPLE_CATALOG_PASSWORD, or use --credentials-file.");
  }
  if (envUsername !== undefined && envPassword !== undefined && input.fileText !== undefined) {
    throw new SampleCatalogError("Pass owner credentials with environment variables or --credentials-file, not both.");
  }
  if (envUsername !== undefined && envPassword !== undefined) {
    if (envPassword === "unknown") {
      throw new SampleCatalogError("Owner credentials are missing or unverified.");
    }
    return { username: envUsername, password: envPassword };
  }
  if (input.fileText !== undefined) return parseOwnerCredentials(input.fileText);
  throw new SampleCatalogError("Owner credentials are missing. Set BRAVOS_SAMPLE_CATALOG_USERNAME and BRAVOS_SAMPLE_CATALOG_PASSWORD, or pass --credentials-file .local/demo-credentials.txt.");
}

export function credentialsPathDecision(localRoot: string, candidate: string): void {
  const relative = path.relative(path.resolve(localRoot), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SampleCatalogError("Credentials file must be an explicit file inside .local.");
  }
  const folded = relative.replaceAll("\\", "/").toLowerCase();
  if (folded.includes("e2e") || folded.includes("storefront-demo")) {
    throw new SampleCatalogError("Sample intake does not read e2e or isolated demo credentials.");
  }
}

export type SampleImageFormat = "png" | "webp";
export type SampleImageContentType = "image/png" | "image/webp";
export type SampleImageInspection = {
  format: SampleImageFormat;
  contentType: SampleImageContentType;
  width: number;
  height: number;
  byteLength: number;
};

export function inspectPng(bytes: Uint8Array): { width: number; height: number; byteLength: number } {
  if (bytes.byteLength < 24 || bytes.byteLength > MEDIA_BYTE_LIMIT) {
    throw new SampleCatalogError("Sample image must be a PNG of at most 5 MiB.");
  }
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new SampleCatalogError("Sample image must be a PNG of at most 5 MiB.");
  }
  const chunkType = String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0);
  if (chunkType !== "IHDR") {
    throw new SampleCatalogError("Sample image must be a PNG of at most 5 MiB.");
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  assertMediaDimensions(width, height);
  return { width, height, byteLength: bytes.byteLength };
}

export function inspectSampleImage(bytes: Uint8Array): SampleImageInspection {
  if (bytes.byteLength < 12 || bytes.byteLength > MEDIA_BYTE_LIMIT) {
    throw new SampleCatalogError("Sample image must be a PNG or WebP of at most 5 MiB.");
  }
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    const png = inspectPng(bytes);
    return { format: "png", contentType: "image/png", width: png.width, height: png.height, byteLength: png.byteLength };
  }
  if (fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP") {
    const size = readWebpDimensions(bytes);
    assertMediaDimensions(size.width, size.height);
    return { format: "webp", contentType: "image/webp", width: size.width, height: size.height, byteLength: bytes.byteLength };
  }
  throw new SampleCatalogError("Sample image must be a PNG or WebP of at most 5 MiB.");
}

export function reviewSampleImageFile(bytes: Uint8Array, imagePath: string): SampleImageInspection {
  const inspection = inspectSampleImage(bytes);
  const suffix = imagePath.split(/[/\\]/).at(-1)?.split(".").at(-1);
  if (suffix !== inspection.format) {
    throw new SampleCatalogError("Sample image content does not match the manifest path extension.");
  }
  return inspection;
}

export function uploadDescriptor(code: string, inspection: SampleImageInspection): { fileName: string; contentType: SampleImageContentType } {
  return { fileName: `${code}.${inspection.format}`, contentType: inspection.contentType };
}

export function reviewPublicMedia(input: {
  expected: SampleImageInspection;
  contentType: string;
  bytes: Uint8Array;
}): string | null {
  const header = input.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (header !== input.expected.contentType) return "public media type does not match the uploaded format";
  let actual: SampleImageInspection;
  try {
    actual = inspectSampleImage(input.bytes);
  } catch (error) {
    return error instanceof SampleCatalogError ? error.message : "public media could not be inspected";
  }
  if (actual.format !== input.expected.format) return "public media signature does not match the uploaded format";
  if (actual.width !== input.expected.width || actual.height !== input.expected.height) {
    return "public media dimensions do not match the uploaded image";
  }
  return null;
}

export function findPublicCostLeak(value: unknown): string | null {
  const raw = JSON.stringify(value) ?? "";
  for (const token of COST_TOKENS) {
    if (raw.includes(token)) return token;
  }
  return findCostKey(value, "$");
}

export function buildHiddenProductPayload(spec: SampleProductSpec, taxonomy: TaxonomyIds): HiddenProductPayload {
  return {
    code: spec.code,
    nameAr: spec.name,
    descriptionAr: spec.description,
    categoryId: requiredTaxonomyId(taxonomy.categoryIds[spec.category], spec.category),
    defaultSellingPricePiasters: spec.pricePiasters,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: spec.sizes.map((size) => ({
      sizeId: requiredTaxonomyId(taxonomy.sizeIds[size], size),
      colorId: requiredTaxonomyId(taxonomy.colorIds[spec.color], spec.color),
      onlineVisible: false,
      sellingPricePiastersOverride: null,
    })),
  };
}

export function buildPublishPayload(product: NormalizedProduct, spec: SampleProductSpec, imageRef: string): PublishPayload {
  if (!MEDIA_REF_PATTERN.test(imageRef)) {
    throw new SampleCatalogError(`Media ref for ${spec.code} is not an accepted PNG or WebP product image.`);
  }
  const variants = pairVariants(product, spec);
  return {
    expectedRevision: product.editRevision,
    expectedVariantIds: variants.map((variant) => variant.id).sort(),
    code: spec.code,
    nameAr: spec.name,
    descriptionAr: spec.description,
    categoryId: product.categoryId,
    defaultSellingPricePiasters: spec.pricePiasters,
    publication: "available",
    imageRefs: [imageRef],
    sizeGuideAr: null,
    variants: variants.map((variant) => ({
      sizeId: variant.sizeId,
      colorId: variant.colorId,
      onlineVisible: true,
      sellingPricePiastersOverride: null,
    })),
  };
}

export function buildReceiptPayload(spec: SampleProductSpec, branchId: string, variants: NormalizedVariant[]): ReceiptPayload {
  if (!UUID_PATTERN.test(branchId)) {
    throw new SampleCatalogError("Receipt branch id is not a workspace UUID.");
  }
  const paired = pairVariants({ variants } as NormalizedProduct, spec);
  return {
    operationId: receiptOperationId(spec.code, branchId),
    branchId,
    receiptDate: SAMPLE_RECEIPT_DATE,
    lines: paired
      .map((variant) => ({
        variantId: variant.id,
        quantity: SAMPLE_QUANTITY,
        unitCostPiasters: spec.costPiasters,
      }))
      .sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function assertSamePayload(saved: unknown, computed: unknown, label: string): void {
  if (canonicalJson(saved) !== canonicalJson(computed)) {
    throw new SampleCatalogError(`${label} differs from the payload saved before the first request. Sample intake stopped.`);
  }
}

export function adoptionProblems(product: NormalizedProduct, spec: SampleProductSpec, taxonomy: TaxonomyIds): string[] {
  const problems: string[] = [];
  if (normalizeCode(product.code) !== normalizeCode(spec.code)) problems.push("code");
  if (product.nameAr !== spec.name) problems.push("name");
  if (product.descriptionAr !== spec.description) problems.push("description");
  if (product.categoryId !== taxonomy.categoryIds[spec.category] || product.categoryName !== spec.category || product.categoryParentId !== null) {
    problems.push("category");
  }
  if (product.defaultSellingPricePiasters !== spec.pricePiasters) problems.push("price");
  if (product.sizeGuideAr !== null) problems.push("size-guide");
  if (product.variants.some((variant) => variant.sellingPricePiastersOverride !== null)) problems.push("override");
  try {
    pairVariants(product, spec);
  } catch {
    problems.push("pairs");
  }
  if (product.publication === "coming_soon") problems.push("publication");
  if (product.publication === "hidden" && product.variants.some((variant) => variant.onlineVisible)) problems.push("visibility");
  if (product.publication === "available" && product.variants.some((variant) => !variant.onlineVisible)) problems.push("visibility");
  if (product.imageRefs.length > 1 || product.imageRefs.some((ref) => !MEDIA_REF_PATTERN.test(ref))) problems.push("images");
  if (product.publication === "available" && product.imageRefs.length !== 1) problems.push("images");
  return [...new Set(problems)];
}

export function matchesDesiredPublish(product: NormalizedProduct, desired: PublishPayload): boolean {
  if (product.publication !== "available" || product.sizeGuideAr !== null) return false;
  if (product.code !== desired.code || product.nameAr !== desired.nameAr || product.descriptionAr !== desired.descriptionAr) return false;
  if (product.categoryId !== desired.categoryId || product.defaultSellingPricePiasters !== desired.defaultSellingPricePiasters) return false;
  if (product.imageRefs.length !== 1 || product.imageRefs[0] !== desired.imageRefs[0]) return false;
  const actualIds = product.variants.map((variant) => variant.id).sort();
  if (canonicalJson(actualIds) !== canonicalJson(desired.expectedVariantIds)) return false;
  if (product.variants.length !== desired.variants.length) return false;
  return desired.variants.every((desiredVariant) => product.variants.some((variant) =>
    variant.sizeId === desiredVariant.sizeId &&
    variant.colorId === desiredVariant.colorId &&
    variant.onlineVisible === true &&
    variant.sellingPricePiastersOverride === null));
}

export function decidePublish(input: {
  matchesDesired: boolean;
  desired: PublishPayload;
  savedIntent: PublishPayload | undefined;
  savedResponse: boolean;
}): { action: "skip" } | { action: "send"; body: PublishPayload } | { action: "abort"; reason: string } {
  if (input.savedResponse && !input.matchesDesired) {
    return { action: "abort", reason: "recorded publish response does not match the current product" };
  }
  if (input.matchesDesired) return { action: "skip" };
  if (input.savedIntent) {
    if (canonicalJson(input.savedIntent) === canonicalJson(input.desired)) {
      return { action: "send", body: input.savedIntent };
    }
    return { action: "abort", reason: "publish intent differs from the current revision; refusing to force the save" };
  }
  return { action: "send", body: input.desired };
}

export function isRevisionConflict(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const message = errorMessage(body);
  return message.includes("تغير المنتج أثناء التعديل") || message.includes("تغيرت تركيبات المقاس واللون");
}

export function mediaPreserveDecision(
  imageRefs: readonly string[],
  intendedRef: string,
): { action: "allow" } | { action: "stop"; reason: string } {
  if (imageRefs.length === 0) return { action: "allow" };
  if (imageRefs.length === 1 && imageRefs[0] === intendedRef) return { action: "allow" };
  return { action: "stop", reason: "the product already has a different image and this tool will not replace it" };
}

export function decideUpload(input: {
  intent: UploadIntent | undefined;
  response: UploadResponse | undefined;
  file: UploadIntent;
  productImageRefs: string[];
  matchingStoredRef: string | undefined;
}): { action: "upload" } | { action: "reuse"; ref: string } | { action: "stop"; reason: string } {
  if (input.intent && canonicalJson(input.intent) !== canonicalJson(input.file)) {
    return { action: "stop", reason: "the image no longer matches the saved upload intent" };
  }
  if (input.response) {
    const preserved = mediaPreserveDecision(input.productImageRefs, input.response.ref);
    if (preserved.action === "stop") return preserved;
    return { action: "reuse", ref: input.response.ref };
  }
  if (input.intent) {
    if (input.matchingStoredRef && input.productImageRefs.length === 1 && input.productImageRefs[0] === input.matchingStoredRef) {
      return { action: "reuse", ref: input.matchingStoredRef };
    }
    return { action: "stop", reason: "the upload started without a saved media ref" };
  }
  if (input.productImageRefs.length === 1 && input.matchingStoredRef === input.productImageRefs[0]) {
    return { action: "reuse", ref: input.matchingStoredRef };
  }
  if (input.productImageRefs.length > 0) {
    return { action: "stop", reason: "the product already has image refs that were not checkpointed" };
  }
  return { action: "upload" };
}

export function reviewSampleReceipt(input: {
  expected: ReceiptPayload;
  actual: ReceiptFingerprint & { remainingQuantities: number[] };
}): string | null {
  if (
    input.actual.operationId !== input.expected.operationId ||
    input.actual.branchId !== input.expected.branchId ||
    input.actual.receiptDate !== input.expected.receiptDate
  ) {
    return "receipt identity differs from the saved sample payload";
  }
  if (input.actual.correctionRevision !== 0) return "sample receipt was corrected outside this tool";
  const actualLines = [...input.actual.lines].sort((left, right) => left.variantId.localeCompare(right.variantId));
  if (canonicalJson(actualLines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    unitCostPiasters: line.unitCostPiasters,
  }))) !== canonicalJson(input.expected.lines)) {
    return "receipt quantity or cost differs from the saved sample payload";
  }
  if (actualLines.some((line) => line.effectiveQuantity !== line.quantity || line.effectiveUnitCostPiasters !== line.unitCostPiasters)) {
    return "sample receipt effective quantity or cost changed";
  }
  if (input.actual.remainingQuantities.length !== actualLines.length) return "sample receipt remaining quantities are incomplete";
  if (input.actual.remainingQuantities.some((quantity) => quantity !== SAMPLE_QUANTITY)) {
    return "branch stock is no longer the sample quantity; apply will not refill it";
  }
  return null;
}

export function reviewPublicSample(input: {
  spec: SampleProductSpec;
  product: {
    id: string;
    nameAr: string;
    descriptionAr: string;
    categoryName: string;
    publication: string;
    availability: string;
    imageRefs: string[];
    variants: Array<{ id: string; sizeName: string; colorName: string; sellingPricePiasters: number; availableQuantity: number; orderable: boolean }>;
  };
  managerVariantIds: string[];
}): string | null {
  if (input.product.nameAr !== input.spec.name || input.product.descriptionAr !== input.spec.description) return "public copy differs";
  if (input.product.categoryName !== input.spec.category || input.product.publication !== "available") return "public category or publication differs";
  if (input.product.availability !== "in_stock" || input.product.imageRefs.length !== 1) return "public availability or media differs";
  if (input.product.variants.length !== input.spec.sizes.length) return "public pair count differs";
  const ids = input.product.variants.map((variant) => variant.id).sort();
  if (canonicalJson(ids) !== canonicalJson([...input.managerVariantIds].sort())) return "public pairs differ from the manager pairs";
  for (const size of input.spec.sizes) {
    const matches = input.product.variants.filter((variant) => variant.sizeName === size && variant.colorName === input.spec.color);
    if (matches.length !== 1) return "public size and color pairs differ";
    const match = matches[0];
    if (!match || match.sellingPricePiasters !== input.spec.pricePiasters || match.availableQuantity !== SAMPLE_QUANTITY || match.orderable !== true) {
      return "public price, stock, or orderable state differs";
    }
  }
  return null;
}

export function preservationProblems(baseline: BaselineSnapshot, current: {
  branches: WorkspaceBranch[];
  categories: BaselineSnapshot["categories"];
  sizes: BaselineSnapshot["sizes"];
  colors: BaselineSnapshot["colors"];
  products: NormalizedProduct[];
  receipts: ReceiptFingerprint[];
}): string[] {
  const problems: string[] = [];
  if (canonicalJson(baseline.branches.map(branchIdentity)) !== canonicalJson(current.branches.map(branchIdentity))) {
    problems.push("workspace branches changed");
  }
  for (const category of baseline.categories) {
    const found = current.categories.find((item) => item.id === category.id);
    if (!found || found.nameAr !== category.nameAr || found.parentId !== category.parentId) problems.push(`category ${category.id} changed`);
  }
  for (const size of baseline.sizes) {
    const found = current.sizes.find((item) => item.id === size.id);
    if (!found || found.nameAr !== size.nameAr) problems.push(`size ${size.id} changed`);
  }
  for (const color of baseline.colors) {
    const found = current.colors.find((item) => item.id === color.id);
    if (!found || found.nameAr !== color.nameAr) problems.push(`color ${color.id} changed`);
  }
  for (const previous of baseline.products) {
    const found = current.products.find((item) => item.id === previous.id);
    if (!found) {
      problems.push(`product ${previous.code} is missing`);
      continue;
    }
    if (isSampleCode(previous.code)) {
      if (sampleDrift(previous, found)) problems.push(`sample product ${previous.code} changed outside the allowed publish step`);
    } else if (canonicalJson(productFingerprint(previous)) !== canonicalJson(productFingerprint(found))) {
      problems.push(`existing product ${previous.code} changed`);
    }
  }
  for (const previous of baseline.receipts) {
    const found = current.receipts.find((item) => item.id === previous.id);
    if (!found || canonicalJson(previous) !== canonicalJson(found)) problems.push(`existing receipt ${previous.id} changed`);
  }
  return problems;
}

export function formatPlan(manifest: SampleManifest, images: ImageReadiness): string {
  const lines = [
    `Sample catalog ${manifest.version}`,
    "Products: 30",
    "Variants per product: 4",
    `Quantity per branch: ${manifest.quantityPerVariantPerBranch}`,
    "Expected branches: 2",
    `Receipt date: ${manifest.receiptDate}`,
    "Variant total: 120",
    "Receipt total: 60",
    "",
  ];
  for (const product of manifest.products) {
    lines.push(`${product.code}  ${product.name}  ${product.category}  ${product.color}  sizes ${product.sizes.join(", ")}  qty/branch ${manifest.quantityPerVariantPerBranch}`);
  }
  lines.push("");
  if (images.missingCodes.length === 0 && images.invalidCodes.length === 0) {
    lines.push("Images: 30 ready for apply preflight");
  } else {
    lines.push(`Images missing: ${images.missingCodes.length === 0 ? "none" : images.missingCodes.join(", ")}`);
    lines.push(`Images unusable: ${images.invalidCodes.length === 0 ? "none" : images.invalidCodes.join(", ")}`);
    lines.push("Apply stops before any request until every sample image passes preflight.");
  }
  return lines.join("\n");
}

export function parseCli(argv: readonly string[]): CliCommand {
  let command: CliCommand["command"] | undefined;
  let apiOrigin = DEVELOPMENT_API_ORIGIN;
  let internalOrigin = DEVELOPMENT_INTERNAL_ORIGIN;
  let credentialsFile: string | undefined;
  const rest = [...argv];
  const head = rest.shift();
  if (head === "plan" || head === "apply" || head === "verify") command = head;
  else throw new SampleCatalogError("Use plan, apply, or verify. Run from the repository root.");
  while (rest.length > 0) {
    const flag = rest.shift();
    const value = rest.shift();
    if (value === undefined || value.startsWith("--")) {
      throw new SampleCatalogError(`Missing value for ${flag ?? "flag"}.`);
    }
    if (flag === "--api") apiOrigin = value;
    else if (flag === "--origin") internalOrigin = value;
    else if (flag === "--credentials-file") {
      if (command === "plan") throw new SampleCatalogError("Plan does not read credentials.");
      if (credentialsFile !== undefined) throw new SampleCatalogError("Pass --credentials-file once.");
      credentialsFile = value;
    } else {
      throw new SampleCatalogError(`Unknown argument ${flag ?? ""}.`);
    }
  }
  return credentialsFile === undefined
    ? { command, apiOrigin, internalOrigin }
    : { command, apiOrigin, internalOrigin, credentialsFile };
}

function parseProduct(entry: unknown, index: number): SampleProductSpec {
  const code = `BRV-SAMPLE-${String(index + 1).padStart(3, "0")}`;
  const body = objectValue(entry, `Sample product ${code} is invalid.`);
  assertExactKeys(body, ["code", "category", "name", "color", "description", "image", "garment"], code);
  if (body.code !== code || typeof body.category !== "string" || !isCategoryName(body.category)) {
    throw new SampleCatalogError(`Sample product ${code} is missing or out of order.`);
  }
  const defaults = CATEGORY_DEFAULTS[body.category];
  const name = textField(body.name, 80, `Sample product ${code} name is invalid.`);
  const color = textField(body.color, 80, `Sample product ${code} color is invalid.`);
  const description = textField(body.description, 2000, `Sample product ${code} description is invalid.`);
  if (typeof body.garment !== "string" || body.garment.trim().length < 1 || body.garment === description) {
    throw new SampleCatalogError(`Sample product ${code} image provenance is invalid.`);
  }
  if (body.image !== `images/${code}.png` && body.image !== `images/${code}.webp`) {
    throw new SampleCatalogError(`Sample product ${code} image path is invalid.`);
  }
  return {
    code,
    category: body.category,
    name,
    color,
    description,
    image: body.image,
    pricePiasters: defaults.pricePiasters,
    costPiasters: defaults.costPiasters,
    sizes: defaults.sizes,
  };
}

function pairVariants(product: Pick<NormalizedProduct, "variants">, spec: SampleProductSpec): NormalizedVariant[] {
  if (product.variants.length !== spec.sizes.length) {
    throw new SampleCatalogError(`Product ${spec.code} does not have the four sample pairs.`);
  }
  return spec.sizes.map((size) => {
    const matches = product.variants.filter((variant) => variant.sizeName === size && variant.colorName === spec.color);
    if (matches.length !== 1) {
      throw new SampleCatalogError(`Product ${spec.code} does not have the explicit ${size} / ${spec.color} pair.`);
    }
    const match = matches[0];
    if (!match || match.sellingPricePiasters !== spec.pricePiasters) {
      throw new SampleCatalogError(`Product ${spec.code} pair price differs from the sample price.`);
    }
    return match;
  });
}

function productFingerprint(product: NormalizedProduct): unknown {
  return {
    id: product.id,
    editRevision: product.editRevision,
    code: product.code,
    nameAr: product.nameAr,
    descriptionAr: product.descriptionAr,
    categoryId: product.categoryId,
    defaultSellingPricePiasters: product.defaultSellingPricePiasters,
    publication: product.publication,
    imageRefs: product.imageRefs,
    sizeGuideAr: product.sizeGuideAr,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sizeId: variant.sizeId,
      colorId: variant.colorId,
      onlineVisible: variant.onlineVisible,
      sellingPricePiastersOverride: variant.sellingPricePiastersOverride,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function sampleDrift(previous: NormalizedProduct, current: NormalizedProduct): boolean {
  if (previous.code !== current.code || previous.nameAr !== current.nameAr || previous.descriptionAr !== current.descriptionAr) return true;
  if (previous.categoryId !== current.categoryId || previous.defaultSellingPricePiasters !== current.defaultSellingPricePiasters) return true;
  if (previous.sizeGuideAr !== current.sizeGuideAr) return true;
  const previousIds = previous.variants.map((variant) => variant.id).sort();
  const currentIds = current.variants.map((variant) => variant.id).sort();
  if (canonicalJson(previousIds) !== canonicalJson(currentIds)) return true;
  for (const before of previous.variants) {
    const after = current.variants.find((variant) => variant.id === before.id);
    if (!after || after.sizeId !== before.sizeId || after.colorId !== before.colorId) return true;
    if (after.sellingPricePiastersOverride !== before.sellingPricePiastersOverride) return true;
    if (before.onlineVisible && !after.onlineVisible) return true;
  }
  if (previous.publication === "available" && current.publication !== "available") return true;
  if (previous.publication === "coming_soon" || current.publication === "coming_soon") return true;
  if (previous.publication === "hidden" && current.publication === "hidden") {
    return canonicalJson(previous.imageRefs) !== canonicalJson(current.imageRefs);
  }
  if (previous.publication === "available" && canonicalJson(previous.imageRefs) !== canonicalJson(current.imageRefs)) return true;
  if (current.publication === "available" && current.imageRefs.length !== 1) return true;
  return false;
}

function branchIdentity(branch: WorkspaceBranch): unknown {
  return { id: branch.id, code: branch.code, nameAr: branch.nameAr };
}

function isSampleCode(code: string): boolean {
  return PRODUCT_CODE_PATTERN.test(code);
}

function normalizeCode(code: string): string {
  return code.normalize("NFC").trim().toLowerCase();
}

function findCostKey(value: unknown, pointer: string): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCostKey(value[index], `${pointer}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (/cost|profit/i.test(key)) return `${pointer}.${key}`;
    const found = findCostKey(child, `${pointer}.${key}`);
    if (found) return found;
  }
  return null;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) result[key] = sortJson((value as Record<string, unknown>)[key]);
  return result;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SampleCatalogError(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(body: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SampleCatalogError(`${label} does not match the authorized manifest shape.`);
  }
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function textField(value: unknown, max: number, message: string): string {
  if (typeof value !== "string") throw new SampleCatalogError(message);
  const text = value.normalize("NFC").trim();
  if (text.length < 1 || text.length > max || text !== value) throw new SampleCatalogError(message);
  return text;
}

function isCategoryName(value: string): value is SampleCategoryName {
  return (CATEGORY_ORDER as readonly string[]).includes(value);
}

function requiredTaxonomyId(value: string | undefined, label: string): string {
  if (!value || !UUID_PATTERN.test(value)) throw new SampleCatalogError(`Taxonomy id for ${label} is missing.`);
  return value;
}

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) * 0x10000) + ((bytes[offset + 2] ?? 0) * 0x100) + (bytes[offset + 3] ?? 0);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) * 0x100) + ((bytes[offset + 2] ?? 0) * 0x10000) + ((bytes[offset + 3] ?? 0) * 0x1000000);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) * 0x100) + ((bytes[offset + 2] ?? 0) * 0x10000);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + ((bytes[offset + 1] ?? 0) * 0x100);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function assertMediaDimensions(width: number, height: number): void {
  if (
    width < 1 ||
    height < 1 ||
    width > MEDIA_DIMENSION_LIMIT ||
    height > MEDIA_DIMENSION_LIMIT ||
    width * height > MEDIA_PIXEL_LIMIT
  ) {
    throw new SampleCatalogError("Sample image exceeds the 8000-pixel or 20-megapixel media limit.");
  }
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  let offset = 12;
  let width: number | undefined;
  let height: number | undefined;
  let extended = false;
  while (offset + 8 <= bytes.byteLength) {
    const tag = fourcc(bytes, offset);
    const size = readUint32LE(bytes, offset + 4);
    const payload = offset + 8;
    if (payload + size > bytes.byteLength) throw new SampleCatalogError("Sample WebP header is truncated.");
    if (tag === "VP8X") {
      if (size < 10) throw new SampleCatalogError("Sample WebP header is truncated.");
      if (((bytes[payload] ?? 0) & 0x02) !== 0) throw new SampleCatalogError("Sample WebP animation is not a product image.");
      width = readUint24LE(bytes, payload + 4) + 1;
      height = readUint24LE(bytes, payload + 7) + 1;
      extended = true;
    } else if (!extended && tag === "VP8 ") {
      const frame = readVp8KeyframeSize(bytes, payload, size);
      width = frame.width;
      height = frame.height;
    } else if (!extended && tag === "VP8L") {
      const frame = readVp8lSize(bytes, payload, size);
      width = frame.width;
      height = frame.height;
    }
    offset = payload + size + (size % 2);
  }
  if (width === undefined || height === undefined) {
    throw new SampleCatalogError("Sample WebP dimensions were not in a VP8, VP8X, or VP8L header.");
  }
  return { width, height };
}

function readVp8KeyframeSize(bytes: Uint8Array, payload: number, size: number): { width: number; height: number } {
  if (size < 10 || payload + 9 >= bytes.byteLength) throw new SampleCatalogError("Sample WebP header is truncated.");
  if (((bytes[payload] ?? 0) & 0x01) !== 0) throw new SampleCatalogError("Sample WebP VP8 frame is not a keyframe.");
  if ((bytes[payload + 3] ?? 0) !== 0x9d || (bytes[payload + 4] ?? 0) !== 0x01 || (bytes[payload + 5] ?? 0) !== 0x2a) {
    throw new SampleCatalogError("Sample WebP VP8 start code is missing.");
  }
  return {
    width: readUint16LE(bytes, payload + 6) & 0x3fff,
    height: readUint16LE(bytes, payload + 8) & 0x3fff,
  };
}

function readVp8lSize(bytes: Uint8Array, payload: number, size: number): { width: number; height: number } {
  if (size < 5 || payload + 4 >= bytes.byteLength) throw new SampleCatalogError("Sample WebP header is truncated.");
  if ((bytes[payload] ?? 0) !== 0x2f) throw new SampleCatalogError("Sample WebP VP8L signature is missing.");
  const bits = readUint32LE(bytes, payload + 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

function errorMessage(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("messageAr" in error)) return "";
  return typeof error.messageAr === "string" ? error.messageAr : "";
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

function stateDirectory(cwd: string): string {
  return path.resolve(cwd, ".local", "sample-catalog", SAMPLE_VERSION);
}

async function main(): Promise<void> {
  const secrets: string[] = [];
  try {
    await run(process.argv.slice(2), process.cwd(), secrets);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sample intake failed.";
    console.error(redact(message, secrets));
    process.exitCode = 1;
  }
}

async function run(argv: readonly string[], cwd: string, secrets: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(helpText());
    return;
  }
  const cli = parseCli(argv);
  assertDevelopmentTarget({
    apiOrigin: cli.apiOrigin,
    internalOrigin: cli.internalOrigin,
    nodeEnv: process.env.NODE_ENV,
    loopbackRehearsal: process.env.BRAVOS_LOOPBACK_REHEARSAL,
    configuredApiOrigin: process.env.BRAVOS_API_ORIGIN,
    configuredInternalOrigin: process.env.BRAVOS_INTERNAL_ORIGIN,
  });
  const manifest = parseSampleManifest(JSON.parse(await readFile(manifestPath(cwd), "utf8")));
  const images = await inspectManifestImages(cwd, manifest);
  if (cli.command === "plan") {
    console.log(formatPlan(manifest, images));
    return;
  }
  if (images.missingCodes.length > 0 || images.invalidCodes.length > 0) {
    throw new SampleCatalogError(`Apply preflight failed before any request. Missing: ${images.missingCodes.join(", ") || "none"}. Unusable: ${images.invalidCodes.join(", ") || "none"}.`);
  }
  const credentials = await loadCredentials(cwd, cli.credentialsFile, secrets);
  const api = new DevelopmentApi(cli.apiOrigin, cli.internalOrigin);
  await api.assertIdentified();
  await api.signIn(credentials);
  if (cli.command === "apply") await applyCatalog(api, manifest, cwd);
  else await verifyCatalog(api, manifest, cwd);
}

function helpText(): string {
  return [
    "Sample catalog intake reads assets/sample-catalog/catalog.json and uses only the development feature API.",
    "plan prints product, variant, and branch quantity counts. It does not read credentials or require images.",
    "apply and verify are for a later main-owned execution. This command does not bootstrap a database.",
    "",
    "pnpm exec tsx scripts/sample-catalog.ts plan",
    "pnpm exec tsx scripts/sample-catalog.ts apply --credentials-file .local/demo-credentials.txt",
    "pnpm exec tsx scripts/sample-catalog.ts verify --credentials-file .local/demo-credentials.txt",
    "",
    "The only accepted targets are API http://127.0.0.1:3010 and Origin http://127.0.0.1:5173.",
    "Each image path must match its product code and end in .png or .webp. Apply sends the format found in the file.",
    "Credentials may instead be BRAVOS_SAMPLE_CATALOG_USERNAME and BRAVOS_SAMPLE_CATALOG_PASSWORD.",
    "Do not point this tool at the isolated storefront demo, e2e ports, or a production host.",
  ].join("\n");
}

function manifestPath(cwd: string): string {
  return path.resolve(cwd, MANIFEST_RELATIVE_PATH);
}

async function inspectManifestImages(cwd: string, manifest: SampleManifest): Promise<ImageReadiness> {
  const missingCodes: string[] = [];
  const invalidCodes: string[] = [];
  const root = path.resolve(cwd, "assets", "sample-catalog");
  for (const product of manifest.products) {
    const imagePath = path.resolve(root, product.image);
    const relative = path.relative(root, imagePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      invalidCodes.push(product.code);
      continue;
    }
    let info: { size: number };
    try {
      info = await stat(imagePath);
    } catch {
      missingCodes.push(product.code);
      continue;
    }
    if (!info.size || info.size > MEDIA_BYTE_LIMIT) {
      invalidCodes.push(product.code);
      continue;
    }
    const handle = await readFile(imagePath);
    try {
      reviewSampleImageFile(handle, product.image);
    } catch {
      invalidCodes.push(product.code);
    }
  }
  return { missingCodes, invalidCodes };
}

async function loadCredentials(cwd: string, credentialsFile: string | undefined, secrets: string[]): Promise<OwnerCredentials> {
  let fileText: string | undefined;
  if (credentialsFile !== undefined) {
    const localRoot = await realpath(path.resolve(cwd, ".local")).catch(() => {
      throw new SampleCatalogError("Credentials file must be an explicit file inside .local.");
    });
    const resolved = await realpath(path.resolve(cwd, credentialsFile)).catch(() => {
      throw new SampleCatalogError("Credentials file was not found inside .local.");
    });
    credentialsPathDecision(localRoot, resolved);
    fileText = await readFile(resolved, "utf8");
  }
  const credentials = selectOwnerCredentials({
    envUsername: process.env.BRAVOS_SAMPLE_CATALOG_USERNAME,
    envPassword: process.env.BRAVOS_SAMPLE_CATALOG_PASSWORD,
    fileText,
  });
  secrets.push(credentials.password);
  return credentials;
}

class DevelopmentApi {
  private cookie = "";

  constructor(
    private readonly apiOrigin: string,
    private readonly internalOrigin: string,
  ) {}

  async assertIdentified(): Promise<void> {
    let result: ApiResult;
    try {
      result = await this.request("GET", "/api/public/health");
    } catch {
      throw new SampleCatalogError("The development API is not reachable at http://127.0.0.1:3010.");
    }
    const body = result.body;
    if (result.status !== 200 || !body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true || (body as { application?: unknown }).application !== "bravos-public") {
      throw new SampleCatalogError("The target did not identify itself as the Bravos development API.");
    }
  }

  async signIn(credentials: OwnerCredentials): Promise<void> {
    const result = await this.request("POST", "/api/auth/sign-in/username", {
      username: credentials.username,
      password: credentials.password,
    });
    if (result.status !== 200) {
      throw new SampleCatalogError(`Sign-in was rejected (${result.status}).`);
    }
    if (result.setCookies.some((value) => value.startsWith("__Secure-") || value.startsWith("__Host-"))) {
      throw new SampleCatalogError("Sign-in returned a secure production cookie. Sample intake stopped before any catalog change.");
    }
    if (result.setCookies.length === 0) {
      throw new SampleCatalogError("Sign-in did not return a session cookie. Sample intake stopped before any catalog change.");
    }
    this.cookie = result.setCookies.join("; ");
  }

  async getBody(route: string): Promise<unknown> {
    const result = await this.request("GET", route);
    if (result.status !== 200) throw apiFailure("GET", route, result);
    return result.body;
  }

  async getJson<T>(route: string, parse: (body: unknown) => T): Promise<T> {
    return parse(await this.getBody(route));
  }

  async sendJson(method: "POST" | "PATCH", route: string, payload: unknown, accepted: number[]): Promise<ApiResult> {
    const result = await this.request(method, route, payload);
    if (!accepted.includes(result.status)) throw apiFailure(method, route, result);
    return result;
  }

  async readBytes(route: string): Promise<{ contentType: string; bytes: Uint8Array }> {
    const response = await fetch(`${this.apiOrigin}${route}`, {
      method: "GET",
      headers: this.headers(false),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new SampleCatalogError(`GET ${route} failed (${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { contentType: response.headers.get("content-type") ?? "", bytes };
  }

  private headers(json: boolean): Record<string, string> {
    return {
      origin: this.internalOrigin,
      accept: json ? "application/json" : "*/*",
      ...(json ? { "content-type": "application/json" } : {}),
      ...(this.cookie ? { cookie: this.cookie } : {}),
    };
  }

  private async request(method: string, route: string, payload?: unknown): Promise<ApiResult> {
    const response = await fetch(`${this.apiOrigin}${route}`, {
      method,
      headers: this.headers(payload !== undefined),
      redirect: "error",
      signal: AbortSignal.timeout(payload === undefined ? 30_000 : 60_000),
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const text = await response.text();
    const setCookies = readSetCookies(response).map((value) => value.split(";")[0] ?? "").filter((value) => value.includes("="));
    return { status: response.status, body: parseResponseJson(text), setCookies };
  }
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseResponseJson(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function apiFailure(method: string, route: string, result: ApiResult): SampleCatalogError {
  const code = errorCode(result.body);
  const message = errorMessage(result.body);
  const detail = [code, message].filter(Boolean).join(": ");
  return new SampleCatalogError(`${method} ${route} failed (${result.status}${detail ? `; ${detail}` : ""}).`);
}

async function applyCatalog(api: DevelopmentApi, manifest: SampleManifest, cwd: string): Promise<void> {
  const opened = await readWorkspace(api);
  const directory = stateDirectory(cwd);
  await mkdir(directory, { recursive: true });
  await readOrCreateBaseline(api, opened.branches, directory);
  const taxonomy = await ensureTaxonomy(api, manifest, directory);
  for (const spec of manifest.products) {
    const product = await ensureHiddenProduct(api, spec, taxonomy, directory);
    for (const branch of opened.branches) {
      await ensureReceipt(api, spec, branch, product, directory);
    }
    const refreshed = await readProduct(api, product.id);
    const imageRef = await ensureMedia(api, spec, refreshed, directory, cwd);
    await ensurePublished(api, spec, imageRef, directory);
    console.log(`sample apply: ${spec.code} checkpointed`);
  }
  await assertActiveBranchUnchanged(api, opened.activeBranchId);
  console.log(`sample apply: prepared ${manifest.products.length} products. Verify was not run.`);
}

async function verifyCatalog(api: DevelopmentApi, manifest: SampleManifest, cwd: string): Promise<void> {
  const opened = await readWorkspace(api);
  const directory = stateDirectory(cwd);
  const baseline = await readJsonFile(path.join(directory, "baseline-snapshot.json"), parseBaseline);
  if (!baseline) {
    throw new SampleCatalogError(`Verify cannot check preservation because ${path.join(".local", "sample-catalog", SAMPLE_VERSION, "baseline-snapshot.json")} is absent. Run apply before verify. Verify did not change business data.`);
  }
  const [categories, sizes, colors, products, receipts, publicBody] = await Promise.all([
    api.getJson("/api/internal/catalog/categories", (body) => parseNamedList(body, true)),
    api.getJson("/api/internal/catalog/sizes", (body) => parseNamedList(body, false)),
    api.getJson("/api/internal/catalog/colors", (body) => parseNamedList(body, false)),
    api.getJson("/api/internal/catalog/products", parseManagerProducts),
    api.getJson("/api/internal/receiving/receipts", parseReceiptFingerprints),
    api.getBody("/api/public/catalog/products"),
  ]);
  const publicProducts = parsePublicProducts(publicBody);
  const leak = findPublicCostLeak(publicBody);
  if (leak) throw new SampleCatalogError(`Public catalog exposed restricted cost data (${leak}).`);
  const preserved = preservationProblems(baseline, {
    branches: opened.branches,
    categories,
    sizes,
    colors,
    products,
    receipts,
  });
  if (preserved.length > 0) {
    throw new SampleCatalogError(`Existing manager data changed: ${preserved.slice(0, 8).join("; ")}.`);
  }
  let publicCount = 0;
  for (const spec of manifest.products) {
    const manager = findByCode(products, spec.code);
    if (!manager) throw new SampleCatalogError(`Sample ${spec.code} is missing from the manager catalog.`);
    if (adoptionProblems(manager, spec, taxonomyFromLists(categories, sizes, colors, manifest)).length > 0) {
      throw new SampleCatalogError(`Sample ${spec.code} manager facts differ.`);
    }
    const summary = publicProducts.find((item) => item.id === manager.id);
    const detailBody = await api.getBody(`/api/public/catalog/products/${manager.id}`);
    const detail = parsePublicProduct(detailBody);
    const detailLeak = findPublicCostLeak(detailBody);
    if (!summary || detailLeak || summary.id !== detail.id) {
      throw new SampleCatalogError(`Public detail for ${spec.code} is missing or exposed restricted data.`);
    }
    const problem = reviewPublicSample({
      spec,
      product: detail,
      managerVariantIds: manager.variants.map((variant) => variant.id),
    });
    if (problem) throw new SampleCatalogError(`Public ${spec.code}: ${problem}.`);
    for (const branch of opened.branches) {
      const expected = buildReceiptPayload(spec, branch.id, manager.variants);
      const operation = await api.getJson(`/api/internal/receiving/operations/${expected.operationId}`, parseReceiptFingerprint);
      const receipt = await api.getJson(`/api/internal/receiving/receipts/${operation.id}`, parseReceiptWithRemaining);
      const receiptProblem = reviewSampleReceipt({
        expected,
        actual: {
          ...receipt.fingerprint,
          remainingQuantities: receipt.remainingQuantities,
        },
      });
      if (receiptProblem) throw new SampleCatalogError(`Receipt ${spec.code} ${branch.code}: ${receiptProblem}.`);
    }
    const imageRef = detail.imageRefs[0];
    if (!imageRef) throw new SampleCatalogError(`Public media for ${spec.code} is missing.`);
    const localPath = path.resolve(cwd, "assets", "sample-catalog", spec.image);
    const expectedImage = reviewSampleImageFile(await readFile(localPath), spec.image);
    const media = await api.readBytes(`/api/public/catalog/media/${imageRef}`);
    const mediaProblem = reviewPublicMedia({ expected: expectedImage, contentType: media.contentType, bytes: media.bytes });
    if (mediaProblem) throw new SampleCatalogError(`Public media for ${spec.code}: ${mediaProblem}.`);
    publicCount += 1;
  }
  console.log(`sample verify: ${publicCount} public sample products, explicit pairs, media, receipts, and preserved manager data checked. No order or sale was created.`);
}

async function readWorkspace(api: DevelopmentApi): Promise<{ branches: WorkspaceBranch[]; activeBranchId: string | null }> {
  const workspace = await api.getJson("/api/internal/workspace", parseWorkspace);
  if (workspace.role !== "manager" || !workspace.manageCatalog || !workspace.manageInventory) {
    throw new SampleCatalogError("The signed-in account cannot manage catalog and inventory.");
  }
  return { branches: workspace.branches, activeBranchId: workspace.activeBranchId };
}

async function readOrCreateBaseline(api: DevelopmentApi, branches: WorkspaceBranch[], directory: string): Promise<BaselineSnapshot> {
  const file = path.join(directory, "baseline-snapshot.json");
  const existing = await readJsonFile(file, parseBaseline);
  if (existing) return existing;
  const [categories, sizes, colors, products, receipts] = await Promise.all([
    api.getJson("/api/internal/catalog/categories", (body) => parseNamedList(body, true)),
    api.getJson("/api/internal/catalog/sizes", (body) => parseNamedList(body, false)),
    api.getJson("/api/internal/catalog/colors", (body) => parseNamedList(body, false)),
    api.getJson("/api/internal/catalog/products", parseManagerProducts),
    api.getJson("/api/internal/receiving/receipts", parseReceiptFingerprints),
  ]);
  const snapshot: BaselineSnapshot = {
    version: SAMPLE_VERSION,
    branches,
    categories,
    sizes,
    colors,
    products,
    receipts,
  };
  await writeJsonExclusive(file, snapshot);
  return snapshot;
}

async function ensureTaxonomy(api: DevelopmentApi, manifest: SampleManifest, directory: string): Promise<TaxonomyIds> {
  const file = path.join(directory, "taxonomy.json");
  const categories = await api.getJson("/api/internal/catalog/categories", (body) => parseNamedList(body, true));
  const sizes = await api.getJson("/api/internal/catalog/sizes", (body) => parseNamedList(body, false));
  const colors = await api.getJson("/api/internal/catalog/colors", (body) => parseNamedList(body, false));
  const categoryIds = {} as TaxonomyIds["categoryIds"];
  for (const category of CATEGORY_ORDER) {
    categoryIds[category] = await ensureCategory(api, categories, category);
  }
  const sizeIds: Record<string, string> = {};
  const colorIds: Record<string, string> = {};
  for (const name of uniqueNames(manifest.products.flatMap((product) => [...product.sizes]))) {
    sizeIds[name] = await ensureName(api, sizes, "sizes", name);
  }
  for (const name of uniqueNames(manifest.products.map((product) => product.color))) {
    colorIds[name] = await ensureName(api, colors, "colors", name);
  }
  const taxonomy = { categoryIds, sizeIds, colorIds };
  const previous = await readJsonFile(file, parseTaxonomy);
  if (previous && canonicalJson(previous) !== canonicalJson(taxonomy)) {
    throw new SampleCatalogError("Saved taxonomy ids no longer match the workspace. Sample intake stopped.");
  }
  if (!previous) await writeJsonExclusive(file, taxonomy);
  return taxonomy;
}

async function ensureCategory(
  api: DevelopmentApi,
  existing: Array<{ id: string; nameAr: string; parentId: string | null }>,
  name: SampleCategoryName,
): Promise<string> {
  const matches = existing.filter((item) => item.nameAr === name);
  if (matches.length > 1) throw new SampleCatalogError(`More than one ${name} category exists. Sample intake stopped.`);
  const match = matches[0];
  if (match?.parentId) throw new SampleCatalogError(`${name} exists only as a child category. Sample intake stopped.`);
  if (match) return match.id;
  try {
    const created = await api.sendJson("POST", "/api/internal/catalog/categories", { nameAr: name }, [201]);
    const parsed = parseNamedList([created.body], true)[0];
    if (!parsed || parsed.nameAr !== name || parsed.parentId !== null) {
      throw new SampleCatalogError(`Created ${name} category did not match the requested name.`);
    }
    existing.push(parsed);
    return parsed.id;
  } catch (error) {
    const reread = await rereadNamed(api, "/api/internal/catalog/categories", true, name, error);
    if (reread?.parentId) throw new SampleCatalogError(`${name} exists only as a child category. Sample intake stopped.`);
    if (reread) return reread.id;
    throw error;
  }
}

async function ensureName(
  api: DevelopmentApi,
  existing: Array<{ id: string; nameAr: string }>,
  resource: "sizes" | "colors",
  name: string,
): Promise<string> {
  const matches = existing.filter((item) => item.nameAr === name);
  if (matches.length > 1) throw new SampleCatalogError(`More than one ${name} ${resource} record exists. Sample intake stopped.`);
  if (matches[0]) return matches[0].id;
  try {
    const created = await api.sendJson("POST", `/api/internal/catalog/${resource}`, { nameAr: name }, [201]);
    const parsed = parseNamedList([created.body], false)[0];
    if (!parsed || parsed.nameAr !== name) throw new SampleCatalogError(`Created ${name} did not match the requested name.`);
    existing.push(parsed);
    return parsed.id;
  } catch (error) {
    const reread = await rereadNamed(api, `/api/internal/catalog/${resource}`, false, name, error);
    if (reread) return reread.id;
    throw error;
  }
}

async function rereadNamed(
  api: DevelopmentApi,
  route: string,
  category: boolean,
  name: string,
  error: unknown,
): Promise<{ id: string; nameAr: string; parentId: string | null } | undefined> {
  if (!(error instanceof SampleCatalogError) || !error.message.includes("(400")) return undefined;
  const fresh = await api.getJson(route, (body) => parseNamedList(body, category));
  const matches = fresh.filter((item) => item.nameAr === name);
  if (matches.length > 1) throw new SampleCatalogError(`More than one ${name} record exists. Sample intake stopped.`);
  return matches[0];
}

async function ensureHiddenProduct(
  api: DevelopmentApi,
  spec: SampleProductSpec,
  taxonomy: TaxonomyIds,
  directory: string,
): Promise<NormalizedProduct> {
  const folder = path.join(directory, "products", spec.code);
  await mkdir(folder, { recursive: true });
  const products = await api.getJson("/api/internal/catalog/products", parseManagerProducts);
  const found = findByCode(products, spec.code);
  const payload = buildHiddenProductPayload(spec, taxonomy);
  if (found) return adoptProduct(found, spec, taxonomy, folder);
  const intentFile = path.join(folder, "create-intent.json");
  const savedIntent = await readJsonFile(intentFile, (value) => value);
  if (savedIntent) assertSamePayload(savedIntent, payload, `Create payload for ${spec.code}`);
  else await writeJsonExclusive(intentFile, payload);
  const result = await api.sendJson("POST", "/api/internal/catalog/products", payload, [201, 409]);
  if (result.status === 409) {
    if (errorCode(result.body) !== "DUPLICATE_PRODUCT_CODE") {
      throw apiFailure("POST", "/api/internal/catalog/products", result);
    }
    const again = findByCode(await api.getJson("/api/internal/catalog/products", parseManagerProducts), spec.code);
    if (!again) throw new SampleCatalogError(`Duplicate SKU ${spec.code} could not be reread. Sample intake stopped.`);
    return adoptProduct(again, spec, taxonomy, folder);
  }
  const created = parseManagerProduct(result.body);
  return adoptProduct(created, spec, taxonomy, folder);
}

async function adoptProduct(product: NormalizedProduct, spec: SampleProductSpec, taxonomy: TaxonomyIds, folder: string): Promise<NormalizedProduct> {
  const problems = adoptionProblems(product, spec, taxonomy);
  if (problems.length > 0) {
    throw new SampleCatalogError(`Product ${spec.code} collides with an existing SKU whose facts differ (${problems.join(", ")}). Sample intake stopped.`);
  }
  const checkpoint: ProductCheckpoint = {
    id: product.id,
    code: product.code,
    variantIds: product.variants.map((variant) => variant.id).sort(),
  };
  const file = path.join(folder, "create-response.json");
  try {
    await writeJsonExclusive(file, checkpoint);
  } catch (error) {
    if (!(error instanceof SampleCatalogError) || !error.message.startsWith("Checkpoint already exists")) throw error;
    const saved = await readJsonFile(file, parseProductCheckpoint);
    if (!saved || saved.id !== checkpoint.id || canonicalJson(saved.variantIds) !== canonicalJson(checkpoint.variantIds)) {
      throw new SampleCatalogError(`Saved product checkpoint for ${spec.code} does not match the SKU now in the catalog.`);
    }
  }
  return product;
}

async function ensureReceipt(
  api: DevelopmentApi,
  spec: SampleProductSpec,
  branch: WorkspaceBranch,
  product: NormalizedProduct,
  directory: string,
): Promise<void> {
  const folder = path.join(directory, "receipts", spec.code, branch.code);
  await mkdir(folder, { recursive: true });
  const payload = buildReceiptPayload(spec, branch.id, product.variants);
  const intentFile = path.join(folder, "intent.json");
  const saved = await readJsonFile(intentFile, (value) => value);
  if (saved) assertSamePayload(saved, payload, `Receipt payload for ${spec.code} at branch ${branch.code}`);
  else await writeJsonExclusive(intentFile, payload);
  const responseFile = path.join(folder, "response.json");
  const existingResponse = await readJsonFile(responseFile, parseReceiptFingerprint);
  if (existingResponse) {
    if (existingResponse.operationId !== payload.operationId || existingResponse.branchId !== payload.branchId) {
      throw new SampleCatalogError(`Saved receipt checkpoint for ${spec.code} at ${branch.code} does not match the immutable payload.`);
    }
    const live = await api.getJson(`/api/internal/receiving/operations/${payload.operationId}`, parseReceiptFingerprint);
    if (
      live.operationId !== payload.operationId ||
      live.branchId !== payload.branchId ||
      live.receiptDate !== payload.receiptDate ||
      canonicalJson(live.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitCostPiasters: line.unitCostPiasters,
      }))) !== canonicalJson(payload.lines)
    ) {
      throw new SampleCatalogError(`Saved receipt for ${spec.code} at ${branch.code} does not match the server. Sample intake will not post another receipt.`);
    }
    return;
  }
  const result = await api.sendJson("POST", "/api/internal/receiving/receipts", payload, [200, 201]);
  const receipt = parseReceiptFingerprint(result.body);
  if (
    receipt.operationId !== payload.operationId ||
    receipt.branchId !== payload.branchId ||
    receipt.receiptDate !== payload.receiptDate ||
    canonicalJson(receipt.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitCostPiasters: line.unitCostPiasters,
    }))) !== canonicalJson(payload.lines)
  ) {
    throw new SampleCatalogError(`Receipt response for ${spec.code} at ${branch.code} does not match the payload saved before the request.`);
  }
  await writeJsonExclusive(responseFile, receipt);
}

async function ensureMedia(
  api: DevelopmentApi,
  spec: SampleProductSpec,
  product: NormalizedProduct,
  directory: string,
  cwd: string,
): Promise<string> {
  const folder = path.join(directory, "products", spec.code);
  const imagePath = path.resolve(cwd, "assets", "sample-catalog", spec.image);
  const bytes = await readFile(imagePath);
  const inspection = reviewSampleImageFile(bytes, spec.image);
  const descriptor = uploadDescriptor(spec.code, inspection);
  const file: UploadIntent = {
    fileName: descriptor.fileName,
    contentType: descriptor.contentType,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const intentFile = path.join(folder, "upload-intent.json");
  const responseFile = path.join(folder, "upload-response.json");
  const intent = await readJsonFile(intentFile, parseUploadIntent);
  const response = await readJsonFile(responseFile, parseUploadResponse);
  const matchingStoredRef = await matchingProductMedia(api, product, file.sha256);
  const decision = decideUpload({
    intent,
    response,
    file,
    productImageRefs: product.imageRefs,
    matchingStoredRef,
  });
  if (decision.action === "stop") {
    throw new SampleCatalogError(`Upload for ${spec.code} stopped: ${decision.reason}. Sample intake will not upload another file.`);
  }
  if (decision.action === "reuse") {
    if (!intent) await writeJsonExclusive(intentFile, file);
    if (!response) {
      await writeJsonExclusive(responseFile, {
        ref: decision.ref,
        contentType: file.contentType,
        byteLength: file.byteLength,
        source: "existing-product-media",
      });
    }
    return decision.ref;
  }
  if (!intent) await writeJsonExclusive(intentFile, file);
  let uploaded: ApiResult;
  try {
    uploaded = await api.sendJson("POST", "/api/internal/catalog/media", {
      fileName: file.fileName,
      contentType: file.contentType,
      base64: Buffer.from(bytes).toString("base64"),
    }, [201]);
  } catch (error) {
    if (error instanceof SampleCatalogError && error.message.includes("(400")) {
      await rm(intentFile, { force: true });
    }
    throw error;
  }
  const parsed = parseUploadResponse(uploaded.body);
  if (!parsed || parsed.byteLength !== file.byteLength || parsed.contentType !== file.contentType) {
    throw new SampleCatalogError(`Upload response for ${spec.code} did not match the file sent.`);
  }
  await writeJsonExclusive(responseFile, { ...parsed, source: "upload" });
  return parsed.ref;
}

async function matchingProductMedia(api: DevelopmentApi, product: NormalizedProduct, sha256: string): Promise<string | undefined> {
  if (product.imageRefs.length !== 1) return undefined;
  const ref = product.imageRefs[0];
  if (!ref || !MEDIA_REF_PATTERN.test(ref)) return undefined;
  const media = await api.readBytes(`/api/internal/catalog/media/${ref}`);
  const actual = createHash("sha256").update(media.bytes).digest("hex");
  return actual === sha256 ? ref : undefined;
}

async function ensurePublished(api: DevelopmentApi, spec: SampleProductSpec, imageRef: string, directory: string): Promise<void> {
  const folder = path.join(directory, "products", spec.code);
  const intentFile = path.join(folder, "publish-intent.json");
  const responseFile = path.join(folder, "publish-response.json");
  const savedIntent = await readJsonFile(intentFile, parsePublishPayload);
  const savedResponse = await readJsonFile(responseFile, (value) => value);
  const taxonomy = await taxonomyForPublish(directory);
  let product = await readProduct(api, await checkpointedProductId(folder, spec.code));
  const problems = adoptionProblems(product, spec, taxonomy);
  if (problems.length > 0) {
    throw new SampleCatalogError(`Product ${spec.code} no longer matches the sample (${problems.join(", ")}). Sample intake stopped without forcing the save.`);
  }
  const preservedMedia = mediaPreserveDecision(product.imageRefs, imageRef);
  if (preservedMedia.action === "stop") {
    throw new SampleCatalogError(`Product ${spec.code} stopped: ${preservedMedia.reason}. Sample intake stopped before replacing the image.`);
  }
  let desired = buildPublishPayload(product, spec, imageRef);
  let decision = decidePublish({
    matchesDesired: matchesDesiredPublish(product, desired),
    desired,
    savedIntent,
    savedResponse: savedResponse !== undefined,
  });
  if (decision.action === "abort") {
    throw new SampleCatalogError(`Product ${spec.code} changed during publish. ${decision.reason}. Sample intake stopped without forcing the save.`);
  }
  if (decision.action === "skip") {
    if (savedResponse === undefined) await writeJsonExclusive(responseFile, { id: product.id, editRevision: product.editRevision, imageRef });
    return;
  }
  if (!savedIntent) await writeJsonExclusive(intentFile, decision.body);
  const result = await api.sendJson("PATCH", `/api/internal/catalog/products/${product.id}`, decision.body, [200, 400]);
  if (isRevisionConflict(result.status, result.body)) {
    product = await readProduct(api, product.id);
    const refreshedProblems = adoptionProblems(product, spec, taxonomy);
    if (refreshedProblems.length > 0) {
      throw new SampleCatalogError(`Product ${spec.code} changed during publish. The refreshed product does not match the sample (${refreshedProblems.join(", ")}). Sample intake stopped without forcing the save.`);
    }
    desired = buildPublishPayload(product, spec, imageRef);
    if (!matchesDesiredPublish(product, desired)) {
      throw new SampleCatalogError(`Product ${spec.code} changed during publish. The refreshed product does not match the sample. Sample intake stopped without forcing the save.`);
    }
    await writeJsonExclusive(responseFile, { id: product.id, editRevision: product.editRevision, imageRef, reviewed: true });
    return;
  }
  if (result.status !== 200) throw apiFailure("PATCH", `/api/internal/catalog/products/${product.id}`, result);
  product = parseManagerProduct(result.body);
  if (!matchesDesiredPublish(product, desired)) {
    throw new SampleCatalogError(`Product ${spec.code} publish response does not match the requested pairs. Sample intake stopped without forcing another save.`);
  }
  await writeJsonExclusive(responseFile, { id: product.id, editRevision: product.editRevision, imageRef });
}

async function checkpointedProductId(folder: string, code: string): Promise<string> {
  const saved = await readJsonFile(path.join(folder, "create-response.json"), parseProductCheckpoint);
  if (!saved || normalizeCode(saved.code) !== normalizeCode(code)) {
    throw new SampleCatalogError(`Product ${code} has no saved identity checkpoint.`);
  }
  return saved.id;
}

async function taxonomyForPublish(directory: string): Promise<TaxonomyIds> {
  const taxonomy = await readJsonFile(path.join(directory, "taxonomy.json"), parseTaxonomy);
  if (!taxonomy) throw new SampleCatalogError("Taxonomy checkpoint is missing. Sample intake stopped.");
  return taxonomy;
}

async function readProduct(api: DevelopmentApi, id: string): Promise<NormalizedProduct> {
  return api.getJson(`/api/internal/catalog/products/${id}`, parseManagerProduct);
}

async function assertActiveBranchUnchanged(api: DevelopmentApi, original: string | null): Promise<void> {
  const current = await readWorkspace(api);
  if (current.activeBranchId === original) return;
  if (!original) {
    throw new SampleCatalogError("Active branch changed during sample intake. It was originally unset and was not cleared automatically.");
  }
  await api.sendJson("POST", "/api/internal/active-branch", { branchId: original }, [200]);
  throw new SampleCatalogError("Active branch changed during sample intake and was restored. Review the last checkpoint before rerunning.");
}

function parseWorkspace(value: unknown): {
  role: string;
  manageCatalog: boolean;
  manageInventory: boolean;
  branches: WorkspaceBranch[];
  activeBranchId: string | null;
} {
  const body = objectValue(value, "Workspace response was invalid.");
  const staff = objectValue(body.staff, "Workspace staff response was invalid.");
  const capabilities = objectValue(body.capabilities, "Workspace capabilities were invalid.");
  const active = body.activeBranch === null ? null : body.activeBranch;
  const activeBranchId = active === null ? null : stringField(objectValue(active, "Active branch was invalid.").id, "Active branch id was invalid.");
  return {
    role: stringField(staff.role, "Workspace role was invalid."),
    manageCatalog: capabilities.manageCatalog === true,
    manageInventory: capabilities.manageInventory === true,
    branches: assertExpectedBranches(body.authorizedBranches),
    activeBranchId,
  };
}

function parseNamedList(value: unknown, category: boolean): Array<{ id: string; nameAr: string; parentId: string | null }> {
  if (!Array.isArray(value)) throw new SampleCatalogError("Taxonomy response was not a list.");
  return value.map((entry) => {
    const body = objectValue(entry, "Taxonomy item was invalid.");
    return {
      id: uuidField(body.id, "Taxonomy id was invalid."),
      nameAr: stringField(body.nameAr, "Taxonomy name was invalid."),
      parentId: !category || body.parentId === null || body.parentId === undefined
        ? null
        : uuidField(body.parentId, "Category parent was invalid."),
    };
  });
}

function parseManagerProducts(value: unknown): NormalizedProduct[] {
  if (!Array.isArray(value)) throw new SampleCatalogError("Manager product response was not a list.");
  return value.map(parseManagerProduct);
}

function parseManagerProduct(value: unknown): NormalizedProduct {
  const body = objectValue(value, "Manager product was invalid.");
  const category = objectValue(body.category, "Manager product category was invalid.");
  if (!Array.isArray(body.variants) || !Array.isArray(body.imageRefs)) {
    throw new SampleCatalogError("Manager product variants were invalid.");
  }
  const publication = body.publication;
  if (publication !== "available" && publication !== "coming_soon" && publication !== "hidden") {
    throw new SampleCatalogError("Manager product publication was invalid.");
  }
  return {
    id: uuidField(body.id, "Manager product id was invalid."),
    editRevision: integerField(body.editRevision, "Manager product revision was invalid."),
    code: stringField(body.code, "Manager product code was invalid."),
    nameAr: stringField(body.nameAr, "Manager product name was invalid."),
    descriptionAr: typeof body.descriptionAr === "string" ? body.descriptionAr : "",
    categoryId: uuidField(category.id, "Manager category id was invalid."),
    categoryName: stringField(category.nameAr, "Manager category name was invalid."),
    categoryParentId: category.parentId === null || category.parentId === undefined ? null : uuidField(category.parentId, "Manager category parent was invalid."),
    defaultSellingPricePiasters: integerField(body.defaultSellingPricePiasters, "Manager product price was invalid."),
    publication,
    imageRefs: body.imageRefs.map((item) => stringField(item, "Manager image ref was invalid.")),
    sizeGuideAr: body.sizeGuideAr === null || body.sizeGuideAr === undefined ? null : stringField(body.sizeGuideAr, "Manager size guide was invalid."),
    variants: body.variants.map(parseManagerVariant),
  };
}

function parseManagerVariant(value: unknown): NormalizedVariant {
  const body = objectValue(value, "Manager variant was invalid.");
  const size = objectValue(body.size, "Manager variant size was invalid.");
  const color = objectValue(body.color, "Manager variant color was invalid.");
  return {
    id: uuidField(body.id, "Manager variant id was invalid."),
    sizeId: uuidField(size.id, "Manager size id was invalid."),
    sizeName: stringField(size.nameAr, "Manager size name was invalid."),
    colorId: uuidField(color.id, "Manager color id was invalid."),
    colorName: stringField(color.nameAr, "Manager color name was invalid."),
    onlineVisible: body.onlineVisible === true,
    sellingPricePiastersOverride: body.sellingPricePiastersOverride === null ? null : integerField(body.sellingPricePiastersOverride, "Manager variant override was invalid."),
    sellingPricePiasters: integerField(body.sellingPricePiasters, "Manager variant price was invalid."),
  };
}

function parsePublicProducts(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) throw new SampleCatalogError("Public catalog response was not a list.");
  return value.map((entry) => {
    const body = objectValue(entry, "Public product summary was invalid.");
    return { id: uuidField(body.id, "Public product id was invalid.") };
  });
}

function parsePublicProduct(value: unknown): {
  id: string;
  nameAr: string;
  descriptionAr: string;
  categoryName: string;
  publication: string;
  availability: string;
  imageRefs: string[];
  variants: Array<{ id: string; sizeName: string; colorName: string; sellingPricePiasters: number; availableQuantity: number; orderable: boolean }>;
} {
  const body = objectValue(value, "Public product detail was invalid.");
  const category = objectValue(body.category, "Public category was invalid.");
  if (!Array.isArray(body.variants) || !Array.isArray(body.imageRefs)) {
    throw new SampleCatalogError("Public product variants were invalid.");
  }
  return {
    id: uuidField(body.id, "Public product id was invalid."),
    nameAr: stringField(body.nameAr, "Public product name was invalid."),
    descriptionAr: typeof body.descriptionAr === "string" ? body.descriptionAr : "",
    categoryName: stringField(category.nameAr, "Public category name was invalid."),
    publication: stringField(body.publication, "Public publication was invalid."),
    availability: stringField(body.availability, "Public availability was invalid."),
    imageRefs: body.imageRefs.map((item) => stringField(item, "Public image ref was invalid.")),
    variants: body.variants.map((entry) => {
      const variant = objectValue(entry, "Public variant was invalid.");
      const size = objectValue(variant.size, "Public size was invalid.");
      const color = objectValue(variant.color, "Public color was invalid.");
      return {
        id: uuidField(variant.id, "Public variant id was invalid."),
        sizeName: stringField(size.nameAr, "Public size name was invalid."),
        colorName: stringField(color.nameAr, "Public color name was invalid."),
        sellingPricePiasters: integerField(variant.sellingPricePiasters, "Public price was invalid."),
        availableQuantity: integerField(variant.availableQuantity, "Public quantity was invalid."),
        orderable: variant.orderable === true,
      };
    }),
  };
}

function parseReceiptFingerprints(value: unknown): ReceiptFingerprint[] {
  if (!Array.isArray(value)) throw new SampleCatalogError("Receipt response was not a list.");
  return value.map(parseReceiptFingerprint);
}

function parseReceiptFingerprint(value: unknown): ReceiptFingerprint {
  const body = objectValue(value, "Receipt was invalid.");
  if (!Array.isArray(body.lines)) throw new SampleCatalogError("Receipt lines were invalid.");
  return {
    id: uuidField(body.id, "Receipt id was invalid."),
    operationId: uuidField(body.operationId, "Receipt operation id was invalid."),
    branchId: uuidField(body.branchId, "Receipt branch id was invalid."),
    receiptDate: stringField(body.receiptDate, "Receipt date was invalid."),
    correctionRevision: integerField(body.correctionRevision, "Receipt revision was invalid."),
    lines: body.lines.map((entry) => {
      const line = objectValue(entry, "Receipt line was invalid.");
      return {
        variantId: uuidField(line.variantId, "Receipt variant id was invalid."),
        quantity: integerField(line.quantity, "Receipt quantity was invalid."),
        unitCostPiasters: integerField(line.unitCostPiasters, "Receipt cost was invalid."),
        effectiveQuantity: integerField(line.effectiveQuantity, "Receipt effective quantity was invalid."),
        effectiveUnitCostPiasters: integerField(line.effectiveUnitCostPiasters, "Receipt effective cost was invalid."),
      };
    }).sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
}

function parseReceiptWithRemaining(value: unknown): { fingerprint: ReceiptFingerprint; remainingQuantities: number[] } {
  const body = objectValue(value, "Receipt was invalid.");
  if (!Array.isArray(body.lines)) throw new SampleCatalogError("Receipt lines were invalid.");
  const fingerprint = parseReceiptFingerprint(value);
  const remaining = new Map<string, number>();
  for (const entry of body.lines) {
    const line = objectValue(entry, "Receipt line was invalid.");
    remaining.set(uuidField(line.variantId, "Receipt variant id was invalid."), integerField(line.remainingQuantity, "Receipt remaining quantity was invalid."));
  }
  return {
    fingerprint,
    remainingQuantities: fingerprint.lines.map((line) => {
      const quantity = remaining.get(line.variantId);
      if (quantity === undefined) throw new SampleCatalogError("Receipt remaining quantity was missing.");
      return quantity;
    }),
  };
}

function parseBaseline(value: unknown): BaselineSnapshot {
  const body = objectValue(value, "Baseline snapshot was invalid.");
  if (body.version !== SAMPLE_VERSION) throw new SampleCatalogError("Baseline snapshot version differs.");
  return {
    version: SAMPLE_VERSION,
    branches: assertExpectedBranches(body.branches),
    categories: parseNamedList(body.categories, true),
    sizes: parseNamedList(body.sizes, false),
    colors: parseNamedList(body.colors, false),
    products: parseStoredProducts(body.products),
    receipts: parseReceiptFingerprints(body.receipts),
  };
}

export function parseBaselineSnapshot(value: unknown): BaselineSnapshot {
  return parseBaseline(value);
}

function parseStoredProducts(value: unknown): NormalizedProduct[] {
  if (!Array.isArray(value)) throw new SampleCatalogError("Baseline products were not a list.");
  return value.map(parseStoredProduct);
}

function parseStoredProduct(value: unknown): NormalizedProduct {
  const body = objectValue(value, "Baseline product was invalid.");
  if (!Array.isArray(body.variants) || !Array.isArray(body.imageRefs)) {
    throw new SampleCatalogError("Baseline product variants were invalid.");
  }
  if (typeof body.descriptionAr !== "string") {
    throw new SampleCatalogError("Baseline product description was invalid.");
  }
  const publication = body.publication === "available" || body.publication === "coming_soon" || body.publication === "hidden"
    ? body.publication
    : undefined;
  if (!publication) throw new SampleCatalogError("Baseline product publication was invalid.");
  return {
    id: uuidField(body.id, "Baseline product id was invalid."),
    editRevision: integerField(body.editRevision, "Baseline product revision was invalid."),
    code: stringField(body.code, "Baseline product code was invalid."),
    nameAr: stringField(body.nameAr, "Baseline product name was invalid."),
    descriptionAr: body.descriptionAr,
    categoryId: uuidField(body.categoryId, "Baseline category id was invalid."),
    categoryName: stringField(body.categoryName, "Baseline category name was invalid."),
    categoryParentId: body.categoryParentId === null || body.categoryParentId === undefined
      ? null
      : uuidField(body.categoryParentId, "Baseline category parent was invalid."),
    defaultSellingPricePiasters: integerField(body.defaultSellingPricePiasters, "Baseline product price was invalid."),
    publication,
    imageRefs: body.imageRefs.map((item) => stringField(item, "Baseline image ref was invalid.")),
    sizeGuideAr: body.sizeGuideAr === null || body.sizeGuideAr === undefined
      ? null
      : stringField(body.sizeGuideAr, "Baseline size guide was invalid."),
    variants: body.variants.map(parseStoredVariant),
  };
}

function parseStoredVariant(value: unknown): NormalizedVariant {
  const body = objectValue(value, "Baseline variant was invalid.");
  if (body.onlineVisible !== true && body.onlineVisible !== false) {
    throw new SampleCatalogError("Baseline variant visibility was invalid.");
  }
  return {
    id: uuidField(body.id, "Baseline variant id was invalid."),
    sizeId: uuidField(body.sizeId, "Baseline size id was invalid."),
    sizeName: stringField(body.sizeName, "Baseline size name was invalid."),
    colorId: uuidField(body.colorId, "Baseline color id was invalid."),
    colorName: stringField(body.colorName, "Baseline color name was invalid."),
    onlineVisible: body.onlineVisible,
    sellingPricePiastersOverride: body.sellingPricePiastersOverride === null
      ? null
      : integerField(body.sellingPricePiastersOverride, "Baseline variant override was invalid."),
    sellingPricePiasters: integerField(body.sellingPricePiasters, "Baseline variant price was invalid."),
  };
}

function parseTaxonomy(value: unknown): TaxonomyIds {
  const body = objectValue(value, "Taxonomy checkpoint was invalid.");
  const categoryIds = objectValue(body.categoryIds, "Taxonomy categories were invalid.");
  const sizeIds = objectValue(body.sizeIds, "Taxonomy sizes were invalid.");
  const colorIds = objectValue(body.colorIds, "Taxonomy colors were invalid.");
  return {
    categoryIds: {
      Pants: uuidField(categoryIds.Pants, "Pants id was invalid."),
      Jackets: uuidField(categoryIds.Jackets, "Jackets id was invalid."),
      Shirts: uuidField(categoryIds.Shirts, "Shirts id was invalid."),
      "T-Shirts": uuidField(categoryIds["T-Shirts"], "T-Shirts id was invalid."),
    },
    sizeIds: mapUuidRecord(sizeIds),
    colorIds: mapUuidRecord(colorIds),
  };
}

export function parseUploadIntent(value: unknown): UploadIntent {
  const body = objectValue(value, "Upload intent was invalid.");
  const contentType = body.contentType === "image/png" || body.contentType === "image/webp" ? body.contentType : undefined;
  if (!contentType) throw new SampleCatalogError("Upload intent content type was invalid.");
  const fileName = stringField(body.fileName, "Upload file name was invalid.");
  const suffix = contentType === "image/png" ? ".png" : ".webp";
  if (!fileName.toLowerCase().endsWith(suffix)) {
    throw new SampleCatalogError("Upload intent file name does not match its content type.");
  }
  return {
    fileName,
    contentType,
    byteLength: integerField(body.byteLength, "Upload size was invalid."),
    sha256: stringField(body.sha256, "Upload hash was invalid."),
  };
}

function parseUploadResponse(value: unknown): UploadResponse | undefined {
  const body = objectValue(value, "Upload response was invalid.");
  const ref = stringField(body.ref, "Upload ref was invalid.");
  if (!MEDIA_REF_PATTERN.test(ref)) throw new SampleCatalogError("Upload ref was invalid.");
  const contentType = body.contentType === "image/png" || body.contentType === "image/webp" ? body.contentType : undefined;
  if (!contentType || !ref.endsWith(contentType === "image/png" ? ".png" : ".webp")) {
    throw new SampleCatalogError("Upload ref was invalid.");
  }
  const source = body.source === "existing-product-media" ? "existing-product-media" : "upload";
  return {
    ref,
    contentType,
    byteLength: integerField(body.byteLength, "Upload size was invalid."),
    source,
  };
}

function parsePublishPayload(value: unknown): PublishPayload {
  const body = objectValue(value, "Publish intent was invalid.");
  if (!Array.isArray(body.expectedVariantIds) || !Array.isArray(body.imageRefs) || !Array.isArray(body.variants)) {
    throw new SampleCatalogError("Publish intent was invalid.");
  }
  const imageRef = body.imageRefs[0];
  if (body.publication !== "available" || body.imageRefs.length !== 1 || typeof imageRef !== "string") {
    throw new SampleCatalogError("Publish intent was invalid.");
  }
  return {
    expectedRevision: integerField(body.expectedRevision, "Publish revision was invalid."),
    expectedVariantIds: body.expectedVariantIds.map((item) => uuidField(item, "Publish variant id was invalid.")),
    code: stringField(body.code, "Publish code was invalid."),
    nameAr: stringField(body.nameAr, "Publish name was invalid."),
    descriptionAr: stringField(body.descriptionAr, "Publish description was invalid."),
    categoryId: uuidField(body.categoryId, "Publish category was invalid."),
    defaultSellingPricePiasters: integerField(body.defaultSellingPricePiasters, "Publish price was invalid."),
    publication: "available",
    imageRefs: [imageRef],
    sizeGuideAr: null,
    variants: body.variants.map((entry) => {
      const variant = objectValue(entry, "Publish variant was invalid.");
      if (variant.onlineVisible !== true || variant.sellingPricePiastersOverride !== null) {
        throw new SampleCatalogError("Publish variant was invalid.");
      }
      return {
        sizeId: uuidField(variant.sizeId, "Publish size was invalid."),
        colorId: uuidField(variant.colorId, "Publish color was invalid."),
        onlineVisible: true,
        sellingPricePiastersOverride: null,
      };
    }),
  };
}

function taxonomyFromLists(
  categories: Array<{ id: string; nameAr: string; parentId: string | null }>,
  sizes: Array<{ id: string; nameAr: string }>,
  colors: Array<{ id: string; nameAr: string }>,
  manifest: SampleManifest,
): TaxonomyIds {
  const categoryIds = {} as TaxonomyIds["categoryIds"];
  for (const category of CATEGORY_ORDER) {
    const match = categories.find((item) => item.nameAr === category && item.parentId === null);
    categoryIds[category] = match?.id ?? "00000000-0000-4000-8000-000000000000";
  }
  const sizeIds: Record<string, string> = {};
  const colorIds: Record<string, string> = {};
  for (const name of uniqueNames(manifest.products.flatMap((product) => [...product.sizes]))) {
    sizeIds[name] = sizes.find((item) => item.nameAr === name)?.id ?? "00000000-0000-4000-8000-000000000000";
  }
  for (const name of uniqueNames(manifest.products.map((product) => product.color))) {
    colorIds[name] = colors.find((item) => item.nameAr === name)?.id ?? "00000000-0000-4000-8000-000000000000";
  }
  return { categoryIds, sizeIds, colorIds };
}

function parseProductCheckpoint(value: unknown): ProductCheckpoint {
  const body = objectValue(value, "Product checkpoint was invalid.");
  if (!Array.isArray(body.variantIds)) throw new SampleCatalogError("Product checkpoint variants were invalid.");
  return {
    id: uuidField(body.id, "Product checkpoint id was invalid."),
    code: stringField(body.code, "Product checkpoint code was invalid."),
    variantIds: body.variantIds.map((item) => uuidField(item, "Product checkpoint variant was invalid.")).sort(),
  };
}

function findByCode(products: NormalizedProduct[], code: string): NormalizedProduct | undefined {
  const key = normalizeCode(code);
  const matches = products.filter((product) => normalizeCode(product.code) === key);
  if (matches.length > 1) throw new SampleCatalogError(`More than one product uses SKU ${code}. Sample intake stopped.`);
  return matches[0];
}

function mapUuidRecord(value: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = uuidField(entry, "Taxonomy id was invalid.");
  return result;
}

function uniqueNames(values: string[]): string[] {
  return [...new Set(values)];
}

function stringField(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length < 1) throw new SampleCatalogError(message);
  return value;
}

function uuidField(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new SampleCatalogError(message);
  return value;
}

function integerField(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SampleCatalogError(message);
  return value;
}

async function readJsonFile<T>(file: string, parse: (value: unknown) => T): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
  try {
    return parse(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SampleCatalogError) throw error;
    throw new SampleCatalogError(`Checkpoint is unreadable: ${path.basename(file)}. Sample intake stopped.`);
  }
}

async function writeJsonExclusive(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (isEexist(error)) throw new SampleCatalogError(`Checkpoint already exists: ${path.basename(file)}`);
    throw error;
  }
}

function redact(message: string, secrets: string[]): string {
  let output = message;
  for (const secret of secrets) {
    if (secret.length >= 4) output = output.split(secret).join("[redacted]");
  }
  return output;
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isEexist(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isDirectExecution(): boolean {
  const self = new URL(import.meta.url);
  return process.argv.some((argument) => {
    if (!argument || argument.startsWith("-")) return false;
    try {
      return pathToFileURL(path.resolve(argument)).pathname.toLowerCase() === self.pathname.toLowerCase();
    } catch {
      return false;
    }
  });
}

if (isDirectExecution()) {
  void main();
}
