export class StorefrontConfigValidationError extends Error {
  readonly code = "VALIDATION";

  constructor(messageAr: string) {
    super(messageAr);
    this.name = "StorefrontConfigValidationError";
  }
}
