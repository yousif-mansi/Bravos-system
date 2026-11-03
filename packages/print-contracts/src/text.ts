/** C0 controls, DEL, and bidi overrides. Ordinary punctuation, markup characters, and emoji stay. */
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const PRODUCT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** Pounds from catalog/sale piasters, at most 10_000_000.00. */
const MONEY = /^(?:0|[1-9]\d{0,7})(?:\.\d{2})?$/;
/** Quantity is 1..1_000_000. The separator is the receipt view's multiplication sign. */
const QUANTITY_PRICE = /^(?:[1-9]\d{0,5}|1000000) × (?:0|[1-9]\d{0,7})(?:\.\d{2})?$/u;

const FORBIDDEN_KEYS = new Set([
  "proto",
  "constructor",
  "prototype",
  "purchasecost",
  "unitcost",
  "costprice",
  "profit",
  "batch",
  "diagnostic",
  "diagnostics",
  "html",
  "script",
  "printer",
  "printername",
  "raw",
  "command",
  "path",
  "filepath",
  "filename",
  "file",
  "url",
  "powershell",
  "shell",
  "argv",
  "cwd",
]);

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const own = Object.keys(value);
  if (own.length !== keys.length) return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  }
  return value;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Reject smuggled cost, markup, printer, and path fields before job-specific checks. */
export function isSafeTree(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof value === "string") return value.length <= 4_000 && !CONTROL_OR_BIDI.test(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || value === null) return true;
  if (Array.isArray(value)) {
    if (value.length > 80) return false;
    return value.every((item) => isSafeTree(item, depth + 1));
  }
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 40) return false;
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) return false;
    if (!isSafeTree(value[key], depth + 1)) return false;
  }
  return true;
}

/** Stored display text. The renderer draws this as data; it is not markup and not searched for words. */
export function isDisplayText(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= max
    && !CONTROL_OR_BIDI.test(value);
}

export function isProductCode(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_CODE.test(value);
}

export function isMoney(value: unknown): value is string {
  return typeof value === "string" && MONEY.test(value);
}

export function isQuantityAndUnitPrice(value: unknown): value is string {
  return typeof value === "string" && QUANTITY_PRICE.test(value);
}

export function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseJobId(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_V4.test(value)) return null;
  return value.toLowerCase();
}
