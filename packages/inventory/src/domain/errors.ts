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

export class StockMutationPausedError extends Error {
  readonly code = "STOCK_MUTATION_PAUSED" as const;
  constructor(message = "تغييرات المخزون متوقفة مؤقتاً لحين انتهاء تنسيق العد.") {
    super(message);
    this.name = "StockMutationPausedError";
  }
}

export class CoordinationStaleError extends Error {
  readonly code = "COORDINATION_STALE" as const;
  constructor(message = "تغير المخزون بعد بدء التنسيق. ألغِ التنسيق وابدأ مزامنة وعداً جديدين.") {
    super(message);
    this.name = "CoordinationStaleError";
  }
}
