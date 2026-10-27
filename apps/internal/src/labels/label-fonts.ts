import { LabelPrintError } from "./barcode.ts";
import { receiptFontSources } from "../receipts/index.ts";

const WEIGHTS = ["400", "700"] as const;

/** Successful WOFF2 bytes only. Keyed by page origin so a warmed preview can print offline. */
const bytesByOrigin = new Map<string, ArrayBuffer>();

function cacheKey(origin: string, file: string): string {
  return `${origin}\n${file}`;
}

function isWoff2(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  const magic = new Uint8Array(bytes, 0, 4);
  return magic[0] === 0x77 && magic[1] === 0x4f && magic[2] === 0x46 && magic[3] === 0x32;
}

function fontFailure(): LabelPrintError {
  return new LabelPrintError("تعذر تجهيز خط الملصق.");
}

function aborted(signal: AbortSignal): DOMException {
  if (signal.reason instanceof DOMException && signal.reason.name === "AbortError") return signal.reason;
  return new DOMException("أُلغيت طباعة الملصق.", "AbortError");
}

/** Drops URL-backed @font-face rules from this label document only. */
function removeCssFontFaces(doc: Document): void {
  for (const style of doc.querySelectorAll("style")) {
    const text = style.textContent ?? "";
    if (!text.includes("@font-face")) continue;
    style.textContent = text.replace(/@font-face\{[^}]*\}/g, "");
  }
}

async function subsetBytes(origin: string, file: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const key = cacheKey(origin, file);
  const cached = bytesByOrigin.get(key);
  if (cached) return cached;
  if (signal?.aborted) throw aborted(signal);

  let response: Response;
  try {
    response = await fetch(new URL(`/fonts/${file}`, origin), { signal });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw signal ? aborted(signal) : error;
    }
    throw fontFailure();
  }
  if (!response.ok) throw fontFailure();

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw signal ? aborted(signal) : error;
    }
    throw fontFailure();
  }
  if (!isWoff2(bytes)) throw fontFailure();
  return bytes;
}

/**
 * Fetches Cairo subsets on the parent page (service worker or HTTP cache), then
 * installs loaded FontFace values into the owned label document.
 */
async function loadLabelFonts(doc: Document, signal: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted(signal);
  removeCssFontFaces(doc);
  if (!doc.fonts || typeof FontFace === "undefined") throw fontFailure();

  const origin = window.location.origin;
  let buffers: ArrayBuffer[];
  try {
    buffers = await Promise.all(receiptFontSources.map((source) => subsetBytes(origin, source.file, signal)));
  } catch (error) {
    if (error instanceof LabelPrintError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw fontFailure();
  }

  const faces: FontFace[] = [];
  try {
    for (const weight of WEIGHTS) {
      receiptFontSources.forEach((source, index) => {
        faces.push(
          new FontFace("Cairo", buffers[index]!, {
            display: "swap",
            style: "normal",
            unicodeRange: source.unicodeRange,
            weight,
          }),
        );
      });
    }
    await Promise.all(faces.map((face) => face.load()));
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw signal ? aborted(signal) : error;
    }
    throw fontFailure();
  }
  if (signal?.aborted) throw aborted(signal);
  for (const face of faces) doc.fonts.add(face);
  receiptFontSources.forEach((source, index) => {
    bytesByOrigin.set(cacheKey(origin, source.file), buffers[index]!);
  });
}

/** Bound both fetching and parsing; an unsuccessful preparation never poisons the cache. */
export async function installOwnedLabelFonts(doc: Document, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let stopWaiting = () => undefined as void;
  const interrupted = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(signal?.aborted ? aborted(signal) : fontFailure());
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    stopWaiting = () => controller.signal.removeEventListener("abort", rejectAbort);
  });
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    await Promise.race([loadLabelFonts(doc, controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    stopWaiting();
    signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
