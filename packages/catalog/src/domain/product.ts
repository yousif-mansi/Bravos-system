import { CatalogValidationError } from "./errors.ts";

const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLICATION_STATUSES = ["available", "coming_soon", "hidden"] as const;
const PRODUCT_MEDIA_REF_PATTERN = /^products\/[0-9A-Za-z][0-9A-Za-z._-]{0,119}\.(?:jpe?g|png|webp)$/i;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export function assertProductCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new CatalogValidationError("رمز المنتج غير صالح.");
  }
  const code = value.normalize("NFC").trim();
  if (!PRODUCT_CODE_PATTERN.test(code)) {
    throw new CatalogValidationError("رمز المنتج غير صالح.");
  }
  return code;
}

export function normalizedProductCodeKey(code: string): string {
  return code.normalize("NFC").trim().toLowerCase();
}

export function assertProductName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CatalogValidationError("اسم المنتج غير صالح.");
  }
  const name = value.normalize("NFC").trim();
  if (name.length < 1 || name.length > 80) {
    throw new CatalogValidationError("اسم المنتج غير صالح.");
  }
  return name;
}

export function assertDescription(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new CatalogValidationError("وصف المنتج غير صالح.");
  }
  const description = value.normalize("NFC").trim();
  if (description.length > 2000) {
    throw new CatalogValidationError("وصف المنتج غير صالح.");
  }
  return description;
}

export function assertTaxonomyName(value: unknown, messageAr: string): string {
  if (typeof value !== "string") {
    throw new CatalogValidationError(messageAr);
  }
  const name = value.normalize("NFC").trim();
  if (name.length < 1 || name.length > 80) {
    throw new CatalogValidationError(messageAr);
  }
  return name;
}

export function assertUuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CatalogValidationError(messageAr);
  }
  return value;
}

export function assertPublication(value: unknown): PublicationStatus {
  if (value === undefined || value === null) {
    return "hidden";
  }
  if (typeof value !== "string" || !PUBLICATION_STATUSES.includes(value as PublicationStatus)) {
    throw new CatalogValidationError("حالة النشر غير صالحة.");
  }
  return value as PublicationStatus;
}

export function assertImageRefs(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new CatalogValidationError("مراجع الصور غير صالحة.");
  }
  if (value.length > 20) {
    throw new CatalogValidationError("مراجع الصور غير صالحة.");
  }
  const refs = value.map((item) => {
    if (typeof item !== "string") {
      throw new CatalogValidationError("مراجع الصور غير صالحة.");
    }
    const ref = item.normalize("NFC").trim();
    if (!PRODUCT_MEDIA_REF_PATTERN.test(ref)) {
      throw new CatalogValidationError("مراجع الصور غير صالحة.");
    }
    return ref;
  });
  if (new Set(refs).size !== refs.length) {
    throw new CatalogValidationError("لا يمكن تكرار صورة المنتج.");
  }
  return refs;
}

export function assertSizeGuide(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new CatalogValidationError("دليل المقاسات غير صالح.");
  }
  const guide = value.normalize("NFC").trim();
  if (guide.length < 1 || guide.length > 4000) {
    throw new CatalogValidationError("دليل المقاسات غير صالح.");
  }
  return guide;
}

export function assertProductMediaRef(value: unknown): string {
  if (typeof value !== "string") {
    throw new CatalogValidationError("مرجع الصورة غير صالح.");
  }
  const ref = value.normalize("NFC").trim();
  if (!PRODUCT_MEDIA_REF_PATTERN.test(ref)) {
    throw new CatalogValidationError("مرجع الصورة غير صالح.");
  }
  return ref;
}

export function assertOptionalUuid(value: unknown, messageAr: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return assertUuid(value, messageAr);
}
