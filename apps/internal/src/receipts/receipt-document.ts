import officialHorizontalLogoSvg from "../../../../logo svg/02_Logo_Horizontal_Black.svg?raw";
import { receiptPageSizeCss, receiptPageSizeMm, type ReceiptView } from "./receipt-model.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const LOGO_WIDTH_MM = 34;

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

export function receiptPrintStyles(contentWidthMm: number, pageHeightMm = 80): string {
  return `
${receiptPageSizeCss(contentWidthMm, pageHeightMm)}
html, body { margin: 0; padding: 0; background: #fff; color: #000; width: ${contentWidthMm}mm; }
body {
  font-family: Cairo, sans-serif;
  font-size: 12px;
  line-height: 1.35;
  width: ${contentWidthMm}mm;
}
.receipt {
  position: relative;
  box-sizing: border-box;
  width: ${contentWidthMm}mm;
  max-width: 100%;
  padding: 2mm 1.5mm 4mm;
  background: #fff;
  color: #000;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.logo-wrap {
  display: flex;
  justify-content: center;
  margin: 0 auto 1.5mm;
  max-width: 100%;
}
.logo {
  display: block;
  width: ${LOGO_WIDTH_MM}mm;
  max-width: 100%;
  height: auto;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.brand { margin: 0; text-align: center; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media print {
  .visually-hidden { display: none; }
}
.center { text-align: center; }
.title { margin: 0 0 1mm; font-size: 13px; font-weight: 700; }
.muted { margin: 1mm 0; }
.rule { border: 0; border-top: 1px solid #000; margin: 2mm 0; }
.line { break-inside: avoid; page-break-inside: avoid; margin: 0 0 2mm; }
.name, .meta, .refs, .value { unicode-bidi: isolate; overflow-wrap: anywhere; word-break: break-word; }
.qty { unicode-bidi: isolate; direction: ltr; text-align: start; margin: 0.4mm 0; }
.detail {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2mm;
  margin: 0.5mm 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
.detail .label { flex: 0 0 auto; overflow-wrap: normal; word-break: normal; }
.detail .value { flex: 1 1 auto; min-width: 0; text-align: start; }
.row { display: flex; justify-content: space-between; gap: 2mm; break-inside: avoid; page-break-inside: avoid; }
.row span { unicode-bidi: isolate; min-width: 0; overflow-wrap: anywhere; }
.figures { unicode-bidi: isolate; direction: ltr; white-space: nowrap; flex: 0 0 auto; }
.total { font-size: 16px; font-weight: 700; margin-top: 1mm; }
.footer { text-align: center; margin-top: 3mm; }
h1, p { margin: 0; }
`;
}

function create(doc: Document, tag: string, className?: string): HTMLElement {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function row(
  doc: Document,
  parent: ParentNode,
  label: string,
  value: string,
  className = "row",
  labelDir: "auto" | "ltr" = "auto",
): void {
  const line = create(doc, "div", className);
  const labelNode = create(doc, "span", labelDir === "ltr" ? "qty" : undefined);
  labelNode.textContent = label;
  labelNode.dir = labelDir;
  const valueNode = create(doc, "span", "figures");
  valueNode.textContent = value;
  valueNode.dir = "ltr";
  line.append(labelNode, valueNode);
  parent.appendChild(line);
}

function quantityLine(doc: Document, parent: ParentNode, text: string): void {
  const line = create(doc, "p", "qty");
  line.dir = "ltr";
  line.textContent = text;
  parent.appendChild(line);
}

function detail(
  doc: Document,
  parent: ParentNode,
  label: string,
  value: string,
  valueDir: "auto" | "ltr" = "auto",
): void {
  const line = create(doc, "p", "detail");
  const labelNode = create(doc, "span", "label");
  labelNode.textContent = label;
  const valueNode = create(doc, "span", "value");
  valueNode.textContent = value;
  valueNode.dir = valueDir;
  line.append(labelNode, valueNode);
  parent.appendChild(line);
}

function appendOfficialLogo(doc: Document, parent: HTMLElement): boolean {
  const parserCtor = doc.defaultView?.DOMParser ?? (typeof DOMParser === "function" ? DOMParser : null);
  if (!parserCtor) return false;
  const parsed = new parserCtor().parseFromString(officialHorizontalLogoSvg, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    return false;
  }
  if (parsed.getElementsByTagName("parsererror").length > 0) {
    return false;
  }
  const logo = doc.importNode(root, true) as unknown as SVGSVGElement;
  logo.removeAttribute("width");
  logo.removeAttribute("height");
  logo.setAttribute("class", "logo");
  logo.setAttribute("aria-hidden", "true");
  logo.setAttribute("focusable", "false");
  logo.setAttribute("preserveAspectRatio", "xMidYMid meet");
  for (const use of Array.from(logo.querySelectorAll("use"))) {
    const href = use.getAttribute("href") ?? use.getAttributeNS(XLINK_NS, "href");
    if (href && !use.getAttribute("href")) {
      use.setAttribute("href", href);
    }
  }
  const wrap = create(doc, "div", "logo-wrap");
  wrap.setAttribute("data-receipt-logo", "official");
  wrap.appendChild(logo);
  parent.appendChild(wrap);
  return true;
}

/**
 * Sets an explicit two-length @page box from the laid-out receipt height.
 * Long receipts cap at RECEIPT_MAX_PAGE_HEIGHT_MM and paginate; content is not clipped.
 */
export function finalizeReceiptDocumentSize(doc: Document, contentWidthMm: number): { widthMm: number; heightMm: number } {
  const receipt = doc.querySelector(".receipt");
  const heightPx = receipt
    ? Math.max(receipt.scrollHeight, receipt.getBoundingClientRect().height)
    : 0;
  const size = receiptPageSizeMm(contentWidthMm, heightPx);
  let page = doc.getElementById("receipt-page-size");
  if (!page) {
    page = doc.createElement("style");
    page.id = "receipt-page-size";
    doc.head.appendChild(page);
  }
  page.textContent = `${receiptPageSizeCss(size.widthMm, size.heightMm)}html,body{width:${size.widthMm}mm;}`;
  doc.documentElement.setAttribute("data-receipt-page-width-mm", String(size.widthMm));
  doc.documentElement.setAttribute("data-receipt-page-height-mm", String(size.heightMm));
  return size;
}

/**
 * Renders the receipt into an empty document using text nodes only for sale data.
 * The same function fills the print iframe and any preview frame.
 */
export function renderReceiptDocument(doc: Document, view: ReceiptView, fontBaseUrl: string): void {
  const style = doc.createElement("style");
  style.textContent = `${receiptFontStyles(fontBaseUrl)}${receiptPrintStyles(view.contentWidthMm)}`;
  doc.head.appendChild(style);
  const page = doc.createElement("style");
  page.id = "receipt-page-size";
  page.textContent = `${receiptPageSizeCss(view.contentWidthMm, 80)}html,body{width:${view.contentWidthMm}mm;}`;
  doc.head.appendChild(page);
  doc.documentElement.lang = "ar";
  doc.documentElement.dir = "rtl";
  doc.title = "إيصال بيع";
  doc.documentElement.setAttribute("data-receipt-page-width-mm", String(view.contentWidthMm));
  doc.documentElement.setAttribute("data-receipt-page-height-mm", "80");

  const receipt = create(doc, "main", "receipt");
  const logoMounted = appendOfficialLogo(doc, receipt);
  const brand = create(doc, "h1", logoMounted ? "brand visually-hidden" : "brand");
  brand.textContent = view.brand;
  receipt.appendChild(brand);
  const heading = create(doc, "p", "center title");
  heading.textContent = "إيصال بيع";
  receipt.appendChild(heading);

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

  detail(doc, receipt, "رقم الإيصال", view.printedReference);
  detail(doc, receipt, "التاريخ", view.occurredAtLabel);
  detail(doc, receipt, "الكاشير", view.cashierDisplayName);
  detail(doc, receipt, "العميل", view.customerName);
  if (view.customerPhone) {
    detail(doc, receipt, "الهاتف", view.customerPhone, "ltr");
  }
  rule();

  for (const line of view.lines) {
    const block = create(doc, "section", "line");
    const name = create(doc, "p", "name");
    name.textContent = line.productName;
    name.dir = "auto";
    block.appendChild(name);
    if (line.productCode) {
      detail(doc, block, "الرمز", line.productCode, "ltr");
    }
    if (line.sizeName.trim() || line.colorName.trim()) {
      const variant = create(doc, "p", "meta");
      variant.textContent = `${line.sizeName} · ${line.colorName}`;
      variant.dir = "auto";
      block.appendChild(variant);
    }
    if (line.linePaid) {
      quantityLine(doc, block, line.quantityAndUnitPrice);
      row(doc, block, "الأصلي", line.lineOriginal);
      row(doc, block, "المدفوع", line.linePaid);
    } else {
      row(doc, block, line.quantityAndUnitPrice, line.lineOriginal, "row", "ltr");
    }
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
  detail(doc, receipt, "طريقة الدفع", view.paymentMethodLabel);
  for (const allocation of view.paymentAllocations) {
    row(doc, receipt, allocation.label, allocation.amount);
  }

  const thanks = create(doc, "p", "footer");
  thanks.textContent = "شكرًا لتسوقكم";
  receipt.appendChild(thanks);

  doc.body.appendChild(receipt);
}
