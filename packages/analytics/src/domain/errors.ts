export class AnalyticsValidationError extends Error {
  readonly code = "VALIDATION" as const;

  constructor(messageAr: string) {
    super(messageAr);
    this.name = "AnalyticsValidationError";
  }
}

export class AnalyticsOperationConflictError extends Error {
  readonly code = "OPERATION_CONFLICT" as const;

  constructor() {
    super("تم استخدام هوية عملية القياس مع بيانات مختلفة.");
    this.name = "AnalyticsOperationConflictError";
  }
}
