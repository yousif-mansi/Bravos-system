import { SalesValidationError } from "./errors.ts";

/** Customer receipt text: BRV, till prefix padded to at least 3, sequence padded to at least 6. */
const RECEIPT_REFERENCE = /^BRV-(\d{3,})-(\d{6,})$/;
const DECIMAL = /^[1-9][0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_CLAIMED_REFERENCE_LENGTH = 80;

export type ReceiptNumberingStatus = "assigned" | "conflict";

/** Stored receipt identity. Assigned rows always carry a canonical reference. Conflict may keep the printed claim. */
export type ReceiptIdentity = {
  registrationId: string | null;
  deviceId: string | null;
  prefix: string | null;
  sequence: string | null;
  reference: string | null;
  status: ReceiptNumberingStatus;
  /** Staff diagnostic. An assigned identity stays reserved when a later claim disagrees. */
  numberingConflict?: boolean;
};

export type ReceiptClaim = {
  registrationId: string;
  deviceId: string;
  prefix: string;
  sequence: string;
  reference: string;
};

export type ParsedReceiptClaim =
  | { kind: "absent" }
  | { kind: "malformed"; claimedReference: string | null }
  | { kind: "valid"; claim: ReceiptClaim };

export function formatReceiptReference(prefix: string, sequence: string): string {
  if (!DECIMAL.test(prefix) || !DECIMAL.test(sequence)) {
    throw new SalesValidationError("رقم الإيصال غير صالح.");
  }
  return `BRV-${prefix.padStart(3, "0")}-${sequence.padStart(6, "0")}`;
}

/** Unpads a canonical receipt reference. Leading zeros and a zero value are rejected. */
export function parseReceiptReference(reference: string): { prefix: string; sequence: string } | null {
  const match = RECEIPT_REFERENCE.exec(reference);
  const prefix = match?.[1] ? unpadDecimal(match[1]) : null;
  const sequence = match?.[2] ? unpadDecimal(match[2]) : null;
  if (!prefix || !sequence) return null;
  if (formatReceiptReference(prefix, sequence) !== reference) return null;
  return { prefix, sequence };
}

/** Next per-registration sequence. Decimal strings avoid unsafe JavaScript integers. There is no sale cap. */
export function nextReceiptSequence(sequence: string): string {
  if (!DECIMAL.test(sequence)) {
    throw new SalesValidationError("رقم الإيصال غير صالح.");
  }
  return (BigInt(sequence) + 1n).toString();
}

/**
 * Optional sync metadata. Missing means no claim. A present claim is valid only when its
 * reference is exactly the formatted prefix and sequence. This does not decide attachment.
 */
export function parseReceiptClaim(value: unknown): ParsedReceiptClaim {
  if (value === undefined) return { kind: "absent" };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "malformed", claimedReference: null };
  }
  const record = value as Record<string, unknown>;
  const claimedReference = claimedReferenceText(record.reference);
  const registrationId = canonicalReceiptUuid(record.registrationId);
  const deviceId = canonicalReceiptUuid(record.deviceId);
  const prefix = typeof record.prefix === "string" ? record.prefix : "";
  const sequence = typeof record.sequence === "string" ? record.sequence : "";
  const reference = typeof record.reference === "string" ? record.reference : "";
  if (!registrationId || !deviceId || !DECIMAL.test(prefix) || !DECIMAL.test(sequence)) {
    return { kind: "malformed", claimedReference };
  }
  let formatted: string;
  try {
    formatted = formatReceiptReference(prefix, sequence);
  } catch {
    return { kind: "malformed", claimedReference };
  }
  if (reference !== formatted) return { kind: "malformed", claimedReference };
  return {
    kind: "valid",
    claim: { registrationId, deviceId, prefix, sequence, reference },
  };
}

function unpadDecimal(value: string): string | null {
  const stripped = value.replace(/^0+/, "");
  return DECIMAL.test(stripped) ? stripped : null;
}

function claimedReferenceText(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CLAIMED_REFERENCE_LENGTH) return null;
  if (CONTROL_CHARS.test(value)) return null;
  return value;
}

/** Canonical receipt text is uncapped. Arbitrary conflict text keeps the 80-character sanitization. */
function storedConflictReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARS.test(value)) return null;
  if (parseReceiptReference(value)) return value;
  return claimedReferenceText(value);
}

/** Registration and device ids compare in PostgreSQL's canonical lowercase form. */
export function canonicalReceiptUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

export function assignedReceiptDocument(claim: ReceiptClaim): {
  status: "assigned";
  registrationId: string;
  deviceId: string;
  prefix: string;
  sequence: string;
  reference: string;
} {
  return {
    status: "assigned",
    registrationId: claim.registrationId,
    deviceId: claim.deviceId,
    prefix: claim.prefix,
    sequence: claim.sequence,
    reference: claim.reference,
  };
}

export function conflictReceiptDocument(reference: string | null): {
  status: "conflict";
  reference: string | null;
} {
  return { status: "conflict", reference };
}

export function sameAssignedReceiptClaim(identity: ReceiptIdentity, claim: ReceiptClaim): boolean {
  return identity.status === "assigned"
    && identity.registrationId === claim.registrationId
    && identity.deviceId === claim.deviceId
    && identity.prefix === claim.prefix
    && identity.sequence === claim.sequence
    && identity.reference === claim.reference;
}

/**
 * Reads a stored receipt identity. SQL NULL means no identity.
 * An unexpected object becomes a conflict with a sanitized reference and does not throw.
 */
export function readStoredReceiptIdentity(value: unknown): ReceiptIdentity | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return conflictIdentity(claimedReferenceText(value));
  }
  const record = value as Record<string, unknown>;
  const reference = storedConflictReference(record.reference);
  const numberingConflict = record.numberingConflict === true;
  if (record.status === "conflict") return conflictIdentity(reference, numberingConflict);
  if (record.status === "assigned") {
    const registrationId = canonicalReceiptUuid(record.registrationId);
    const deviceId = canonicalReceiptUuid(record.deviceId);
    const prefix = typeof record.prefix === "string" ? record.prefix : "";
    const sequence = typeof record.sequence === "string" ? record.sequence : "";
    const printed = typeof record.reference === "string" ? record.reference : "";
    if (registrationId && deviceId && DECIMAL.test(prefix) && DECIMAL.test(sequence)) {
      try {
        const formatted = formatReceiptReference(prefix, sequence);
        if (printed === formatted) {
          return {
            status: "assigned",
            registrationId,
            deviceId,
            prefix,
            sequence,
            reference: formatted,
            ...(numberingConflict ? { numberingConflict: true } : {}),
          };
        }
      } catch {
        return conflictIdentity(reference, numberingConflict);
      }
    }
  }
  return conflictIdentity(reference, numberingConflict);
}

function conflictIdentity(reference: string | null, numberingConflict = false): ReceiptIdentity {
  return {
    status: "conflict",
    reference,
    registrationId: null,
    deviceId: null,
    prefix: null,
    sequence: null,
    ...(numberingConflict ? { numberingConflict: true } : {}),
  };
}
