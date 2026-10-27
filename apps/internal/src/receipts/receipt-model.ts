import type { SaleDto, SalePaymentDto } from "@bravos/contracts";
import { formatEgpFromPiasters } from "../money.ts";

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
  sizeName: string;
  colorName: string;
  /** Stored quantity and stored unit price, already formatted. */
  quantityAndUnitPrice: string;
  /** Stored line original total (`originalPiasters`). */
  lineOriginal: string;
};

export type ReceiptView = {
  brand: "BRAVOS";
  branchName: string;
  /** Printed only when configured. A missing phone is never a customer-facing warning. */
  contactPhone: string | null;
  /** Server sale reference when the completed sale has one. */
  serverReference: string | null;
  /**
   * Full local operation id. Kept for traceability after a server reference exists.
   * This is not the server POS sequence.
   */
  localOperationReference: string;
  /** Server reference when known; otherwise the full local operation reference. */
  printedReference: string;
  occurredAtLabel: string;
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

const LOCAL_REFERENCE_PREFIX = "عملية محلية ";

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
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

export function contentWidthMm(paperWidthMm: ReceiptPaperWidthMm): number {
  return paperWidthMm === 58 ? 48 : 72;
}

function money(piasters: number): string {
  return formatEgpFromPiasters(piasters);
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
    printedReference: sale.reference ?? localOperationReference(sale.operationId),
    occurredAtLabel: formatCairoDateTime(sale.occurredAt),
    lines: sale.lines.map((line) => ({
      productName: line.variant.product.nameAr,
      sizeName: line.variant.size.nameAr,
      colorName: line.variant.color.nameAr,
      quantityAndUnitPrice: `${line.quantity} × ${money(line.listedUnitPricePiasters)}`,
      lineOriginal: money(line.originalPiasters),
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
