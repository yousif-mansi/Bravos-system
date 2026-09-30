export type PendingSalePhase = "prepared" | "uncertain" | "rejected";

export type SalePayloadLines = Array<{ variantId: string; quantity: number }>;

export type SalePayload = {
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  payment?: { method: "cash" | "online" | "split"; cashPiasters: number; onlinePiasters: number };
  lines: SalePayloadLines;
};

export type PendingSale = {
  saleId: string;
  operationId: string;
  staffId: string;
  phase: PendingSalePhase;
  digest: string | null;
  physicallyCompleted: boolean;
  payload: SalePayload | null;
  occurredAt: string | null;
  pricingOccurredAt?: string | null;
};

function storageKey(staffId: string): string {
  return `bravos.sales.pending.${staffId}`;
}

export function loadPendingSale(staffId: string): PendingSale | null {
  try {
    const raw = localStorage.getItem(storageKey(staffId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingSale;
    if (parsed.staffId !== staffId || typeof parsed.saleId !== "string" || typeof parsed.operationId !== "string") {
      return null;
    }
    if (parsed.phase !== "prepared" && parsed.phase !== "uncertain" && parsed.phase !== "rejected") {
      return null;
    }
    return {
      saleId: parsed.saleId,
      operationId: parsed.operationId,
      staffId: parsed.staffId,
      phase: parsed.phase,
      digest: typeof parsed.digest === "string" ? parsed.digest : null,
      physicallyCompleted: parsed.physicallyCompleted === true,
      payload: isPayload(parsed.payload) ? parsed.payload : null,
      occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : null,
      pricingOccurredAt: typeof parsed.pricingOccurredAt === "string" ? parsed.pricingOccurredAt : null,
    };
  } catch {
    return null;
  }
}

function isPayload(value: unknown): value is SalePayload {
  if (!value || typeof value !== "object" || !("lines" in value) || !Array.isArray((value as SalePayload).lines)) {
    return false;
  }
  const payload = value as SalePayload;
  return typeof payload.employeeDiscountPiasters === "number";
}

export function savePendingSale(pending: PendingSale): void {
  localStorage.setItem(storageKey(pending.staffId), JSON.stringify(pending));
}

export function clearPendingSale(staffId: string, expectedSaleId: string): void {
  const current = loadPendingSale(staffId);
  if (!current || current.saleId !== expectedSaleId) {
    return;
  }
  localStorage.removeItem(storageKey(staffId));
}

export function pendingSaleStorageKey(staffId: string): string {
  return storageKey(staffId);
}

export async function withPendingSaleLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  const name = `bravos.sales.lock.${staffId}`;
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(name, { mode: "exclusive" }, async () => work());
  }
  return work();
}

export type SaleMarkerAssignment =
  | { kind: "assigned"; pending: PendingSale }
  | { kind: "blocked"; pending: PendingSale };

export function createPendingSale(input: {
  staffId: string;
  physicallyCompleted: boolean;
  payload: SalePayload | null;
  occurredAt: string | null;
  pricingOccurredAt?: string | null;
}): PendingSale {
  return {
    saleId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    staffId: input.staffId,
    phase: "uncertain",
    digest: null,
    physicallyCompleted: input.physicallyCompleted,
    payload: input.payload,
    occurredAt: input.occurredAt,
    pricingOccurredAt: input.pricingOccurredAt ?? null,
  };
}

export function assignPendingSale(input: {
  staffId: string;
  digest: string;
  localSaleId: string;
  localOperationId: string;
  physicallyCompleted: boolean;
  payload: SalePayload;
  occurredAt: string | null;
  pricingOccurredAt?: string | null;
}): SaleMarkerAssignment {
  const stored = loadPendingSale(input.staffId);
  if (stored && stored.saleId !== input.localSaleId && (stored.physicallyCompleted || stored.phase === "uncertain")) {
    return { kind: "blocked", pending: stored };
  }
  const pending: PendingSale = {
    saleId: input.localSaleId,
    operationId: input.localOperationId,
    staffId: input.staffId,
    phase: "uncertain",
    digest: input.digest,
    physicallyCompleted: input.physicallyCompleted || stored?.physicallyCompleted === true,
    payload: input.payload,
    occurredAt: input.occurredAt ?? stored?.occurredAt ?? null,
    pricingOccurredAt: input.pricingOccurredAt ?? stored?.pricingOccurredAt ?? null,
  };
  savePendingSale(pending);
  return { kind: "assigned", pending };
}

export async function digestSalePayload(input: SalePayload): Promise<string> {
  const lines = [...input.lines]
    .map((line) => ({ variantId: line.variantId, quantity: line.quantity }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      return left.quantity - right.quantity;
    });
  const couponCode = input.couponCode?.normalize("NFC").trim().toLocaleUpperCase("en-US") || null;
  const canonical = JSON.stringify({
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    ...(couponCode ? { couponCode } : {}),
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    ...(input.payment ? { payment: input.payment } : {}),
    lines,
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
