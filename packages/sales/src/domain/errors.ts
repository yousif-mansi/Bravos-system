export class SalesValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "SalesValidationError";
  }
}
