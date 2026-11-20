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

/** Cairo subset files and the unicode ranges shared by label and receipt documents. */
export const cairoFontSources: readonly { readonly file: string; readonly unicodeRange: string }[] = FONT_FILES.map(
  ([file, unicodeRange]) => ({ file, unicodeRange }),
);

/** Successful WOFF2 bytes only. Keyed by page origin so a warmed print document can be prepared offline. */
const bytesByOrigin = new Map<string, ArrayBuffer>();

function cacheKey(origin: string, file: string): string {
  return `${origin}\n${file}`;
}

function isWoff2(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  const magic = new Uint8Array(bytes, 0, 4);
  return magic[0] === 0x77 && magic[1] === 0x4f && magic[2] === 0x46 && magic[3] === 0x32;
}

function fontFailure(): Error {
  return new Error("Unable to load the bundled Cairo font");
}

function aborted(signal: AbortSignal): DOMException {
  if (signal.reason instanceof DOMException && signal.reason.name === "AbortError") return signal.reason;
  return new DOMException("أُلغيت الطباعة.", "AbortError");
}

/** Drops URL-backed @font-face rules from this print document only. */
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
    response = await fetch(new URL(`/fonts/${file}`, origin), { signal, cache: navigator.onLine ? "default" : "force-cache" });
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
 * installs loaded FontFace values into the owned print document.
 */
async function loadFonts(doc: Document, weights: readonly string[], signal: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted(signal);
  if (!doc.fonts || typeof FontFace === "undefined") throw fontFailure();

  const origin = window.location.origin;
  const buffers = await Promise.all(cairoFontSources.map((source) => subsetBytes(origin, source.file, signal)));

  const faces: FontFace[] = [];
  try {
    for (const weight of weights) {
      cairoFontSources.forEach((source, index) => {
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
  removeCssFontFaces(doc);
  for (const face of faces) doc.fonts.add(face);
  cairoFontSources.forEach((source, index) => {
    bytesByOrigin.set(cacheKey(origin, source.file), buffers[index]!);
  });
}

/** Bound both fetching and parsing; an unsuccessful preparation never poisons the cache. */
export async function installOwnedCairoFonts(doc: Document, weights: readonly string[], signal?: AbortSignal): Promise<void> {
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
    await Promise.race([loadFonts(doc, weights, controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    stopWaiting();
    signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
