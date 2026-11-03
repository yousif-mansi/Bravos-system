const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC = "۰۱۲۳۴۵۶۷۸۹";

/** Digits for a partial search. This is not an identity and does not accept or merge a customer. */
export function customerSearchDigits(value: string): string {
  return foldCustomerDigits(value);
}

/** Exact digit identity for a customer. Returns null when the phone cannot be a saved identity. */
export function normalizeCustomerPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = foldCustomerDigits(value);
  if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

function foldCustomerDigits(value: string): string {
  let digits = "";
  for (const char of value) {
    const arabic = ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) {
      digits += String(arabic);
      continue;
    }
    const eastern = EASTERN_ARABIC.indexOf(char);
    if (eastern >= 0) {
      digits += String(eastern);
      continue;
    }
    if (char >= "0" && char <= "9") digits += char;
  }
  return digits;
}
