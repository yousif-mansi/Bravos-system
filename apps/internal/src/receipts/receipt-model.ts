import type { SaleDto, SalePaymentDto } from "@bravos/contracts";
import { piastersToEgpInput } from "../money.ts";
import { customerReceiptNumber } from "../receipt-number.ts";

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
  /** Legacy POS reference when the completed sale has one. */
  serverReference: string | null;
  /**
   * Full local operation id. Kept for internal traceability.
   * It is not a customer receipt number.
   */
  localOperationReference: string;
  /** Customer receipt number: BRV, then the legacy POS reference, then a pending label. */
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
  /** Content column width in millimetres. The browser page size is left to the Windows driver. */
  contentWidthMm: number;
};

/** CSS reference pixel conversion used for thermal page-height measurement. */
const CSS_PX_PER_MM = 96 / 25.4;
/** Long receipts paginate at this height instead of becoming an A4 sheet. */
export const RECEIPT_MAX_PAGE_HEIGHT_MM = 300;

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

export function contentWidthMm(paperWidthMm: ReceiptPaperWidthMm): number {
  return paperWidthMm === 58 ? 48 : 72;
}

/** Two explicit millimetre lengths. `auto` is invalid CSS page size. */
export function receiptPageSizeCss(widthMm: number, heightMm: number): string {
  return `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
}

/**
 * Thermal page box from content width and measured CSS-pixel height.
 * Height is rounded up with a 1mm buffer, then capped so long receipts paginate.
 */
export function receiptPageSizeMm(contentWidthMm: number, contentHeightPx: number): { widthMm: number; heightMm: number } {
  const measuredMm = Math.max(0, contentHeightPx) / CSS_PX_PER_MM;
  const heightMm = Math.min(RECEIPT_MAX_PAGE_HEIGHT_MM, Math.max(1, Math.ceil(measuredMm + 1)));
  return { widthMm: contentWidthMm, heightMm };
}

function money(piasters: number): string {
  return piastersToEgpInput(piasters);
}

function storedText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
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
      productName: line.variant.product.nameAr,
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
