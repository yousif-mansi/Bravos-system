export class ReportExportValidationError extends Error {
  readonly code = "VALIDATION" as const;

  constructor(messageAr: string) {
    super(messageAr);
    this.name = "ReportExportValidationError";
  }
}
