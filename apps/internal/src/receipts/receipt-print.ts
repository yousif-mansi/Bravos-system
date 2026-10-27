import type { SaleDto } from "@bravos/contracts";
import { claimBrowserPrint, releaseBrowserPrint } from "../printing/browser-print-lock.ts";
import { resolveReceiptOptions } from "./receipt-options.ts";
import { buildReceiptView, isCompletedSale, type ReceiptOptions } from "./receipt-model.ts";
import { renderReceiptDocument } from "./receipt-document.ts";

/**
 * Print lifecycle (dialog only; paper success is never claimed):
 * 1. Open a same-origin iframe within IFRAME_LOAD_MS, or fail and remove it.
 * 2. Wait up to FONT_TIMEOUT_MS until Cairo covers Arabic, Latin, and bold.
 * 3. Call the iframe's print(), never the parent window.
 *    On Windows, print() blocks until the dialog is closed or cancelled.
 *    A blocking return, or afterprint, means the dialog returned.
 *    A non-blocking return waits up to DIALOG_WATCH_MS for afterprint.
 * 4. Keep the iframe through that call. Remove it only after a short grace,
 *    or when the watch bound ends, and always clear the in-flight lock.
 *    Cancelling the dialog does not fail the sale.
 */
const IFRAME_LOAD_MS = 5000;
const FONT_TIMEOUT_MS = 4000;
const DIALOG_WATCH_MS = 120_000;
const FRAME_GRACE_MS = 500;
const BLOCKING_PRINT_MS = 300;

const FONT_PROBE = "400 16px Cairo";
const FONT_PROBE_BOLD = "700 16px Cairo";
const ARABIC_SAMPLE = "إيصال";
const LATIN_SAMPLE = "BRAVOS";

export class ReceiptPrintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptPrintError";
  }
}

/** Browser dialog lifecycle. Neither flag means paper was printed. */
export type ReceiptPrintResult = {
  dialogRequested: true;
  dialogReturned: boolean;
};

type PrintJob = {
  iframe: HTMLIFrameElement;
};

let active: PrintJob | null = null;
let printing = false;
let cancelPreparation = false;

function unavailable(message: string): ReceiptPrintError {
  return new ReceiptPrintError(message);
}

function fontBaseUrl(): string {
  return window.location.origin;
}

function removeJob(job: PrintJob | null): void {
  if (!job) return;
  job.iframe.remove();
  if (active === job) active = null;
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("timeout"));
    }, ms);
    work.then(resolve, reject);
  }).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function waitForFonts(doc: Document): Promise<void> {
  const fonts = doc.fonts;
  if (!fonts) {
    throw unavailable("تعذر تجهيز خط الإيصال. البيع مكتمل. أعد طباعة الإيصال.");
  }
  const ready = (async () => {
    await fonts.ready;
    await fonts.load(FONT_PROBE, ARABIC_SAMPLE);
    await fonts.load(FONT_PROBE, LATIN_SAMPLE);
    await fonts.load(FONT_PROBE_BOLD, ARABIC_SAMPLE);
    await fonts.load(FONT_PROBE_BOLD, "الإجمالي");
    const arabic = fonts.check(FONT_PROBE, ARABIC_SAMPLE);
    const latin = fonts.check(FONT_PROBE, LATIN_SAMPLE);
    const bold = fonts.check(FONT_PROBE_BOLD, ARABIC_SAMPLE);
    if (!arabic || !latin || !bold) {
      throw new Error("font-missing");
    }
  })();
  try {
    await withTimeout(ready, FONT_TIMEOUT_MS, () => undefined);
  } catch {
    throw unavailable("تعذر تجهيز خط الإيصال. البيع مكتمل. أعد طباعة الإيصال.");
  }
}

function openFrame(title: string, host: HTMLElement, presentation: "print" | "preview"): Promise<PrintJob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  if (presentation === "print") {
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "80mm";
    iframe.style.height = "400px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
  } else {
    iframe.style.width = "100%";
    iframe.style.minHeight = "120mm";
    iframe.style.background = "#fff";
  }
  iframe.style.border = "0";

  let timer: ReturnType<typeof setTimeout> | undefined;
  const drop = () => {
    if (timer !== undefined) clearTimeout(timer);
    iframe.remove();
  };

  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      drop();
      reject(unavailable(message));
    };
    timer = setTimeout(() => fail("تعذر فتح صفحة الإيصال. البيع مكتمل. أعد المحاولة."), IFRAME_LOAD_MS);
    iframe.addEventListener("error", () => fail("تعذر فتح صفحة الإيصال. البيع مكتمل. أعد المحاولة."), { once: true });
    iframe.addEventListener(
      "load",
      () => {
        if (timer !== undefined) clearTimeout(timer);
        if (!iframe.contentDocument) {
          fail("تعذر فتح صفحة الإيصال. البيع مكتمل. أعد المحاولة.");
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

function fill(job: PrintJob, sale: SaleDto, overrides?: Partial<ReceiptOptions>): Window {
  const doc = job.iframe.contentDocument;
  const printWindow = job.iframe.contentWindow;
  if (!doc || !printWindow || typeof printWindow.print !== "function") {
    throw unavailable("هذا المتصفح لا يطبع الإيصال من الصفحة الداخلية. البيع مكتمل. أعد المحاولة.");
  }
  doc.open();
  doc.write("<!DOCTYPE html><html><head></head><body></body></html>");
  doc.close();
  renderReceiptDocument(doc, buildReceiptView(sale, resolveReceiptOptions(overrides)), fontBaseUrl());
  return printWindow;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    throw unavailable("لم تُفتح نافذة الطباعة. البيع مكتمل. أعد طباعة الإيصال.");
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
 * Prints one completed sale through a same-origin iframe.
 * A second call is rejected until this call settles.
 * Call releaseReceiptPrintResources if the host unmounts during preparation.
 */
export async function printSaleReceipt(
  sale: SaleDto,
  overrides?: Partial<ReceiptOptions>,
): Promise<ReceiptPrintResult> {
  if (printing) {
    throw unavailable("نافذة طباعة الإيصال مفتوحة. أغلقها ثم أعد المحاولة.");
  }
  if (!isCompletedSale(sale)) {
    throw unavailable("لا يمكن طباعة إيصال قبل اكتمال البيع.");
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw unavailable("الطباعة متاحة من شاشة نقطة البيع في المتصفح فقط.");
  }

  let printToken: symbol;
  try {
    printToken = claimBrowserPrint();
  } catch {
    throw unavailable("نافذة طباعة الإيصال مفتوحة. أغلقها ثم أعد المحاولة.");
  }
  printing = true;
  cancelPreparation = false;
  let job: PrintJob | null = null;
  try {
    if (active) removeJob(active);
    job = await openFrame("إيصال الطباعة", document.body, "print");
    active = job;
    if (cancelPreparation) {
      throw unavailable("أُلغيت طباعة الإيصال قبل فتح النافذة. البيع مكتمل.");
    }
    const printWindow = fill(job, sale, overrides);
    await waitForFonts(printWindow.document);
    if (cancelPreparation) {
      throw unavailable("أُلغيت طباعة الإيصال قبل فتح النافذة. البيع مكتمل.");
    }
    const dialogReturned = await awaitDialog(printWindow);
    await delay(FRAME_GRACE_MS);
    return { dialogRequested: true, dialogReturned };
  } catch (error) {
    if (error instanceof ReceiptPrintError) throw error;
    throw unavailable("تعذرت طباعة الإيصال. البيع مكتمل. إلغاء نافذة الطباعة لا يلغي البيع.");
  } finally {
    removeJob(job);
    printing = false;
    releaseBrowserPrint(printToken);
  }
}

/**
 * Drops a frame that is not inside print().
 * During preparation the in-flight call stops before print() and removes the frame.
 * After print() has been entered, the frame stays until the dialog lifecycle ends.
 */
export function releaseReceiptPrintResources(): void {
  cancelPreparation = true;
  if (!printing && active) removeJob(active);
}

/** Same receipt document, without opening the print dialog. */
export async function mountReceiptPreview(
  host: HTMLElement,
  sale: SaleDto,
  overrides?: Partial<ReceiptOptions>,
): Promise<() => void> {
  if (!isCompletedSale(sale)) {
    throw unavailable("لا يمكن عرض إيصال بيع غير مكتمل.");
  }
  let job: PrintJob | null = null;
  try {
    job = await openFrame("معاينة الإيصال", host, "preview");
    fill(job, sale, overrides);
    const frame = job.iframe;
    return () => frame.remove();
  } catch (error) {
    removeJob(job);
    if (error instanceof ReceiptPrintError) throw error;
    throw unavailable("تعذر عرض معاينة الإيصال.");
  }
}
