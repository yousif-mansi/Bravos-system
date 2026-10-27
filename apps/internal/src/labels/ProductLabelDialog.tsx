import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { accountGeneration, subscribeAccount } from "../account-session.ts";
import {
  LabelPrintError,
  mountProductLabelPreview,
  planLabelLayout,
  printProductLabels,
  type ProductLabelSettings,
} from "./index.ts";
import "./product-label.css";

const DEVICE_PREFS_KEY = "bravos.product-label.device";
const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type LabelProductFields = {
  id: string;
  code: string;
  nameAr: string;
};

type DevicePrefs = {
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300;
};

const FALLBACK_PREFS: DevicePrefs = { widthMm: 80, heightMm: 40, dpi: 203 };

function readDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(DEVICE_PREFS_KEY);
    if (!raw) return FALLBACK_PREFS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    const widthMm = Number(parsed.widthMm);
    const heightMm = Number(parsed.heightMm);
    const dpi = parsed.dpi === 300 ? 300 : parsed.dpi === 203 ? 203 : null;
    if (!inRange(widthMm, 40, 160) || !inRange(heightMm, 20, 100) || !dpi) return FALLBACK_PREFS;
    return { widthMm, heightMm, dpi };
  } catch {
    return FALLBACK_PREFS;
  }
}

function writeDevicePrefs(prefs: DevicePrefs) {
  try {
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify({
      widthMm: prefs.widthMm,
      heightMm: prefs.heightMm,
      dpi: prefs.dpi,
    }));
  } catch {
    // A full or blocked store must not stop printing.
  }
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function parseWhole(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : null;
}

function decimalSeparator(): string {
  const part = new Intl.NumberFormat(undefined).formatToParts(1.1).find((item) => item.type === "decimal");
  return part?.value === "," ? "," : ".";
}

/** Finite positive millimetres, at most two decimal places. Copies stay integers. */
function parseDimension(raw: string): number | null {
  const trimmed = raw.trim();
  const separator = decimalSeparator();
  const normalized = separator === "," && trimmed.includes(",") && !trimmed.includes(".")
    ? trimmed.replace(",", ".")
    : trimmed;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function messageFrom(error: unknown): string {
  if (error instanceof LabelPrintError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof Error && error.name === "AbortError") return "";
  if (error instanceof Error && error.message) return error.message;
  return "تعذرت طباعة الملصق. إلغاء نافذة الطباعة لا يغيّر المنتج.";
}

export function ProductLabelDialog({
  product,
  onClose,
}: {
  product: LabelProductFields;
  onClose: () => void;
}) {
  const titleId = useId();
  const widthId = useId();
  const heightId = useId();
  const copiesId = useId();
  const dpiId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const sizeDetailsRef = useRef<HTMLDetailsElement>(null);
  const printAbortRef = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  const productRef = useRef(product);
  onCloseRef.current = onClose;
  const initial = useMemo(readDevicePrefs, []);
  const [widthRaw, setWidthRaw] = useState(String(initial.widthMm));
  const [heightRaw, setHeightRaw] = useState(String(initial.heightMm));
  const [copiesRaw, setCopiesRaw] = useState("1");
  const [dpi, setDpi] = useState<203 | 300>(initial.dpi);
  const [previewTick, setPreviewTick] = useState(0);
  const [previewPhase, setPreviewPhase] = useState<"loading" | "ready" | "error">("loading");
  const [previewError, setPreviewError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const [printStatus, setPrintStatus] = useState("");

  const widthMm = parseDimension(widthRaw);
  const heightMm = parseDimension(heightRaw);
  const copies = parseWhole(copiesRaw);
  const widthValid = widthMm !== null && inRange(widthMm, 40, 160);
  const heightValid = heightMm !== null && inRange(heightMm, 20, 100);
  const copiesValid = copies !== null && copies >= 1 && copies <= 100;
  const deviceValid = widthValid && heightValid;

  const previewLayout = useMemo(() => {
    if (!widthValid || !heightValid || widthMm === null || heightMm === null) {
      return { ok: false as const, message: "إعدادات الملصق غير صالحة." };
    }
    const settings: ProductLabelSettings = { widthMm, heightMm, copies: 1, dpi };
    try {
      planLabelLayout(productRef.current, settings);
    } catch (error) {
      return { ok: false as const, message: messageFrom(error) || "إعدادات الملصق غير صالحة." };
    }
    return { ok: true as const, settings, message: "" };
  }, [widthMm, heightMm, dpi, widthValid, heightValid]);

  const printSettings: ProductLabelSettings | null = previewLayout.ok && copiesValid && copies !== null
    ? { ...previewLayout.settings, copies }
    : null;
  const settingsMessage = !previewLayout.ok
    ? previewLayout.message
    : !copiesValid
      ? "إعدادات الملصق غير صالحة."
      : "";

  const activePreviewError = previewPhase === "error" ? previewError : "";
  const geometryError = (!previewLayout.ok && (previewLayout.message.includes("عرض") || previewLayout.message.includes("ارتفاع")))
    || activePreviewError.includes("عرض")
    || activePreviewError.includes("ارتفاع");

  useEffect(() => {
    if (!geometryError || !sizeDetailsRef.current) return;
    sizeDetailsRef.current.open = true;
  }, [geometryError]);

  useEffect(() => {
    if (!deviceValid || widthMm === null || heightMm === null) return;
    writeDevicePrefs({ widthMm, heightMm, dpi });
  }, [deviceValid, widthMm, heightMm, dpi]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("h2")?.focus();
    return () => {
      printAbortRef.current?.abort();
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => subscribeAccount(() => {
    printAbortRef.current?.abort();
    onCloseRef.current();
  }), []);

  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!previewLayout.ok) {
      setPreviewPhase("error");
      return;
    }
    const generation = accountGeneration();
    const bound = productRef.current;
    const settings = previewLayout.settings;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setPreviewPhase("loading");
    setPreviewError("");
    void mountProductLabelPreview(host, bound, settings)
      .then((dispose) => {
        if (disposed || accountGeneration() !== generation) {
          dispose();
          return;
        }
        cleanup = dispose;
        setPreviewPhase("ready");
      })
      .catch((error) => {
        if (disposed || accountGeneration() !== generation) return;
        host.replaceChildren();
        setPreviewPhase("error");
        setPreviewError(messageFrom(error) || "تعذر عرض معاينة الملصق.");
      });
    return () => {
      disposed = true;
      cleanup?.();
      host.replaceChildren();
    };
  }, [previewLayout, previewTick]);

  function close() {
    printAbortRef.current?.abort();
    onClose();
  }

  function trapTab(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => !element.hidden);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function onPrint() {
    if (!printSettings || printing || previewPhase !== "ready") return;
    const generation = accountGeneration();
    const settings = printSettings;
    const controller = new AbortController();
    printAbortRef.current = controller;
    setPrinting(true);
    setPrintError("");
    setPrintStatus("");
    try {
      const result = await printProductLabels(productRef.current, settings, controller.signal, dialogRef.current);
      if (controller.signal.aborted || accountGeneration() !== generation) return;
      if (result.dialogRequested) setPrintStatus("تم طلب طباعة الملصقات.");
    } catch (error) {
      if (controller.signal.aborted || accountGeneration() !== generation) return;
      const text = messageFrom(error);
      if (text) setPrintError(text);
    } finally {
      if (printAbortRef.current === controller) printAbortRef.current = null;
      if (!controller.signal.aborted && accountGeneration() === generation) setPrinting(false);
    }
  }

  const widthRejected = !widthValid
    || (!previewLayout.ok && previewLayout.message.includes("عرض"))
    || activePreviewError.includes("عرض");
  const heightRejected = !heightValid
    || (!previewLayout.ok && previewLayout.message.includes("ارتفاع"))
    || activePreviewError.includes("ارتفاع");
  const printDisabled = printSettings === null || printing || previewPhase !== "ready";
  const fieldsLocked = printing;

  const dialog = (
    <dialog
      ref={dialogRef}
      className="product-label-dialog"
      data-testid="product-label-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={trapTab}
    >
      <h2 id={titleId} tabIndex={-1}>ملصق المنتج</h2>
      <div className="product-label-identity">
        <p><strong>{product.nameAr}</strong></p>
        <p className="muted">رمز المنتج: {product.code}</p>
      </div>
      <div
        className="product-label-preview"
        data-testid="product-label-preview"
        aria-busy={previewLayout.ok && previewPhase === "loading"}
      >
        {previewLayout.ok && previewPhase === "loading" ? <p>جارٍ تجهيز المعاينة…</p> : null}
        <div ref={previewRef} className="product-label-preview-host" />
      </div>
      {settingsMessage ? <div className="error" role="alert">{settingsMessage}</div> : null}
      {previewPhase === "error" && previewLayout.ok ? (
        <div className="error" role="alert">
          <p>{previewError}</p>
          <button type="button" className="secondary" onClick={() => setPreviewTick((value) => value + 1)}>إعادة المحاولة</button>
        </div>
      ) : null}
      <fieldset className="product-label-fields" disabled={fieldsLocked}>
      <div className="field">
        <label htmlFor={copiesId}>عدد النسخ</label>
        <input
          id={copiesId}
          inputMode="numeric"
          autoComplete="off"
          value={copiesRaw}
          aria-invalid={!copiesValid}
          disabled={fieldsLocked}
          onChange={(event) => setCopiesRaw(event.target.value)}
        />
      </div>
      <details ref={sizeDetailsRef} className="product-label-size" data-invalid={widthRejected || heightRejected}>
        <summary>مقاس الملصق</summary>
        <p className="muted product-label-note">المقاس الافتراضي مؤقت ويمكن تعديله ليطابق طابعة الملصقات.</p>
        <div className="field">
          <label htmlFor={widthId}>العرض بالملليمتر</label>
          <input
            id={widthId}
            inputMode="decimal"
            autoComplete="off"
            value={widthRaw}
            aria-invalid={widthRejected}
            disabled={fieldsLocked}
            onChange={(event) => setWidthRaw(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={heightId}>الارتفاع بالملليمتر</label>
          <input
            id={heightId}
            inputMode="decimal"
            autoComplete="off"
            value={heightRaw}
            aria-invalid={heightRejected}
            disabled={fieldsLocked}
            onChange={(event) => setHeightRaw(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={dpiId}>كثافة الطباعة</label>
          <select
            id={dpiId}
            value={String(dpi)}
            aria-invalid={false}
            disabled={fieldsLocked}
            onChange={(event) => setDpi(event.target.value === "300" ? 300 : 203)}
          >
            <option value="203">203</option>
            <option value="300">300</option>
          </select>
        </div>
      </details>
      </fieldset>
      <p className="muted product-label-note">اختر طابعة الملصقات والمقاس المطابق في نافذة الطباعة، وبنسبة 100٪.</p>
      {printError ? <div className="error" role="alert">{printError}</div> : null}
      {printStatus ? <div className="notice" role="status">{printStatus}</div> : null}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={close}>إلغاء</button>
        <button
          type="button"
          data-testid="product-label-print"
          disabled={printDisabled}
          onClick={() => void onPrint()}
        >
          {printing ? "جارٍ تجهيز الملصقات…" : "طباعة الملصقات"}
        </button>
      </div>
    </dialog>
  );

  return createPortal(dialog, document.body);
}
