import type { SaleCorrectionWrite } from "./api.ts";
import type { ReturnCorrectionWrite } from "./returns-api.ts";
import {
  assignPendingOperation,
  clearPendingOperation,
  pendingOperationKey,
  readPendingOperation,
  withPendingOperationLock,
} from "./pending-operation.ts";

const NAMESPACE = "corrections";

export type CorrectionAttempt =
  | { staffId: string; target: "sale"; recordId: string; operationId: string; input: SaleCorrectionWrite }
  | { staffId: string; target: "return"; recordId: string; operationId: string; input: ReturnCorrectionWrite };

export function correctionAttemptKey(staffId: string) {
  return pendingOperationKey(NAMESPACE, staffId);
}

export function readCorrectionAttempt(staffId: string) {
  return readPendingOperation(NAMESPACE, staffId, isCorrectionAttempt);
}

export function assignCorrectionAttempt(candidate: CorrectionAttempt) {
  return assignPendingOperation({ namespace: NAMESPACE, candidate, read: readCorrectionAttempt });
}

export function clearCorrectionAttempt(staffId: string, operationId: string) {
  clearPendingOperation({ namespace: NAMESPACE, staffId, operationId, read: readCorrectionAttempt });
}

export function withCorrectionAttemptLock<T>(staffId: string, work: () => T | Promise<T>) {
  return withPendingOperationLock(NAMESPACE, staffId, work);
}

function isCorrectionAttempt(value: unknown): value is CorrectionAttempt {
  if (!value || typeof value !== "object") return false;
  const parsed = value as Partial<CorrectionAttempt>;
  return typeof parsed.staffId === "string"
    && (parsed.target === "sale" || parsed.target === "return")
    && typeof parsed.recordId === "string"
    && typeof parsed.operationId === "string"
    && Boolean(parsed.input && typeof parsed.input === "object");
}
