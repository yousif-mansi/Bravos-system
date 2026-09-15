export class ExpensesValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "ExpensesValidationError";
  }
}

export class ExpenseOperationConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor(message = "تعذر إعادة تنفيذ العملية ببيانات مختلفة.") {
    super(message);
    this.name = "ExpenseOperationConflictError";
  }
}

export class ExpenseRevisionConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("تم تعديل المصروف بالفعل. حدّث التفاصيل قبل إعادة المحاولة.");
    this.name = "ExpenseRevisionConflictError";
  }
}
