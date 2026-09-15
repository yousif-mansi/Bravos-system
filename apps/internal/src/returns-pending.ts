import {
  assignPendingOperation,
  clearPendingOperation,
  pendingOperationKey,
  readPendingOperation,
  withPendingOperationLock,
} from "./pending-operation.ts";

const NAMESPACE = "returns";

export type PendingReturnAttempt =
  | {
      staffId: string;
      action: "create";
      operationId: string;
      payload: {
        returnId: string;
        operationId: string;
        source: { kind: "physical_sale" | "delivered_online_order"; id: string };
        handlingBranchId: string;
        authorizedRefund: { merchandisePiasters: number; checkoutChargePiasters: number };
        lines: Array<{ sourceLineId: string; quantity: number; sellableQuantity: number }>;
      };
    }
  | {
      staffId: string;
      action: "post";
      operationId: string;
      payload: { returnId: string; expectedRevision: number };
    }
  | {
      staffId: string;
      action: "refund";
      operationId: string;
      payload: { returnId: string; amountPiasters: number; operationId: string };
    }
  | {
      staffId: string;
      action: "exchange";
      operationId: string;
      payload: {
        returnId: string;
        input: {
          exchangeId: string;
          operationId: string;
          replacementSaleId: string;
          replacementSaleOperationId: string;
          receivedAndInspected: true;
          expectedRevision: number;
          cashRefundStatus: "owed" | "paid";
          quoteId: string;
        };
      };
    };

export function pendingReturnStorageKey(staffId: string) {
  return pendingOperationKey(NAMESPACE, staffId);
}

export function readPendingReturnAttempt(staffId: string): PendingReturnAttempt | null {
  return readPendingOperation(NAMESPACE, staffId, isPendingReturnAttempt);
}

export function assignPendingReturnAttempt(candidate: PendingReturnAttempt) {
  return assignPendingOperation({ namespace: NAMESPACE, candidate, read: readPendingReturnAttempt });
}

export function clearPendingReturnAttempt(staffId: string, operationId: string) {
  clearPendingOperation({ namespace: NAMESPACE, staffId, operationId, read: readPendingReturnAttempt });
}

export async function withPendingReturnLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  return withPendingOperationLock(NAMESPACE, staffId, work);
}

function isPendingReturnAttempt(value: unknown): value is PendingReturnAttempt {
  if (!value || typeof value !== "object") return false;
  const parsed = value as Partial<PendingReturnAttempt>;
  if (typeof parsed.staffId !== "string" || typeof parsed.operationId !== "string") return false;
  if (parsed.action !== "create" && parsed.action !== "post" && parsed.action !== "refund" && parsed.action !== "exchange") return false;
  return Boolean(parsed.payload && typeof parsed.payload === "object");
}
