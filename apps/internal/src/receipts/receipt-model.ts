import type { SaleDto, SalePaymentDto } from "@bravos/contracts";
import { piastersToEgpInput } from "../money.ts";
import { customerReceiptNumber } from "../receipt-number.ts";

/** Browser paper is 58 mm portrait. A stored 80 is accepted and treated as 58. */
export type ReceiptPaperWidthMm = 58 | 80;

/** Explicit receipt settings. The owner supplies the phone; an empty string means it is not configured. */
export type ReceiptOptions = {
  paperWidthMm: ReceiptPaperWidthMm;
  contactPhone: string;
};

export type ReceiptMoneyLine = {
  label: string;
  amount: string;
};

export type ReceiptItemLine = {
  productName: string;
  /** Stored product code / SKU. Empty when the saved product has no code. */
  productCode: string;
  sizeName: string;
  colorName: string;
  /** Stored quantity and stored unit price, already formatted. */
  quantityAndUnitPrice: string;
  /** Stored line original total (`originalPiasters`). */
  lineOriginal: string;
  /** Stored line paid total (`paidPiasters`) when it differs from the original. */
  linePaid: string | null;
};

export type ReceiptView = {
  brand: "BRAVOS";
  branchName: string;
  /** Printed only when configured. A missing phone is never a customer-facing warning. */
  contactPhone: string | null;
  /** Central POS reference when the completed sale has one. */
  serverReference: string | null;
  /**
   * Full local operation id. Kept for internal traceability.
   * It is not a customer receipt number.
   */
  localOperationReference: string;
  /** The receipt's selected number, with the central POS reference as a legacy fallback. */
  printedReference: string;
  occurredAtLabel: string;
  /** Cashier display name only. Staff ids stay off the receipt. */
  cashierDisplayName: string;
  /** Saved customer name, or a neutral Arabic placeholder when none was recorded. */
  customerName: string;
  /** Saved customer phone when present. */
  customerPhone: string | null;
  lines: ReceiptItemLine[];
  /** Present only when a stored discount must be shown to reconcile the final total. */
  adjustments: ReceiptMoneyLine[];
  finalTotal: string;
  exchangeCredit: string | null;
  cashCollected: string | null;
  paymentMethodLabel: string;
  paymentAllocations: ReceiptMoneyLine[];
  /** Content column width in millimetres after the 58 mm paper inset. */
  contentWidthMm: number;
};

/** CSS reference pixel conversion used for thermal page-height measurement. */
const CSS_PX_PER_MM = 96 / 25.4;
/** Long receipts paginate at this height instead of becoming an A4 sheet. */
export const RECEIPT_MAX_PAGE_HEIGHT_MM = 300;
/** Physical browser page width. Native hardware roll stays 80 mm. */
export const RECEIPT_PAPER_WIDTH_MM = 58;
const RECEIPT_CONTENT_INSET_MM = 48;
const CAIRO_DATE_TIME = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}):(\d{2})$/;

const LOCAL_REFERENCE_PREFIX = "عملية محلية ";
const UNREGISTERED_LABEL = "غير مسجل";

const paymentMethodLabels: Record<SalePaymentDto["method"], string> = {
  cash: "نقدي",
  online: "دفع إلكتروني",
  split: "مقسّم نقدي وإلكتروني",
};

export function isCompletedSale(sale: SaleDto): boolean {
  return sale.physicallyCompleted === true;
}

export function localOperationReference(operationId: string): string {
  return `${LOCAL_REFERENCE_PREFIX}${operationId}`;
}

/** Cairo wall time for the stored sale instant. Falls back to the raw value if it cannot be read. */
export function formatCairoDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("day")}/${read("month")}/${read("year")} ${read("hour")}:${read("minute")}`;
}

export function contentWidthMm(_paperWidthMm: ReceiptPaperWidthMm = 58): number {
  return RECEIPT_CONTENT_INSET_MM;
}

/**
 * Split the stored Cairo `DD/MM/YYYY HH:mm` label into receipt date and 12-hour time.
 * Unparseable stored labels are kept whole on the date row.
 */
export function splitReceiptDateTime(label: string): { dateLabel: string; timeLabel: string | null } {
  const match = CAIRO_DATE_TIME.exec(label);
  if (!match) return { dateLabel: label, timeLabel: null };
  const hour24 = Number(match[2]);
  const minute = match[3] ?? "00";
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return { dateLabel: label, timeLabel: null };
  const period = hour24 < 12 ? "ص" : "م";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { dateLabel: match[1] ?? label, timeLabel: `${hour12}:${minute} ${period}` };
}

/** Quantity and original unit price from the stored `quantityAndUnitPrice` string. */
export function splitQuantityAndUnitPrice(value: string): { quantity: string; unitPrice: string } | null {
  const parts = value.split(" × ");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { quantity: parts[0], unitPrice: parts[1] };
}

/** Two explicit millimetre lengths. `auto` is invalid CSS page size. */
export function receiptPageSizeCss(widthMm: number, heightMm: number): string {
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
}

/**
 * Thermal page box for 58 mm portrait paper.
 * Height is rounded up with a 1mm buffer, kept at least as tall as the paper
 * width so a short receipt stays portrait, then capped so long receipts paginate.
 */
export function receiptPageSizeMm(_paperOrContentWidthMm: number, contentHeightPx: number): { widthMm: number; heightMm: number } {
  const measuredMm = Math.max(0, contentHeightPx) / CSS_PX_PER_MM;
  const heightMm = Math.min(
    RECEIPT_MAX_PAGE_HEIGHT_MM,
    Math.max(RECEIPT_PAPER_WIDTH_MM, Math.ceil(measuredMm + 1)),
  );
  return { widthMm: RECEIPT_PAPER_WIDTH_MM, heightMm };
}

function money(piasters: number): string {
  return piastersToEgpInput(piasters);
}

function storedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Prefer the Arabic name when the catalog label includes an English translation after an em dash. */
function receiptProductName(name: string): string {
  const [primary, translation, ...rest] = name.split(" — ");
  const arabic = /\p{Script=Arabic}/u;
  const latin = /\p{Script=Latin}/u;
  if (primary && translation && rest.length === 0 && arabic.test(primary) && latin.test(translation) && !arabic.test(translation)) {
    return primary.trim();
  }
  return name;
}

function adjustmentsFor(sale: SaleDto): ReceiptMoneyLine[] {
  const rows: ReceiptMoneyLine[] = [];
  const discountShown =
    sale.automaticOfferDiscountPiasters !== 0 ||
    sale.couponDiscountPiasters !== 0 ||
    sale.employeeDiscountPiasters !== 0;
  if (!discountShown) {
    return rows;
  }
  rows.push({ label: "الإجمالي قبل الخصم", amount: money(sale.originalTotalPiasters) });
  if (sale.automaticOfferDiscountPiasters !== 0) {
    rows.push({ label: "خصم العرض", amount: money(sale.automaticOfferDiscountPiasters) });
  }
  if (sale.couponDiscountPiasters !== 0) {
    rows.push({ label: "خصم الكوبون", amount: money(sale.couponDiscountPiasters) });
  }
  if (sale.employeeDiscountPiasters !== 0) {
    rows.push({ label: "خصم الموظف", amount: money(sale.employeeDiscountPiasters) });
  }
  return rows;
}

function paymentAllocations(payment: SalePaymentDto): ReceiptMoneyLine[] {
  if (payment.method === "cash") {
    return [{ label: "المبلغ النقدي", amount: money(payment.cashPiasters) }];
  }
  if (payment.method === "online") {
    return [{ label: "المبلغ الإلكتروني", amount: money(payment.onlinePiasters) }];
  }
  return [
    { label: "المبلغ النقدي", amount: money(payment.cashPiasters) },
    { label: "المبلغ الإلكتروني", amount: money(payment.onlinePiasters) },
  ];
}

/**
 * Pure view of a completed sale. Amounts are the stored sale figures.
 * Nothing is priced from the current catalog and no total is recomputed.
 */
export function buildReceiptView(sale: SaleDto, options: ReceiptOptions): ReceiptView {
  const phone = options.contactPhone.trim();
  const showExchange = sale.exchangeCreditAppliedPiasters !== 0;
  return {
    brand: "BRAVOS",
    branchName: sale.branch.nameAr,
    contactPhone: phone.length > 0 ? phone : null,
    serverReference: sale.reference,
    localOperationReference: localOperationReference(sale.operationId),
    printedReference: customerReceiptNumber({
      receiptReference: sale.receiptReference ?? null,
      reference: sale.reference,
      blockedIds: [sale.id, sale.operationId],
    }),
    occurredAtLabel: formatCairoDateTime(sale.occurredAt),
    cashierDisplayName: storedText(sale.soldByDisplayName) ?? UNREGISTERED_LABEL,
    customerName: storedText(sale.customerName) ?? UNREGISTERED_LABEL,
    customerPhone: storedText(sale.customerPhone),
    lines: sale.lines.map((line) => ({
      productName: receiptProductName(line.variant.product.nameAr),
      productCode: storedText(line.variant.product.code) ?? "",
      sizeName: line.variant.purpose === "operational" ? "" : line.variant.size.nameAr,
      colorName: line.variant.purpose === "operational" ? "" : line.variant.color.nameAr,
      quantityAndUnitPrice: `${line.quantity} × ${money(line.listedUnitPricePiasters)}`,
      lineOriginal: money(line.originalPiasters),
      linePaid: line.paidPiasters !== line.originalPiasters ? money(line.paidPiasters) : null,
    })),
    adjustments: adjustmentsFor(sale),
    finalTotal: money(sale.finalTotalPiasters),
    exchangeCredit: showExchange ? money(sale.exchangeCreditAppliedPiasters) : null,
    cashCollected: showExchange ? money(sale.cashReceivedPiasters) : null,
    paymentMethodLabel: paymentMethodLabels[sale.payment.method],
    paymentAllocations: paymentAllocations(sale.payment),
    contentWidthMm: contentWidthMm(options.paperWidthMm),
  };
}
