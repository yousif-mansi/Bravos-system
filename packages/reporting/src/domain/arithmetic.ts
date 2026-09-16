import { ReportingValidationError } from "./errors.ts";

function safe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new ReportingValidationError("تجاوزت قيمة التقرير النطاق الآمن.");
  return value;
}

export function checkedAdd(left: number, right: number): number {
  return safe(safe(left) + safe(right));
}

export function checkedSubtract(left: number, right: number): number {
  return safe(safe(left) - safe(right));
}

export function checkedMultiply(left: number, right: number): number {
  return safe(safe(left) * safe(right));
}

export function checkedSum<T>(rows: Iterable<T>, value: (row: T) => number): number {
  let total = 0;
  for (const row of rows) total = checkedAdd(total, value(row));
  return total;
}
