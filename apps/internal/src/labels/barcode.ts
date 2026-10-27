import JsBarcode from "jsbarcode";

/** Existing saved product codes. Case is significant and must be encoded unchanged. */
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** CODE128 quiet zone. Ten modules each side; the encoder binary does not include them. */
export const QUIET_ZONE_MODULES = 10;

/** White margin inside the label edge, also added when measuring minimum width. */
export const PAGE_PADDING_MM = 2;

const BAR_MIN_MM = 10;
const CODE_FONT_MM = 3.2;
const NAME_FONT_MM = 3.6;
const LINE_HEIGHT = 1.35;
export const TEXT_GAP_MM = 1;
export const NAME_GAP_MM = 0.6;
/** Latin product codes are narrower than Arabic display names. */
const CODE_CHAR_EM = 0.62;
const NAME_CHAR_EM = 1.05;

export type LabelProduct = {
  id: string;
  code: string;
  nameAr: string;
};

export type ProductLabelSettings = {
  widthMm: number;
  heightMm: number;
  copies: number;
  dpi: 203 | 300;
};

export type EncodedProductBarcode = {
  value: string;
  modules: string;
  quietZoneModules: number;
};

export type LabelLayout = {
  product: LabelProduct;
  settings: ProductLabelSettings;
  barcode: EncodedProductBarcode;
  minimumWidthMm: number;
  minimumHeightMm: number;
  moduleWidthMm: number;
  barcodeWidthMm: number;
  barHeightMm: number;
  pagePaddingMm: number;
  codeFontMm: number;
  nameFontMm: number;
};

type LibraryEncoding = {
  data?: string;
  binary?: string;
  text?: string;
};

type LibraryBarcode = {
  encodings?: LibraryEncoding[];
};

export class LabelPrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelPrintError";
  }
}

function fail(message: string): never {
  throw new LabelPrintError(message);
}

/** Millimetres shown in Arabic validation errors. Ceil so the stated width is enough. */
export function formatLabelMm(mm: number): string {
  const ceiled = Math.ceil(mm * 10) / 10;
  return Number.isInteger(ceiled) ? String(ceiled) : ceiled.toFixed(1);
}

function moduleWidthMm(dpi: 203 | 300): number {
  return (2 * 25.4) / dpi;
}

function lineCount(text: string, fontMm: number, charEm: number, contentWidthMm: number): number {
  if (text.length === 0) return 0;
  const perLine = Math.max(1, Math.floor(contentWidthMm / (fontMm * charEm)));
  return Math.ceil(text.length / perLine);
}

function textStackMm(code: string, name: string, contentWidthMm: number): number {
  const codeLines = Math.max(1, lineCount(code, CODE_FONT_MM, CODE_CHAR_EM, contentWidthMm));
  const nameLines = lineCount(name, NAME_FONT_MM, NAME_CHAR_EM, contentWidthMm);
  const codeBlock = codeLines * CODE_FONT_MM * LINE_HEIGHT;
  const nameBlock = nameLines * NAME_FONT_MM * LINE_HEIGHT;
  const nameGap = nameLines > 0 ? NAME_GAP_MM : 0;
  return codeBlock + nameGap + nameBlock;
}

export function assertLabelSettings(settings: ProductLabelSettings): void {
  if (!settings || typeof settings !== "object") fail("إعدادات الملصق غير صالحة.");
  const { widthMm, heightMm, copies, dpi } = settings;
  if (!Number.isFinite(widthMm) || widthMm < 40 || widthMm > 160) fail("إعدادات الملصق غير صالحة.");
  if (!Number.isFinite(heightMm) || heightMm < 20 || heightMm > 100) fail("إعدادات الملصق غير صالحة.");
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) fail("إعدادات الملصق غير صالحة.");
  if (dpi !== 203 && dpi !== 300) fail("إعدادات الملصق غير صالحة.");
}

export function encodeProductBarcode(code: string): EncodedProductBarcode {
  if (typeof code !== "string" || !PRODUCT_CODE_PATTERN.test(code)) {
    fail("رمز المنتج غير صالح للملصق.");
  }

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
    fail("تعذر ترميز رمز المنتج كباركود.");
  }

  const row = target.encodings?.[0];
  const binary = typeof row?.binary === "string" ? row.binary : row?.data;
  if (!row || typeof binary !== "string" || !/^[01]+$/.test(binary)) {
    fail("تعذر ترميز رمز المنتج كباركود.");
  }
  if (typeof row.text === "string" && row.text !== code) {
    fail("تعذر ترميز رمز المنتج كباركود.");
  }

  return { value: code, modules: binary, quietZoneModules: QUIET_ZONE_MODULES };
}

/**
 * Validates settings and returns bar geometry.
 * Module width is two printer dots. Quiet zones stay ten modules and are never scaled away.
 */
export function planLabelLayout(product: LabelProduct, settings: ProductLabelSettings): LabelLayout {
  if (!product || typeof product.code !== "string" || typeof product.nameAr !== "string" || typeof product.id !== "string") {
    fail("بيانات المنتج غير صالحة للملصق.");
  }
  assertLabelSettings(settings);

  const barcode = encodeProductBarcode(product.code);
  const dotMm = moduleWidthMm(settings.dpi);
  const totalModules = barcode.modules.length + barcode.quietZoneModules * 2;
  const barcodeWidthMm = totalModules * dotMm;
  const rawMinimumWidth = barcodeWidthMm + PAGE_PADDING_MM * 2;
  const minimumWidthMm = Math.ceil(rawMinimumWidth * 10) / 10;
  if (settings.widthMm + 1e-9 < minimumWidthMm) {
    fail(`رمز المنتج يحتاج ملصقاً بعرض ${formatLabelMm(minimumWidthMm)} مم على الأقل`);
  }

  const contentWidthMm = settings.widthMm - PAGE_PADDING_MM * 2;
  const stack = textStackMm(product.code, product.nameAr, contentWidthMm);
  const rawMinimumHeight = PAGE_PADDING_MM * 2 + BAR_MIN_MM + TEXT_GAP_MM + stack;
  const minimumHeightMm = Math.ceil(rawMinimumHeight * 10) / 10;
  const barHeightMm = settings.heightMm - PAGE_PADDING_MM * 2 - TEXT_GAP_MM - stack;
  if (barHeightMm + 1e-9 < BAR_MIN_MM || settings.heightMm + 1e-9 < minimumHeightMm) {
    fail(`رمز المنتج يحتاج ملصقاً بارتفاع ${formatLabelMm(minimumHeightMm)} مم على الأقل`);
  }

  return {
    product,
    settings,
    barcode,
    minimumWidthMm,
    minimumHeightMm,
    moduleWidthMm: dotMm,
    barcodeWidthMm,
    barHeightMm,
    pagePaddingMm: PAGE_PADDING_MM,
    codeFontMm: CODE_FONT_MM,
    nameFontMm: NAME_FONT_MM,
  };
}
