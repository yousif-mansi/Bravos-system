import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CashierProductLookupDto,
  CountCoordinationDto,
  InventoryBatchDto,
  PosPriceSnapshotDto,
  StockCorrectionDto,
  StockPauseDto,
  StockReconciliationCaseDto,
  StockReconciliationDto,
  WorkspaceDto,
} from "@bravos/contracts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import {
  acknowledgeCountCoordination,
  ApiError,
  cancelCountCoordination,
  finalizeStockCorrection,
  getCountCoordination,
  getStockPause,
  issuePosSnapshot,
  listBatches,
  listCashierCatalog,
  listStockCorrections,
  listStockReconciliationCases,
  listStockReconciliations,
  reconcileLateSale,
  startCountCoordination,
} from "../api.ts";
import { cacheIssuedSnapshot, pos } from "../pos.ts";

type Loaded = {
  coordination: CountCoordinationDto | null;
  pause: StockPauseDto | null;
  catalog: CashierProductLookupDto[];
  batches: InventoryBatchDto[];
  corrections: StockCorrectionDto[];
  cases: StockReconciliationCaseDto[];
  reconciliations: StockReconciliationDto[];
};

type CorrectionAttempt = {
  operationId: string;
  coordinationId: string;
  branchId: string;
  variantId: string;
  previousAvailableQuantity: number;
  correctedAvailableQuantity: number;
  reason: string;
  positiveSourceBatchId: string | null;
};

const EMPTY: Loaded = {
  coordination: null,
  pause: null,
  catalog: [],
  batches: [],
  corrections: [],
  cases: [],
  reconciliations: [],
};

export default function StockCorrectionsPage({ workspace }: { workspace: WorkspaceDto }) {
  const [data, setData] = useState<Loaded>(EMPTY);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [variantId, setVariantId] = useState("");
  const [correctedQuantity, setCorrectedQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [positiveSourceBatchId, setPositiveSourceBatchId] = useState("");
  const [pauseSnapshot, setPauseSnapshot] = useState<PosPriceSnapshotDto | null>(null);
  const [correctionAttempt, setCorrectionAttempt] = useState<CorrectionAttempt | null>(null);
  const [startOperationId, setStartOperationId] = useState("");
  const [cancelOperationId, setCancelOperationId] = useState("");
  const [reconciliationQuantities, setReconciliationQuantities] = useState<Record<string, string>>({});
  const reconciliationOperations = useRef(new Map<string, string>());
  const correctionInFlight = useRef(false);
  const correctionFeedback = useRevealFeedback<HTMLFormElement>();
  const activeBranch = workspace.activeBranch;

  async function load() {
    const [coordination, pause, catalog, batches, corrections, cases, reconciliations] = await Promise.all([
      getCountCoordination(),
      getStockPause(),
      listCashierCatalog(),
      listBatches(),
      listStockCorrections(),
      listStockReconciliationCases(),
      listStockReconciliations(),
    ]);
    const next = { coordination, pause, catalog, batches, corrections, cases, reconciliations };
    setData(next);
    const saved = readCorrectionAttempt(workspace.staff.id);
    if (saved && corrections.some((item) => item.operationId === saved.operationId)) {
      clearCorrectionAttempt(workspace.staff.id, saved.operationId);
      setCorrectionAttempt(null);
    }
    return next;
  }

  useEffect(() => {
    const saved = readCorrectionAttempt(workspace.staff.id);
    if (saved) {
      setCorrectionAttempt(saved);
      setVariantId(saved.variantId);
      setCorrectedQuantity(String(saved.correctedAvailableQuantity));
      setReason(saved.reason);
      setPositiveSourceBatchId(saved.positiveSourceBatchId ?? "");
    } else {
      setCorrectionAttempt(null);
      setVariantId("");
      setCorrectedQuantity("");
      setReason("");
      setPositiveSourceBatchId("");
    }
    setInitialLoading(true);
    void load()
      .catch((caught) => setError(message(caught, "تعذر تحميل تصحيحات المخزون.")))
      .finally(() => setInitialLoading(false));
  }, [workspace.staff.id, activeBranch?.id]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== attemptKey(workspace.staff.id) || correctionInFlight.current) return;
      const saved = readCorrectionAttempt(workspace.staff.id);
      setCorrectionAttempt(saved);
      if (saved) adoptCorrectionAttempt(saved);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  const variants = useMemo(() => {
    return data.catalog.flatMap((product) => product.variants.map((variant) => ({
      id: variant.id,
      label: `${product.code} — ${product.nameAr} / ${variant.size.nameAr} / ${variant.color.nameAr}`,
      available: variant.availableQuantity,
    })));
  }, [data.catalog]);
  const selected = variants.find((item) => item.id === variantId) ?? null;
  const sourceBatches = data.batches.filter((batch) => batch.variantId === variantId
    && batch.branchBalances.some((balance) => balance.branchId === activeBranch?.id));
  const coordination = data.coordination?.status === "active" ? data.coordination : null;
  const allAcknowledged = Boolean(coordination) && coordination!.devices.every(
    (device) => device.acknowledgedStockVersion === coordination!.boundaryStockVersion,
  );
  const numericCorrection = correctedQuantity === "" ? null : Number(correctedQuantity);
  const isIncrease = Boolean(selected && numericCorrection !== null && numericCorrection > selected.available);
  const correctionValid = Boolean(
    coordination
      && selected
      && numericCorrection !== null
      && Number.isInteger(numericCorrection)
      && numericCorrection >= 0
      && numericCorrection !== selected.available
      && reason.trim()
      && (!isIncrease || positiveSourceBatchId),
  );

  async function run(action: string, work: () => Promise<void>) {
    setPending(action);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (caught) {
      setError(message(caught, "تعذر إكمال العملية."));
    } finally {
      setPending("");
    }
  }

  async function start() {
    if (!activeBranch) {
      setError("اختر الفرع النشط قبل بدء تصحيح المخزون.");
      return;
    }
    const operationId = startOperationId || crypto.randomUUID();
    setStartOperationId(operationId);
    await run("start", async () => {
      await startCountCoordination(operationId);
      setStartOperationId("");
      await load();
      setNotice("بدأ التوقف المؤقت. يجب مزامنة كل نقطة بيع معروفة وتأكيد توقفها.");
      correctionFeedback.reveal();
    });
  }

  async function recover() {
    await run("recover", async () => {
      const refreshed = await load();
      if (refreshed.coordination?.status === "active") {
        setStartOperationId("");
        setNotice("استُرد تنسيق العد النشط. أكمل تأكيد نقاط البيع أو ألغِ التوقف.");
        correctionFeedback.reveal();
      } else {
        setNotice("لا يوجد تنسيق عد نشط لاسترداده.");
      }
    });
  }

  async function syncThisTill() {
    await run("sync", async () => {
      const pendingIds = await pos.listPendingOperationIds();
      if (pendingIds.length > 0) throw new Error("يجب إرسال المبيعات المكتملة من هذه النقطة أولاً.");
      const snapshot = await issuePosSnapshot(await pos.deviceId(), pendingIds);
      await cacheIssuedSnapshot(workspace.staff.id, snapshot);
      if (!snapshot.stockPause) throw new Error("لم تعد مهلة التوقف نشطة. حدّث الصفحة وابدأ تنسيقاً جديداً.");
      setPauseSnapshot(snapshot);
      setNotice("استلمت نقطة البيع أمر التوقف بعد مزامنة طابورها. راجع رقم اللقطة ثم أكد التوقف.");
    });
  }

  async function acknowledgeThisTill() {
    const snapshot = pauseSnapshot;
    if (!snapshot?.stockPause) return;
    await run("ack", async () => {
      await acknowledgeCountCoordination({
        coordinationId: snapshot.stockPause!.coordinationId,
        deviceId: snapshot.deviceId,
        snapshotId: snapshot.snapshotId,
      });
      await load();
      setNotice("تم تأكيد مزامنة هذه النقطة وتوقفها عند حد العد باللقطة المعروضة.");
    });
  }

  async function cancel() {
    if (!coordination) return;
    const operationId = cancelOperationId || crypto.randomUUID();
    setCancelOperationId(operationId);
    await run("cancel", async () => {
      await cancelCountCoordination(operationId, coordination.id);
      setCancelOperationId("");
      setPauseSnapshot(null);
      await load();
      setNotice("أُلغي التوقف المؤقت دون تغيير الكمية.");
    });
  }

  async function finalize() {
    if (!coordination || !selected || !activeBranch || numericCorrection === null || correctionInFlight.current) return;
    const draft: CorrectionAttempt = {
      operationId: crypto.randomUUID(),
      coordinationId: coordination.id,
      branchId: activeBranch.id,
      variantId: selected.id,
      previousAvailableQuantity: selected.available,
      correctedAvailableQuantity: numericCorrection,
      reason: reason.trim(),
      positiveSourceBatchId: numericCorrection > selected.available ? positiveSourceBatchId || null : null,
    };
    let attempt: CorrectionAttempt;
    try {
      const assignment = await withCorrectionLock(workspace.staff.id, () => {
        const stored = readCorrectionAttempt(workspace.staff.id);
        if (stored && !sameCorrectionRequest(stored, correctionAttempt ?? draft)) {
          return { kind: "blocked" as const, attempt: stored };
        }
        const assigned = stored ?? correctionAttempt ?? draft;
        saveCorrectionAttempt(workspace.staff.id, assigned);
        return { kind: "assigned" as const, attempt: assigned };
      });
      if (assignment.kind === "blocked") {
        adoptCorrectionAttempt(assignment.attempt);
        setCorrectionAttempt(assignment.attempt);
        setError("توجد محاولة تصحيح غير مؤكدة في تبويب آخر. استُعيدت قيمها؛ تحقق منها وأعد إرسالها.");
        return;
      }
      attempt = assignment.attempt;
    } catch {
      setError("تعذر حفظ معرّف عملية التصحيح محلياً.");
      return;
    }
    correctionInFlight.current = true;
    adoptCorrectionAttempt(attempt);
    setCorrectionAttempt(attempt);
    setPending("finalize");
    setError("");
    setNotice("");
    try {
      await finalizeStockCorrection(attempt);
      await acceptCorrection(attempt.operationId, "حُفظ تصحيح الكمية وأُنهي التوقف المؤقت.");
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          const found = await listStockCorrections()
            .then((items) => items.some((item) => item.operationId === attempt.operationId))
            .catch(() => false);
          if (found) {
            await acceptCorrection(attempt.operationId, "تم العثور على تصحيح الكمية المحفوظ وأُنهي التوقف المؤقت.");
            return;
          }
        }
        if (caught.status >= 400 && caught.status < 500) {
          await withCorrectionLock(workspace.staff.id, () => clearCorrectionAttempt(workspace.staff.id, attempt.operationId));
          setCorrectionAttempt(null);
        }
        setError(caught.messageAr);
      } else {
        setError("نتيجة حفظ التصحيح غير مؤكدة. أعد المحاولة بنفس القيم للتحقق دون تكرار الأثر.");
      }
    } finally {
      correctionInFlight.current = false;
      setPending("");
    }
  }

  function adoptCorrectionAttempt(attempt: CorrectionAttempt) {
    setVariantId(attempt.variantId);
    setCorrectedQuantity(String(attempt.correctedAvailableQuantity));
    setReason(attempt.reason);
    setPositiveSourceBatchId(attempt.positiveSourceBatchId ?? "");
  }

  async function acceptCorrection(operationId: string, messageAr: string) {
    await withCorrectionLock(workspace.staff.id, () => clearCorrectionAttempt(workspace.staff.id, operationId));
    setCorrectionAttempt(null);
    setPauseSnapshot(null);
    setVariantId("");
    setCorrectedQuantity("");
    setPositiveSourceBatchId("");
    setReason("");
    await load();
    setNotice(messageAr);
  }

  function reconciliationQuantity(item: StockReconciliationCaseDto, resolution: "included_in_count" | "allocate_missing_source") {
    const key = reconciliationQuantityKey(item, resolution);
    const fallback = resolution === "included_in_count" ? item.maximumCountedQuantity : item.unallocatedQuantity;
    return reconciliationQuantities[key] ?? String(fallback);
  }

  function setReconciliationQuantity(item: StockReconciliationCaseDto, resolution: "included_in_count" | "allocate_missing_source", value: string) {
    setReconciliationQuantities((current) => ({ ...current, [reconciliationQuantityKey(item, resolution)]: value }));
  }

  async function reconcile(
    item: StockReconciliationCaseDto,
    resolution: "included_in_count" | "allocate_missing_source",
    quantity: number,
  ) {
    const key = `${item.branchId}:${item.correctionId}:${item.saleId}:${item.variantId}:${resolution}`;
    const operationId = reconciliationOperations.current.get(key) ?? crypto.randomUUID();
    reconciliationOperations.current.set(key, operationId);
    await run(`reconcile-${item.saleId}`, async () => {
      await reconcileLateSale({
        operationId,
        branchId: item.branchId,
        correctionId: item.correctionId,
        saleId: item.saleId,
        variantId: item.variantId,
        resolution,
        quantity,
      });
      reconciliationOperations.current.delete(key);
      await load();
      setNotice(
        resolution === "included_in_count"
          ? "أعيد أثر البيع الذي كان داخلاً في العدد مرة واحدة."
          : "رُبط البيع المتأخر بدفعات التكلفة الفعلية.",
      );
    });
  }

  return (
    <main className="shell stock-corrections-page">
      <header className="page-hero">
        <h1>تصحيح كميات المخزون</h1>
      </header>
      <p className="notice" data-testid="stock-correction-active-branch">
        الفرع النشط للتصحيح: <strong>{activeBranch?.nameAr ?? "اختر فرعاً من مساحة العمل"}</strong>
      </p>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {initialLoading ? <p role="status">جارٍ تحميل المخزون والتصحيحات…</p> : null}

      <section className="card">
        <h2>تنسيق العد القصير</h2>
        {data.pause ? (
          <div className="error" data-testid="manager-stock-pause">
            المخزون متوقف عند الإصدار {data.pause.boundaryStockVersion} حتى {formatDate(data.pause.expiresAt)}.
          </div>
        ) : null}
        {!coordination ? (
          <div className="actions">
            <button type="button" disabled={Boolean(pending) || !activeBranch || initialLoading} onClick={() => void start()}>
              {pending === "start" ? "جارٍ البدء…" : startOperationId ? "إعادة محاولة بدء التوقف" : "مزامنة النقاط وبدء التوقف"}
            </button>
            <button className="secondary" type="button" disabled={Boolean(pending)} onClick={() => void recover()}>
              استرداد تنسيق نشط
            </button>
          </div>
        ) : (
          <>
            <p>حد المخزون: {coordination.boundaryStockVersion} — بدأ {formatDate(coordination.boundaryAt)} — ينتهي {formatDate(coordination.expiresAt)}</p>
            {coordination.devices.length === 0 ? <p className="muted">لا توجد نقاط بيع معروفة.</p> : (
              <div data-testid="known-tills">
                {coordination.devices.map((device) => (
                  <article className="history-item" key={device.deviceId} data-testid="known-till">
                    <p><strong>{device.deviceId}</strong> — {device.acknowledgedAt ? "متزامنة ومتوقفة" : "لم تؤكد التوقف"}</p>
                    <p className="muted">آخر لقطة معروفة: {device.knownSnapshotId} عند إصدار {device.knownStockVersion ?? "غير معروف"}</p>
                    {device.acknowledgedSnapshotId ? (
                      <p>لقطة التأكيد الدقيقة: {device.acknowledgedSnapshotId} عند إصدار {device.acknowledgedStockVersion}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
            {pauseSnapshot?.stockPause?.coordinationId === coordination.id ? (
              <div className="notice" data-testid="pause-observation">
                أمر التوقف ظاهر على هذه النقطة. اللقطة {pauseSnapshot.snapshotId}، الجهاز {pauseSnapshot.deviceId}، إصدار المخزون {pauseSnapshot.stockVersion}.
              </div>
            ) : null}
            <div className="actions">
              {workspace.capabilities.cashier ? (
                <button type="button" disabled={Boolean(pending) || Boolean(correctionAttempt)} onClick={() => void syncThisTill()}>
                  مزامنة هذه النقطة وإظهار التوقف
                </button>
              ) : null}
              {pauseSnapshot?.stockPause?.coordinationId === coordination.id ? (
                <button type="button" disabled={Boolean(pending) || Boolean(correctionAttempt)} onClick={() => void acknowledgeThisTill()}>
                  تأكيد توقف هذه النقطة
                </button>
              ) : null}
              <button className="secondary" type="button" disabled={Boolean(pending)} onClick={() => void recover()}>تحديث الحالات</button>
              <button className="danger" type="button" disabled={Boolean(pending) || Boolean(correctionAttempt)} onClick={() => void cancel()}>
                {cancelOperationId ? "إعادة محاولة الإلغاء" : "إلغاء دون تصحيح"}
              </button>
            </div>
          </>
        )}
      </section>

      {coordination ? (
        <form ref={correctionFeedback.regionRef} className={`card reveal-feedback${correctionFeedback.highlighted ? " is-highlighted" : ""}`} aria-label="تصحيح الكمية الفعلية" onSubmit={(event) => { event.preventDefault(); void finalize(); }}>
          <h2 ref={correctionFeedback.headingRef} tabIndex={-1}>الكمية الفعلية</h2>
          <p data-testid="correction-form-branch">الفرع: <strong>{workspace.authorizedBranches.find((branch) => branch.id === (correctionAttempt?.branchId ?? activeBranch?.id))?.nameAr ?? "—"}</strong></p>
          {correctionAttempt ? (
            <div className="notice">هذه محاولة غير مؤكدة. جُمّدت القيم وسيُعاد إرسال معرّف العملية نفسه.</div>
          ) : null}
          <div className="field">
            <label htmlFor="stock-variant">الصنف</label>
            <select
              id="stock-variant"
              value={variantId}
              disabled={Boolean(correctionAttempt)}
              onChange={(event) => {
                setVariantId(event.target.value);
                setCorrectedQuantity("");
                setPositiveSourceBatchId("");
              }}
            >
              <option value="">اختر الصنف</option>
              {variants.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          {selected ? <p data-testid="previous-available">المتاح السابق: {selected.available}</p> : null}
          <div className="field">
            <label htmlFor="corrected-quantity">المتاح الفعلي المصحح</label>
            <input
              id="corrected-quantity"
              type="number"
              min="0"
              step="1"
              value={correctedQuantity}
              disabled={Boolean(correctionAttempt)}
              onChange={(event) => setCorrectedQuantity(event.target.value)}
            />
          </div>
          {isIncrease ? (
            <div className="field">
              <label htmlFor="source-batch">دفعة التكلفة الفعلية للزيادة</label>
              <select
                id="source-batch"
                value={positiveSourceBatchId}
                disabled={Boolean(correctionAttempt)}
                onChange={(event) => setPositiveSourceBatchId(event.target.value)}
              >
                <option value="">اختر الدفعة</option>
                {sourceBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.id} — {batch.receiptDate} — تكلفة الوحدة الفعلية {money(batch.effectiveUnitCostPiasters)}
                  </option>
                ))}
              </select>
              <p className="muted">تُعاد الزيادة إلى دفعة فعلية محفوظة؛ لا تُنشأ تكلفة مفترضة.</p>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="correction-reason">سبب التصحيح</label>
            <textarea
              id="correction-reason"
              value={reason}
              disabled={Boolean(correctionAttempt)}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <button type="submit" disabled={Boolean(pending) || !activeBranch || (Boolean(correctionAttempt) && correctionAttempt?.branchId !== activeBranch.id) || (!correctionAttempt && (!allAcknowledged || !correctionValid))}>
            {pending === "finalize" ? "جارٍ التحقق…" : correctionAttempt ? "إعادة محاولة حفظ التصحيح" : "حفظ التصحيح وإنهاء التوقف"}
          </button>
          {!allAcknowledged ? <p className="muted">لا يمكن الحفظ حتى تؤكد كل نقطة بيع معروفة مزامنتها وتوقفها.</p> : null}
          {correctionAttempt && correctionAttempt.branchId !== activeBranch?.id ? <p className="error">اختر فرع المحاولة الأصلية لإعادة إرسالها بأمان.</p> : null}
          {isIncrease && !positiveSourceBatchId ? <p className="muted">اختر دفعة التكلفة الفعلية قبل حفظ الزيادة.</p> : null}
        </form>
      ) : null}

      <section className="card">
        <h2>المبيعات المتأخرة بعد التصحيح</h2>
        {data.cases.length === 0 ? <EmptyState title="مفيش حاجة للمراجعة" message="بعد التصحيح أي فرق هيظهر هنا." /> : data.cases.map((item) => (
          <article className="history-item" key={`${item.correctionId}-${item.saleId}-${item.variantId}`} data-testid="stock-reconciliation-case">
            <p><strong>البيع {item.saleId}</strong></p>
            <p data-testid="late-sale-timing">
              {item.timing === "before_count"
                ? "بيع قبل حد العد: قد تكون وحداته داخلة في الكمية التي عُدّت."
                : "بيع بعد حد العد: وحداته ليست جزءاً من الكمية التي عُدّت."}
            </p>
            <p>الجهاز المصدر: {item.deviceId}</p>
            <p>لقطة البيع: {item.sourceSnapshotId} — أُصدرت {formatDate(item.sourceSnapshotIssuedAt)}</p>
            <p>وقت حدوث البيع: {formatDate(item.occurredAt)} — وقت وصوله للخادم: {formatDate(item.recordedAt)}</p>
            <p>حد العد: {formatDate(item.boundaryAt)}</p>
            <p>المباع: {item.soldQuantity} — المخصص بتكلفة: {item.allocatedQuantity} — بلا مصدر تكلفة: {item.unallocatedQuantity}</p>
            <p>يمكن اعتبار {item.maximumCountedQuantity} كحد أقصى داخلاً في العد؛ سُوّي منه {item.alreadyCountedQuantity}.</p>
            {item.costsIncomplete ? (
              <p className="error">تكلفة البيع غير مكتملة. تظل الكمية المختلف عليها ظاهرة حتى ربط مصدر تكلفة فعلي.</p>
            ) : (
              <p className="notice">تكلفة البيع مكتملة.</p>
            )}
            <div className="actions">
              {item.maximumCountedQuantity > 0 ? (
                <div className="field">
                  <label htmlFor={`included-${item.correctionId}-${item.saleId}-${item.variantId}`}>الكمية التي كانت داخلة في العد</label>
                  <input
                    id={`included-${item.correctionId}-${item.saleId}-${item.variantId}`}
                    type="number"
                    min="1"
                    max={item.maximumCountedQuantity}
                    step="1"
                    value={reconciliationQuantity(item, "included_in_count")}
                    onChange={(event) => setReconciliationQuantity(item, "included_in_count", event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={Boolean(pending) || !validBoundedQuantity(reconciliationQuantity(item, "included_in_count"), item.maximumCountedQuantity)}
                    onClick={() => void reconcile(item, "included_in_count", Number(reconciliationQuantity(item, "included_in_count")))}
                  >
                    تسجيل الكمية الداخلة في العد
                  </button>
                </div>
              ) : null}
              {item.unallocatedQuantity > 0 ? (
                <div className="field">
                  <label htmlFor={`allocate-${item.correctionId}-${item.saleId}-${item.variantId}`}>كمية ربط مصدر التكلفة</label>
                  <input
                    id={`allocate-${item.correctionId}-${item.saleId}-${item.variantId}`}
                    type="number"
                    min="1"
                    max={item.unallocatedQuantity}
                    step="1"
                    value={reconciliationQuantity(item, "allocate_missing_source")}
                    onChange={(event) => setReconciliationQuantity(item, "allocate_missing_source", event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={Boolean(pending) || !validBoundedQuantity(reconciliationQuantity(item, "allocate_missing_source"), item.unallocatedQuantity)}
                    onClick={() => void reconcile(item, "allocate_missing_source", Number(reconciliationQuantity(item, "allocate_missing_source")))}
                  >
                    ربط مصدر التكلفة الفعلي
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <section className="card" data-testid="stock-correction-history">
        <h2>سجل التصحيحات</h2>
        {data.corrections.length === 0 ? <EmptyState title="لسه مفيش تصحيحات" message="أول تصحيح هيتسجل هنا." /> : data.corrections.map((item) => (
          <article className="history-item" key={item.id} data-testid="stock-correction-row">
            <p><strong>{item.variant.product.code}</strong> — {workspace.authorizedBranches.find((branch) => branch.id === item.branchId)?.nameAr ?? "فرع غير معروف"} — من {item.previousAvailableQuantity} إلى {item.correctedAvailableQuantity} ({signed(item.quantityDelta)})</p>
            <p>{item.reason}</p>
            <p className="muted">{item.changedBy.displayName} — {formatDate(item.changedAt)} — حد المخزون {item.boundaryStockVersion}</p>
            <p>نقاط البيع المؤكدة: {item.devices.filter((device) => device.acknowledgedAt).length} من {item.devices.length}</p>
            {item.batches.length > 0 ? (
              <ul>{item.batches.map((batch) => (
                <li key={`${batch.batchId}-${batch.direction}`}>
                  {batch.direction === "restore" ? "استعادة" : "خصم"} {batch.quantity} من الدفعة {batch.batchId} — تكلفة الوحدة الفعلية {money(batch.effectiveUnitCostPiasters)}
                </li>
              ))}</ul>
            ) : null}
          </article>
        ))}
      </section>

      <section className="card">
        <h2>سجل مصالحات المبيعات المتأخرة</h2>
        {data.reconciliations.length === 0 ? <p className="empty">لا توجد مصالحات.</p> : data.reconciliations.map((item) => (
          <article className="history-item" key={item.id} data-testid="stock-reconciliation-row">
            <p><strong>{item.saleId}</strong> — {item.quantity} — {item.resolution === "included_in_count" ? "كان داخل العدد" : "رُبط بمصدر تكلفة"}</p>
            <p>المتاح من {item.previousAvailableQuantity} إلى {item.resultingAvailableQuantity} — {item.resolvedBy.displayName} — {formatDate(item.resolvedAt)}</p>
            {item.batches.length > 0 ? <ul>{item.batches.map((batch) => (
              <li key={`${batch.batchId}-${batch.direction}`}>
                {batch.direction === "restore" ? "استعادة" : "تخصيص"} {batch.quantity} — الدفعة {batch.batchId} — {money(batch.effectiveUnitCostPiasters)}
              </li>
            ))}</ul> : null}
          </article>
        ))}
      </section>
    </main>
  );
}

function attemptKey(staffId: string) {
  return `bravos.stock-correction.pending.${staffId}`;
}

function readCorrectionAttempt(staffId: string): CorrectionAttempt | null {
  try {
    const raw = localStorage.getItem(attemptKey(staffId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CorrectionAttempt>;
    if (
      typeof parsed.operationId !== "string"
      || typeof parsed.coordinationId !== "string"
      || typeof parsed.branchId !== "string"
      || typeof parsed.variantId !== "string"
      || typeof parsed.previousAvailableQuantity !== "number"
      || typeof parsed.correctedAvailableQuantity !== "number"
      || typeof parsed.reason !== "string"
      || (parsed.positiveSourceBatchId !== null && typeof parsed.positiveSourceBatchId !== "string")
    ) return null;
    return parsed as CorrectionAttempt;
  } catch {
    return null;
  }
}

function saveCorrectionAttempt(staffId: string, attempt: CorrectionAttempt) {
  localStorage.setItem(attemptKey(staffId), JSON.stringify(attempt));
}

function clearCorrectionAttempt(staffId: string, expectedOperationId: string) {
  const current = readCorrectionAttempt(staffId);
  if (!current || current.operationId !== expectedOperationId) return;
  localStorage.removeItem(attemptKey(staffId));
}

function sameCorrectionRequest(left: CorrectionAttempt, right: CorrectionAttempt) {
  return left.coordinationId === right.coordinationId
    && left.branchId === right.branchId
    && left.variantId === right.variantId
    && left.previousAvailableQuantity === right.previousAvailableQuantity
    && left.correctedAvailableQuantity === right.correctedAvailableQuantity
    && left.reason === right.reason
    && left.positiveSourceBatchId === right.positiveSourceBatchId;
}

async function withCorrectionLock<T>(staffId: string, work: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) {
    return navigator.locks.request(`bravos.stock-correction.lock.${staffId}`, { mode: "exclusive" }, work);
  }
  return work();
}

function reconciliationQuantityKey(
  item: StockReconciliationCaseDto,
  resolution: "included_in_count" | "allocate_missing_source",
) {
  return `${item.correctionId}:${item.saleId}:${item.variantId}:${resolution}`;
}

function validBoundedQuantity(value: string, maximum: number) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= maximum;
}

function money(piasters: number) {
  return `${piasters / 100} ج.م.`;
}

function signed(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}

function message(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) return caught.messageAr;
  if (caught instanceof Error && caught.message) return caught.message;
  return fallback;
}
