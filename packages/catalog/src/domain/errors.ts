export class CatalogValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

export class DuplicateProductCodeError extends Error {
  readonly code = "DUPLICATE_PRODUCT_CODE" as const;
  constructor() {
    super("رمز المنتج مستخدم بالفعل.");
    this.name = "DuplicateProductCodeError";
  }
}

export class ReferencedVariantError extends Error {
  readonly code = "VARIANT_REFERENCED" as const;
  constructor() {
    super("لا يمكن حذف متغير مرتبط بسجلات مخزون.");
    this.name = "ReferencedVariantError";
  }
}
