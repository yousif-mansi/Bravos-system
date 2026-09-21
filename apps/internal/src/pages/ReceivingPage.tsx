import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  ManagerProductDto,
  ReceiptDto,
  WorkspaceDto,
} from "@bravos/contracts";
import {
  ApiError,
  correctReceipt,
  finalizeReceipt,
  getInventorySettings,
  listBatches,
  listLowStock,
  listProducts,
  listReceipts,
  lookupReceivingOperation,
  setVariantLowStockThreshold,
  updateInventorySettings,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";

import {
  assignPendingReceive,
  clearPendingReceive,
  digestReceivePayload,
  loadPendingReceive,
  pendingStorageKey,
  savePendingReceive,
  withPendingMarkerLock,
  type PendingReceive,
  type ReceivePayloadLines,
} from "../receiving-pending.ts";

type DraftLine = {
  key: string;
  productId: string;
  variantId: string;
  quantity: string;
  costEgp: string;
};

type CorrectionDraftLine = {
  lineId: string;
  label: string;
  quantity: string;
  costEgp: string;
};

type CorrectionPayload = {
  receiptId: string;
  expectedRevision: number;
  reason: string;
  lines: Array<{ lineId: string; quantity: number; unitCostPiasters: number }>;
};

async function digestCorrectionPayload(input: CorrectionPayload): Promise<string> {
  const canonical = JSON.stringify({
    receiptId: input.receiptId,
    expectedRevision: input.expectedRevision,
    reason: input.reason.trim(),
    lines: [...input.lines].sort((left, right) => left.lineId.localeCompare(right.lineId)),
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), productId: "", variantId: "", quantity: "", costEgp: "" };
}

function todayCairoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function ReceivingPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [batches, setBatches] = useState<InventoryBatchDto[]>([]);
  const [lowStock, setLowStock] = useState<LowStockVariantDto[]>([]);
  const [settings, setSettings] = useState<InventorySettingsDto | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [receiptDate, setReceiptDate] = useState(todayCairoDate);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [thresholdInput, setThresholdInput] = useState("3");
  const [overrideVariantId, setOverrideVariantId] = useState("");
  const [overrideThreshold, setOverrideThreshold] = useState("");
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionLines, setCorrectionLines] = useState<CorrectionDraftLine[]>([]);
  const [correctionRetryReady, setCorrectionRetryReady] = useState(false);
  const [pendingReceive, setPendingReceive] = useState<PendingReceive | null>(null);
  const [frozenPayload, setFrozenPayload] = useState<{
    receiptDate: string;
    lines: ReceivePayloadLines;
  } | null>(null);
  const inFlightRef = useRef(false);
  const pendingReceiveRef = useRef<PendingReceive | null>(null);
  const frozenPayloadRef = useRef<{
    receiptDate: string;
    lines: ReceivePayloadLines;
  } | null>(null);
  const correctionAttemptRef = useRef<{ digest: string; operationId: string } | null>(null);
  const correctionInFlightRef = useRef(false);

  async function refresh() {
    const [nextProducts, nextReceipts, nextBatches, nextLowStock, nextSettings] = await Promise.all([
      listProducts(),
      listReceipts(),
      listBatches(),
      listLowStock(),
      getInventorySettings(),
    ]);
    setProducts(nextProducts);
    setReceipts(nextReceipts);
    setBatches(nextBatches);
    setLowStock(nextLowStock);
    setSettings(nextSettings);
    setThresholdInput(String(nextSettings.lowStockThreshold));
  }

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الاستلام.");
    });
  }, []);

  useEffect(() => {
    const stored = loadPendingReceive(workspace.staff.id);
    if (!stored) {
      return;
    }
    pendingReceiveRef.current = stored;
    setPendingReceive(stored);
    let cancelled = false;
    inFlightRef.current = true;
    setPending("check");
    lookupReceivingOperation(stored.operationId)
      .then((found) => {
        if (cancelled) {
          return;
        }
        if (found) {
          return acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
        }
        if (stored.phase === "uncertain") {
          setError("لم يُؤكد الحفظ بعد. أدخل البيانات نفسها ثم أعد المحاولة أو تحقق لاحقاً. لا تبدأ إذناً جديداً.");
        } else {
          setError("لم تُقبل العملية. صحّح البيانات وأعد المحاولة دون بدء إذن جديد.");
        }
        return undefined;
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من عملية الاستلام.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          inFlightRef.current = false;
          setPending("");
        }
      });
    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== pendingStorageKey(workspace.staff.id)) {
        return;
      }
      if (pendingReceiveRef.current) {
        return;
      }
      const stored = loadPendingReceive(workspace.staff.id);
      pendingReceiveRef.current = stored;
      setPendingReceive(stored);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  const selectedReceipt = receipts.find((item) => item.id === selectedReceiptId) ?? receipts[0] ?? null;
  const formLocked = pendingReceive?.phase === "uncertain" && frozenPayload !== null;

  const variantOptions = useMemo(() => {
    return products.flatMap((product) =>
      product.variants.map((variant) => ({
        product,
        variant,
        label: `${product.code} — ${product.nameAr} / ${variant.size.nameAr} / ${variant.color.nameAr}`,
      })),
    );
  }, [products]);

  function parseDraftLines(): ReceivePayloadLines | null {
    const parsed: ReceivePayloadLines = [];
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitCostPiasters = egpInputToPiasters(line.costEgp);
      if (!line.variantId) {
        setError("يجب تحديد المتغير لكل صنف.");
        return null;
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        setError("الكمية غير صالحة.");
        return null;
      }
      if (unitCostPiasters === null) {
        setError("تكلفة الشراء غير صالحة.");
        return null;
      }
      parsed.push({ variantId: line.variantId, quantity, unitCostPiasters });
    }
    return parsed;
  }

  async function acceptReceipt(receipt: ReceiptDto, messageAr: string) {
    await withPendingMarkerLock(workspace.staff.id, () => {
      clearPendingReceive(workspace.staff.id, receipt.operationId);
    });
    pendingReceiveRef.current = null;
    frozenPayloadRef.current = null;
    setPendingReceive(null);
    setFrozenPayload(null);
    setNotice(messageAr);
    setError("");
    setLines([emptyLine()]);
    setSelectedReceiptId(receipt.id);
    await refresh();
  }

  async function submitPayload(payload: { receiptDate: string; lines: ReceivePayloadLines }) {
    let digest: string;
    try {
      digest = await digestReceivePayload(payload);
    } catch {
      setError("تعذر تجهيز عملية الاستلام.");
      return;
    }
    let assignment: Awaited<ReturnType<typeof assignPendingReceive>>;
    try {
      assignment = await withPendingMarkerLock(workspace.staff.id, () =>
        assignPendingReceive({
          staffId: workspace.staff.id,
          digest,
          localOperationId: pendingReceiveRef.current?.operationId ?? null,
        }),
      );
    } catch {
      setError("تعذر حفظ معرّف العملية.");
      return;
    }
    if (assignment.kind === "blocked") {
      if (pendingReceiveRef.current && frozenPayloadRef.current) {
        setError("يجب إدخال نفس بيانات العملية غير المؤكدة.");
        return;
      }
      pendingReceiveRef.current = assignment.pending;
      setPendingReceive(assignment.pending);
      frozenPayloadRef.current = null;
      setFrozenPayload(null);
      setError("توجد عملية استلام غير مؤكدة. تحقق من نتيجتها قبل بدء إذن جديد.");
      return;
    }
    const nextPending = assignment.pending;
    pendingReceiveRef.current = nextPending;
    setPendingReceive(nextPending);
    frozenPayloadRef.current = payload;
    setFrozenPayload(payload);
    try {
      const created = await finalizeReceipt({
        operationId: nextPending.operationId,
        receiptDate: payload.receiptDate,
        lines: payload.lines,
      });
      await acceptReceipt(created, "تم حفظ إذن الاستلام.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        const found = await lookupReceivingOperation(nextPending.operationId);
        if (found) {
          await acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
          return;
        }
      }
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 404)) {
        const rejected: PendingReceive = {
          ...nextPending,
          phase: "rejected",
          digest: null,
        };
        await withPendingMarkerLock(workspace.staff.id, () => {
          const stored = loadPendingReceive(workspace.staff.id);
          if (stored && stored.operationId !== rejected.operationId) {
            return;
          }
          savePendingReceive(rejected);
        });
        pendingReceiveRef.current = rejected;
        frozenPayloadRef.current = null;
        setPendingReceive(rejected);
        setFrozenPayload(null);
        setError(caught.messageAr);
        return;
      }
      const uncertain: PendingReceive = { ...nextPending, phase: "uncertain", digest };
      await withPendingMarkerLock(workspace.staff.id, () => {
        const stored = loadPendingReceive(workspace.staff.id);
        if (stored && stored.operationId !== uncertain.operationId) {
          return;
        }
        savePendingReceive(uncertain);
      });
      pendingReceiveRef.current = uncertain;
      setPendingReceive(uncertain);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الاستلام.");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setPending("receive");
    setError("");
    setNotice("");
    try {
      const payload =
        frozenPayloadRef.current ??
        (pendingReceiveRef.current?.phase === "uncertain" && frozenPayload
          ? frozenPayload
          : (() => {
              const parsed = parseDraftLines();
              return parsed ? { receiptDate, lines: parsed } : null;
            })());
      if (!payload) {
        return;
      }
      await submitPayload(payload);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الاستلام.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function onCheckResult() {
    if (inFlightRef.current) {
      return;
    }
    const current = pendingReceiveRef.current;
    if (!current) {
      return;
    }
    inFlightRef.current = true;
    setPending("check");
    setError("");
    setNotice("");
    try {
      const found = await lookupReceivingOperation(current.operationId);
      if (found) {
        await acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
        return;
      }
      setError("لم يُؤكد الحفظ بعد. أعد المحاولة أو تحقق لاحقاً. لا تبدأ إذناً جديداً.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من عملية الاستلام.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function onSaveThreshold(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const lowStockThreshold = Number(thresholdInput);
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      setError("حد التنبيه غير صالح.");
      return;
    }
    setPending("settings");
    try {
      const updated = await updateInventorySettings(lowStockThreshold);
      setSettings(updated);
      setNotice("تم حفظ حد التنبيه.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ حد التنبيه.");
    } finally {
      setPending("");
    }
  }

  async function onSaveOverride(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!overrideVariantId) {
      setError("يجب تحديد المتغير لحد التنبيه.");
      return;
    }
    const trimmed = overrideThreshold.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError("حد التنبيه غير صالح.");
      return;
    }
    setPending("override");
    try {
      await setVariantLowStockThreshold(overrideVariantId, value);
      setNotice(value === null ? "تم حذف حد المتغير." : "تم حفظ حد المتغير.");
      setOverrideThreshold("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ حد المتغير.");
    } finally {
      setPending("");
    }
  }

  function beginCorrection() {
    if (!selectedReceipt) return;
    resetCorrectionAttempt();
    setCorrectionReason("");
    setCorrectionLines(selectedReceipt.lines.map((line) => ({
      lineId: line.id,
      label: `${line.variant.product.code} / ${line.variant.size.nameAr} / ${line.variant.color.nameAr}`,
      quantity: String(line.effectiveQuantity),
      costEgp: piastersToEgpInput(line.effectiveUnitCostPiasters),
    })));
    setEditingCorrection(true);
  }

  function resetCorrectionAttempt() {
    correctionAttemptRef.current = null;
    setCorrectionRetryReady(false);
  }

  async function onCorrectReceipt(event: FormEvent) {
    event.preventDefault();
    if (!selectedReceipt || correctionInFlightRef.current) return;
    const parsed = correctionLines.map((line) => ({
      lineId: line.lineId,
      quantity: Number(line.quantity),
      unitCostPiasters: egpInputToPiasters(line.costEgp),
    }));
    if (parsed.some((line) => !Number.isInteger(line.quantity) || line.quantity < 0)) {
      setError("الكمية الفعالة غير صالحة.");
      return;
    }
    if (parsed.some((line) => line.unitCostPiasters === null)) {
      setError("تكلفة الشراء الفعالة غير صالحة.");
      return;
    }
    correctionInFlightRef.current = true;
    try {
      const payload: CorrectionPayload = {
        receiptId: selectedReceipt.id,
        expectedRevision: selectedReceipt.correctionRevision,
        reason: correctionReason.trim(),
        lines: parsed.map((line) => ({
          lineId: line.lineId,
          quantity: line.quantity,
          unitCostPiasters: line.unitCostPiasters!,
        })),
      };
      const digest = await digestCorrectionPayload(payload);
      const attempt = correctionAttemptRef.current?.digest === digest
        ? correctionAttemptRef.current
        : { digest, operationId: crypto.randomUUID() };
      correctionAttemptRef.current = attempt;
      setPending("correction");
      setError("");
      setNotice("");
      await correctReceipt(selectedReceipt.id, {
        operationId: attempt.operationId,
        expectedRevision: payload.expectedRevision,
        reason: payload.reason,
        lines: payload.lines,
      });
      resetCorrectionAttempt();
      setEditingCorrection(false);
      setNotice("تم حفظ تصحيح إذن الاستلام.");
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        resetCorrectionAttempt();
      } else {
        setCorrectionRetryReady(true);
      }
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ تصحيح إذن الاستلام.");
    } finally {
      correctionInFlightRef.current = false;
      setPending("");
    }
  }

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>استلام المخزون</h1>
      </header>
      {typeof navigator !== "undefined" && !navigator.onLine ? (
        <div className="error" role="alert">استلام المخزون يتطلب اتصالاً.</div>
      ) : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <form className="card" aria-label="تسجيل إذن استلام" onSubmit={(event) => void onSubmit(event)}>
        <h2>{pendingReceive ? "عملية استلام غير مؤكدة" : "إذن استلام جديد"}</h2>
        {pendingReceive ? (
          <p className="muted" data-testid="pending-operation">
            معرّف العملية محفوظ لهذه الجلسة. التحقق من النتيجة يتم عبر الخادم ولا يبدأ إذناً جديداً.
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="receiptDate">تاريخ الاستلام</label>
          <input
            id="receiptDate"
            type="date"
            value={receiptDate}
            onChange={(event) => setReceiptDate(event.target.value)}
            required
            disabled={formLocked}
          />
        </div>
        {lines.map((line, index) => {
          const product = products.find((item) => item.id === line.productId);
          return (
            <div className="variant-row" key={line.key}>
              <div className="field">
                <label htmlFor={`product-${line.key}`}>المنتج</label>
                <select
                  id={`product-${line.key}`}
                  value={line.productId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, productId: event.target.value, variantId: "" };
                    setLines(next);
                  }}
                  disabled={formLocked}
                >
                  <option value="">اختر منتجاً</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>{item.code} — {item.nameAr}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`variant-${line.key}`}>المقاس واللون</label>
                <select
                  id={`variant-${line.key}`}
                  value={line.variantId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, variantId: event.target.value };
                    setLines(next);
                  }}
                  disabled={formLocked || !product}
                >
                  <option value="">اختر المتغير</option>
                  {product?.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.size.nameAr} / {variant.color.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`qty-${line.key}`}>الكمية</label>
                <input
                  id={`qty-${line.key}`}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, quantity: event.target.value };
                    setLines(next);
                  }}
                  required
                  disabled={formLocked}
                />
              </div>
              <div className="field">
                <label htmlFor={`cost-${line.key}`}>تكلفة الشراء للجنيه</label>
                <input
                  id={`cost-${line.key}`}
                  value={line.costEgp}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, costEgp: event.target.value };
                    setLines(next);
                  }}
                  required
                  disabled={formLocked}
                />
              </div>
              <button
                type="button"
                className="secondary"
                disabled={formLocked || lines.length <= 1}
                onClick={() => setLines(lines.filter((item) => item.key !== line.key))}
              >
                حذف الصنف
              </button>
            </div>
          );
        })}
        <div className="actions">
          <button type="button" className="secondary" disabled={formLocked} onClick={() => setLines([...lines, emptyLine()])}>
            إضافة صنف
          </button>
          {pendingReceive ? (
            <button
              type="button"
              className="secondary"
              disabled={pending === "check" || pending === "receive"}
              onClick={() => void onCheckResult()}
            >
              {pending === "check" ? "جارٍ التحقق…" : "التحقق من النتيجة"}
            </button>
          ) : null}
          <button type="submit" disabled={pending === "receive"}>
            {pending === "receive"
              ? "جارٍ الحفظ…"
              : pendingReceive
                ? "إعادة المحاولة"
                : "حفظ الاستلام"}
          </button>
        </div>
      </form>

      <div className="grid two">
        <section className="card">
          <h2>أذون الاستلام</h2>
          {receipts.length === 0 ? (
            <p className="empty">لا توجد أذون استلام بعد.</p>
          ) : (
            <div className="staff-list" data-testid="receipt-list">
              {receipts.map((receipt) => (
                <article className="staff-item" key={receipt.id}>
                  <button type="button" className="secondary" onClick={() => {
                    resetCorrectionAttempt();
                    setSelectedReceiptId(receipt.id);
                    setEditingCorrection(false);
                  }}>
                    عرض التفاصيل
                  </button>
                  <p>التاريخ: {receipt.receiptDate}</p>
                  <p>{receipt.lines.map((line) => line.variant.product.code).join("، ")}</p>
                  <p className="muted">أصناف: {receipt.lines.length}</p>
                </article>
              ))}
            </div>
          )}
          {selectedReceipt ? (
            <div data-testid="receipt-details">
              <h3>تفاصيل الإذن</h3>
              <p>تاريخ الاستلام: {selectedReceipt.receiptDate}</p>
              {selectedReceipt.lines.map((line) => (
                <div key={line.id} className="staff-item">
                  <p>{line.variant.product.code} / {line.variant.size.nameAr} / {line.variant.color.nameAr}</p>
                  <p>الأصل: {line.quantity} × {formatEgpFromPiasters(line.unitCostPiasters)}</p>
                  <p>الفعلي: {line.effectiveQuantity} × {formatEgpFromPiasters(line.effectiveUnitCostPiasters)}</p>
                  <p className="muted">المتاح: {line.remainingQuantity} — المستهلك حالياً: {line.allocatedQuantity}</p>
                </div>
              ))}
              <div className="actions">
                <button type="button" className="secondary" onClick={beginCorrection}>تصحيح الإذن</button>
              </div>
              {editingCorrection ? (
                <form className="stacked-form" aria-label="تصحيح إذن الاستلام" onSubmit={(event) => void onCorrectReceipt(event)}>
                  <div className="field">
                    <label htmlFor="receivingCorrectionReason">سبب التصحيح</label>
                    <input
                      id="receivingCorrectionReason"
                      value={correctionReason}
                      onChange={(event) => {
                        resetCorrectionAttempt();
                        setCorrectionReason(event.target.value);
                      }}
                      required
                    />
                  </div>
                  {correctionLines.map((line, index) => (
                    <div className="variant-row" key={line.lineId}>
                      <p>{line.label}</p>
                      <div className="field">
                        <label htmlFor={`correctionQuantity-${line.lineId}`}>الكمية الفعالة</label>
                        <input
                          id={`correctionQuantity-${line.lineId}`}
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(event) => {
                            resetCorrectionAttempt();
                            const next = [...correctionLines];
                            next[index] = { ...line, quantity: event.target.value };
                            setCorrectionLines(next);
                          }}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`correctionCost-${line.lineId}`}>تكلفة الشراء الفعالة بالجنيه</label>
                        <input
                          id={`correctionCost-${line.lineId}`}
                          value={line.costEgp}
                          onChange={(event) => {
                            resetCorrectionAttempt();
                            const next = [...correctionLines];
                            next[index] = { ...line, costEgp: event.target.value };
                            setCorrectionLines(next);
                          }}
                          required
                        />
                      </div>
                    </div>
                  ))}
                  <div className="actions">
                    <button type="submit" disabled={pending === "correction"}>
                      {pending === "correction"
                        ? "جارٍ الحفظ…"
                        : correctionRetryReady
                          ? "إعادة محاولة التصحيح"
                          : "حفظ التصحيح"}
                    </button>
                    <button type="button" className="secondary" onClick={() => {
                      resetCorrectionAttempt();
                      setEditingCorrection(false);
                    }}>إلغاء</button>
                  </div>
                </form>
              ) : null}
              {selectedReceipt.corrections.length > 0 ? (
                <div className="staff-list">
                  <h4>سجل التصحيحات</h4>
                  {selectedReceipt.corrections.map((correction) => (
                    <article className="staff-item" key={correction.id}>
                      <p>التصحيح {correction.revision}: {correction.reason}</p>
                      <p className="muted">نفّذه {correction.changedByDisplayName} — {new Date(correction.changedAt).toLocaleString("ar-EG")}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card">
          <h2>دفعات التكلفة</h2>
          {batches.length === 0 ? (
            <p className="empty">لا توجد دفعات بعد.</p>
          ) : (
            <div className="staff-list" data-testid="batch-list">
              {batches.map((batch) => (
                <article className="staff-item" key={batch.id}>
                  <p>
                    {batch.variant.product.code} / {batch.variant.size.nameAr} / {batch.variant.color.nameAr}
                  </p>
                  <p>المتبقي: {batch.remainingQuantity} من {batch.effectiveReceivedQuantity}</p>
                  <p>الكمية الأصلية: {batch.receivedQuantity} — الكمية الفعالة: {batch.effectiveReceivedQuantity}</p>
                  <p>تكلفة الشراء الأصلية: {formatEgpFromPiasters(batch.unitCostPiasters)}</p>
                  <p>التكلفة الفعالة: {formatEgpFromPiasters(batch.effectiveUnitCostPiasters)}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>المخزون المنخفض</h2>
          <form aria-label="حد التنبيه العام" onSubmit={(event) => void onSaveThreshold(event)}>
            <div className="field">
              <label htmlFor="globalThreshold">الحد العام للكمية المتاحة</label>
              <input id="globalThreshold" value={thresholdInput} onChange={(event) => setThresholdInput(event.target.value)} />
            </div>
            <button type="submit" disabled={pending === "settings"}>
              {pending === "settings" ? "جارٍ الحفظ…" : "حفظ الحد العام"}
            </button>
          </form>
          {settings ? <p className="muted">الحد الحالي: {settings.lowStockThreshold}</p> : null}
          <form className="stacked-form" aria-label="حد تنبيه لمتغير" onSubmit={(event) => void onSaveOverride(event)}>
            <div className="field">
              <label htmlFor="overrideVariant">المتغير</label>
              <select id="overrideVariant" value={overrideVariantId} onChange={(event) => setOverrideVariantId(event.target.value)}>
                <option value="">اختر متغيراً</option>
                {variantOptions.map((item) => (
                  <option key={item.variant.id} value={item.variant.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="overrideThreshold">حد المتغير (فارغ للحذف)</label>
              <input id="overrideThreshold" value={overrideThreshold} onChange={(event) => setOverrideThreshold(event.target.value)} />
            </div>
            <button type="submit" disabled={pending === "override"}>
              {pending === "override" ? "جارٍ الحفظ…" : "حفظ حد المتغير"}
            </button>
          </form>
          {lowStock.length === 0 ? (
            <p className="empty">لا توجد أصناف منخفضة حالياً.</p>
          ) : (
            <div className="staff-list" data-testid="low-stock-list">
              {lowStock.map((item) => (
                <article className="staff-item" key={item.variantId}>
                  <p>
                    {item.variant.product.code} / {item.variant.size.nameAr} / {item.variant.color.nameAr}
                  </p>
                  <p>المتاح: {item.availableQuantity} — الحد: {item.threshold}</p>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>تنبيه</h2>
          <p>
            الاستلام متصل ويتطلب صلاحية المدير. الكميات متاحة لكل الفروع والمتجر من مخزون مركزي واحد،
            وتبقى تكاليف الشراء في دفعات منفصلة.
          </p>
        </section>
      </div>
    </main>
  );
}
