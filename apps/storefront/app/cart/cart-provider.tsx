"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { AddCartLine, CartLine } from "./cart-types";
import { recordPublicAnalyticsEvent } from "../analytics-events";

const STORAGE_KEY = "bravos-guest-cart-v1";
const STORAGE_VERSION = 1;
const STORAGE_LOCK = "bravos-guest-cart-mutation";

type CartStorageStatus = "loading" | "ready" | "unavailable" | "corrupt";

type StoredCart = {
  version: typeof STORAGE_VERSION;
  revision: string;
  items: CartLine[];
  completedCheckoutOperationIds?: string[];
};

type CartContextValue = {
  items: CartLine[];
  hydrated: boolean;
  storageStatus: CartStorageStatus;
  itemCount: number;
  add: (line: AddCartLine) => Promise<boolean>;
  setQuantity: (variantId: string, quantity: number, maximum: number) => Promise<boolean>;
  remove: (variantId: string) => Promise<void>;
  completeCheckout: (operationId: string, lines: Array<{ variantId: string; quantity: number }>) => Promise<boolean>;
  refreshLine: (variantId: string, values: Partial<Omit<CartLine, "variantId" | "quantity">>) => Promise<void>;
};

type CartState = { items: CartLine[]; completedCheckoutOperationIds: string[] };

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [completedCheckoutOperationIds, setCompletedCheckoutOperationIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageStatus, setStorageStatus] = useState<CartStorageStatus>("loading");
  const writesEnabled = useRef(false);
  const storedRaw = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      storedRaw.current = stored;
      if (stored) {
        const parsed = parseStoredCart(stored);
        if (!parsed) {
          setStorageStatus("corrupt");
          return;
        }
        setItems(parsed.items);
        setCompletedCheckoutOperationIds(parsed.completedCheckoutOperationIds);
        if (parsed.legacy) {
          const raw = serializeCart(parsed.items, parsed.completedCheckoutOperationIds);
          window.localStorage.setItem(STORAGE_KEY, raw);
          storedRaw.current = raw;
        }
      }
      writesEnabled.current = true;
      setStorageStatus("ready");
    } catch {
      writesEnabled.current = false;
      setStorageStatus("unavailable");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    function reconcileStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || event.newValue === storedRaw.current) return;
      try {
        if (event.storageArea !== window.localStorage) return;
        if (window.localStorage.getItem(STORAGE_KEY) !== event.newValue) return;
        if (event.newValue === null) {
          storedRaw.current = null;
          writesEnabled.current = true;
          setItems([]);
          setCompletedCheckoutOperationIds([]);
          setStorageStatus("ready");
          return;
        }
        const parsed = parseStoredCart(event.newValue);
        if (!parsed) {
          writesEnabled.current = false;
          setStorageStatus("corrupt");
          return;
        }
        storedRaw.current = event.newValue;
        writesEnabled.current = true;
        setItems(parsed.items);
        setCompletedCheckoutOperationIds(parsed.completedCheckoutOperationIds);
        setStorageStatus("ready");
      } catch {
        writesEnabled.current = false;
        setStorageStatus("unavailable");
      }
    }

    window.addEventListener("storage", reconcileStorage);
    return () => window.removeEventListener("storage", reconcileStorage);
  }, []);

  async function mutateCart(
    update: (current: CartState) => CartState | null,
    requirePersistence = false,
  ): Promise<boolean> {
    return withCartLock(async () => {
      let current: CartState = { items, completedCheckoutOperationIds };
      if (writesEnabled.current) {
        try {
          const stored = window.localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = parseStoredCart(stored);
            if (!parsed) {
              writesEnabled.current = false;
              setStorageStatus("corrupt");
            } else {
              current = {
                items: parsed.items,
                completedCheckoutOperationIds: parsed.completedCheckoutOperationIds,
              };
            }
          }
        } catch {
          writesEnabled.current = false;
          setStorageStatus("unavailable");
        }
      }
      const next = update(current);
      if (!next) return false;
      let persisted = false;
      if (writesEnabled.current) {
        try {
          const raw = serializeCart(next.items, next.completedCheckoutOperationIds);
          window.localStorage.setItem(STORAGE_KEY, raw);
          storedRaw.current = raw;
          persisted = true;
          setStorageStatus("ready");
        } catch {
          writesEnabled.current = false;
          setStorageStatus("unavailable");
        }
      }
      setItems(next.items);
      setCompletedCheckoutOperationIds(next.completedCheckoutOperationIds);
      return requirePersistence ? persisted : true;
    });
  }

  const value: CartContextValue = {
    items,
    hydrated,
    storageStatus,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    async add(line) {
      const quantity = line.quantity ?? 1;
      const added = await mutateCart((current) => {
        const match = current.items.find((item) => item.variantId === line.variantId);
        if (!line.orderable || !Number.isInteger(quantity) || quantity < 1 || quantity + (match?.quantity ?? 0) > line.knownAvailableQuantity) return null;
        return {
          ...current,
          items: match
            ? current.items.map((item) => item.variantId === line.variantId ? { ...item, ...line, quantity: item.quantity + quantity } : item)
            : [...current.items, { ...line, quantity }],
        };
      });
      if (added) {
        void recordPublicAnalyticsEvent({
          operationId: crypto.randomUUID(),
          eventType: "cart_addition",
          productId: line.productId,
          variantId: line.variantId,
          quantity,
        });
      }
      return added;
    },
    async setQuantity(variantId, quantity, maximum) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) return false;
      return mutateCart((current) => ({
        ...current,
        items: current.items.map((item) => item.variantId === variantId ? { ...item, quantity } : item),
      }));
    },
    async remove(variantId) {
      await mutateCart((current) => ({ ...current, items: current.items.filter((item) => item.variantId !== variantId) }));
    },
    async completeCheckout(operationId, submittedLines) {
      return mutateCart((current) => {
        if (current.completedCheckoutOperationIds.includes(operationId)) return current;
        const submitted = new Map<string, number>();
        for (const line of submittedLines) submitted.set(line.variantId, (submitted.get(line.variantId) ?? 0) + line.quantity);
        const nextItems = current.items.flatMap((item) => {
          const remaining = item.quantity - (submitted.get(item.variantId) ?? 0);
          return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
        });
        return {
          items: nextItems,
          completedCheckoutOperationIds: [...current.completedCheckoutOperationIds, operationId].slice(-50),
        };
      }, true);
    },
    async refreshLine(variantId, values) {
      await mutateCart((current) => ({
        ...current,
        items: current.items.map((item) => item.variantId === variantId ? { ...item, ...values } : item),
      }));
    },
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

async function withCartLock<T>(run: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(STORAGE_LOCK, run);
  return run();
}

function serializeCart(items: CartLine[], completedCheckoutOperationIds: string[]) {
  const payload: StoredCart = {
    version: STORAGE_VERSION,
    revision: createRevision(),
    items,
    completedCheckoutOperationIds,
  };
  return JSON.stringify(payload);
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is missing.");
  return context;
}

function parseStoredCart(raw: string): { items: CartLine[]; completedCheckoutOperationIds: string[]; legacy: boolean } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(value)) {
    const items = parseLines(value);
    return items ? { items, completedCheckoutOperationIds: [], legacy: true } : null;
  }
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== STORAGE_VERSION || typeof payload.revision !== "string" || !payload.revision) return null;
  const items = parseLines(payload.items);
  const completedCheckoutOperationIds = parseOperationIds(payload.completedCheckoutOperationIds);
  return items && completedCheckoutOperationIds ? { items, completedCheckoutOperationIds, legacy: false } : null;
}

function parseOperationIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) return null;
  return [...new Set(value)].slice(-50);
}

function parseLines(value: unknown): CartLine[] | null {
  if (!Array.isArray(value) || value.some((item) => !validLine(item))) return null;
  const unique = new Map<string, CartLine>();
  for (const item of value) {
    if (!validLine(item)) return null;
    const current = unique.get(item.variantId);
    unique.set(item.variantId, current ? {
      ...item,
      quantity: Math.min(current.quantity + item.quantity, Number.MAX_SAFE_INTEGER),
    } : item);
  }
  return [...unique.values()];
}

function createRevision(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function validLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.productId === "string"
    && typeof item.variantId === "string"
    && typeof item.productNameAr === "string"
    && typeof item.sizeNameAr === "string"
    && typeof item.colorNameAr === "string"
    && Number.isInteger(item.unitPricePiasters) && Number(item.unitPricePiasters) >= 0
    && (typeof item.imageRef === "string" || item.imageRef === null)
    && Number.isInteger(item.quantity) && Number(item.quantity) > 0
    && Number.isInteger(item.knownAvailableQuantity) && Number(item.knownAvailableQuantity) >= 0
    && typeof item.orderable === "boolean";
}
