import { egpInputToPiasters, piastersToEgpInput } from "../money.ts";
import officialVerticalLogoSvg from "../../../../logo svg/01_Primary-Logo_Vertical_Black.svg?raw";
import {
  RECEIPT_PAPER_WIDTH_MM,
  receiptPageSizeCss,
  receiptPageSizeMm,
  splitQuantityAndUnitPrice,
  splitReceiptDateTime,
  type ReceiptView,
} from "./receipt-model.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const LOGO_WIDTH_MM = 26;
const LOGO_HEIGHT_MM = 18;

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
  return [400, 600, 700, 800]
    .flatMap((weight) =>
      FONT_FILES.map(
        ([file, range]) =>
          `@font-face{font-family:Cairo;font-style:normal;font-weight:${weight};font-display:swap;src:url("${base}/fonts/${file}") format("woff2");unicode-range:${range};}`,
      ),
    )
    .join("");
}

export function receiptPrintStyles(_contentWidthMm: number, pageHeightMm = RECEIPT_PAPER_WIDTH_MM): string {
  return `
${receiptPageSizeCss(RECEIPT_PAPER_WIDTH_MM, pageHeightMm)}
html, body { margin: 0; padding: 0; background: #fff; color: #000; width: ${RECEIPT_PAPER_WIDTH_MM}mm; }
body {
  font-family: Cairo, sans-serif;
  font-size: 9px;
  font-weight: 500;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  width: ${RECEIPT_PAPER_WIDTH_MM}mm;
}
.receipt {
  position: relative;
  box-sizing: border-box;
  width: ${RECEIPT_PAPER_WIDTH_MM}mm;
  max-width: 100%;
  padding: 4mm 2.6mm 3.8mm;
  background: #fff;
  color: #161616;
  overflow-wrap: anywhere;
  word-break: break-word;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.logo-wrap {
  display: flex;
  justify-content: center;
  margin: 0 auto 0.35mm;
  max-width: 100%;
}
.logo {
  display: block;
  width: ${LOGO_WIDTH_MM}mm;
  height: ${LOGO_HEIGHT_MM}mm;
  max-width: 100%;
  object-fit: contain;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.logo-caption {
  direction: ltr;
  text-align: center;
  font: 700 4.9px/1 Cairo, Arial, sans-serif;
  letter-spacing: 1.15px;
  margin: 0 0 3.1mm;
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
h1, p { margin: 0; }
.meta {
  display: grid;
  grid-template-columns: 55% 45%;
  border-block: 0.5px solid #777;
  padding: 1.15mm 0;
  margin-bottom: 2.3mm;
  font-size: 7.3px;
}
.meta > div { min-width: 0; padding-inline: 0.85mm; }
.meta > div + div { border-inline-start: 0.5px solid #777; }
.meta p {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 1.5px;
  margin: 0;
  line-height: 1.85;
}
.meta strong { font-weight: 700; flex: 0 0 auto; }
.meta .value { min-width: 0; font-weight: 500; }
.meta bdi { font-size: 7px; font-variant-numeric: tabular-nums; }
.items {
  border-spacing: 0;
  width: 100%;
  table-layout: fixed;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.items th {
  background: #e6e6e4;
  font-size: 8.1px;
  font-weight: 800;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.items td, .items th { padding: 1.05mm 0.4mm; vertical-align: top; }
.items th:first-child { border-start-start-radius: 1.4mm; border-end-start-radius: 1.4mm; }
.items th:last-child { border-start-end-radius: 1.4mm; border-end-end-radius: 1.4mm; }
.items td:nth-child(2), .items th:nth-child(2) { text-align: start; }
.items td { border-bottom: 0.5px solid #aaa; }
.items td:last-child { font-weight: 700; }
.items tr { break-inside: avoid; page-break-inside: avoid; }
.items .name { text-align: start; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 2mm; }
.subtotal {
  margin-top: 1.6mm;
  padding: 0.85mm 1.5mm;
  background: #e6e6e4;
  border-radius: 1.4mm;
  font-weight: 800;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.payment { margin: 1.55mm 0.6mm; }
.payment .row { padding: 0.65mm 0.9mm; }
.payment .row + .row { border-top: 0.5px solid #a0a0a0; }
.payment strong { font-weight: 700; }
.total {
  border-radius: 30px;
  background: #151515;
  color: #fff;
  padding: 0.85mm 2.25mm;
  font-weight: 800;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.total bdi { font-size: 13px; font-weight: 800; }
.footer {
  display: flex;
  align-items: center;
  gap: 2mm;
  margin: 2.8mm 1mm 0;
  font-size: 9px;
  font-weight: 800;
  text-align: center;
  white-space: nowrap;
}
.footer::before, .footer::after { content: ""; height: 0.5px; background: #555; flex: 1; }
@media screen {
  [data-receipt-preview] body { font-size: 9px; }
}

`;
}

function create(doc: Document, tag: string, className?: string): HTMLElement {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function metaLine(
  doc: Document,
  parent: ParentNode,
  label: string,
  value: string,
  valueDir: "auto" | "ltr" = "auto",
): void {
  const line = create(doc, "p");
  const labelNode = create(doc, "strong");
  labelNode.textContent = `${label}:`;
  const valueNode = create(doc, "span", "value");
  const bidi = doc.createElement("bdi");
  bidi.textContent = value;
  bidi.dir = valueDir;
  valueNode.appendChild(bidi);
  line.append(labelNode, valueNode);
  parent.appendChild(line);
}

function moneyRow(doc: Document, className: string, label: string, amount: string): HTMLElement {
  const row = create(doc, "div", `row ${className}`);
  const labelNode = create(doc, "span");
  labelNode.textContent = label;
  const amountNode = doc.createElement("bdi");
  amountNode.textContent = amount;
  amountNode.dir = "ltr";
  row.append(labelNode, amountNode);
  return row;
}

function appendOfficialLogo(doc: Document, parent: HTMLElement): boolean {
  const parserCtor = doc.defaultView?.DOMParser ?? (typeof DOMParser === "function" ? DOMParser : null);
  if (!parserCtor) return false;
  const parsed = new parserCtor().parseFromString(officialVerticalLogoSvg, "image/svg+xml");
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

function storedDiscount(view: ReceiptView): { itemsTotal: string; discount: string } | null {
  const subtotal = view.adjustments.find((line) => line.label === "الإجمالي قبل الخصم");
  const discount = view.adjustments.reduce(
    (sum, line) => (line.label === "الإجمالي قبل الخصم" ? sum : sum + (egpInputToPiasters(line.amount) ?? 0)),
    0,
  );
  if (discount <= 0) return null;
  return {
    itemsTotal: subtotal?.amount ?? view.finalTotal,
    discount: piastersToEgpInput(discount),
  };
}

/**
 * Sets an explicit two-length @page box from the laid-out receipt height.
 * Long receipts cap at RECEIPT_MAX_PAGE_HEIGHT_MM and paginate; content is not clipped.
 */
export function finalizeReceiptDocumentSize(doc: Document, _contentWidthMm: number): { widthMm: number; heightMm: number } {
  const receipt = doc.querySelector(".receipt");
  const heightPx = receipt
    ? Math.max(receipt.scrollHeight, receipt.getBoundingClientRect().height)
    : 0;
  const size = receiptPageSizeMm(RECEIPT_PAPER_WIDTH_MM, heightPx);
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
  page.textContent = `${receiptPageSizeCss(RECEIPT_PAPER_WIDTH_MM, RECEIPT_PAPER_WIDTH_MM)}html,body{width:${RECEIPT_PAPER_WIDTH_MM}mm;}`;
  doc.head.appendChild(page);
  doc.documentElement.lang = "ar";
  doc.documentElement.dir = "rtl";
  doc.title = "إيصال بيع";
  doc.documentElement.setAttribute("data-receipt-page-width-mm", String(RECEIPT_PAPER_WIDTH_MM));
  doc.documentElement.setAttribute("data-receipt-page-height-mm", String(RECEIPT_PAPER_WIDTH_MM));

  const receipt = create(doc, "main", "receipt");
  const logoMounted = appendOfficialLogo(doc, receipt);
  const caption = create(doc, "div", "logo-caption");
  caption.textContent = "MEN'S WEAR";
  receipt.appendChild(caption);
  const brand = create(doc, "h1", logoMounted ? "brand visually-hidden" : "brand");
  brand.textContent = view.brand;
  receipt.appendChild(brand);

  const occurred = splitReceiptDateTime(view.occurredAtLabel);
  const meta = create(doc, "section", "meta");
  meta.setAttribute("aria-label", "بيانات الفاتورة");
  const invoice = create(doc, "div");
  metaLine(doc, invoice, "رقم الفاتورة", view.printedReference);
  metaLine(doc, invoice, "التاريخ", occurred.dateLabel, "ltr");
  if (occurred.timeLabel) metaLine(doc, invoice, "الوقت", occurred.timeLabel, "ltr");
  const party = create(doc, "div");
  metaLine(doc, party, "الكاشير", view.cashierDisplayName);
  metaLine(doc, party, "العميل", view.customerName);
  if (view.customerPhone) metaLine(doc, party, "الهاتف", view.customerPhone, "ltr");
  meta.append(invoice, party);
  receipt.appendChild(meta);

  const table = create(doc, "table", "items");
  table.setAttribute("aria-label", "الأصناف");
  const columns = create(doc, "colgroup");
  for (const width of ["9%", "31%", "17%", "19%", "24%"]) {
    const col = doc.createElement("col");
    col.style.width = width;
    columns.appendChild(col);
  }
  table.appendChild(columns);
  const headerRow = create(doc, "tr");
  for (const label of ["م", "الصنف", "الكمية", "السعر", "الإجمالي"]) {
    const cell = create(doc, "th");
    cell.setAttribute("scope", "col");
    cell.textContent = label;
    headerRow.appendChild(cell);
  }
  const tableHead = create(doc, "thead");
  tableHead.appendChild(headerRow);
  table.appendChild(tableHead);
  const tableBody = create(doc, "tbody");
  view.lines.forEach((line, index) => {
    const itemRow = create(doc, "tr");
    const seq = create(doc, "td");
    seq.textContent = String(index + 1);
    const product = create(doc, "td", "name");
    product.dir = "auto";
    product.textContent = line.productName;
    const parsed = splitQuantityAndUnitPrice(line.quantityAndUnitPrice);
    const quantity = create(doc, "td", "figures");
    quantity.dir = "ltr";
    quantity.textContent = parsed?.quantity ?? line.quantityAndUnitPrice;
    const unit = create(doc, "td", "figures");
    unit.dir = "ltr";
    unit.textContent = parsed?.unitPrice ?? "";
    const total = create(doc, "td", "figures");
    total.dir = "ltr";
    total.textContent = line.lineOriginal;
    itemRow.append(seq, product, quantity, unit, total);
    tableBody.appendChild(itemRow);
  });
  table.appendChild(tableBody);
  receipt.appendChild(table);

  const discount = storedDiscount(view);
  const itemsTotal = discount?.itemsTotal ?? view.finalTotal;
  receipt.appendChild(moneyRow(doc, "subtotal", "إجمالي الأصناف", itemsTotal));

  const payment = create(doc, "section", "payment");
  const method = create(doc, "div", "row");
  const methodLabel = create(doc, "strong");
  methodLabel.textContent = "طريقة الدفع:";
  const methodValue = create(doc, "span");
  methodValue.textContent = view.paymentMethodLabel;
  method.append(methodLabel, methodValue);
  payment.appendChild(method);
  if (view.exchangeCredit) {
    payment.appendChild(moneyRow(doc, "", "رصيد استبدال", view.exchangeCredit));
  }
  const single = view.paymentAllocations.length === 1 ? view.paymentAllocations[0] : null;
  const simpleCash = single?.label === "المبلغ النقدي" && view.paymentMethodLabel === "نقدي";
  if (!simpleCash) {
    for (const allocation of view.paymentAllocations) {
      payment.appendChild(moneyRow(doc, "", allocation.label, allocation.amount));
    }
  }
  const collectedAlreadyShown = simpleCash && single?.amount === view.cashCollected;
  if (view.cashCollected !== null && !collectedAlreadyShown) {
    payment.appendChild(moneyRow(doc, "", "النقد المحصّل", view.cashCollected));
  }
  if (discount) {
    const discountRow = create(doc, "div", "row");
    const discountLabel = create(doc, "strong");
    discountLabel.textContent = "الخصم:";
    const discountValue = doc.createElement("bdi");
    discountValue.textContent = discount.discount;
    discountValue.dir = "ltr";
    discountRow.append(discountLabel, discountValue);
    payment.appendChild(discountRow);
  }
  receipt.appendChild(payment);

  if (discount) {
    receipt.appendChild(moneyRow(doc, "total", "الإجمالي بعد الخصم", view.finalTotal));
  }

  const footer = create(doc, "p", "footer");
  footer.textContent = "استايلك على كيفك";
  receipt.appendChild(footer);
  doc.body.appendChild(receipt);
}
