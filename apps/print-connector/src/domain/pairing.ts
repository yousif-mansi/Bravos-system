import { PAIRING_CODE_LENGTH } from "../contracts.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function pairingCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== PAIRING_CODE_LENGTH) {
    throw new Error("pairing_entropy");
  }
  let code = "";
  for (const byte of bytes) {
    const index = byte & 31;
    code += ALPHABET[index] ?? "";
  }
  if (code.length !== PAIRING_CODE_LENGTH) {
    throw new Error("pairing_entropy");
  }
  return code;
}

export function isPairingCode(value: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${PAIRING_CODE_LENGTH}}$`).test(value);
}
