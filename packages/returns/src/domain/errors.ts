export class ReturnsValidationError extends Error {
  readonly code = "VALIDATION";
  constructor(messageAr: string) {
    super(messageAr);
    this.name = "ReturnsValidationError";
  }
}

export class ReturnWindowExpiredError extends ReturnsValidationError {
  constructor() {
    super("انتهت مدة الإرجاع داخل النظام. تُعالج الحالات اللاحقة عبر واتساب.");
    this.name = "ReturnWindowExpiredError";
  }
}
