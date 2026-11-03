import type { StoredPairing, TokenStore } from "../ports.ts";

export type MemoryTokenStore = TokenStore & {
  snapshot(): StoredPairing | null;
};

export function createMemoryTokenStore(initial: StoredPairing | null = null): MemoryTokenStore {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(record) {
      current = record;
    },
    async clear() {
      current = null;
    },
    snapshot() {
      return current;
    },
  };
}
