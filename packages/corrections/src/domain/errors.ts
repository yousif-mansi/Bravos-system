export class CorrectionsValidationError extends Error {
  readonly code = "VALIDATION";
  constructor(message = "بيانات تصحيح التسجيل غير صالحة.") { super(message); }
}
