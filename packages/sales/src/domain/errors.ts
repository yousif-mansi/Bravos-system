export class SalesValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "SalesValidationError";
  }
}

export class SaleRetainedForRestoreError extends Error {
  readonly code = "SALE_RETAINED_FOR_RESTORE" as const;
  constructor(message = "تم الاحتفاظ بالبيع المكتمل لمراجعة المدير بعد الاستعادة.") {
    super(message);
    this.name = "SaleRetainedForRestoreError";
  }
}

export class SaleRestoreGenerationChangedError extends Error {
  readonly code = "RESTORE_STALE" as const;
  constructor(message = "تغير جيل البيانات بعد استعادة. أعد مزامنة البيع ليُحفظ لمراجعة المدير.") {
    super(message);
    this.name = "SaleRestoreGenerationChangedError";
  }
}
