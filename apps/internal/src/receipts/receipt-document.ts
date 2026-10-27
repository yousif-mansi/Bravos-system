import type { ReceiptView } from "./receipt-model.ts";

/** Same subset ranges as apps/internal/src/styles/fonts.css so the faces combine. */
const CAIRO_RANGES = {
  arabic:
    "U+6??, U+750-77F, U+870-88E, U+890-891, U+897-8E1, U+8E3-8FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1",
  latinExt:
    "U+100-2BA, U+2BD-2C5, U+2C7-2CC, U+2CE-2D7, U+2DD-2FF, U+304, U+308, U+329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  latin:
    "U+??, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
} as const;

const FONT_FILES = [
  ["cairo-arabic.woff2", CAIRO_RANGES.arabic],
  ["cairo-latin-ext.woff2", CAIRO_RANGES.latinExt],
  ["cairo-latin.woff2", CAIRO_RANGES.latin],
] as const;

/** Cairo subset files and the unicode ranges shared with receipt CSS. */
export const receiptFontSources: readonly { readonly file: string; readonly unicodeRange: string }[] = FONT_FILES.map(
  ([file, unicodeRange]) => ({ file, unicodeRange }),
);

export function receiptFontStyles(fontBaseUrl: string): string {
  const base = fontBaseUrl.replace(/\/$/, "");
  return [400, 700]
    .flatMap((weight) =>
      FONT_FILES.map(
        ([file, range]) =>
          `@font-face{font-family:Cairo;font-style:normal;font-weight:${weight};font-display:swap;src:url("${base}/fonts/${file}") format("woff2");unicode-range:${range};}`,
      ),
    )
    .join("");
}

export function receiptPrintStyles(contentWidthMm: number): string {
  return `
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body {
  font-family: Cairo, sans-serif;
  font-size: 12px;
  line-height: 1.35;
  width: ${contentWidthMm}mm;
}
.receipt {
  box-sizing: border-box;
  width: ${contentWidthMm}mm;
  padding: 2mm 1.5mm 4mm;
  background: #fff;
  color: #000;
}
.brand { margin: 0; text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
.center { text-align: center; }
.muted { margin: 1mm 0; }
.rule { border: 0; border-top: 1px solid #000; margin: 2mm 0; }
.line { break-inside: avoid; page-break-inside: avoid; margin: 0 0 2mm; }
.name, .meta, .refs { unicode-bidi: isolate; overflow-wrap: anywhere; }
.row { display: flex; justify-content: space-between; gap: 2mm; break-inside: avoid; page-break-inside: avoid; }
.row span { unicode-bidi: isolate; }
.figures { white-space: nowrap; }
.total { font-size: 16px; font-weight: 700; margin-top: 1mm; }
h1, p { margin: 0; }
`;
}

function create(doc: Document, tag: string, className?: string): HTMLElement {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function row(doc: Document, parent: ParentNode, label: string, value: string, className = "row"): void {
  const line = create(doc, "div", className);
  const labelNode = create(doc, "span");
  labelNode.textContent = label;
  const valueNode = create(doc, "span", "figures");
  valueNode.textContent = value;
  valueNode.dir = "ltr";
  line.append(labelNode, valueNode);
  parent.appendChild(line);
}

/**
 * Renders the receipt into an empty document using text nodes only.
 * The same function fills the print iframe and any preview frame.
 */
export function renderReceiptDocument(doc: Document, view: ReceiptView, fontBaseUrl: string): void {
  const style = doc.createElement("style");
  style.textContent = `${receiptFontStyles(fontBaseUrl)}${receiptPrintStyles(view.contentWidthMm)}`;
  doc.head.appendChild(style);
  doc.documentElement.lang = "ar";
  doc.documentElement.dir = "rtl";
  doc.title = "إيصال";

  const receipt = create(doc, "main", "receipt");
  const brand = create(doc, "h1", "brand");
  brand.textContent = view.brand;
  receipt.appendChild(brand);

  const branch = create(doc, "p", "center name");
  branch.textContent = view.branchName;
  branch.dir = "auto";
  receipt.appendChild(branch);

  if (view.contactPhone) {
    const phone = create(doc, "p", "center");
    phone.textContent = view.contactPhone;
    phone.dir = "ltr";
    receipt.appendChild(phone);
  }

  const rule = () => {
    receipt.appendChild(create(doc, "hr", "rule"));
  };
  rule();

  const reference = create(doc, "p", "refs");
  reference.textContent = view.printedReference;
  reference.dir = "auto";
  receipt.appendChild(reference);

  const when = create(doc, "p", "muted");
  when.textContent = view.occurredAtLabel;
  receipt.appendChild(when);
  rule();

  for (const line of view.lines) {
    const block = create(doc, "section", "line");
    const name = create(doc, "p", "name");
    name.textContent = line.productName;
    name.dir = "auto";
    const variant = create(doc, "p", "meta");
    variant.textContent = `${line.sizeName} · ${line.colorName}`;
    variant.dir = "auto";
    block.append(name, variant);
    row(doc, block, line.quantityAndUnitPrice, line.lineOriginal);
    receipt.appendChild(block);
  }

  rule();
  for (const adjustment of view.adjustments) {
    row(doc, receipt, adjustment.label, adjustment.amount);
  }
  row(doc, receipt, "الإجمالي", view.finalTotal, "row total");
  if (view.exchangeCredit) {
    row(doc, receipt, "رصيد استبدال", view.exchangeCredit);
  }
  if (view.cashCollected) {
    row(doc, receipt, "النقد المحصّل", view.cashCollected);
  }
  const method = create(doc, "p", "muted");
  method.textContent = view.paymentMethodLabel;
  receipt.appendChild(method);
  for (const allocation of view.paymentAllocations) {
    row(doc, receipt, allocation.label, allocation.amount);
  }

  doc.body.appendChild(receipt);
}
