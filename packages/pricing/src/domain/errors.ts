export class PricingValidationError extends Error {
  readonly code = "VALIDATION" as const;

  constructor(messageAr: string) {
    super(messageAr);
    this.name = "PricingValidationError";
  }
}
