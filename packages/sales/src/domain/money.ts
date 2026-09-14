import { SalesValidationError } from "./errors.ts";

const UNREPRESENTABLE = "تعذر تمثيل مبلغ البيع.";

export function assertSafeMoney(value: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0) {
    throw new SalesValidationError(UNREPRESENTABLE);
  }
  return value;
}

export function multiplyMoney(unitPiasters: number, quantity: number): number {
  assertSafeMoney(unitPiasters);
  if (!Number.isInteger(quantity) || Object.is(quantity, -0) || quantity < 0) {
    throw new SalesValidationError("الكمية غير صالحة.");
  }
  if (unitPiasters > 0 && quantity > Math.floor(Number.MAX_SAFE_INTEGER / unitPiasters)) {
    throw new SalesValidationError(UNREPRESENTABLE);
  }
  return assertSafeMoney(unitPiasters * quantity);
}

export function addMoney(left: number, right: number): number {
  return assertSafeMoney(assertSafeMoney(left) + assertSafeMoney(right));
}

export function subtractMoney(left: number, right: number): number {
  assertSafeMoney(left);
  assertSafeMoney(right);
  const next = left - right;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
  }
  return next;
}
