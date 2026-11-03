import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export { randomBytes };

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestsEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

const DUMMY_TOKEN_HASH = sha256Hex("bravos-print-connector-dummy");

/** Compare a bearer token with the stored hash. Missing and wrong tokens take the same compare. */
export function tokenMatches(storedHex: string | null, token: string | null): boolean {
  const presented = sha256Hex(token ?? "missing");
  const ok = digestsEqual(presented, storedHex ?? DUMMY_TOKEN_HASH);
  return storedHex !== null && token !== null && ok;
}

/** Compare a pairing code with its stored hash without an early length return. */
export function codeMatches(storedHex: string | null, code: string): boolean {
  const bounded = code.length > 64 ? code.slice(0, 64) : code;
  const presented = sha256Hex(bounded.length > 0 ? bounded : "missing");
  const ok = digestsEqual(presented, storedHex ?? DUMMY_TOKEN_HASH);
  return storedHex !== null && ok;
}
