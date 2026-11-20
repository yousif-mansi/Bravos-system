import { cairoFontSources } from "../printing/owned-cairo-fonts.ts";
import { egpInputToPiasters, piastersToEgpInput } from "../money.ts";
import officialVerticalLogoSvg from "../../../../logo svg/01_Primary-Logo_Vertical_Black.svg?raw";
import {
  RECEIPT_PAPER_WIDTH_MM,
  RECEIPT_SIDE_INSET_MM,
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

export { cairoFontSources as receiptFontSources };

export function receiptFontStyles(fontBaseUrl: string, weights: readonly number[] = [600, 700]): string {
  const base = fontBaseUrl.replace(/\/$/, "");
  return weights
    .flatMap((weight) =>
      cairoFontSources.map(
        ({ file, unicodeRange }) =>
          `@font-face{font-family:Cairo;font-style:normal;font-weight:${weight};font-display:swap;src:url("${base}/fonts/${file}") format("woff2");unicode-range:${unicodeRange};}`,
      ),
    )
    .join("");
}

export function receiptPrintStyles(_contentWidthMm: number, pageHeightMm = RECEIPT_PAPER_WIDTH_MM): string {
  return `
${receiptPageSizeCss(RECEIPT_PAPER_WIDTH_MM, pageHeightMm)}
html, body { margin: 0; padding: 0; background: #fff; color: #000; width: ${RECEIPT_PAPER_WIDTH_MM}mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: Cairo, sans-serif;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  width: ${RECEIPT_PAPER_WIDTH_MM}mm;
}
.receipt {
  position: relative;
  box-sizing: border-box;
  width: ${RECEIPT_PAPER_WIDTH_MM}mm;
  max-width: 100%;
  padding: 2mm ${RECEIPT_SIDE_INSET_MM}mm;
  background: #fff;
  color: #000;
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
  table-layout: fixed;
  margin-bottom: 2.3mm;
  font-size: 9px;
}
.meta td { width: 50%; padding: 0.75mm 0.85mm; vertical-align: middle; }
.meta p {
  margin: 0;
  line-height: 1.5;
}
.meta strong { font-weight: 700; white-space: nowrap; }
.meta, .items { width: 100%; border-collapse: collapse; }
.meta td, .items th, .items td { border: 1.5px solid #000; }
.items {
  table-layout: fixed;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.items th { font-weight: 700; text-align: center; }
.items td, .items th { padding: 0.85mm 0.45mm; vertical-align: middle; }
.items td:last-child { font-weight: 700; }
.meta, .items tr { break-inside: avoid; }
.items .name { text-align: right; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 2mm; }
.subtotal {
  margin-top: 1.6mm;
  padding: 0.85mm 1.5mm;
  font-weight: 700;
}
.payment { margin: 0.5mm 0 1.5mm; }
.payment .row { padding: 0.65mm 1.5mm; }
.payment .discount { border-top: 1.5px solid #000; }
.payment strong { font-weight: 700; }
.total {
  border-radius: 12px;
  background: #000;
  color: #fff;
  padding: 6px 12px;
  font-weight: 700;
  break-inside: avoid;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.total bdi { font-size: 13px; font-weight: 700; }
.footer {
  margin: 2mm 0 0;
  padding-top: 1mm;
  border-top: 1.5px solid #000;
  font-weight: 700;
  text-align: center;
  break-inside: avoid;
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
  value: string | null,
  valueDir: "auto" | "ltr" = "auto",
): void {
  if (value === null) return;
  const line = create(doc, "p");
  const labelNode = create(doc, "strong");
  labelNode.textContent = `${label}:`;
  const valueNode = create(doc, "span", "value");
  const bidi = doc.createElement("bdi");
  bidi.textContent = value;
  bidi.dir = valueDir;
  valueNode.appendChild(bidi);
  line.append(labelNode, " ", valueNode);
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
  const meta = create(doc, "table", "meta");
  meta.setAttribute("aria-label", "بيانات الفاتورة");
  const metaBody = create(doc, "tbody");
  for (const [rightLabel, rightValue, leftLabel, leftValue, leftDir] of [
    ["رقم الفاتورة", view.printedReference, "الكاشير", view.cashierDisplayName, "auto"],
    ["التاريخ", occurred.dateLabel, "العميل", view.customerName, "auto"],
    ["الوقت", occurred.timeLabel, "الهاتف", view.customerPhone, "ltr"],
  ] as const) {
    const row = create(doc, "tr");
    const right = create(doc, "td");
    const left = create(doc, "td");
    metaLine(doc, right, rightLabel, rightValue, "ltr");
    metaLine(doc, left, leftLabel, leftValue, leftDir);
    row.append(right, left);
    metaBody.appendChild(row);
  }
  meta.appendChild(metaBody);
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
  receipt.appendChild(moneyRow(doc, "subtotal", "إجمالي الأصناف:", itemsTotal));

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
    const discountRow = create(doc, "div", "row discount");
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
