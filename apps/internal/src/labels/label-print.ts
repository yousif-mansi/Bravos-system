import { claimBrowserPrint, releaseBrowserPrint } from "../printing/browser-print-lock.ts";
import { LabelPrintError, planLabelLayout, type LabelLayout, type LabelProduct, type ProductLabelSettings } from "./barcode.ts";
import { fitAndValidateLabelDocument, renderLabelDocument } from "./label-document.ts";
import { installOwnedLabelFonts } from "./label-fonts.ts";

/**
 * Dialog-only label printing. A return never means the label printer succeeded.
 * Windows print() blocks until the dialog closes. Other hosts wait for afterprint.
 * The iframe stays through that call, then a short grace, then removal.
 */
const IFRAME_LOAD_MS = 5000;
const FONT_TIMEOUT_MS = 4000;
const DIALOG_WATCH_MS = 120_000;
const FRAME_GRACE_MS = 500;
const BLOCKING_PRINT_MS = 300;

const FONT_PROBE = "400 16px Cairo";
const FONT_PROBE_BOLD = "700 16px Cairo";
const ARABIC_SAMPLE = "ملصق";
const LATIN_SAMPLE = "BRAVOS";

export type LabelPrintResult = {
  dialogRequested: true;
  dialogReturned: boolean;
};

type PrintJob = {
  iframe: HTMLIFrameElement;
};

function fail(message: string): LabelPrintError {
  return new LabelPrintError(message);
}

function fontBaseUrl(): string {
  return window.location.origin;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("أُلغيت طباعة الملصق.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(resolve, reject);
  }).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function waitForFonts(doc: Document): Promise<void> {
  const fonts = doc.fonts;
  if (!fonts) throw fail("تعذر تجهيز خط الملصق.");
  const ready = (async () => {
    const loads = Promise.all([
      fonts.load(FONT_PROBE, ARABIC_SAMPLE),
      fonts.load(FONT_PROBE, LATIN_SAMPLE),
      fonts.load(FONT_PROBE_BOLD, ARABIC_SAMPLE),
    ]);
    await Promise.all([fonts.ready, loads]);
    if (!fonts.check(FONT_PROBE, ARABIC_SAMPLE) || !fonts.check(FONT_PROBE, LATIN_SAMPLE) || !fonts.check(FONT_PROBE_BOLD, ARABIC_SAMPLE)) {
      throw new Error("font-missing");
    }
  })();
  try {
    await withTimeout(ready, FONT_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof LabelPrintError) throw error;
    throw fail("تعذر تجهيز خط الملصق.");
  }
}

function openFrame(
  title: string,
  host: HTMLElement,
  presentation: "print" | "preview",
  layout: LabelLayout,
  signal?: AbortSignal,
): Promise<PrintJob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.border = "0";
  if (presentation === "print") {
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = `${layout.settings.widthMm}mm`;
    iframe.style.height = `${layout.settings.heightMm}mm`;
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
  } else {
    iframe.style.width = "100%";
    iframe.style.minHeight = `${layout.settings.heightMm}mm`;
    iframe.style.background = "#fff";
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopWatching = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort && signal) signal.removeEventListener("abort", onAbort);
  };
  const drop = () => {
    stopWatching();
    iframe.remove();
  };

  return new Promise((resolve, reject) => {
    const failLoad = () => {
      drop();
      reject(fail("تعذر فتح صفحة الملصق."));
    };
    onAbort = () => {
      drop();
      reject(abortError(signal!));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(failLoad, IFRAME_LOAD_MS);
    iframe.addEventListener("error", failLoad, { once: true });
    iframe.addEventListener(
      "load",
      () => {
        stopWatching();
        if (signal?.aborted) {
          iframe.remove();
          reject(abortError(signal));
          return;
        }
        if (!iframe.contentDocument) {
          failLoad();
          return;
        }
        resolve({ iframe });
      },
      { once: true },
    );
    host.appendChild(iframe);
    iframe.src = "about:blank";
  });
}

function fill(job: PrintJob, layout: LabelLayout): Window {
  const doc = job.iframe.contentDocument;
  const printWindow = job.iframe.contentWindow;
  if (!doc || !printWindow) {
    throw fail("تعذر فتح صفحة الملصق.");
  }
  doc.open();
  doc.write("<!DOCTYPE html><html><head></head><body></body></html>");
  doc.close();
  renderLabelDocument(doc, layout, fontBaseUrl());
  return printWindow;
}

function whenAborted(signal: AbortSignal): { promise: Promise<never>; cancel: () => void } {
  let onAbort = () => undefined as void;
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, cancel: () => signal.removeEventListener("abort", onAbort) };
}

async function awaitDialog(printWindow: Window): Promise<boolean> {
  let afterPrint = false;
  const onAfterPrint = () => {
    afterPrint = true;
  };
  printWindow.addEventListener("afterprint", onAfterPrint);
  const started = performance.now();
  try {
    printWindow.focus();
    printWindow.print();
  } catch {
    printWindow.removeEventListener("afterprint", onAfterPrint);
    throw fail("لم تُفتح نافذة الطباعة.");
  }

  const blocking = afterPrint || performance.now() - started >= BLOCKING_PRINT_MS;
  if (blocking) {
    printWindow.removeEventListener("afterprint", onAfterPrint);
    return true;
  }

  const watched = await new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (returned: boolean) => {
      if (timer !== undefined) clearTimeout(timer);
      printWindow.removeEventListener("afterprint", onLate);
      resolve(returned);
    };
    const onLate = () => finish(true);
    printWindow.addEventListener("afterprint", onLate);
    timer = setTimeout(() => finish(false), DIALOG_WATCH_MS);
    if (afterPrint) finish(true);
  });
  printWindow.removeEventListener("afterprint", onAfterPrint);
  return watched;
}

/**
 * Prints one product label per page for settings.copies.
 * The native dialog chooses the printer. Paper success is not reported.
 */
export async function printProductLabels(
  product: LabelProduct,
  settings: ProductLabelSettings,
  signal?: AbortSignal,
  host?: HTMLElement | null,
): Promise<LabelPrintResult> {
  throwIfAborted(signal);
  const layout = planLabelLayout(product, settings);
  throwIfAborted(signal);
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw fail("الطباعة متاحة من شاشة المتصفح فقط.");
  }

  let token: symbol;
  try {
    token = claimBrowserPrint();
  } catch {
    throw fail("نافذة طباعة مفتوحة. أغلقها ثم أعد المحاولة.");
  }

  let job: PrintJob | null = null;
  let dialogStarted = false;
  try {
    job = await openFrame("ملصق المنتج", host ?? document.body, "print", layout, signal);
    throwIfAborted(signal);
    const printWindow = fill(job, layout);
    if (typeof printWindow.print !== "function") {
      throw fail("هذا المتصفح لا يطبع الملصق من الصفحة الداخلية.");
    }
    const fontsReady = installOwnedLabelFonts(printWindow.document, signal).then(() => waitForFonts(printWindow.document));
    const abortWait = signal ? whenAborted(signal) : null;
    try {
      if (abortWait) await Promise.race([fontsReady, abortWait.promise]);
      else await fontsReady;
    } finally {
      abortWait?.cancel();
    }
    throwIfAborted(signal);
    fitAndValidateLabelDocument(printWindow.document, layout);
    throwIfAborted(signal);
    dialogStarted = true;
    const dialogReturned = await awaitDialog(printWindow);
    await delay(FRAME_GRACE_MS);
    return { dialogRequested: true, dialogReturned };
  } catch (error) {
    if (dialogStarted) {
      await delay(FRAME_GRACE_MS);
    }
    if (error instanceof LabelPrintError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    if (signal?.aborted) throw abortError(signal);
    throw fail("تعذرت طباعة الملصق. إلغاء نافذة الطباعة لا يغيّر المنتج.");
  } finally {
    job?.iframe.remove();
    releaseBrowserPrint(token);
  }
}

/** Same label document, without opening the print dialog. */
export async function mountProductLabelPreview(
  host: HTMLElement,
  product: LabelProduct,
  settings: ProductLabelSettings,
): Promise<() => void> {
  const layout = planLabelLayout(product, settings);
  let job: PrintJob | null = null;
  try {
    job = await openFrame("معاينة الملصق", host, "preview", layout);
    fill(job, layout);
    const previewDocument = job.iframe.contentDocument;
    if (!previewDocument) throw fail("تعذر عرض معاينة الملصق.");
    await installOwnedLabelFonts(previewDocument);
    await waitForFonts(previewDocument);
    fitAndValidateLabelDocument(previewDocument, layout);
    const frame = job.iframe;
    return () => frame.remove();
  } catch (error) {
    job?.iframe.remove();
    if (error instanceof LabelPrintError) throw error;
    throw fail("تعذر عرض معاينة الملصق.");
  }
}
