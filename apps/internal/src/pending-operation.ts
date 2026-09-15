export function pendingOperationKey(namespace: string, staffId: string) {
  return `bravos.${namespace}.pending.${staffId}`;
}

export function readPendingOperation<T extends { staffId: string; operationId: string }>(
  namespace: string,
  staffId: string,
  isValid: (value: unknown) => value is T,
): T | null {
  try {
    const raw = localStorage.getItem(pendingOperationKey(namespace, staffId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) && parsed.staffId === staffId ? parsed : null;
  } catch {
    return null;
  }
}

export function assignPendingOperation<T extends { staffId: string; operationId: string }>(input: {
  namespace: string;
  candidate: T;
  read: (staffId: string) => T | null;
}) {
  const current = input.read(input.candidate.staffId);
  if (current) {
    const sameIdentity = current.operationId === input.candidate.operationId;
    const samePayload = JSON.stringify(current) === JSON.stringify(input.candidate);
    if (!sameIdentity || !samePayload) return { kind: "blocked" as const, attempt: current };
    return { kind: "assigned" as const, attempt: current };
  }
  localStorage.setItem(
    pendingOperationKey(input.namespace, input.candidate.staffId),
    JSON.stringify(input.candidate),
  );
  return { kind: "assigned" as const, attempt: input.candidate };
}

export function clearPendingOperation<T extends { staffId: string; operationId: string }>(input: {
  namespace: string;
  staffId: string;
  operationId: string;
  read: (staffId: string) => T | null;
}) {
  const current = input.read(input.staffId);
  if (current?.operationId === input.operationId) {
    localStorage.removeItem(pendingOperationKey(input.namespace, input.staffId));
  }
}

export async function withPendingOperationLock<T>(namespace: string, staffId: string, work: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) {
    return navigator.locks.request(`bravos.${namespace}.lock.${staffId}`, { mode: "exclusive" }, work);
  }
  return work();
}
