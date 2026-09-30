import type { SalePaymentDto } from "@bravos/contracts";
import { SalesValidationError } from "./errors.ts";

export function cashPayment(amountPiasters: number): SalePaymentDto {
  return { method: "cash", cashPiasters: amountPiasters, onlinePiasters: 0 };
}

export function parsePaymentInput(value: unknown): SalePaymentDto | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SalesValidationError("طريقة الدفع غير صالحة.");
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.cashPiasters) || !Number.isSafeInteger(candidate.onlinePiasters)) {
    throw new SalesValidationError("مبالغ الدفع غير صالحة.");
  }
  const due = (candidate.cashPiasters as number) + (candidate.onlinePiasters as number);
  if (!Number.isSafeInteger(due)) throw new SalesValidationError("مبالغ الدفع غير صالحة.");
  return validatePayment(value, due);
}

export function validatePayment(value: unknown, duePiasters: number): SalePaymentDto {
  if (value === undefined || value === null) return cashPayment(duePiasters);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SalesValidationError("طريقة الدفع غير صالحة.");
  const payment = value as Record<string, unknown>;
  if (Object.keys(payment).some((key) => !["method", "cashPiasters", "onlinePiasters"].includes(key))) {
    throw new SalesValidationError("طريقة الدفع غير صالحة.");
  }
  const cash = payment.cashPiasters;
  const online = payment.onlinePiasters;
  if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(online) || (cash as number) < 0 || (online as number) < 0) {
    throw new SalesValidationError("مبالغ الدفع غير صالحة.");
  }
  if ((cash as number) + (online as number) !== duePiasters) {
    throw new SalesValidationError("مجموع النقد والدفع الإلكتروني يجب أن يساوي المتبقي على العميل.");
  }
  if (payment.method === "cash" && online === 0) return { method: "cash", cashPiasters: cash as number, onlinePiasters: 0 };
  if (payment.method === "online" && cash === 0) return { method: "online", cashPiasters: 0, onlinePiasters: online as number };
  if (payment.method === "split" && (cash as number) > 0 && (online as number) > 0) {
    return { method: "split", cashPiasters: cash as number, onlinePiasters: online as number };
  }
  throw new SalesValidationError("طريقة الدفع لا تطابق المبالغ المدخلة.");
}

export function paymentMatches(left: SalePaymentDto, right: SalePaymentDto): boolean {
  return left.method === right.method && left.cashPiasters === right.cashPiasters && left.onlinePiasters === right.onlinePiasters;
}
