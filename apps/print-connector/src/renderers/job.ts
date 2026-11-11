import {
  LABEL_PRINTER_NAME,
  RECEIPT_COPIES,
  RECEIPT_PRINTER_NAME,
  parsePrintJob,
} from "../contracts.ts";
import type { PrintJob } from "../contracts.ts";
import type { PrintDispatch } from "../ports.ts";
import { encodeProductCode } from "./barcode.ts";
import {
  LABEL_CONTENT_WIDTH_DOTS,
  LABEL_HEIGHT_DOTS,
  LABEL_MIN_BAR_DOTS,
  LABEL_WIDTH_DOTS,
  QUIET_ZONE_MODULES,
  RECEIPT_MAX_PAGE_DOTS,
  RECEIPT_PAPER_WIDTH_DOTS,
  barcodeWidthDots,
  moduleDotsFor,
} from "./geometry.ts";

const STDIN_MAX_BYTES = 48_000;

export type NativeFailureCode =
  | "printer_missing"
  | "printer_offline"
  | "unsupported_driver"
  | "renderer_unavailable"
  | "unsupported_platform"
  | "invalid_layout"
  | "invalid_job";

export type NativeLabelJob = {
  kind: "label";
  copies: number;
  code: string;
  name: string;
  modules: string;
  price: string | null;
};

export type NativeReceiptLine = {
  productName: string;
  productCode: string;
  sizeName: string;
  colorName: string;
  quantityAndUnitPrice: string;
  lineOriginal: string;
  linePaid: string | null;
};

export type NativeMoneyLine = {
  label: string;
  amount: string;
};

export type NativeReceiptJob = {
  kind: "receipt";
  copies: 1;
  branchName: string;
  contactPhone: string | null;
  printedReference: string;
  occurredAtLabel: string;
  cashierDisplayName: string;
  customerName: string;
  customerPhone: string | null;
  lines: NativeReceiptLine[];
  adjustments: NativeMoneyLine[];
  finalTotal: string;
  exchangeCredit: string | null;
  cashCollected: string | null;
  paymentMethodLabel: string;
  paymentAllocations: NativeMoneyLine[];
};

export type NativeJob = NativeLabelJob | NativeReceiptJob;

export type NativeEnvelope = {
  action: "probe" | "preview" | "print";
  job: NativeJob | null;
};

export type PreparedNativeJob =
  | {
    ok: true;
    kind: "label";
    moduleDots: 1 | 2;
    quietModules: typeof QUIET_ZONE_MODULES;
    barcodeModules: number;
    barcodeWidthDots: number;
    pageWidthDots: number;
    pageHeightDots: number;
    contentWidthDots: number;
    minimumBarDots: number;
    job: NativeLabelJob;
  }
  | {
    ok: true;
    kind: "receipt";
    copies: 1;
    pageWidthDots: number;
    maxPageHeightDots: number;
    job: NativeReceiptJob;
  }
  | { ok: false; code: "invalid_job" | "invalid_layout" | "unsupported_driver" };

function nativeReceipt(parsed: Extract<PrintJob, { kind: "receipt" }>): NativeReceiptJob {
  const view = parsed.receiptView;
  return {
    kind: "receipt",
    copies: 1,
    branchName: view.branchName,
    contactPhone: view.contactPhone,
    printedReference: view.printedReference,
    occurredAtLabel: view.occurredAtLabel,
    cashierDisplayName: view.cashierDisplayName,
    customerName: view.customerName,
    customerPhone: view.customerPhone,
    lines: view.lines.map((line) => ({
      productName: line.productName,
      productCode: line.productCode,
      sizeName: line.sizeName,
      colorName: line.colorName,
      quantityAndUnitPrice: line.quantityAndUnitPrice,
      lineOriginal: line.lineOriginal,
      linePaid: line.linePaid,
    })),
    adjustments: view.adjustments.map((row) => ({ label: row.label, amount: row.amount })),
    finalTotal: view.finalTotal,
    exchangeCredit: view.exchangeCredit,
    cashCollected: view.cashCollected,
    paymentMethodLabel: view.paymentMethodLabel,
    paymentAllocations: view.paymentAllocations.map((row) => ({ label: row.label, amount: row.amount })),
  };
}

export function envelopeJson(envelope: NativeEnvelope): Buffer | null {
  const json = JSON.stringify(envelope);
  const bytes = Buffer.from(json, "utf8");
  if (bytes.length < 2 || bytes.length > STDIN_MAX_BYTES) return null;
  return bytes;
}

export function prepareNativeJob(dispatch: PrintDispatch): PreparedNativeJob {
  if (dispatch.kind === "label") {
    if (dispatch.printerName !== LABEL_PRINTER_NAME) return { ok: false, code: "unsupported_driver" };
    const parsed = parsePrintJob(dispatch.document);
    if (!parsed || parsed.kind !== "label") return { ok: false, code: "invalid_job" };
    if (dispatch.jobId !== parsed.id || dispatch.copies !== parsed.copies) return { ok: false, code: "invalid_job" };
    const encoded = encodeProductCode(parsed.product.code);
    if (!encoded.ok) return { ok: false, code: "invalid_job" };
    const moduleDots = moduleDotsFor(encoded.modules.length);
    if (moduleDots === null) return { ok: false, code: "invalid_layout" };
    const width = barcodeWidthDots(encoded.modules.length, moduleDots);
    if (width > LABEL_CONTENT_WIDTH_DOTS) return { ok: false, code: "invalid_layout" };
    return {
      ok: true,
      kind: "label",
      moduleDots,
      quietModules: QUIET_ZONE_MODULES,
      barcodeModules: encoded.modules.length,
      barcodeWidthDots: width,
      pageWidthDots: LABEL_WIDTH_DOTS,
      pageHeightDots: LABEL_HEIGHT_DOTS,
      contentWidthDots: LABEL_CONTENT_WIDTH_DOTS,
      minimumBarDots: LABEL_MIN_BAR_DOTS,
      job: {
        kind: "label",
        copies: parsed.copies,
        code: parsed.product.code,
        name: parsed.product.name,
        modules: encoded.modules,
        price: parsed.product.price ?? null,
      },
    };
  }
  if (dispatch.printerName !== RECEIPT_PRINTER_NAME) return { ok: false, code: "unsupported_driver" };
  if (dispatch.copies !== RECEIPT_COPIES) return { ok: false, code: "invalid_job" };
  const parsed = parsePrintJob(dispatch.document);
  if (!parsed || parsed.kind !== "receipt" || dispatch.jobId !== parsed.id) return { ok: false, code: "invalid_job" };
  return {
    ok: true,
    kind: "receipt",
    copies: 1,
    pageWidthDots: RECEIPT_PAPER_WIDTH_DOTS,
    maxPageHeightDots: RECEIPT_MAX_PAGE_DOTS,
    job: nativeReceipt(parsed),
  };
}
