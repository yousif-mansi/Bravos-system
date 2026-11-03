const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shown when a completed sale has no customer receipt number and no legacy POS reference. */
export const PENDING_RECEIPT_NUMBER = "في انتظار رقم الإيصال";

/** Staff-only note. The printed number stays; nothing is sold again. */
export const RECEIPT_NUMBER_CONFLICT = "تعارض في رقم الإيصال. الرقم المطبوع محفوظ.";

export function customerReceiptNumber(input: {
  receiptReference?: string | null;
  reference?: string | null;
  blockedIds?: Array<string | null | undefined>;
}): string {
  const blocked = new Set((input.blockedIds ?? []).filter((value): value is string => typeof value === "string" && value.length > 0));
  const receipt = usableNumber(input.receiptReference, blocked);
  if (receipt) return receipt;
  const legacy = usableNumber(input.reference, blocked);
  if (legacy) return legacy;
  return PENDING_RECEIPT_NUMBER;
}

/** Keep the open sale summary on its printed number after a matching acknowledgement. */
export function preservedSummaryReceipt<T extends {
  id: string;
  receiptReference?: string | null;
  receiptNumberingConflict?: true;
}>(
  current: T | null,
  saleId: string,
  synced: { receiptReference?: string | null; receiptNumberingConflict?: true },
): T | null {
  if (!current || current.id !== saleId) return current;
  const localReference = typeof current.receiptReference === "string" && current.receiptReference.length > 0
    ? current.receiptReference
    : null;
  const remoteReference = typeof synced.receiptReference === "string" && synced.receiptReference.length > 0
    ? synced.receiptReference
    : null;
  const receiptReference = localReference ?? remoteReference;
  const conflict = current.receiptNumberingConflict === true
    || synced.receiptNumberingConflict === true
    || (localReference !== null && remoteReference !== null && localReference !== remoteReference);
  return {
    ...current,
    ...(receiptReference ? { receiptReference } : {}),
    ...(conflict ? { receiptNumberingConflict: true as const } : {}),
  };
}

type ReceiptIdentity = {
  id: string;
  operationId: string;
  soldByStaffId: string;
  branch: { id: string };
  receiptReference?: string | null;
  receiptNumberingConflict?: true;
};

/** Overlay a matching local printed number onto an authorized remote sale. */
export function withPreservedLocalReceipt<T extends ReceiptIdentity>(
  remote: T,
  local: ReceiptIdentity | null | undefined,
  staffId: string,
): T {
  if (
    !local
    || local.id !== remote.id
    || local.operationId !== remote.operationId
    || local.soldByStaffId !== remote.soldByStaffId
    || local.soldByStaffId !== staffId
    || local.branch.id !== remote.branch.id
  ) {
    return remote;
  }
  const localReference = typeof local.receiptReference === "string" && local.receiptReference.length > 0
    ? local.receiptReference
    : null;
  const remoteReference = typeof remote.receiptReference === "string" && remote.receiptReference.length > 0
    ? remote.receiptReference
    : null;
  const receiptReference = localReference ?? remoteReference;
  const conflict = local.receiptNumberingConflict === true
    || remote.receiptNumberingConflict === true
    || (localReference !== null && remoteReference !== null && localReference !== remoteReference);
  return {
    ...remote,
    ...(receiptReference ? { receiptReference } : {}),
    ...(conflict ? { receiptNumberingConflict: true as const } : {}),
  };
}

function usableNumber(value: string | null | undefined, blocked: Set<string>): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || blocked.has(trimmed) || UUID.test(trimmed) || trimmed.startsWith("عملية محلية")) return null;
  return trimmed;
}
