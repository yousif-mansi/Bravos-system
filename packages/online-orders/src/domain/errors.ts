export class OnlineOrderValidationError extends Error {
  readonly code = "VALIDATION";
}

export class UnsupportedDeliveryAreaError extends Error {
  readonly code = "UNSUPPORTED_DELIVERY_AREA";
  constructor(message = "منطقة التوصيل غير متاحة.") { super(message); }
}

export class VariantNotOrderableError extends Error {
  readonly code = "VARIANT_NOT_ORDERABLE";
  constructor(message = "أحد المنتجات لم يعد متاحاً للطلب.") { super(message); }
}

export class InsufficientStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";
  constructor(message = "الكمية المطلوبة غير متاحة حالياً.") { super(message); }
}

export class QuoteStaleError extends Error {
  readonly code = "QUOTE_STALE";
  constructor(message = "تغير السعر أو رسوم التوصيل. راجع الإجمالي الجديد قبل الإرسال.") { super(message); }
}

export class OnlineOrderOperationConflictError extends Error {
  readonly code = "OPERATION_CONFLICT";
  constructor(message = "معرّف المحاولة مستخدم لطلب مختلف.") { super(message); }
}

export class QuoteAlreadyUsedError extends Error {
  readonly code = "QUOTE_ALREADY_USED";
  constructor(message = "تم استخدام مراجعة الطلب هذه من قبل.") { super(message); }
}
