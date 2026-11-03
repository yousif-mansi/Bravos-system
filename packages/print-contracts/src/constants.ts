/** Loopback print connector. These values are the protocol, not staff-editable printer choices. */
export const PRINT_CONNECTOR_HOST = "127.0.0.1";
export const PRINT_CONNECTOR_PORT = 17831;
export const DEFAULT_STAFF_ORIGIN = "http://127.0.0.1:5177";

export const LABEL_PRINTER_NAME = "Xprinter XP-236B";
export const RECEIPT_PRINTER_NAME = "Bravos Receipts - Xprinter XP-80TS";

export const LABEL_PAPER_WIDTH_MM = 38;
export const LABEL_PAPER_HEIGHT_MM = 25;
export const LABEL_DPI = 203;
export const LABEL_PROFILE = "compact";

/** 80mm receipt layout from the staff receipt view. 58mm (48mm content) is not this printer. */
export const RECEIPT_CONTENT_WIDTH_MM = 72;
export const RECEIPT_COPIES = 1;
export const LABEL_COPIES_MIN = 1;
export const LABEL_COPIES_MAX = 100;

export const MAX_JOB_JSON_BYTES = 32 * 1024;
export const MAX_RECEIPT_LINES = 40;
export const QUEUE_CAP = 8;

/** Terminal dedupe records older than this may be dropped. Outstanding ids are never dropped to make room. */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Sanitized id/hash/phase records. This is not a process-lifetime cap of 200. */
export const JOB_METADATA_CAP = 50_000;

/** Catalog product name, taxonomy name, and staff display name. */
export const PRODUCT_NAME_MAX = 80;
export const TAXONOMY_NAME_MAX = 80;
export const CASHIER_NAME_MAX = 80;
export const BRANCH_NAME_MAX = 80;
/** Optional sale customer name. */
export const CUSTOMER_NAME_MAX = 120;
/** Optional sale phone and the configured receipt contact phone. */
export const PHONE_MAX = 40;
/**
 * Customer receipt text. Canonical BRV references are not capped in sales;
 * 256 covers an 80-digit sequence plus the BRV prefix.
 */
export const PRINTED_REFERENCE_MAX = 256;
/** Cairo `DD/MM/YYYY HH:mm`, or the raw timestamp the receipt view already stored. */
export const OCCURRED_AT_MAX = 80;

export const PAIRING_CODE_LENGTH = 16;
export const PAIRING_TTL_MS = 120_000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_LOCK_MS = 60_000;

const ORIGIN = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/;

/** Configured staff page origin. HTTPS, localhost names, and the connector port are refused. */
export function assertStaffOrigin(value: string): string {
  const match = ORIGIN.exec(value);
  if (!match?.[1]) {
    throw new Error("invalid_staff_origin");
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === PRINT_CONNECTOR_PORT) {
    throw new Error("invalid_staff_origin");
  }
  if (String(port) !== match[1]) {
    throw new Error("invalid_staff_origin");
  }
  return value;
}
