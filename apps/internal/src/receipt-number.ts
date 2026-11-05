const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shown when a completed sale has no customer receipt number and no legacy POS reference. */
export const PENDING_RECEIPT_NUMBER = "في انتظار رقم الإيصال";

/** Staff-only note. The printed number stays; nothing is sold again. */
export const RECEIPT_NUMBER_CONFLICT = "تعارض في رقم الإيصال. الرقم المطبوع محفوظ.";

const OFFICIAL_POS_REFERENCE = /^POS-[0-9]+$/;

type ReceiptNumberInput = {
  receiptReference?: string | null;
  reference?: string | null;
  blockedIds?: Array<string | null | undefined>;
};

export function customerReceiptNumber(input: ReceiptNumberInput): string {
  const blocked = new Set((input.blockedIds ?? []).filter((value): value is string => typeof value === "string" && value.length > 0));
  const receipt = usableNumber(input.receiptReference, blocked);
  if (receipt) return receipt;
  const legacy = usableNumber(input.reference, blocked);
  if (legacy) return legacy;
  return PENDING_RECEIPT_NUMBER;
}

export function acknowledgedPosReference(value: string | null | undefined): string | null {
  return typeof value === "string" && OFFICIAL_POS_REFERENCE.test(value) ? value : null;
}

export function officialSaleNumber(input: ReceiptNumberInput): string {
  const official = acknowledgedPosReference(input.reference);
  return official && !input.blockedIds?.includes(official) ? official : customerReceiptNumber(input);
}

/** Keep the open sale summary on its printed number after a matching acknowledgement. */
export function preservedSummaryReceipt<T extends {
  id: string;
  reference?: string | null;
  receiptReference?: string | null;
  receiptNumberingConflict?: true;
}>(
  current: T | null,
  saleId: string,
  synced: { reference?: string | null; receiptReference?: string | null; receiptNumberingConflict?: true },
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
    ...(synced.reference ? { reference: synced.reference } : {}),
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

type NumberedSale = ReceiptIdentity & { reference?: string | null };

function receiptSelectionKey(sale: ReceiptIdentity): string {
  return `bravos.receipt-number:${sale.soldByStaffId}:${sale.branch.id}:${sale.id}:${sale.operationId}`;
}

/** Save the first connected print choice before handing it to the till's printer. */
export function rememberAcknowledgedReceiptNumber(sale: NumberedSale): boolean {
  const reference = acknowledgedPosReference(sale.reference);
  if (!reference) return false;
  try {
    const key = receiptSelectionKey(sale);
    const previous = localStorage.getItem(key);
    if (previous !== null) return previous === reference;
    localStorage.setItem(key, reference);
    return true;
  } catch {
    return false;
  }
}

/** Apply this till's choice without replacing the registered offline lookup alias. */
export function withSelectedReceiptNumber<T extends NumberedSale>(sale: T): T {
  try {
    const selected = acknowledgedPosReference(localStorage.getItem(receiptSelectionKey(sale)));
    const official = acknowledgedPosReference(sale.reference);
    if (selected && (!official || selected === official)) return { ...sale, receiptReference: selected };
  } catch {
    // The durable sale still contains its receipt alias.
  }
  return sale;
}

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
