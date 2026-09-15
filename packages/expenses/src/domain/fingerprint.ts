import { createHash } from "node:crypto";

export function fingerprintExpensePayload(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
