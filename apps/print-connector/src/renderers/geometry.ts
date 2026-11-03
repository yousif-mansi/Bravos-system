/** 203 dpi dot conversion. Half-up, matching the C# helper, not banker's rounding. */
export const NATIVE_DPI = 203;

export const QUIET_ZONE_MODULES = 10;

export const LABEL_WIDTH_MM = 38;
export const LABEL_HEIGHT_MM = 25;
export const LABEL_INSET_MM = 2;
export const LABEL_CODE_MM = 2.8;
export const LABEL_NAME_MM = 2;
export const LABEL_MIN_BAR_MM = 10;
export const LABEL_TEXT_GAP_MM = 1;
/** 0.5 mm is 4 dots. A 0.6 mm gap is 5 dots and leaves the 10 mm bar one dot short. */
export const LABEL_NAME_GAP_MM = 0.5;

export const RECEIPT_PAPER_WIDTH_MM = 80;
export const RECEIPT_CONTENT_WIDTH_MM = 72;
export const RECEIPT_MAX_PAGE_MM = 300;
export const RECEIPT_TOP_MM = 2;
export const RECEIPT_BOTTOM_MM = 4;
export const RECEIPT_LOGO_MM = 34;

export function mmToDots(mm: number): number {
  return Math.round((mm * NATIVE_DPI) / 25.4);
}

export const LABEL_WIDTH_DOTS = mmToDots(LABEL_WIDTH_MM);
export const LABEL_HEIGHT_DOTS = mmToDots(LABEL_HEIGHT_MM);
export const LABEL_INSET_DOTS = mmToDots(LABEL_INSET_MM);
export const LABEL_CONTENT_WIDTH_DOTS = LABEL_WIDTH_DOTS - LABEL_INSET_DOTS * 2;
export const LABEL_CONTENT_HEIGHT_DOTS = LABEL_HEIGHT_DOTS - LABEL_INSET_DOTS * 2;
export const LABEL_MIN_BAR_DOTS = mmToDots(LABEL_MIN_BAR_MM);

export const RECEIPT_PAPER_WIDTH_DOTS = mmToDots(RECEIPT_PAPER_WIDTH_MM);
export const RECEIPT_CONTENT_WIDTH_DOTS = mmToDots(RECEIPT_CONTENT_WIDTH_MM);
export const RECEIPT_MAX_PAGE_DOTS = mmToDots(RECEIPT_MAX_PAGE_MM);

/** One or two native dots, or null when the quiet zones cannot fit without scaling. */
export function moduleDotsFor(moduleCount: number): 1 | 2 | null {
  if (!Number.isInteger(moduleCount) || moduleCount < 1) return null;
  const total = moduleCount + QUIET_ZONE_MODULES * 2;
  if (total * 2 <= LABEL_CONTENT_WIDTH_DOTS) return 2;
  if (total <= LABEL_CONTENT_WIDTH_DOTS) return 1;
  return null;
}

export function barcodeWidthDots(moduleCount: number, moduleDots: 1 | 2): number {
  return (moduleCount + QUIET_ZONE_MODULES * 2) * moduleDots;
}

/** PaperSize hundredths of an inch, half-up, matching native-print.cs. */
export function hundredthsOfDots(dots: number): number {
  return Math.floor((dots * 100) / NATIVE_DPI + 0.5);
}

/**
 * Windows stores paper in hundredths of an inch, so a round trip can land
 * half a dot away (304 dots -> 150 hundredths -> 304.5). Accept that, plus
 * a float epsilon. Module widths stay integer dots elsewhere.
 */
export function dotsFromHundredths(hundredths: number): { dots: number; accepted: boolean } {
  const exact = (hundredths * NATIVE_DPI) / 100;
  const dots = Math.floor(exact + 0.5);
  const accepted = dots >= 0 && Math.abs(exact - dots) <= 0.5 + 1e-6;
  return { dots, accepted };
}
