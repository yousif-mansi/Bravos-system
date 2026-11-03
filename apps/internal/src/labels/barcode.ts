import JsBarcode from "jsbarcode";

/** Existing saved product codes. Case is significant and must be encoded unchanged. */
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** CODE128 quiet zone. Ten modules each side; the encoder binary does not include them. */
export const QUIET_ZONE_MODULES = 10;

/** White margin inside the label edge, also added when measuring minimum width. */
export const PAGE_PADDING_MM = 2;

/** Generic adhesive stock. Unchanged for saved custom sizes. */
export const GENERIC_MIN_LABEL_WIDTH_MM = 40;
/** Actual XP-236B adhesive. The generic floor stays 40. */
export const COMPACT_MIN_LABEL_WIDTH_MM = 38;
export const GENERIC_LABEL_PROFILE = "generic" as const;
/** Xprinter XP-236B, 203 dpi, adhesive 38×25 mm. */
export const XP236B_38X25_PROFILE = "xp236b-38x25" as const;
export const XP236B_38X25_WIDTH_MM = 38;
export const XP236B_38X25_HEIGHT_MM = 25;
export const XP236B_38X25_DPI = 203 as const;

const BAR_MIN_MM = 10;
const GENERIC_CODE_FONT_MM = 3.2;
const GENERIC_NAME_FONT_MM = 3.6;
const GENERIC_LINE_HEIGHT = 1.35;
/** Larger than the 13-dot / 12-dot diagnostic proof, still inside 25 mm. */
const COMPACT_CODE_FONT_MM = 2.8;
const COMPACT_NAME_FONT_MM = 2;
const COMPACT_LINE_HEIGHT = 1.2;
export const TEXT_GAP_MM = 1;
export const NAME_GAP_MM = 0.6;
/** Latin product codes are narrower than Arabic display names. */
const CODE_CHAR_EM = 0.62;
const NAME_CHAR_EM = 1.05;
/** Compact acceptance only. The loaded font, not this estimate, is the fit check. */
const COMPACT_NAME_CHAR_EM = 0.5;

export type LabelProfileId = typeof GENERIC_LABEL_PROFILE | typeof XP236B_38X25_PROFILE;

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
  /** Omitted settings stay on the generic two-dot profile. */
  profile?: LabelProfileId;
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
  lineHeight: number;
  /** Native printer dots per module. Generic is always 2. Compact is 1 or 2. */
  moduleDots: 1 | 2;
  profile: LabelProfileId;
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

function dotsToMm(dots: number, dpi: 203 | 300): number {
  return (dots * 25.4) / dpi;
}

type TypeSpec = {
  codeFontMm: number;
  nameFontMm: number;
  lineHeight: number;
  codeCharEm: number;
  nameCharEm: number;
};

function typeSpec(profile: LabelProfileId): TypeSpec {
  if (profile === XP236B_38X25_PROFILE) {
    return {
      codeFontMm: COMPACT_CODE_FONT_MM,
      nameFontMm: COMPACT_NAME_FONT_MM,
      lineHeight: COMPACT_LINE_HEIGHT,
      codeCharEm: CODE_CHAR_EM,
      nameCharEm: COMPACT_NAME_CHAR_EM,
    };
  }
  return {
    codeFontMm: GENERIC_CODE_FONT_MM,
    nameFontMm: GENERIC_NAME_FONT_MM,
    lineHeight: GENERIC_LINE_HEIGHT,
    codeCharEm: CODE_CHAR_EM,
    nameCharEm: NAME_CHAR_EM,
  };
}

function lineCount(text: string, fontMm: number, charEm: number, contentWidthMm: number): number {
  if (text.length === 0) return 0;
  const perLine = Math.max(1, Math.floor(contentWidthMm / (fontMm * charEm)));
  return Math.ceil(text.length / perLine);
}

function textStackMm(code: string, name: string, contentWidthMm: number, type: TypeSpec): number {
  const codeLines = Math.max(1, lineCount(code, type.codeFontMm, type.codeCharEm, contentWidthMm));
  const nameLines = lineCount(name, type.nameFontMm, type.nameCharEm, contentWidthMm);
  const codeBlock = codeLines * type.codeFontMm * type.lineHeight;
  const nameBlock = nameLines * type.nameFontMm * type.lineHeight;
  const nameGap = nameLines > 0 ? NAME_GAP_MM : 0;
  return codeBlock + nameGap + nameBlock;
}

export function resolveLabelProfile(settings: ProductLabelSettings): LabelProfileId {
  if (!settings || typeof settings !== "object") fail("إعدادات الملصق غير صالحة.");
  if (settings.profile === undefined || settings.profile === GENERIC_LABEL_PROFILE) return GENERIC_LABEL_PROFILE;
  if (settings.profile === XP236B_38X25_PROFILE) return XP236B_38X25_PROFILE;
  fail("إعدادات الملصق غير صالحة.");
}

export function assertLabelSettings(settings: ProductLabelSettings): void {
  const profile = resolveLabelProfile(settings);
  const { widthMm, heightMm, copies, dpi } = settings;
  const minWidth = profile === XP236B_38X25_PROFILE ? COMPACT_MIN_LABEL_WIDTH_MM : GENERIC_MIN_LABEL_WIDTH_MM;
  if (!Number.isFinite(widthMm) || widthMm < minWidth || widthMm > 160) fail("إعدادات الملصق غير صالحة.");
  if (!Number.isFinite(heightMm) || heightMm < 20 || heightMm > 100) fail("إعدادات الملصق غير صالحة.");
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) fail("إعدادات الملصق غير صالحة.");
  if (dpi !== 203 && dpi !== 300) fail("إعدادات الملصق غير صالحة.");
  if (profile === XP236B_38X25_PROFILE && dpi !== XP236B_38X25_DPI) fail("إعدادات الملصق غير صالحة.");
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

function minimumWidthMmFor(totalModules: number, dots: 1 | 2, dpi: 203 | 300): number {
  const raw = totalModules * dotsToMm(dots, dpi) + PAGE_PADDING_MM * 2;
  return Math.ceil(raw * 10) / 10;
}

/**
 * Generic labels stay on two printer dots, including 300 dpi.
 * XP-236B may use two dots only when that integer width fits the 38 mm stock.
 * One dot is the other native width. Modules are never a fraction and are not scaled to the label.
 */
function moduleDotsFor(profile: LabelProfileId, dpi: 203 | 300, totalModules: number, widthMm: number): 1 | 2 {
  if (profile !== XP236B_38X25_PROFILE) return 2;
  if (widthMm + 1e-9 >= minimumWidthMmFor(totalModules, 2, dpi)) return 2;
  return 1;
}

/**
 * Validates settings and returns bar geometry.
 * Quiet zones stay ten modules and are never scaled away.
 */
export function planLabelLayout(product: LabelProduct, settings: ProductLabelSettings): LabelLayout {
  if (!product || typeof product.code !== "string" || typeof product.nameAr !== "string" || typeof product.id !== "string") {
    fail("بيانات المنتج غير صالحة للملصق.");
  }
  assertLabelSettings(settings);
  const profile = resolveLabelProfile(settings);

  const barcode = encodeProductBarcode(product.code);
  const totalModules = barcode.modules.length + barcode.quietZoneModules * 2;
  const moduleDots = moduleDotsFor(profile, settings.dpi, totalModules, settings.widthMm);
  const moduleWidthMm = dotsToMm(moduleDots, settings.dpi);
  const barcodeWidthMm = totalModules * moduleWidthMm;
  const minimumWidthMm = minimumWidthMmFor(totalModules, moduleDots, settings.dpi);
  if (settings.widthMm + 1e-9 < minimumWidthMm) {
    fail(`رمز المنتج يحتاج ملصقاً بعرض ${formatLabelMm(minimumWidthMm)} مم على الأقل`);
  }

  const type = typeSpec(profile);
  const contentWidthMm = settings.widthMm - PAGE_PADDING_MM * 2;
  const stack = textStackMm(product.code, product.nameAr, contentWidthMm, type);
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
    moduleWidthMm,
    barcodeWidthMm,
    barHeightMm,
    pagePaddingMm: PAGE_PADDING_MM,
    codeFontMm: type.codeFontMm,
    nameFontMm: type.nameFontMm,
    lineHeight: type.lineHeight,
    moduleDots,
    profile,
  };
}
