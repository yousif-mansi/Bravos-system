import { egpInputToPiasters, piastersToEgpInput } from "../money.ts";
import officialHorizontalLogoSvg from "../../../../logo svg/02_Logo_Horizontal_Black.svg?raw";
import { receiptPageSizeCss, receiptPageSizeMm, type ReceiptView } from "./receipt-model.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const LOGO_WIDTH_MM = 22;

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
  return [400, 600]
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
  font-weight: 400;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
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
.brand { margin: 0; text-align: center; font-size: 18px; font-weight: 600; letter-spacing: 0.08em; }
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
.header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1mm; }
.header .logo-wrap { margin: 0; }
.details, .summary { margin-top: 1.2mm; }
.details .detail + .detail { margin-top: 0.5mm; }
.detail { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; break-inside: avoid; }
.detail .label { flex: 0 0 auto; }
.detail .value { min-width: 0; text-align: left; }
.total { margin-top: 0.5mm; font-size: 14px; font-weight: 600; }
.items { width: 100%; table-layout: fixed; border-collapse: collapse; text-align: right; margin-top: 1mm; }
.items th, .items td { padding: 0.45mm 0.4mm; vertical-align: top; border-bottom: 0.5px solid #555; }
.items tr { break-inside: avoid; page-break-inside: avoid; }
.items col.product { width: 56%; }
.items col.quantity { width: 16%; }
.items col.money { width: 28%; }
.items th { font-size: 11px; font-weight: 600; vertical-align: bottom; }
.items .figures { text-align: right; }
.name { text-align: right; }
@media screen {
  [data-receipt-preview] body { font-size: 9.5px; }
  [data-receipt-preview] .items th { font-size: 9px; }
  [data-receipt-preview] .total { font-size: 11.5px; }
}

`;
}

function create(doc: Document, tag: string, className?: string): HTMLElement {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function detail(
  doc: Document,
  parent: ParentNode,
  label: string,
  value: string,
  valueDir: "auto" | "ltr" = "auto",
  className?: string,
): void {
  const line = create(doc, "div", className ? "detail " + className : "detail");
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
  const header = create(doc, "header", "header");
  const identity = create(doc, "div");
  const branch = create(doc, "p", "branch");
  branch.textContent = view.branchName;
  identity.appendChild(branch);
  if (view.contactPhone) {
    const phone = create(doc, "bdi");
    phone.textContent = view.contactPhone;
    identity.appendChild(phone);
  }
  header.appendChild(identity);
  const logoMounted = appendOfficialLogo(doc, header);
  const brand = create(doc, "h1", logoMounted ? "brand visually-hidden" : "brand");
  brand.textContent = view.brand;
  header.appendChild(brand);
  receipt.appendChild(header);

  const details = create(doc, "div", "details");
  receipt.appendChild(details);
  detail(doc, details, "رقم الإيصال", view.printedReference, "auto", "receipt-reference");
  detail(doc, details, "التاريخ", view.occurredAtLabel, "ltr");
  if (view.cashierDisplayName !== "غير مسجل") detail(doc, details, "الكاشير", view.cashierDisplayName);
  if (view.customerName !== "غير مسجل") detail(doc, details, "العميل", view.customerName);
  if (view.customerPhone) detail(doc, details, "الهاتف", view.customerPhone, "ltr");

  const table = create(doc, "table", "items");
  table.setAttribute("aria-label", "الأصناف");
  const columns = create(doc, "colgroup");
  for (const kind of ["product", "quantity", "money"]) columns.appendChild(create(doc, "col", kind));
  table.appendChild(columns);
  const headerRow = create(doc, "tr");
  for (const label of ["الصنف", "عدد", "السعر"]) {
    const cell = create(doc, "th");
    cell.setAttribute("scope", "col");
    cell.textContent = label;
    headerRow.appendChild(cell);
  }
  const tableHead = create(doc, "thead");
  tableHead.appendChild(headerRow);
  table.appendChild(tableHead);
  const tableBody = create(doc, "tbody");
  for (const line of view.lines) {
    const itemRow = create(doc, "tr");
    const product = create(doc, "td");
    const name = create(doc, "p", "name");
    name.dir = "auto";
    name.textContent = line.productName;
    product.appendChild(name);
    itemRow.appendChild(product);
    const [quantity = ""] = line.quantityAndUnitPrice.split(" × ", 1);
    for (const value of [quantity, line.lineOriginal]) {
      const cell = create(doc, "td", "figures");
      cell.dir = "ltr";
      cell.textContent = value;
      itemRow.appendChild(cell);
    }
    tableBody.appendChild(itemRow);
  }
  table.appendChild(tableBody);
  receipt.appendChild(table);

  const summary = create(doc, "div", "summary");
  const subtotal = view.adjustments.find((line) => line.label === "الإجمالي قبل الخصم");
  const discount = view.adjustments.reduce((sum, line) =>
    line.label === "الإجمالي قبل الخصم" ? sum : sum + (egpInputToPiasters(line.amount) ?? 0), 0);
  if (discount > 0) {
    const beforeDiscount = subtotal?.amount ?? piastersToEgpInput(view.lines.reduce(
      (sum, line) => sum + (egpInputToPiasters(line.lineOriginal) ?? 0), 0,
    ));
    detail(doc, summary, "الإجمالي قبل الخصم", beforeDiscount, "ltr");
    detail(doc, summary, "الخصم", piastersToEgpInput(discount), "ltr");
  }
  detail(doc, summary, discount > 0 ? "الإجمالي بعد الخصم" : "الإجمالي", view.finalTotal, "ltr", "total");

  const payment = create(doc, "div", "payment");
  if (view.exchangeCredit) detail(doc, payment, "رصيد استبدال", view.exchangeCredit, "ltr");
  const single = view.paymentAllocations.length === 1 ? view.paymentAllocations[0] : null;
  for (const allocation of view.paymentAllocations) detail(doc, payment, allocation.label, allocation.amount, "ltr");
  const collectedAlreadyShown = single?.label === "المبلغ النقدي" && single.amount === view.cashCollected;
  if (view.cashCollected !== null && !collectedAlreadyShown) detail(doc, payment, "النقد المحصّل", view.cashCollected, "ltr");
  if (payment.hasChildNodes()) summary.appendChild(payment);
  receipt.appendChild(summary);
  doc.body.appendChild(receipt);
}
