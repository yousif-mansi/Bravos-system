"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AddCartLine, CartLine } from "./cart-types";

const STORAGE_KEY = "bravos-guest-cart-v1";
const STORAGE_VERSION = 1;

type CartStorageStatus = "loading" | "ready" | "unavailable" | "corrupt";

type StoredCart = {
  version: typeof STORAGE_VERSION;
  revision: string;
  items: CartLine[];
};

type CartContextValue = {
  items: CartLine[];
  hydrated: boolean;
  storageStatus: CartStorageStatus;
  itemCount: number;
  add: (line: AddCartLine) => boolean;
  setQuantity: (variantId: string, quantity: number, maximum: number) => boolean;
  remove: (variantId: string) => void;
  refreshLine: (variantId: string, values: Partial<Omit<CartLine, "variantId" | "quantity">>) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageStatus, setStorageStatus] = useState<CartStorageStatus>("loading");
  const writesEnabled = useRef(false);
  const suppressNextWrite = useRef(false);
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
        suppressNextWrite.current = !parsed.legacy;
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
    if (!hydrated || !writesEnabled.current) return;
    if (suppressNextWrite.current) {
      suppressNextWrite.current = false;
      return;
    }
    try {
      const payload: StoredCart = {
        version: STORAGE_VERSION,
        revision: createRevision(),
        items,
      };
      const raw = JSON.stringify(payload);
      window.localStorage.setItem(STORAGE_KEY, raw);
      storedRaw.current = raw;
      setStorageStatus("ready");
    } catch {
      writesEnabled.current = false;
      setStorageStatus("unavailable");
    }
  }, [hydrated, items]);

  useEffect(() => {
    function reconcileStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || event.newValue === storedRaw.current) return;
      try {
        if (event.storageArea !== window.localStorage) return;
        if (window.localStorage.getItem(STORAGE_KEY) !== event.newValue) return;
        if (event.newValue === null) {
          storedRaw.current = null;
          writesEnabled.current = true;
          suppressNextWrite.current = true;
          setItems([]);
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
        suppressNextWrite.current = true;
        setItems(parsed.items);
        setStorageStatus("ready");
      } catch {
        writesEnabled.current = false;
        setStorageStatus("unavailable");
      }
    }

    window.addEventListener("storage", reconcileStorage);
    return () => window.removeEventListener("storage", reconcileStorage);
  }, []);

  const value = useMemo<CartContextValue>(() => ({
    items,
    hydrated,
    storageStatus,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    add(line) {
      const quantity = line.quantity ?? 1;
      const existing = items.find((item) => item.variantId === line.variantId);
      if (!line.orderable || !Number.isInteger(quantity) || quantity < 1 || quantity + (existing?.quantity ?? 0) > line.knownAvailableQuantity) {
        return false;
      }
      setItems((current) => {
        const match = current.find((item) => item.variantId === line.variantId);
        if (!match) return [...current, { ...line, quantity }];
        if (match.quantity + quantity > line.knownAvailableQuantity) return current;
        return current.map((item) => item.variantId === line.variantId
          ? { ...item, ...line, quantity: item.quantity + quantity }
          : item);
      });
      return true;
    },
    setQuantity(variantId, quantity, maximum) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) return false;
      setItems((current) => current.map((item) => item.variantId === variantId ? { ...item, quantity } : item));
      return true;
    },
    remove(variantId) {
      setItems((current) => current.filter((item) => item.variantId !== variantId));
    },
    refreshLine(variantId, values) {
      setItems((current) => current.map((item) => item.variantId === variantId ? { ...item, ...values } : item));
    },
  }), [hydrated, items, storageStatus]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is missing.");
  return context;
}

function parseStoredCart(raw: string): { items: CartLine[]; legacy: boolean } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(value)) {
    const items = parseLines(value);
    return items ? { items, legacy: true } : null;
  }
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.version !== STORAGE_VERSION || typeof payload.revision !== "string" || !payload.revision) return null;
  const items = parseLines(payload.items);
  return items ? { items, legacy: false } : null;
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
