import { CatalogValidationError } from "./errors.ts";

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_DIMENSION = 8_000;
export const MAX_PRODUCT_IMAGE_PIXELS = 20_000_000;

export type ProductImageContentType = "image/jpeg" | "image/png" | "image/webp";

export type ValidatedProductImage = {
  contentType: ProductImageContentType;
  extension: "jpg" | "png" | "webp";
  bytes: Uint8Array;
};

export function validateProductImage(input: {
  fileName: unknown;
  contentType: unknown;
  bytes: unknown;
}): ValidatedProductImage {
  if (typeof input.fileName !== "string" || input.fileName.trim().length < 1 || input.fileName.length > 255) {
    throw new CatalogValidationError("اسم ملف الصورة غير صالح.");
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 12 || input.bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new CatalogValidationError("حجم الصورة غير صالح. الحد الأقصى 5 ميجابايت.");
  }
  const detected = detectImage(input.bytes);
  if (!detected || input.contentType !== detected.contentType) {
    throw new CatalogValidationError("نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.");
  }
  const suffix = input.fileName.trim().toLowerCase().split(".").at(-1);
  const acceptedSuffixes = detected.extension === "jpg" ? new Set(["jpg", "jpeg"]) : new Set([detected.extension]);
  if (!suffix || !acceptedSuffixes.has(suffix)) {
    throw new CatalogValidationError("امتداد الصورة لا يطابق محتواها.");
  }
  return { ...detected, bytes: input.bytes };
}

function detectImage(bytes: Uint8Array): Pick<ValidatedProductImage, "contentType" | "extension"> | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, expected: string): boolean {
  return [...expected].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
