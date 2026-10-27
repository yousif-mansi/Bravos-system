import type { ReceiptOptions, ReceiptPaperWidthMm } from "./receipt-model.ts";

const PHONE_ENV = "VITE_POS_RECEIPT_PHONE";
const WIDTH_ENV = "VITE_POS_RECEIPT_PAPER_WIDTH";

function envRecord(): Record<string, string | undefined> {
  const env = (import.meta.env ?? {}) as unknown as Record<string, unknown>;
  return {
    [PHONE_ENV]: typeof env[PHONE_ENV] === "string" ? env[PHONE_ENV] : undefined,
    [WIDTH_ENV]: typeof env[WIDTH_ENV] === "string" ? env[WIDTH_ENV] : undefined,
  };
}

export function parsePaperWidth(value: string | undefined): ReceiptPaperWidthMm {
  const trimmed = value?.trim();
  if (trimmed === "58") return 58;
  return 80;
}

/** Env defaults, then optional explicit overrides for tests and a future settings call. */
export function resolveReceiptOptions(overrides?: Partial<ReceiptOptions>): ReceiptOptions {
  const env = envRecord();
  const paperWidthMm = overrides?.paperWidthMm ?? parsePaperWidth(env[WIDTH_ENV]);
  const contactPhone = overrides?.contactPhone ?? env[PHONE_ENV] ?? "";
  return {
    paperWidthMm: paperWidthMm === 58 ? 58 : 80,
    contactPhone,
  };
}

/** Staff-only warning when no contact phone is configured. Never printed and never blocks the sale. */
export function receiptPhoneWarning(options: ReceiptOptions): string | null {
  return options.contactPhone.trim().length > 0
    ? null
    : "رقم هاتف الإيصال غير مضبوط. اطلب من المسؤول إضافته.";
}
