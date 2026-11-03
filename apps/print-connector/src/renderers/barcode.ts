import JsBarcode from "jsbarcode";

const PRODUCT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

type LibraryEncoding = {
  data?: string;
  binary?: string;
  text?: string;
};

type LibraryBarcode = {
  encodings?: LibraryEncoding[];
};

export type EncodedCode =
  | { ok: true; code: string; modules: string }
  | { ok: false; code: "invalid_job" };

/**
 * CODE128 from the stored product code. Case is kept. Quiet zones are not part
 * of the module string; the drawer adds ten modules on each side.
 */
export function encodeProductCode(code: string): EncodedCode {
  if (!PRODUCT_CODE.test(code)) return { ok: false, code: "invalid_job" };
  const target: LibraryBarcode = {};
  try {
    JsBarcode(target, code, {
      format: "CODE128",
      displayValue: false,
      margin: 0,
      marginLeft: 0,
      marginRight: 0,
      ean128: false,
    });
  } catch {
    return { ok: false, code: "invalid_job" };
  }
  const row = target.encodings?.[0];
  const binary = typeof row?.binary === "string" ? row.binary : row?.data;
  if (!row || typeof binary !== "string" || !/^[01]+$/.test(binary)) {
    return { ok: false, code: "invalid_job" };
  }
  if (typeof row.text === "string" && row.text !== code) {
    return { ok: false, code: "invalid_job" };
  }
  if (binary.length < 35 || binary.length > 520 || (binary.length - 35) % 11 !== 0) {
    return { ok: false, code: "invalid_job" };
  }
  return { ok: true, code, modules: binary };
}
