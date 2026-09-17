export class RestoreValidationError extends Error {
  readonly code = "VALIDATION";

  constructor(message = "بيانات الاستعادة غير صالحة.", options?: ErrorOptions) {
    super(message, options);
    this.name = "RestoreValidationError";
  }
}

export class RestoreStaleError extends Error {
  readonly code = "RESTORE_STALE";

  constructor(message = "تغيرت بيانات العمل أو حالة الأجهزة بعد إعداد معاينة الاستعادة. حدّث المعاينة وأعد المحاولة.") {
    super(message);
    this.name = "RestoreStaleError";
  }
}

export class RestorePausedError extends Error {
  readonly code = "RESTORE_PAUSED";

  constructor(message = "تغييرات العمل متوقفة مؤقتاً لإتمام استعادة البيانات.") {
    super(message);
    this.name = "RestorePausedError";
  }
}
