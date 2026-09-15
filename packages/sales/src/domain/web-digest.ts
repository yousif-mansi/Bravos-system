export async function sha256Hex(value: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
