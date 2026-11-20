import { installOwnedCairoFonts } from "../printing/owned-cairo-fonts.ts";
import { LabelPrintError } from "./barcode.ts";

export async function installOwnedLabelFonts(doc: Document, signal?: AbortSignal): Promise<void> {
  try {
    const compact = doc.querySelector(".label-header") !== null;
    await installOwnedCairoFonts(doc, compact ? ["500", "600", "800"] : ["400", "700"], signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new LabelPrintError("تعذر تجهيز خط الملصق.");
  }
}
