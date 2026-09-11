export type PendingReceivePhase = "uncertain" | "rejected";

export type PendingReceive = {
  operationId: string;
  staffId: string;
  phase: PendingReceivePhase;
  digest: string | null;
};

export type ReceivePayloadLines = Array<{
  variantId: string;
  quantity: number;
  unitCostPiasters: number;
}>;

function storageKey(staffId: string): string {
  return `bravos.receiving.pending.${staffId}`;
}

export function loadPendingReceive(staffId: string): PendingReceive | null {
  try {
    const raw = localStorage.getItem(storageKey(staffId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingReceive;
    if (parsed.staffId !== staffId || typeof parsed.operationId !== "string") {
      return null;
    }
    if (parsed.phase !== "uncertain" && parsed.phase !== "rejected") {
      return null;
    }
    return {
      operationId: parsed.operationId,
      staffId: parsed.staffId,
      phase: parsed.phase,
      digest: typeof parsed.digest === "string" ? parsed.digest : null,
    };
  } catch {
    return null;
  }
}

export function savePendingReceive(pending: PendingReceive): void {
  localStorage.setItem(storageKey(pending.staffId), JSON.stringify(pending));
}

export function clearPendingReceive(staffId: string, expectedOperationId: string): void {
  const current = loadPendingReceive(staffId);
  if (!current || current.operationId !== expectedOperationId) {
    return;
  }
  localStorage.removeItem(storageKey(staffId));
}

export function pendingStorageKey(staffId: string): string {
  return storageKey(staffId);
}

export async function withPendingMarkerLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  const name = `bravos.receiving.lock.${staffId}`;
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(name, { mode: "exclusive" }, async () => work());
  }
  return work();
}

export type MarkerAssignment =
  | { kind: "assigned"; pending: PendingReceive }
  | { kind: "blocked"; pending: PendingReceive };

export function assignPendingReceive(input: {
  staffId: string;
  digest: string;
  localOperationId: string | null;
}): MarkerAssignment {
  const stored = loadPendingReceive(input.staffId);
  if (input.localOperationId) {
    if (stored?.operationId === input.localOperationId && stored.digest && stored.digest !== input.digest) {
      return { kind: "blocked", pending: stored };
    }
    const pending: PendingReceive = {
      operationId: input.localOperationId,
      staffId: input.staffId,
      phase: "uncertain",
      digest: input.digest,
    };
    if (!stored || stored.operationId === input.localOperationId) {
      savePendingReceive(pending);
    }
    return { kind: "assigned", pending };
  }
  if (stored?.phase === "uncertain") {
    if (stored.digest && stored.digest !== input.digest) {
      return { kind: "blocked", pending: stored };
    }
    const pending: PendingReceive = {
      ...stored,
      phase: "uncertain",
      digest: input.digest,
    };
    savePendingReceive(pending);
    return { kind: "assigned", pending };
  }
  if (stored?.phase === "rejected") {
    return { kind: "blocked", pending: stored };
  }
  const pending: PendingReceive = {
    operationId: crypto.randomUUID(),
    staffId: input.staffId,
    phase: "uncertain",
    digest: input.digest,
  };
  savePendingReceive(pending);
  return { kind: "assigned", pending };
}

export async function digestReceivePayload(input: {
  receiptDate: string;
  lines: ReceivePayloadLines;
}): Promise<string> {
  const lines = [...input.lines]
    .map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitCostPiasters: line.unitCostPiasters,
    }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      if (left.unitCostPiasters !== right.unitCostPiasters) {
        return left.unitCostPiasters - right.unitCostPiasters;
      }
      return left.quantity - right.quantity;
    });
  const canonical = JSON.stringify({ receiptDate: input.receiptDate, lines });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
