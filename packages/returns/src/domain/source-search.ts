import { createHash } from "node:crypto";
import { ReturnsValidationError } from "./errors.ts";

type SourceFilters = {
  reference?: string; phone?: string; date?: string; branchId?: string;
  amountPiasters?: number; channel?: "physical" | "online";
};
export type SourceCursorKey = { receivedAt: string; id: string; channel: "physical" | "online" };

export function normalizeSourcePhone(input: string): string {
  const digits = input.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) - (digit >= "۰" ? 0x6f0 : 0x660)))
    .replace(/[^0-9]/g, "");
  if (!digits) throw new ReturnsValidationError("اكتب رقم هاتف صحيح.");
  return digits;
}

function filterFingerprint(filters: SourceFilters) {
  return createHash("sha256").update(JSON.stringify({ reference: filters.reference, phone: filters.phone,
    date: filters.date, branchId: filters.branchId, amountPiasters: filters.amountPiasters, channel: filters.channel })).digest("hex");
}

export function encodeSourceCursor(key: SourceCursorKey, filters: SourceFilters): string {
  return Buffer.from(JSON.stringify({ version: 1, ...key, filters: filterFingerprint(filters) })).toString("base64url");
}

export function decodeSourceCursor(input: unknown, filters: SourceFilters): SourceCursorKey | undefined {
  if (input === undefined || input === "") return undefined;
  try {
    if (typeof input !== "string" || input.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error();
    const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.version !== 1 || value.filters !== filterFingerprint(filters)
      || typeof value.receivedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.receivedAt)
      || new Date(value.receivedAt).toISOString().slice(0, 19) !== value.receivedAt.slice(0, 19)
      || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id)
      || (value.channel !== "physical" && value.channel !== "online")) throw new Error();
    return { receivedAt: value.receivedAt, id: value.id, channel: value.channel };
  } catch {
    throw new ReturnsValidationError("صفحة البحث غير صالحة. ابدأ البحث من جديد.");
  }
}
