import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  adoptionProblems,
  assertDevelopmentTarget,
  assertExpectedBranches,
  assertSamePayload,
  buildHiddenProductPayload,
  buildPublishPayload,
  buildReceiptPayload,
  canonicalJson,
  credentialsPathDecision,
  decidePublish,
  decideUpload,
  findPublicCostLeak,
  formatPlan,
  inspectPng,
  inspectSampleImage,
  isRevisionConflict,
  matchesDesiredPublish,
  mediaPreserveDecision,
  MEDIA_BYTE_LIMIT,
  parseBaselineSnapshot,
  parseCli,
  parseOwnerCredentials,
  parseSampleManifest,
  parseUploadIntent,
  reviewPublicMedia,
  reviewSampleImageFile,
  preservationProblems,
  receiptOperationId,
  reviewPublicSample,
  reviewSampleReceipt,
  selectOwnerCredentials,
  stableUuid,
  uploadDescriptor,
} from "../../scripts/sample-catalog.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const manifestPath = path.join(root, "assets", "sample-catalog", "catalog.json");
const version = "bravos-sample-range-2026-10-13-v1";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const imageRef = "products/sample0000-0000-4000-8000-000000000001.png";
const developmentTarget = {
  apiOrigin: "http://127.0.0.1:3010",
  internalOrigin: "http://127.0.0.1:5173",
  nodeEnv: "development",
  loopbackRehearsal: undefined,
  configuredApiOrigin: undefined,
  configuredInternalOrigin: undefined,
};

async function manifest() {
  return parseSampleManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

function taxonomyFor(spec) {
  return {
    categoryIds: {
      Pants: uuid(1),
      Jackets: uuid(2),
      Shirts: uuid(3),
      "T-Shirts": uuid(4),
    },
    sizeIds: Object.fromEntries(spec.sizes.map((size, index) => [size, uuid(10 + index)])),
    colorIds: { [spec.color]: uuid(30) },
  };
}

function managerProduct(spec, taxonomy, patch = {}) {
  return {
    id: uuid(50),
    editRevision: 1,
    code: spec.code,
    nameAr: spec.name,
    descriptionAr: spec.description,
    categoryId: taxonomy.categoryIds[spec.category],
    categoryName: spec.category,
    categoryParentId: null,
    defaultSellingPricePiasters: spec.pricePiasters,
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: null,
    variants: spec.sizes.map((size, index) => ({
      id: uuid(100 + index),
      sizeId: taxonomy.sizeIds[size],
      sizeName: size,
      colorId: taxonomy.colorIds[spec.color],
      colorName: spec.color,
      onlineVisible: false,
      sellingPricePiastersOverride: null,
      sellingPricePiasters: spec.pricePiasters,
    })),
    ...patch,
  };
}

function png(width, height, byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}

test("the authorized manifest is 30 products with four explicit sizes", async () => {
  const sample = await manifest();
  assert.equal(sample.products.length, 30);
  assert.equal(sample.quantityPerVariantPerBranch, 5);
  assert.equal(sample.receiptDate, "2026-10-13");
  assert.deepEqual(
    sample.products.map((product) => product.code),
    Array.from({ length: 30 }, (_unused, index) => `BRV-SAMPLE-${String(index + 1).padStart(3, "0")}`),
  );
  assert.equal(sample.products.filter((product) => product.category === "Pants").length, 8);
  assert.equal(sample.products.filter((product) => product.category === "Jackets").length, 6);
  assert.equal(sample.products.filter((product) => product.category === "Shirts").length, 8);
  assert.equal(sample.products.filter((product) => product.category === "T-Shirts").length, 8);
  assert.ok(sample.products.every((product) => product.sizes.length === 4 && (product.image === `images/${product.code}.png` || product.image === `images/${product.code}.webp`)));
});

test("a swapped image path or product count is rejected", async () => {
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  const moved = structuredClone(raw);
  moved.products[0].image = "../secret.png";
  assert.throws(() => parseSampleManifest(moved), /image path/);
  const shortened = structuredClone(raw);
  shortened.products.pop();
  assert.throws(() => parseSampleManifest(shortened), /exactly 30/);
  const webpPath = structuredClone(raw);
  webpPath.products[0].image = "images/BRV-SAMPLE-001.webp";
  assert.equal(parseSampleManifest(webpPath).products[0].image, "images/BRV-SAMPLE-001.webp");
  const jpegPath = structuredClone(raw);
  jpegPath.products[0].image = "images/BRV-SAMPLE-001.jpg";
  assert.throws(() => parseSampleManifest(jpegPath), /image path/);
  const otherCode = structuredClone(raw);
  otherCode.products[0].image = "images/BRV-SAMPLE-002.webp";
  assert.throws(() => parseSampleManifest(otherCode), /image path/);
});

test("plan output lists variants and branch quantity without costs or image provenance", async () => {
  const sample = await manifest();
  const text = formatPlan(sample, { missingCodes: ["BRV-SAMPLE-030"], invalidCodes: [] });
  assert.match(text, /Products: 30/);
  assert.match(text, /Variants per product: 4/);
  assert.match(text, /Quantity per branch: 5/);
  assert.match(text, /Expected branches: 2/);
  assert.match(text, /BRV-SAMPLE-001 {2}Tapered Twill Pants {2}Pants {2}Black {2}sizes 30, 32, 34, 36 {2}qty\/branch 5/);
  assert.match(text, /Apply stops before any request/);
  for (const secret of ["55000", "90000", "45000", "18000", "costPiasters", "unitCost", "matte black men's tapered", "owner password"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("hidden, publish, and receipt payloads stay idempotent and keep cost off the product body", async () => {
  const spec = (await manifest()).products[0];
  const taxonomy = taxonomyFor(spec);
  const hidden = buildHiddenProductPayload(spec, taxonomy);
  assert.equal(hidden.publication, "hidden");
  assert.equal(hidden.nameAr, "Tapered Twill Pants");
  assert.deepEqual(hidden.imageRefs, []);
  assert.deepEqual(hidden.variants.map((variant) => variant.onlineVisible), [false, false, false, false]);
  assert.equal(JSON.stringify(hidden).includes("costPiasters"), false);
  assert.equal(JSON.stringify(hidden).includes("matte black men's tapered"), false);

  const product = managerProduct(spec, taxonomy);
  const published = buildPublishPayload(product, spec, imageRef);
  assert.equal(published.publication, "available");
  assert.deepEqual(published.expectedVariantIds, product.variants.map((variant) => variant.id).sort());
  assert.deepEqual(published.imageRefs, [imageRef]);
  const webpRef = "products/sample0000-0000-4000-8000-000000000001.webp";
  assert.deepEqual(buildPublishPayload(product, spec, webpRef).imageRefs, [webpRef]);
  assert.throws(() => buildPublishPayload(product, spec, "products/sample0000-0000-4000-8000-000000000001.gif"), /PNG or WebP/);
  assert.ok(published.variants.every((variant) => variant.onlineVisible === true && variant.sellingPricePiastersOverride === null));
  assert.deepEqual(
    published.variants.map((variant) => `${variant.sizeId}:${variant.colorId}`),
    product.variants.map((variant) => `${variant.sizeId}:${variant.colorId}`),
  );
  assert.equal(matchesDesiredPublish({
    ...product,
    publication: "available",
    imageRefs: [imageRef],
    variants: product.variants.map((variant) => ({ ...variant, onlineVisible: true })),
  }, published), true);

  const firstBranch = uuid(7);
  const secondBranch = uuid(8);
  const first = buildReceiptPayload(spec, firstBranch, product.variants);
  const repeat = buildReceiptPayload(spec, firstBranch, product.variants);
  assert.equal(canonicalJson(first), canonicalJson(repeat));
  assert.deepEqual(first.lines.map((line) => line.quantity), [5, 5, 5, 5]);
  assert.ok(first.lines.every((line) => line.unitCostPiasters === spec.costPiasters));
  assert.equal(receiptOperationId(spec.code, firstBranch), first.operationId);
  assert.notEqual(receiptOperationId(spec.code, secondBranch), first.operationId);
  assert.match(first.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => assertSamePayload({ ...first, lines: [{ ...first.lines[0], unitCostPiasters: 1 }] }, first, "Receipt payload"), /differs from the payload saved/);
});

test("an existing SKU is adopted only when its sample facts match", async () => {
  const spec = (await manifest()).products[0];
  const taxonomy = taxonomyFor(spec);
  const product = managerProduct(spec, taxonomy);
  assert.deepEqual(adoptionProblems(product, spec, taxonomy), []);
  assert.ok(adoptionProblems({ ...product, nameAr: "Other Pants" }, spec, taxonomy).includes("name"));
  assert.ok(adoptionProblems({
    ...product,
    variants: product.variants.slice(0, 3),
  }, spec, taxonomy).includes("pairs"));
  assert.ok(adoptionProblems({ ...product, publication: "coming_soon" }, spec, taxonomy).includes("publication"));
});

test("publish and upload resume rules refuse a forced rewrite or a second upload", async () => {
  const spec = (await manifest()).products[0];
  const taxonomy = taxonomyFor(spec);
  const product = managerProduct(spec, taxonomy);
  const desired = buildPublishPayload(product, spec, imageRef);
  const stale = { ...desired, expectedRevision: 4 };
  assert.equal(decidePublish({ matchesDesired: false, desired, savedIntent: undefined, savedResponse: false }).action, "send");
  assert.equal(decidePublish({ matchesDesired: true, desired, savedIntent: stale, savedResponse: false }).action, "skip");
  assert.equal(decidePublish({ matchesDesired: false, desired, savedIntent: stale, savedResponse: false }).action, "abort");
  assert.equal(decidePublish({ matchesDesired: false, desired, savedIntent: undefined, savedResponse: true }).action, "abort");
  assert.equal(isRevisionConflict(400, { error: { code: "VALIDATION", messageAr: "تغير المنتج أثناء التعديل. أعد تحميله وراجع المقاسات والألوان قبل الحفظ." } }), true);
  assert.equal(isRevisionConflict(409, { error: { code: "OPERATION_CONFLICT", messageAr: "تغير المنتج أثناء التعديل" } }), false);

  const file = { fileName: "BRV-SAMPLE-001.png", contentType: "image/png", byteLength: 24, sha256: "abc" };
  assert.equal(decideUpload({ intent: undefined, response: undefined, file, productImageRefs: [], matchingStoredRef: undefined }).action, "upload");
  assert.equal(decideUpload({ intent: file, response: undefined, file, productImageRefs: [], matchingStoredRef: undefined }).action, "stop");
  assert.equal(decideUpload({
    intent: file,
    response: { ref: imageRef, contentType: "image/png", byteLength: 24, source: "upload" },
    file,
    productImageRefs: [imageRef],
    matchingStoredRef: imageRef,
  }).action, "reuse");
  const saved = { ref: imageRef, contentType: "image/png", byteLength: 24, source: "upload" };
  const otherRef = "products/sample0000-0000-4000-8000-000000000002.png";
  assert.equal(decideUpload({
    intent: file,
    response: saved,
    file,
    productImageRefs: [otherRef],
    matchingStoredRef: undefined,
  }).action, "stop");
  assert.equal(decideUpload({
    intent: file,
    response: saved,
    file,
    productImageRefs: [],
    matchingStoredRef: undefined,
  }).action, "reuse");
  assert.equal(mediaPreserveDecision([], imageRef).action, "allow");
  assert.equal(mediaPreserveDecision([imageRef], imageRef).action, "allow");
  assert.equal(mediaPreserveDecision([otherRef], imageRef).action, "stop");
  assert.equal(mediaPreserveDecision([imageRef, otherRef], imageRef).action, "stop");
});

test("development targets, owner credentials, and branch count fail closed", () => {
  assert.doesNotThrow(() => assertDevelopmentTarget(developmentTarget));
  assert.throws(() => assertDevelopmentTarget({ ...developmentTarget, apiOrigin: "http://127.0.0.1:3012" }), /development loopback API/);
  assert.throws(() => assertDevelopmentTarget({ ...developmentTarget, internalOrigin: "http://localhost:5173" }), /internal origin/);
  assert.throws(() => assertDevelopmentTarget({ ...developmentTarget, nodeEnv: "production" }), /NODE_ENV=production/);
  assert.throws(() => assertDevelopmentTarget({ ...developmentTarget, loopbackRehearsal: "true" }), /rehearsal/);
  assert.throws(() => assertDevelopmentTarget({ ...developmentTarget, configuredApiOrigin: "https://shop.example" }), /BRAVOS_API_ORIGIN/);

  const parsed = parseOwnerCredentials([
    "BRAVOS labeled local demo credentials. Disposable. Do not use in production.",
    "owner login: owner",
    "owner password: owner-secret",
    "demo cashier login: cashier",
    "demo cashier password: cashier-secret",
  ].join("\n"));
  assert.deepEqual(parsed, { username: "owner", password: "owner-secret" });
  assert.throws(() => parseOwnerCredentials("owner login: owner\nowner password: unknown\n"), /unverifed|unverified/);
  assert.throws(() => selectOwnerCredentials({
    envUsername: "owner",
    envPassword: "env-secret",
    fileText: "owner login: owner\nowner password: file-secret\n",
  }), /not both/);
  assert.throws(() => selectOwnerCredentials({ envUsername: undefined, envPassword: undefined, fileText: undefined }), /credentials are missing/);

  const localRoot = path.resolve(root, ".local");
  assert.doesNotThrow(() => credentialsPathDecision(localRoot, path.join(localRoot, "demo-credentials.txt")));
  assert.throws(() => credentialsPathDecision(localRoot, path.join(localRoot, "e2e", "owner.txt")), /e2e/);
  assert.throws(() => credentialsPathDecision(localRoot, path.join(localRoot, "storefront-demo", "credentials.json")), /isolated demo/);
  assert.throws(() => credentialsPathDecision(localRoot, path.resolve(root, "secret.txt")), /inside \.local/);

  const branches = [
    { id: uuid(2), code: "fayoum", nameAr: "الفيوم" },
    { id: uuid(1), code: "abshway", nameAr: "أبشواي" },
  ];
  assert.deepEqual(assertExpectedBranches(branches).map((branch) => branch.code), ["abshway", "fayoum"]);
  assert.throws(() => assertExpectedBranches(branches.slice(0, 1)), /found 1/);
  assert.throws(() => assertExpectedBranches([...branches, { id: uuid(3), code: "other", nameAr: "Other" }]), /found 3|not the two expected/);
});

test("png preflight enforces the existing media byte and pixel limits", () => {
  assert.equal(MEDIA_BYTE_LIMIT, 5 * 1024 * 1024);
  assert.deepEqual(inspectPng(png(1200, 1500)), { width: 1200, height: 1500, byteLength: 24 });
  assert.throws(() => inspectPng(png(1200, 1500, 23)), /5 MiB/);
  assert.throws(() => inspectPng(new Uint8Array(MEDIA_BYTE_LIMIT + 1)), /5 MiB/);
  assert.throws(() => inspectPng(png(8001, 1)), /20-megapixel|8000/);
  assert.throws(() => inspectPng(png(8000, 2501)), /20-megapixel|8000/);
  const broken = png(10, 10);
  broken[0] = 0;
  assert.throws(() => inspectPng(broken), /PNG/);
});

function writeAscii(bytes, offset, text) {
  for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
}

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
}

function webpContainer(tag, payload) {
  const size = payload.length;
  const total = 20 + size + (size % 2);
  const bytes = new Uint8Array(total);
  writeAscii(bytes, 0, "RIFF");
  writeUint32LE(bytes, 4, total - 8);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, tag);
  writeUint32LE(bytes, 16, size);
  bytes.set(payload, 20);
  return bytes;
}

function webpVp8(width, height) {
  const payload = new Uint8Array(10);
  payload[0] = 0x10;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload[6] = width & 255;
  payload[7] = (width >>> 8) & 255;
  payload[8] = height & 255;
  payload[9] = (height >>> 8) & 255;
  return webpContainer("VP8 ", payload);
}

function webpVp8x(width, height, flags = 0) {
  const payload = new Uint8Array(10);
  payload[0] = flags;
  const canvasWidth = width - 1;
  const canvasHeight = height - 1;
  payload[4] = canvasWidth & 255;
  payload[5] = (canvasWidth >>> 8) & 255;
  payload[6] = (canvasWidth >>> 16) & 255;
  payload[7] = canvasHeight & 255;
  payload[8] = (canvasHeight >>> 8) & 255;
  payload[9] = (canvasHeight >>> 16) & 255;
  return webpContainer("VP8X", payload);
}

function webpVp8l(width, height) {
  const bits = (width - 1) | ((height - 1) << 14);
  const payload = new Uint8Array(5);
  payload[0] = 0x2f;
  payload[1] = bits & 255;
  payload[2] = (bits >>> 8) & 255;
  payload[3] = (bits >>> 16) & 255;
  payload[4] = (bits >>> 24) & 255;
  return webpContainer("VP8L", payload);
}

test("webp preflight reads VP8, VP8X, and VP8L and rejects a format or limit mismatch", () => {
  const vp8 = webpVp8(1200, 1500);
  assert.deepEqual(inspectSampleImage(vp8), {
    format: "webp",
    contentType: "image/webp",
    width: 1200,
    height: 1500,
    byteLength: vp8.byteLength,
  });
  assert.deepEqual(inspectSampleImage(webpVp8x(900, 1400)), {
    format: "webp",
    contentType: "image/webp",
    width: 900,
    height: 1400,
    byteLength: webpVp8x(900, 1400).byteLength,
  });
  assert.deepEqual(inspectSampleImage(webpVp8l(640, 800)), {
    format: "webp",
    contentType: "image/webp",
    width: 640,
    height: 800,
    byteLength: webpVp8l(640, 800).byteLength,
  });
  const pngBytes = png(1200, 1500);
  assert.equal(inspectSampleImage(pngBytes).format, "png");
  assert.equal(reviewSampleImageFile(vp8, "images/BRV-SAMPLE-001.webp").contentType, "image/webp");
  assert.throws(() => reviewSampleImageFile(vp8, "images/BRV-SAMPLE-001.png"), /manifest path extension/);
  assert.throws(() => reviewSampleImageFile(pngBytes, "images/BRV-SAMPLE-001.webp"), /manifest path extension/);
  assert.deepEqual(uploadDescriptor("BRV-SAMPLE-001", inspectSampleImage(vp8)), {
    fileName: "BRV-SAMPLE-001.webp",
    contentType: "image/webp",
  });
  assert.equal(parseUploadIntent({
    fileName: "BRV-SAMPLE-001.webp",
    contentType: "image/webp",
    byteLength: vp8.byteLength,
    sha256: "abc",
  }).contentType, "image/webp");
  assert.throws(() => parseUploadIntent({
    fileName: "BRV-SAMPLE-001.png",
    contentType: "image/webp",
    byteLength: vp8.byteLength,
    sha256: "abc",
  }), /file name/);
  assert.throws(() => parseUploadIntent({
    fileName: "BRV-SAMPLE-001.jpg",
    contentType: "image/jpeg",
    byteLength: vp8.byteLength,
    sha256: "abc",
  }), /content type/);
  assert.throws(() => inspectSampleImage(new Uint8Array(MEDIA_BYTE_LIMIT + 1)), /5 MiB/);
  assert.throws(() => inspectSampleImage(webpVp8(8001, 1)), /8000|20-megapixel/);
  assert.throws(() => inspectSampleImage(webpVp8(8000, 2501)), /8000|20-megapixel/);
  assert.throws(() => inspectSampleImage(webpVp8x(1200, 1500, 0x02)), /animation/);
  const interframe = webpVp8(20, 20);
  interframe[20] = 0x01;
  assert.throws(() => inspectSampleImage(interframe), /keyframe/);
  const truncated = vp8.slice(0, 12);
  assert.throws(() => inspectSampleImage(truncated), /VP8|truncated/);
  const wave = webpVp8(20, 20);
  writeAscii(wave, 8, "WAVE");
  assert.throws(() => inspectSampleImage(wave), /PNG or WebP/);
  const expected = inspectSampleImage(vp8);
  assert.equal(reviewPublicMedia({ expected, contentType: "image/webp", bytes: vp8 }), null);
  assert.match(reviewPublicMedia({ expected, contentType: "image/png", bytes: vp8 }) ?? "", /uploaded format/);
  const resized = webpVp8(1000, 1500);
  assert.match(reviewPublicMedia({ expected, contentType: "image/webp", bytes: resized }) ?? "", /dimensions/);
});

test("public cost scan and stock review do not treat selling price as cost", async () => {
  const spec = (await manifest()).products[0];
  const publicProduct = {
    id: uuid(50),
    nameAr: spec.name,
    descriptionAr: spec.description,
    categoryName: spec.category,
    publication: "available",
    availability: "in_stock",
    imageRefs: [imageRef],
    variants: spec.sizes.map((size, index) => ({
      id: uuid(100 + index),
      sizeName: size,
      colorName: spec.color,
      sellingPricePiasters: spec.pricePiasters,
      availableQuantity: 5,
      orderable: true,
    })),
  };
  assert.equal(findPublicCostLeak(publicProduct), null);
  assert.match(findPublicCostLeak({ ...publicProduct, unitCostPiasters: 55000 }) ?? "", /unitCostPiasters/);
  assert.equal(reviewPublicSample({
    spec,
    product: publicProduct,
    managerVariantIds: publicProduct.variants.map((variant) => variant.id),
  }), null);
  assert.match(reviewPublicSample({
    spec,
    product: { ...publicProduct, variants: publicProduct.variants.map((variant) => ({ ...variant, availableQuantity: 10 })) },
    managerVariantIds: publicProduct.variants.map((variant) => variant.id),
  }) ?? "", /stock/);
});

test("receipt review keeps the original quantity and fails closed when remaining stock changed", async () => {
  const spec = (await manifest()).products[0];
  const product = managerProduct(spec, taxonomyFor(spec));
  const expected = buildReceiptPayload(spec, uuid(7), product.variants);
  const actual = {
    id: uuid(70),
    operationId: expected.operationId,
    branchId: expected.branchId,
    receiptDate: expected.receiptDate,
    correctionRevision: 0,
    lines: expected.lines.map((line) => ({ ...line, effectiveQuantity: line.quantity, effectiveUnitCostPiasters: line.unitCostPiasters })),
    remainingQuantities: [5, 5, 5, 5],
  };
  assert.equal(reviewSampleReceipt({ expected, actual }), null);
  assert.match(reviewSampleReceipt({ expected, actual: { ...actual, remainingQuantities: [5, 5, 4, 5] } }) ?? "", /will not refill/);
  assert.match(reviewSampleReceipt({ expected, actual: { ...actual, correctionRevision: 1 } }) ?? "", /corrected/);
});

test("preservation allows sample publication and rejects edits to existing records", async () => {
  const spec = (await manifest()).products[0];
  const taxonomy = taxonomyFor(spec);
  const sample = managerProduct(spec, taxonomy);
  const existing = managerProduct((await manifest()).products[1], taxonomyFor((await manifest()).products[1]), {
    id: uuid(60),
    code: "EXISTING-1",
  });
  const branches = [
    { id: uuid(1), code: "abshway", nameAr: "أبشواي" },
    { id: uuid(2), code: "fayoum", nameAr: "الفيوم" },
  ];
  const receipt = {
    id: uuid(80),
    operationId: uuid(81),
    branchId: branches[0].id,
    receiptDate: "2026-09-01",
    correctionRevision: 0,
    lines: [{ variantId: uuid(82), quantity: 2, unitCostPiasters: 1000, effectiveQuantity: 2, effectiveUnitCostPiasters: 1000 }],
  };
  const baseline = {
    version,
    branches,
    categories: [{ id: taxonomy.categoryIds.Pants, nameAr: "Pants", parentId: null }],
    sizes: [{ id: taxonomy.sizeIds["30"], nameAr: "30" }],
    colors: [{ id: taxonomy.colorIds.Black, nameAr: "Black" }],
    products: [sample, existing],
    receipts: [receipt],
  };
  const current = {
    branches,
    categories: baseline.categories,
    sizes: baseline.sizes,
    colors: baseline.colors,
    products: [
      {
        ...sample,
        editRevision: 2,
        publication: "available",
        imageRefs: [imageRef],
        variants: sample.variants.map((variant) => ({ ...variant, onlineVisible: true })),
      },
      existing,
    ],
    receipts: [receipt],
  };
  assert.deepEqual(preservationProblems(baseline, current), []);
  assert.ok(preservationProblems(baseline, {
    ...current,
    products: [sample, { ...existing, defaultSellingPricePiasters: existing.defaultSellingPricePiasters + 1 }],
  }).some((problem) => problem.includes("EXISTING-1")));
  assert.ok(preservationProblems(baseline, {
    ...current,
    products: [{ ...sample, variants: sample.variants.map((variant, index) => index === 0 ? { ...variant, id: uuid(199) } : variant) }, existing],
  }).some((problem) => problem.includes(spec.code)));
  assert.ok(preservationProblems(baseline, {
    ...current,
    receipts: [{ ...receipt, lines: [{ ...receipt.lines[0], quantity: 9 }] }],
  }).some((problem) => problem.includes(receipt.id)));
});

test("a saved baseline reads the normalized manager snapshot", async () => {
  const spec = (await manifest()).products[0];
  const taxonomy = taxonomyFor(spec);
  const sample = managerProduct(spec, taxonomy);
  const stored = {
    version,
    branches: [
      { id: uuid(1), code: "abshway", nameAr: "أبشواي" },
      { id: uuid(2), code: "fayoum", nameAr: "الفيوم" },
    ],
    categories: [{ id: taxonomy.categoryIds.Pants, nameAr: "Pants", parentId: null }],
    sizes: [{ id: taxonomy.sizeIds["30"], nameAr: "30" }],
    colors: [{ id: taxonomy.colorIds.Black, nameAr: "Black" }],
    products: [sample],
    receipts: [],
  };
  const parsed = parseBaselineSnapshot(JSON.parse(JSON.stringify(stored)));
  assert.equal(parsed.products[0].code, spec.code);
  assert.equal(parsed.products[0].categoryId, taxonomy.categoryIds.Pants);
  assert.equal(parsed.products[0].variants[0].sizeName, spec.sizes[0]);
  assert.equal(parsed.products[0].variants[0].onlineVisible, false);
});

test("commands stay on the fixed manifest and do not accept plan credentials", () => {
  assert.deepEqual(parseCli(["plan"]), {
    command: "plan",
    apiOrigin: "http://127.0.0.1:3010",
    internalOrigin: "http://127.0.0.1:5173",
  });
  assert.equal(parseCli(["verify", "--credentials-file", ".local/demo-credentials.txt"]).credentialsFile, ".local/demo-credentials.txt");
  assert.throws(() => parseCli(["plan", "--credentials-file", ".local/demo-credentials.txt"]), /does not read credentials/);
  assert.throws(() => parseCli(["apply", "--database", "postgres"]), /Unknown argument/);
  assert.equal(stableUuid("bravos-sample-catalog:test"), stableUuid("bravos-sample-catalog:test"));
});
