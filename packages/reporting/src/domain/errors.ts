export class ReportingValidationError extends Error { readonly code = "VALIDATION"; }

export class ReportingPayloadLimitError extends ReportingValidationError {
  constructor(readonly limitBytes: number) {
    super("حجم تفاصيل التقرير كبير جداً. ضيّق الفترة أو المرشحات أو اعرض صفحة تفاصيل أصغر.");
  }
}

export class ReportingExportLimitError extends Error {
  readonly code = "VALIDATION";

  constructor(readonly limit: number) {
    super("التقرير كبير جداً للتصدير. اختر فترة أو مرشحات أضيق.");
  }
}
