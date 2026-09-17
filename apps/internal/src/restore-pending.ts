const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

export type PendingRestore = {
  staffId: string;
  operationId: string;
  previewId: string | null;
  previewFingerprint: string | null;
  activationOperationId: string | null;
};

function key(staffId: string) {
  return `bravos.restore.pending.${staffId}`;
}

export function restorePendingStorageKey(staffId: string) {
  return key(staffId);
}

export function readPendingRestore(staffId: string): PendingRestore | null {
  try {
    const raw = localStorage.getItem(key(staffId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingRestore>;
    if (
      value.staffId !== staffId
      || typeof value.operationId !== "string"
      || !UUID.test(value.operationId)
      || (value.previewId !== null && (typeof value.previewId !== "string" || !UUID.test(value.previewId)))
      || (value.previewFingerprint !== null
        && (typeof value.previewFingerprint !== "string" || !SHA256.test(value.previewFingerprint)))
      || (value.activationOperationId !== null
        && (typeof value.activationOperationId !== "string" || !UUID.test(value.activationOperationId)))
    ) return null;
    return {
      staffId,
      operationId: value.operationId,
      previewId: value.previewId ?? null,
      previewFingerprint: value.previewFingerprint?.toLowerCase() ?? null,
      activationOperationId: value.activationOperationId ?? null,
    };
  } catch {
    return null;
  }
}

export function beginRestoreAttempt(staffId: string): PendingRestore {
  const existing = readPendingRestore(staffId);
  if (existing) return existing;
  const pending: PendingRestore = {
    staffId,
    operationId: crypto.randomUUID(),
    previewId: null,
    previewFingerprint: null,
    activationOperationId: null,
  };
  write(pending);
  return pending;
}

export function attachRestorePreview(staffId: string, input: {
  operationId: string;
  previewId: string;
  previewFingerprint: string | null;
}): PendingRestore {
  const current = readPendingRestore(staffId);
  if (current && current.operationId !== input.operationId) return current;
  const pending: PendingRestore = {
    staffId,
    operationId: input.operationId,
    previewId: input.previewId,
    previewFingerprint: input.previewFingerprint,
    activationOperationId: current?.activationOperationId ?? null,
  };
  write(pending);
  return pending;
}

export function adoptActiveRestorePreview(staffId: string, input: {
  operationId: string;
  previewId: string;
  previewFingerprint: string | null;
}): PendingRestore {
  const current = readPendingRestore(staffId);
  const pending: PendingRestore = {
    staffId,
    operationId: input.operationId,
    previewId: input.previewId,
    previewFingerprint: input.previewFingerprint,
    activationOperationId:
      current?.previewId === input.previewId ? current.activationOperationId : null,
  };
  write(pending);
  return pending;
}

export function assignRestoreActivation(staffId: string, previewId: string, previewFingerprint: string): PendingRestore | null {
  const current = readPendingRestore(staffId);
  if (!current || current.previewId !== previewId) return null;
  const pending: PendingRestore = {
    ...current,
    previewFingerprint,
    activationOperationId: current.activationOperationId ?? crypto.randomUUID(),
  };
  write(pending);
  return pending;
}

export function clearPendingRestore(staffId: string, operationId?: string) {
  const current = readPendingRestore(staffId);
  if (current && (!operationId || current.operationId === operationId)) localStorage.removeItem(key(staffId));
}

export async function withRestoreLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) {
    return navigator.locks.request(`bravos.restore.lock.${staffId}`, { mode: "exclusive" }, work);
  }
  return work();
}

function write(pending: PendingRestore) {
  localStorage.setItem(key(pending.staffId), JSON.stringify(pending));
}
