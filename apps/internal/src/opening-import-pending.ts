import type { OpeningImportPreviewDto } from "@bravos/contracts";

export type PendingOpeningImport = {
  staffId: string;
  operationId: string;
  previewId: string;
  previewFingerprint: string;
};

function storageKey(staffId: string): string {
  return `bravos.opening-import.pending.${staffId}`;
}

export function loadPendingOpeningImport(staffId: string): PendingOpeningImport | null {
  try {
    const raw = localStorage.getItem(storageKey(staffId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingOpeningImport>;
    if (
      parsed.staffId !== staffId
      || typeof parsed.operationId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.operationId)
      || typeof parsed.previewId !== "string"
      || parsed.previewId.length === 0
      || typeof parsed.previewFingerprint !== "string"
      || !/^[0-9a-f]{64}$/i.test(parsed.previewFingerprint)
    ) {
      return null;
    }
    return {
      staffId,
      operationId: parsed.operationId,
      previewId: parsed.previewId,
      previewFingerprint: parsed.previewFingerprint.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function assignPendingOpeningImport(
  staffId: string,
  preview: OpeningImportPreviewDto,
): { kind: "assigned" | "blocked"; pending: PendingOpeningImport } {
  const stored = loadPendingOpeningImport(staffId);
  if (stored) {
    const samePreview = stored.previewId === preview.id
      && stored.operationId === preview.operationId
      && stored.previewFingerprint === preview.previewFingerprint;
    return { kind: samePreview ? "assigned" : "blocked", pending: stored };
  }
  const pending: PendingOpeningImport = {
    staffId,
    operationId: preview.operationId,
    previewId: preview.id,
    previewFingerprint: preview.previewFingerprint,
  };
  localStorage.setItem(storageKey(staffId), JSON.stringify(pending));
  return { kind: "assigned", pending };
}

export function clearPendingOpeningImport(staffId: string, expected: PendingOpeningImport): void {
  const current = loadPendingOpeningImport(staffId);
  if (
    current?.operationId === expected.operationId
    && current.previewId === expected.previewId
    && current.previewFingerprint === expected.previewFingerprint
  ) {
    localStorage.removeItem(storageKey(staffId));
  }
}

export function pendingOpeningImportStorageKey(staffId: string): string {
  return storageKey(staffId);
}

export async function withOpeningImportLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      `bravos.opening-import.lock.${staffId}`,
      { mode: "exclusive" },
      work,
    );
  }
  return work();
}
