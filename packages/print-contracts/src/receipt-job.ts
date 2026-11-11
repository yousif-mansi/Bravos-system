import {
  BRANCH_NAME_MAX,
  CASHIER_NAME_MAX,
  CUSTOMER_NAME_MAX,
  MAX_RECEIPT_LINES,
  OCCURRED_AT_MAX,
  PHONE_MAX,
  PRINTED_REFERENCE_MAX,
  PRODUCT_NAME_MAX,
  RECEIPT_COPIES,
  TAXONOMY_NAME_MAX,
  isReceiptContentWidth,
} from "./constants.ts";
import {
  exactKeys,
  isDisplayText,
  isInteger,
  isMoney,
  isProductCode,
  isQuantityAndUnitPrice,
  isSafeTree,
  parseJobId,
} from "./text.ts";

/**
 * Public receipt fields the connector prints. Staff operation ids and legacy POS
 * references stay off this transport; `printedReference` is the receipt number.
 * Amounts stay the strings the paired app already accepted. Purchase cost is not a field.
 */
export type ReceiptMoneyLineDto = {
  label: string;
  amount: string;
};

export type ReceiptItemLineDto = {
  productName: string;
  productCode: string;
  sizeName: string;
  colorName: string;
  quantityAndUnitPrice: string;
  lineOriginal: string;
  linePaid: string | null;
};

export type ReceiptViewDto = {
  brand: "BRAVOS";
  branchName: string;
  contactPhone: string | null;
  printedReference: string;
  occurredAtLabel: string;
  cashierDisplayName: string;
  customerName: string;
  customerPhone: string | null;
  lines: ReceiptItemLineDto[];
  adjustments: ReceiptMoneyLineDto[];
  finalTotal: string;
  exchangeCredit: string | null;
  cashCollected: string | null;
  paymentMethodLabel: string;
  paymentAllocations: ReceiptMoneyLineDto[];
  contentWidthMm: 48 | 72;
};

export type ReceiptJob = {
  kind: "receipt";
  id: string;
  copies: typeof RECEIPT_COPIES;
  receiptView: ReceiptViewDto;
};

const ADJUSTMENT_LABELS = ["الإجمالي قبل الخصم", "خصم العرض", "خصم الكوبون", "خصم الموظف"] as const;
const CASH_LABEL = "المبلغ النقدي";
const ONLINE_LABEL = "المبلغ الإلكتروني";
const PAYMENT_LABELS = ["نقدي", "دفع إلكتروني", "مقسّم نقدي وإلكتروني"] as const;

function nullablePhone(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (isDisplayText(value, PHONE_MAX)) return value;
  return undefined;
}

function moneyOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (isMoney(value)) return value;
  return undefined;
}

function parseLine(value: unknown): ReceiptItemLineDto | null {
  const record = exactKeys(value, [
    "productName",
    "productCode",
    "sizeName",
    "colorName",
    "quantityAndUnitPrice",
    "lineOriginal",
    "linePaid",
  ]);
  if (!record) return null;
  const linePaid = moneyOrNull(record.linePaid);
  const productName = record.productName;
  const sizeName = record.sizeName;
  const colorName = record.colorName;
  const quantityAndUnitPrice = record.quantityAndUnitPrice;
  const lineOriginal = record.lineOriginal;
  if (linePaid === undefined || !isDisplayText(productName, PRODUCT_NAME_MAX)) return null;
  const productCode = record.productCode === "" ? "" : record.productCode;
  if (typeof productCode !== "string" || (productCode !== "" && !isProductCode(productCode))) return null;
  // Product-level POS lines deliberately omit website-only size/color labels.
  if ((sizeName !== "" && !isDisplayText(sizeName, TAXONOMY_NAME_MAX))
    || (colorName !== "" && !isDisplayText(colorName, TAXONOMY_NAME_MAX))) return null;
  if (!isQuantityAndUnitPrice(quantityAndUnitPrice) || !isMoney(lineOriginal)) return null;
  return {
    productName,
    productCode,
    sizeName,
    colorName,
    quantityAndUnitPrice,
    lineOriginal,
    linePaid,
  };
}

function parseAdjustment(value: unknown): ReceiptMoneyLineDto | null {
  const record = exactKeys(value, ["label", "amount"]);
  const label = record?.label;
  const amount = record?.amount;
  if (!record || !isMoney(amount) || typeof label !== "string" || !ADJUSTMENT_LABELS.includes(label as typeof ADJUSTMENT_LABELS[number])) {
    return null;
  }
  return { label, amount };
}

function parseAllocations(method: string, value: unknown): ReceiptMoneyLineDto[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ReceiptMoneyLineDto[] = [];
  for (const item of value) {
    const record = exactKeys(item, ["label", "amount"]);
    const label = record?.label;
    const amount = record?.amount;
    if (!record || !isMoney(amount) || typeof label !== "string") return null;
    rows.push({ label, amount });
  }
  if (method === "نقدي") {
    const row = rows[0];
    if (rows.length !== 1 || !row || row.label !== CASH_LABEL) return null;
    return rows;
  }
  if (method === "دفع إلكتروني") {
    const row = rows[0];
    if (rows.length !== 1 || !row || row.label !== ONLINE_LABEL) return null;
    return rows;
  }
  const cash = rows[0];
  const online = rows[1];
  if (rows.length !== 2 || !cash || !online || cash.label !== CASH_LABEL || online.label !== ONLINE_LABEL) return null;
  return rows;
}

export function parseReceiptJob(value: unknown): ReceiptJob | null {
  if (!isSafeTree(value)) return null;
  const record = exactKeys(value, ["kind", "id", "copies", "receiptView"]);
  if (!record || record.kind !== "receipt" || record.copies !== RECEIPT_COPIES) return null;
  const id = parseJobId(record.id);
  if (!id) return null;
  const view = exactKeys(record.receiptView, [
    "brand",
    "branchName",
    "contactPhone",
    "printedReference",
    "occurredAtLabel",
    "cashierDisplayName",
    "customerName",
    "customerPhone",
    "lines",
    "adjustments",
    "finalTotal",
    "exchangeCredit",
    "cashCollected",
    "paymentMethodLabel",
    "paymentAllocations",
    "contentWidthMm",
  ]);
  if (!view || view.brand !== "BRAVOS" || !isReceiptContentWidth(view.contentWidthMm)) return null;
  const contentWidthMm = view.contentWidthMm;
  const branchName = view.branchName;
  const printedReference = view.printedReference;
  const occurredAtLabel = view.occurredAtLabel;
  const cashierDisplayName = view.cashierDisplayName;
  const customerName = view.customerName;
  const finalTotal = view.finalTotal;
  const paymentMethodLabel = view.paymentMethodLabel;
  if (!isDisplayText(branchName, BRANCH_NAME_MAX) || !isDisplayText(printedReference, PRINTED_REFERENCE_MAX)) return null;
  if (!isDisplayText(cashierDisplayName, CASHIER_NAME_MAX) || !isDisplayText(customerName, CUSTOMER_NAME_MAX)) return null;
  if (!isDisplayText(occurredAtLabel, OCCURRED_AT_MAX) || !isMoney(finalTotal)) return null;
  const contactPhone = nullablePhone(view.contactPhone);
  const customerPhone = nullablePhone(view.customerPhone);
  const exchangeCredit = moneyOrNull(view.exchangeCredit);
  const cashCollected = moneyOrNull(view.cashCollected);
  if (contactPhone === undefined || customerPhone === undefined || exchangeCredit === undefined || cashCollected === undefined) {
    return null;
  }
  if ((exchangeCredit === null) !== (cashCollected === null)) return null;
  if (typeof paymentMethodLabel !== "string" || !PAYMENT_LABELS.includes(paymentMethodLabel as typeof PAYMENT_LABELS[number])) {
    return null;
  }
  if (!Array.isArray(view.lines) || !isInteger(view.lines.length, 1, MAX_RECEIPT_LINES)) return null;
  const lines: ReceiptItemLineDto[] = [];
  for (const line of view.lines) {
    const parsed = parseLine(line);
    if (!parsed) return null;
    lines.push(parsed);
  }
  if (!Array.isArray(view.adjustments) || view.adjustments.length > ADJUSTMENT_LABELS.length) return null;
  const adjustments: ReceiptMoneyLineDto[] = [];
  const seen = new Set<string>();
  for (const row of view.adjustments) {
    const parsed = parseAdjustment(row);
    if (!parsed || seen.has(parsed.label)) return null;
    seen.add(parsed.label);
    adjustments.push(parsed);
  }
  const paymentAllocations = parseAllocations(paymentMethodLabel, view.paymentAllocations);
  if (!paymentAllocations) return null;
  return {
    kind: "receipt",
    id,
    copies: RECEIPT_COPIES,
    receiptView: {
      brand: "BRAVOS",
      branchName,
      contactPhone,
      printedReference,
      occurredAtLabel,
      cashierDisplayName,
      customerName,
      customerPhone,
      lines,
      adjustments,
      finalTotal,
      exchangeCredit,
      cashCollected,
      paymentMethodLabel,
      paymentAllocations,
      contentWidthMm,
    },
  };
}
