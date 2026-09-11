export class InventoryValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

export class OperationConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor(message = "تعذر إعادة تنفيذ العملية ببيانات مختلفة.") {
    super(message);
    this.name = "OperationConflictError";
  }
}
