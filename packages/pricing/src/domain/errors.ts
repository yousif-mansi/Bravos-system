export class PricingValidationError extends Error {
  readonly code = "VALIDATION" as const;

  constructor(messageAr: string) {
    super(messageAr);
    this.name = "PricingValidationError";
  }
}

export class CouponUsageConflictError extends Error {
  readonly code = "CONFLICT" as const;

  constructor(message = "بلغ الكوبون الحد الأقصى للاستخدام.") {
    super(message);
    this.name = "CouponUsageConflictError";
  }
}
