import { receiptFontStyles } from "../receipts/receipt-document.ts";
import officialVerticalLogoSvg from "../../../../logo svg/01_Primary-Logo_Vertical_Black.svg?raw";
import {
  BRAND_GAP_MM,
  COMPACT_BAR_HEIGHT_MM,
  COMPACT_LOGO_HEIGHT_MM,
  COMPACT_PRICE_FONT_MM,
  COMPACT_ROW_GAP_MM,
  COMPACT_VERTICAL_PADDING_MM,
  formatLabelMm,
  LabelPrintError,
  NAME_GAP_MM,
  TEXT_GAP_MM,
  XP236B_38X25_PROFILE,
  type LabelLayout,
} from "./barcode.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const BAR_FLOOR_MM = 10;
const PX_PER_MM = 96 / 25.4;
const OVERFLOW_PX = 1;

function mm(value: number): string {
  return `${value}mm`;
}

export function labelPrintStyles(layout: LabelLayout): string {
  const { settings, barcodeWidthMm, barHeightMm, pagePaddingMm, codeFontMm, nameFontMm, brandFontMm, lineHeight } = layout;
  return `
@page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: Cairo, sans-serif; }
.label {
  box-sizing: border-box;
  width: ${mm(settings.widthMm)};
  height: ${mm(settings.heightMm)};
  margin-left: auto;
  margin-right: auto;
  padding: ${mm(pagePaddingMm)};
  background: #fff;
  color: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: visible;
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: page;
  page-break-after: always;
}
.label:last-child { break-after: auto; page-break-after: auto; }
.brand {
  flex: 0 0 auto;
  margin: 0 0 ${mm(BRAND_GAP_MM)};
  font-size: ${mm(brandFontMm)};
  font-weight: 700;
  line-height: ${lineHeight};
  text-align: center;
  direction: ltr;
}
.bars {
  flex: 0 0 auto;
  align-self: center;
  width: ${mm(barcodeWidthMm)};
  height: ${mm(barHeightMm)};
  background: #fff;
}
.bars svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }
.meta {
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  direction: ltr;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1mm;
  margin: ${mm(TEXT_GAP_MM)} 0 0;
}
.meta.single { justify-content: center; }
.code, .price, .name {
  margin: 0;
  unicode-bidi: isolate;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.code {
  flex: 1 1 auto;
  min-width: 0;
  font-size: ${mm(codeFontMm)};
  line-height: ${lineHeight};
  direction: ltr;
  text-align: start;
}
.meta.single .code { text-align: center; flex: 0 1 auto; }
.price {
  flex: 0 1 auto;
  font-size: ${mm(codeFontMm)};
  font-weight: 700;
  line-height: ${lineHeight};
  direction: ltr;
  text-align: end;
}
.name {
  flex: 0 0 auto;
  align-self: stretch;
  margin-top: ${mm(NAME_GAP_MM)};
  font-size: ${mm(nameFontMm)};
  line-height: ${lineHeight};
  text-align: center;
}
${layout.profile === XP236B_38X25_PROFILE ? compactStyles(layout) : ""}
`;
}

function compactStyles(layout: LabelLayout): string {
  return `
.label {
  padding: ${mm(COMPACT_VERTICAL_PADDING_MM)} ${mm(layout.pagePaddingMm)};
  border: none;
  gap: ${mm(COMPACT_ROW_GAP_MM)};
  justify-content: space-between;
  align-items: stretch;
  overflow: hidden;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.label-header, .label-footer {
  display: flex;
  direction: ltr;
  justify-content: space-between;
  gap: ${mm(1)};
}
.label-header { align-items: center; }
.label-footer { align-items: baseline; }
.label-header .code {
  font-weight: 500;
  font-size: ${mm(layout.barcode.value.length > 18 ? 1.8 : layout.codeFontMm)};
  text-align: left;
}
.label-header .brand {
  flex: none;
  display: block;
  width: ${mm(COMPACT_LOGO_HEIGHT_MM * 503 / 629)};
  height: ${mm(COMPACT_LOGO_HEIGHT_MM)};
  margin: 0;
}
.label-footer .name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}
.label-footer .price {
  flex: none;
  font-size: ${mm((layout.priceText?.length ?? 0) > 12 ? 3.05 : COMPACT_PRICE_FONT_MM)};
  font-weight: 800;
  white-space: nowrap;
  text-align: right;
}
`;
}

function drawBars(doc: Document, modules: string, quietZoneModules: number): SVGSVGElement {
  const total = modules.length + quietZoneModules * 2;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${total} 1`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");

  const ground = doc.createElementNS(SVG_NS, "rect");
  ground.setAttribute("x", "0");
  ground.setAttribute("y", "0");
  ground.setAttribute("width", String(total));
  ground.setAttribute("height", "1");
  ground.setAttribute("fill", "#ffffff");
  svg.appendChild(ground);

  let index = 0;
  while (index < modules.length) {
    if (modules[index] !== "1") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < modules.length && modules[index] === "1") index += 1;
    const bar = doc.createElementNS(SVG_NS, "rect");
    bar.setAttribute("x", String(quietZoneModules + start));
    bar.setAttribute("y", "0");
    bar.setAttribute("width", String(index - start));
    bar.setAttribute("height", "1");
    bar.setAttribute("fill", "#000000");
    svg.appendChild(bar);
  }
  return svg;
}

function appendLabel(doc: Document, layout: LabelLayout): void {
  const section = doc.createElement("section");
  section.className = "label";
  section.dataset.moduleDots = String(layout.moduleDots);
  section.dataset.labelProfile = layout.profile;

  const bars = doc.createElement("div");
  bars.className = "bars";
  const graphic = drawBars(doc, layout.barcode.modules, layout.barcode.quietZoneModules);
  graphic.setAttribute("aria-label", layout.barcode.value);
  bars.appendChild(graphic);
  const code = doc.createElement("p");
  code.className = "code";
  code.dir = "ltr";
  code.textContent = layout.barcode.value;
  const price = doc.createElement("p");
  if (layout.priceText) {
    price.className = "price";
    price.dir = "ltr";
    price.textContent = layout.priceText;
  }

  const name = doc.createElement("p");
  name.className = "name";
  name.dir = "auto";
  name.textContent = layout.product.nameAr;

  if (layout.profile === XP236B_38X25_PROFILE) {
    const header = doc.createElement("div");
    const footer = doc.createElement("div");
    header.className = "label-header";
    footer.className = "label-footer";
    const svg = new DOMParser().parseFromString(officialVerticalLogoSvg, "image/svg+xml").documentElement;
    const logo = doc.importNode(svg, true);
    logo.setAttribute("class", "brand");
    logo.setAttribute("role", "img");
    logo.setAttribute("aria-label", "Bravos");
    header.append(code, logo);
    footer.appendChild(name);
    if (layout.priceText) footer.appendChild(price);
    section.append(header, bars, footer);
  } else {
    const brand = doc.createElement("p");
    brand.className = "brand";
    brand.dir = "ltr";
    brand.textContent = "Bravos";
    const meta = doc.createElement("div");
    meta.className = layout.priceText ? "meta" : "meta single";
    meta.appendChild(code);
    if (layout.priceText) meta.appendChild(price);
    section.append(brand, bars, meta);
    if (layout.product.nameAr.length > 0) section.appendChild(name);
  }

  doc.body.appendChild(section);
}

function pxLength(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function outerBlockPx(element: HTMLElement, view: Window): number {
  const style = view.getComputedStyle(element);
  return element.getBoundingClientRect().height + pxLength(style.marginTop) + pxLength(style.marginBottom);
}

function requiredHeightMessage(paddingPx: number, textPx: number): string {
  const requiredMm = (paddingPx + textPx) / PX_PER_MM + BAR_FLOOR_MM;
  return `رمز المنتج يحتاج ملصقاً بارتفاع ${formatLabelMm(requiredMm)} مم على الأقل`;
}

/**
 * After Cairo is loaded, bar height is the space actually left under the text.
 * The character estimate must not keep growing the bars when the label is taller.
 */
export function fitAndValidateLabelDocument(doc: Document, layout: LabelLayout): void {
  const view = doc.defaultView;
  const label = doc.querySelector<HTMLElement>(".label");
  if (!view || !label) {
    throw new LabelPrintError("تعذر قياس الملصق.");
  }

  const labelStyle = view.getComputedStyle(label);
  const padTop = pxLength(labelStyle.paddingTop);
  const padBottom = pxLength(labelStyle.paddingBottom);
  const compact = layout.profile === XP236B_38X25_PROFILE;
  const textRows = label.querySelectorAll<HTMLElement>(compact ? ".label-header, .label-footer" : ".brand, .meta, .name");
  const textPx = Array.from(textRows).reduce((sum, row) => sum + outerBlockPx(row, view), 0)
    + (compact ? 2 * pxLength(labelStyle.rowGap) : 0);
  const innerHeight = label.getBoundingClientRect().height - padTop - padBottom;
  const remainingPx = innerHeight - textPx;
  if (remainingPx / PX_PER_MM + 1e-4 < BAR_FLOOR_MM) {
    throw new LabelPrintError(requiredHeightMessage(padTop + padBottom, textPx));
  }

  const fitted = `${compact ? Math.min(remainingPx, COMPACT_BAR_HEIGHT_MM * PX_PER_MM) : remainingPx}px`;
  for (const bars of doc.querySelectorAll<HTMLElement>(".bars")) {
    bars.style.height = fitted;
  }

  for (const section of doc.querySelectorAll<HTMLElement>(".label")) {
    const box = section.getBoundingClientRect();
    const style = view.getComputedStyle(section);
    const left = box.left + pxLength(style.paddingLeft);
    const right = box.right - pxLength(style.paddingRight);
    const bottom = box.bottom - pxLength(style.paddingBottom);
    for (const child of section.querySelectorAll(".bars, .brand, .meta, .name, .code, .price")) {
      const childBox = child.getBoundingClientRect();
      if (childBox.left < left - OVERFLOW_PX || childBox.right > right + OVERFLOW_PX) {
        throw new LabelPrintError(`رمز المنتج يحتاج ملصقاً بعرض ${formatLabelMm(layout.minimumWidthMm)} مم على الأقل`);
      }
      if (childBox.bottom > bottom + OVERFLOW_PX) {
        throw new LabelPrintError(requiredHeightMessage(padTop + padBottom, textPx));
      }
    }
  }
}

/** Fills an empty document. The print iframe and the preview iframe both use this. */
export function renderLabelDocument(doc: Document, layout: LabelLayout, fontBaseUrl: string): void {
  const style = doc.createElement("style");
  const weights = layout.profile === XP236B_38X25_PROFILE ? [500, 600, 800] : [400, 700];
  style.textContent = `${receiptFontStyles(fontBaseUrl, weights)}${labelPrintStyles(layout)}`;
  doc.head.appendChild(style);
  doc.documentElement.lang = "ar";
  doc.documentElement.dir = "rtl";
  doc.title = "ملصق منتج";

  for (let copy = 0; copy < layout.settings.copies; copy += 1) {
    appendLabel(doc, layout);
  }
}
