import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  ReturnCorrectionDetailDto,
  SaleCorrectionDetailDto,
  WorkspaceDto,
} from "@bravos/contracts";
import {
  ApiError,
  changeSaleCorrection,
  getSaleCorrection,
  listSales,
  type SaleCorrectionWrite,
} from "../api.ts";
import {
  changeReturnCorrection,
  getReturnCorrection,
  listReturns,
  type ReturnCorrectionWrite,
} from "../returns-api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { accountGeneration } from "../account-session.ts";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import {
  assignCorrectionAttempt,
  clearCorrectionAttempt,
  correctionAttemptKey,
  readCorrectionAttempt,
  type CorrectionAttempt,
  withCorrectionAttemptLock,
} from "../corrections-pending.ts";

type Detail = SaleCorrectionDetailDto | ReturnCorrectionDetailDto;
type LineEdit = { quantity: number; paid: string; sellableQuantity: number; stockDelta: number };
type BoundReadableReference = { targetType: "sale" | "return"; id: string; reference: string };

export default function CorrectionsPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [searchParams] = useSearchParams();
  const initialTarget = searchParams.get("target") === "return" ? "return" : "sale";
  const initialId = searchParams.get("id") ?? "";
  const [target, setTarget] = useState<"sale" | "return">(initialTarget);
  const [recordId, setRecordId] = useState(initialId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [changeType, setChangeType] = useState<"correction" | "cancellation">("correction");
  const [reason, setReason] = useState("");
  const [effectiveAmount, setEffectiveAmount] = useState("0");
  const [effectiveCheckoutCharge, setEffectiveCheckoutCharge] = useState("0");
  const [lines, setLines] = useState<Record<string, LineEdit>>({});
  const [cashDirection, setCashDirection] = useState<"none" | "paid_out" | "recovered">("none");
  const [cashAmount, setCashAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [failedLoad, setFailedLoad] = useState<{ target: "sale" | "return"; id: string } | null>(null);
  const detailFeedback = useRevealFeedback<HTMLElement>();
  const loadVersion = useRef(0);
  const knownReferenceRef = useRef<BoundReadableReference | null>(null);
  const [knownReference, setKnownReference] = useState<string | null>(null);
  useEffect(() => () => { loadVersion.current += 1; }, [workspace.staff.id]);
  const [uncertainAttempt, setUncertainAttempt] = useState<CorrectionAttempt | null>(() => readCorrectionAttempt(workspace.staff.id));

  useEffect(() => {
    if (!initialId) return;
    void loadRecord(initialTarget, initialId);
  }, []);

  useEffect(() => {
    const key = correctionAttemptKey(workspace.staff.id);
    setUncertainAttempt(readCorrectionAttempt(workspace.staff.id));
    function onStorage(event: StorageEvent) {
      if (event.key === key) setUncertainAttempt(readCorrectionAttempt(workspace.staff.id));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  async function load(event: FormEvent) {
    event.preventDefault();
    if (!recordId.trim()) return setError("أدخل مرجع البيع أو الإرجاع.");
    await loadRecord(target, recordId.trim(), true);
  }

  async function loadRecord(nextTarget: "sale" | "return", entered: string, reveal = false) {
    const version = ++loadVersion.current;
    const epoch = accountGeneration();
    const stillCurrent = () => version === loadVersion.current && epoch === accountGeneration();
    setBusy(true);
    setLoadingDetails(true);
    setFailedLoad(null);
    setError("");
    setNotice("");
    try {
      const resolved = await resolveCorrectionTarget(nextTarget, entered, stillCurrent);
      if (!stillCurrent() || resolved.kind === "stale") return;
      if (resolved.kind === "none") {
        setFailedLoad({ target: nextTarget, id: entered });
        setError(nextTarget === "sale"
          ? "لا يوجد بيع مكتمل بهذا المرجع. راجع المرجع في المبيعات، أو افتح التصحيح من رابط البيع."
          : "لا يوجد إرجاع بهذا المرجع. راجع المرجع في المرتجعات، أو افتح التصحيح من رابط الإرجاع.");
        return;
      }
      if (resolved.kind === "ambiguous") {
        setFailedLoad({ target: nextTarget, id: entered });
        setError("هذا المرجع يطابق أكثر من تسجيل. افتح التسجيل المطلوب من المبيعات أو المرتجعات حتى لا يُختار تسجيل خاطئ.");
        return;
      }
      if (!isRecordId(resolved.id)) {
        setFailedLoad({ target: nextTarget, id: entered });
        setError("تعذر فتح هذا التسجيل لأن معرّفه غير صالح. افتحه من صفحة المبيعات أو المرتجعات.");
        return;
      }
      const readablePromise: Promise<string | null | "stale"> = resolved.enrich
        ? (nextTarget === "sale" ? lookupSaleReference(resolved.id, stillCurrent) : lookupReturnReference(resolved.id, stillCurrent))
          .catch(() => null)
        : Promise.resolve(resolved.readableReference);
      const value = nextTarget === "sale" ? await getSaleCorrection(resolved.id) : await getReturnCorrection(resolved.id);
      if (!stillCurrent()) return;
      const found = await readablePromise;
      if (!stillCurrent() || found === "stale") return;
      select(value, found);
      if (reveal) detailFeedback.reveal();
    } catch (caught) {
      if (!stillCurrent()) return;
      setFailedLoad({ target: nextTarget, id: entered });
      showError(caught);
    } finally {
      if (version === loadVersion.current) { setBusy(false); setLoadingDetails(false); }
    }
  }

  function select(value: Detail, readableReference?: string | null) {
    const cached = knownReferenceRef.current;
    const cachedForRecord = cached?.id === value.id && cached.targetType === value.targetType ? cached.reference : null;
    const supplied = readableReference === undefined ? cachedForRecord : readableReference;
    const nextReference = supplied && supplied !== value.id ? supplied : null;
    knownReferenceRef.current = nextReference
      ? { targetType: value.targetType, id: value.id, reference: nextReference }
      : null;
    setKnownReference(nextReference);
    setDetail(value);
    setRecordId(nextReference ?? value.id);
    setChangeType("correction");
    setReason("");
    setCashDirection("none");
    setCashAmount("");
    if (value.targetType === "sale") {
      const effective = value.effective ?? value.original;
      setEffectiveAmount(piastersToEgpInput(effective.finalTotalPiasters));
      setEffectiveCheckoutCharge("0");
      setLines(Object.fromEntries(effective.lines.map((line) => [line.saleLineId, {
        quantity: line.quantity,
        paid: piastersToEgpInput(line.paidPiasters),
        sellableQuantity: 0,
        stockDelta: 0,
      }])));
    } else {
      const effective = value.effective ?? value.original;
      setEffectiveAmount(piastersToEgpInput(effective.authorizedRefund.merchandisePiasters));
      setEffectiveCheckoutCharge(piastersToEgpInput(effective.authorizedRefund.checkoutChargePiasters));
      setLines(Object.fromEntries(effective.lines.map((line) => [line.returnLineId, {
        quantity: line.quantity,
        paid: "0",
        sellableQuantity: line.sellableQuantity,
        stockDelta: 0,
      }])));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const amountPiasters = egpInputToPiasters(effectiveAmount);
    const checkoutChargePiasters = egpInputToPiasters(effectiveCheckoutCharge);
    const cashPiasters = cashDirection === "none" ? null : egpInputToPiasters(cashAmount);
    if (changeType === "correction" && amountPiasters === null) return setError("القيمة الفعالة غير صالحة.");
    if (changeType === "correction" && detail.targetType === "return" && checkoutChargePiasters === null) return setError("قيمة رسوم التوصيل الفعالة غير صالحة.");
    if (cashDirection !== "none" && (cashPiasters === null || cashPiasters <= 0)) return setError("أدخل قيمة النقد الذي تحرك فعلياً.");
    const merchandise = Object.entries(lines).flatMap(([lineId, line]) => line.stockDelta === 0
      ? []
      : [{ lineId, quantityDelta: line.stockDelta }]);
    const cash = cashDirection === "none" ? null : { direction: cashDirection, amountPiasters: cashPiasters! };
    let effective: SaleCorrectionWrite["effective"] | ReturnCorrectionWrite["effective"] = null;
    if (changeType === "correction" && detail.targetType === "sale") {
      const effectiveLines: NonNullable<SaleCorrectionWrite["effective"]>["lines"] = [];
      for (const line of detail.original.lines) {
        const edit = lines[line.saleLineId];
        const paidPiasters = edit ? egpInputToPiasters(edit.paid) : null;
        if (!edit || paidPiasters === null) return setError("قيمة سطر البيع غير صالحة.");
        effectiveLines.push({ lineId: line.saleLineId, quantity: edit.quantity, paidPiasters });
      }
      effective = { finalTotalPiasters: amountPiasters!, lines: effectiveLines };
    } else if (changeType === "correction" && detail.targetType === "return") {
      effective = {
        authorizedRefund: { merchandisePiasters: amountPiasters!, checkoutChargePiasters: checkoutChargePiasters! },
        lines: detail.original.lines.map((line) => ({
          lineId: line.returnLineId,
          quantity: lines[line.returnLineId]!.quantity,
          sellableQuantity: lines[line.returnLineId]!.sellableQuantity,
        })),
      };
    }
    const operationId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const common = { operationId, expectedRevision: detail.revision, type: changeType, reason, merchandise, cash };
      const attempt: CorrectionAttempt = detail.targetType === "sale"
        ? { staffId: workspace.staff.id, target: "sale", recordId: detail.id, operationId, input: { ...common, effective: effective as SaleCorrectionWrite["effective"] } }
        : { staffId: workspace.staff.id, target: "return", recordId: detail.id, operationId, input: { ...common, effective: effective as ReturnCorrectionWrite["effective"] } };
      const value = await executeCorrectionAttempt(attempt);
      if (!value) return;
      select(value);
      setNotice(changeType === "cancellation"
        ? "تم إلغاء أثر التسجيل مع الاحتفاظ بالأصل. لم تُفترض عودة بضاعة أو دفع نقد."
        : "تم حفظ التصحيح مع الوقائع الفعلية التي أدخلتها.");
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function executeCorrectionAttempt(candidate: CorrectionAttempt): Promise<Detail | null> {
    return withCorrectionAttemptLock(candidate.staffId, async () => {
      const assignment = assignCorrectionAttempt(candidate);
      if (assignment.kind === "blocked") {
        setUncertainAttempt(assignment.attempt);
        setError("توجد عملية تصحيح سابقة لم نعرف نتيجتها. أعد محاولة العملية نفسها قبل بدء عملية جديدة.");
        return null;
      }
      const attempt = assignment.attempt;
      setUncertainAttempt(attempt);
      try {
        const value = attempt.target === "sale"
          ? await changeSaleCorrection(attempt.recordId, attempt.input)
          : await changeReturnCorrection(attempt.recordId, attempt.input);
        clearCorrectionAttempt(attempt.staffId, attempt.operationId);
        setUncertainAttempt(null);
        return value;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status < 500) {
          clearCorrectionAttempt(attempt.staffId, attempt.operationId);
          setUncertainAttempt(null);
        }
        throw caught;
      }
    });
  }

  async function retryCorrectionAttempt() {
    if (!uncertainAttempt || uncertainAttempt.staffId !== workspace.staff.id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await executeCorrectionAttempt(uncertainAttempt);
      if (!value) return;
      select(value);
      setNotice("تم العثور على نتيجة عملية التصحيح السابقة وإكمالها بنفس المعرّف.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status < 500) showError(caught);
      else setError("ما زالت نتيجة عملية التصحيح غير مؤكدة. أعد المحاولة نفسها بعد عودة الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  function showError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.messageAr : caught instanceof Error ? caught.message : "تعذر إكمال العملية.");
  }

  const originalAmount = detail?.targetType === "sale"
    ? detail.original.finalTotalPiasters
    : detail?.original.authorizedRefundPiasters;
  const currentAmount = detail?.targetType === "sale"
    ? detail.effective?.finalTotalPiasters
    : detail?.effective?.authorizedRefundPiasters;

  return (
    <main className="shell corrections-page">
      <header className="page-hero">
        <h1>تصحيح التسجيلات</h1>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {loadingDetails ? <p role="status">جارٍ تحميل تفاصيل التسجيل…</p> : null}
      {failedLoad ? <button type="button" disabled={busy} onClick={() => void loadRecord(failedLoad.target, failedLoad.id, true)}>إعادة تحميل تفاصيل التسجيل</button> : null}
      {uncertainAttempt ? <div className="notice" data-testid="pending-correction-attempt"><p>توجد عملية تصحيح لم يصل تأكيد نتيجتها. ستُعاد بنفس البيانات ومعرّف العملية.</p><button type="button" disabled={busy} onClick={() => void retryCorrectionAttempt()}>إعادة محاولة التصحيح السابق نفسه</button></div> : null}

      <section className="card">
        <h2>فتح التسجيل الأصلي</h2>
        <form aria-label="فتح تسجيل للتصحيح" className="grid two" onSubmit={(event) => void load(event)}>
          <div className="field"><label htmlFor="correction-target">نوع التسجيل</label><select id="correction-target" disabled={busy} value={target} onChange={(event) => { setTarget(event.target.value as "sale" | "return"); setDetail(null); setFailedLoad(null); knownReferenceRef.current = null; setKnownReference(null); }}><option value="sale">بيع فرع مكتمل</option><option value="return">إرجاع مرحّل</option></select></div>
          <div className="field"><label htmlFor="correction-record">مرجع التسجيل</label><input id="correction-record" disabled={busy} value={recordId} onChange={(event) => { setRecordId(event.target.value); setFailedLoad(null); }} /></div>
          <button type="submit" disabled={busy}>{loadingDetails ? "جارٍ فتح التفاصيل…" : "فتح التفاصيل"}</button>
        </form>
      </section>

      {detail ? (
        <>
          <section ref={detailFeedback.regionRef} className={`card reveal-feedback${detailFeedback.highlighted ? " is-highlighted" : ""}`} data-testid="correction-details">
            <h2 ref={detailFeedback.headingRef} tabIndex={-1}>الأصل والقيمة المستخدمة حالياً</h2>
            <p data-testid="correction-reference">المرجع: {knownReference ?? detail.reference}</p>
            {detail.targetType === "return" ? <p>مصدر الشراء: {detail.source.kind === "delivered_online_order" ? "طلب أونلاين مُسلّم" : "بيع فرع مكتمل"}</p> : null}
            <p>القيمة الأصلية المسجلة: {formatEgpFromPiasters(originalAmount ?? 0)}</p>
            <p>القيمة المستخدمة حالياً: {currentAmount === null || currentAmount === undefined ? "ملغاة" : formatEgpFromPiasters(currentAmount)}</p>
            {detail.targetType === "return" ? <p>تفصيل الأصل: بضاعة {formatEgpFromPiasters(detail.original.authorizedRefund.merchandisePiasters)} · رسوم توصيل {formatEgpFromPiasters(detail.original.authorizedRefund.checkoutChargePiasters)}. {detail.effective ? <>التفصيل المستخدم: بضاعة {formatEgpFromPiasters(detail.effective.authorizedRefund.merchandisePiasters)} · رسوم توصيل {formatEgpFromPiasters(detail.effective.authorizedRefund.checkoutChargePiasters)}.</> : null}</p> : null}
            {detail.targetType === "sale" ? (
              <ul data-testid="correction-line-history">
                {detail.original.lines.map((line) => {
                  const current = detail.effective?.lines.find((item) => item.saleLineId === line.saleLineId);
                  return <li key={line.saleLineId}>{line.variant.product.nameAr}: الأصل {line.quantity} بقيمة {formatEgpFromPiasters(line.paidPiasters)}؛ المستخدم حالياً {current ? `${current.quantity} بقيمة ${formatEgpFromPiasters(current.paidPiasters)}` : "ملغى"}.</li>;
                })}
              </ul>
            ) : (
              <ul data-testid="correction-line-history">
                {detail.original.lines.map((line) => {
                  const current = detail.effective?.lines.find((item) => item.returnLineId === line.returnLineId);
                  return <li key={line.returnLineId}>{line.variant.product.nameAr}: الأصل {line.quantity} مستلم، منها {line.sellableQuantity} قابل للبيع؛ المستخدم حالياً {current ? `${current.quantity} مستلم، منها ${current.sellableQuantity} قابل للبيع` : "ملغى"}.</li>;
                })}
              </ul>
            )}
            <p>القيمة النقدية في التسجيل الأصلي: {formatEgpFromPiasters(detail.targetType === "sale" ? detail.actual.originalCashReceivedPiasters : detail.actual.originalRefundPaidPiasters)}</p>
            {detail.targetType === "return" && detail.actual.exchangeCreditAppliedPiasters > 0 ? <p>رصيد الاستبدال المستخدم (ليس نقداً): {formatEgpFromPiasters(detail.actual.exchangeCreditAppliedPiasters)}</p> : null}
            {detail.targetType === "return" && detail.effective ? <p>المتبقي النقدي المستحق حالياً: {formatEgpFromPiasters(Math.max(0, detail.effective.authorizedRefundPiasters - detail.actual.exchangeCreditAppliedPiasters - detail.actual.netRefundPaidPiasters))}</p> : null}
            <p>حركات النقد الفعلية في التصحيحات: دُفع {formatEgpFromPiasters(detail.actual.correctionCashPaidOutPiasters)}، واستُرد {formatEgpFromPiasters(detail.actual.correctionCashRecoveredPiasters)}.</p>
            <p>الصافي بعد حركات النقد الصريحة: {formatEgpFromPiasters(detail.targetType === "sale" ? detail.actual.netCashReceivedPiasters : detail.actual.netRefundPaidPiasters)}</p>
            <p>حركات البضاعة المسجلة في التصحيحات: عاد {detail.actual.merchandiseRestoredQuantity}، وخرج {detail.actual.merchandiseDeductedQuantity}.</p>
            {detail.changes.length ? <ol>{detail.changes.map((change) => <li key={change.id}>{change.type === "cancellation" ? "إلغاء تسجيل" : "تصحيح تسجيل"}: {change.reason} — {change.changedByDisplayName} — {new Date(change.changedAt).toLocaleString("ar-EG")}</li>)}</ol> : <p className="muted">لم تُسجل تصحيحات سابقة.</p>}
          </section>

          {detail.status === "active" ? (
            <section className="card">
              <h2>إجراء إداري مرتبط بالأصل</h2>
              <p className="muted">القيمة الفعالة تصحح الحسابات. أدخل حركة المخزون أو النقد فقط إذا حدثت فعلياً.</p>
              <form aria-label="تصحيح أو إلغاء تسجيل" onSubmit={(event) => void save(event)}>
                <div className="field"><label htmlFor="change-type">الإجراء</label><select id="change-type" value={changeType} onChange={(event) => setChangeType(event.target.value as "correction" | "cancellation")}><option value="correction">تصحيح القيم الفعالة</option><option value="cancellation">إلغاء أثر التسجيل</option></select></div>
                {changeType === "correction" ? detail.targetType === "sale" ? <div className="field"><label htmlFor="effective-amount">إجمالي البيع المصحح بالجنيه</label><input id="effective-amount" inputMode="decimal" value={effectiveAmount} onChange={(event) => setEffectiveAmount(event.target.value)} /></div> : <div className="grid two"><div className="field"><label htmlFor="effective-amount">{detail.source.kind === "delivered_online_order" ? "استرداد البضاعة المصحح بالجنيه" : "الاسترداد المعتمد المصحح بالجنيه"}</label><input id="effective-amount" inputMode="decimal" value={effectiveAmount} onChange={(event) => setEffectiveAmount(event.target.value)} /></div>{detail.source.kind === "delivered_online_order" ? <div className="field"><label htmlFor="effective-checkout-charge">استرداد رسوم التوصيل المصحح بالجنيه</label><input id="effective-checkout-charge" inputMode="decimal" value={effectiveCheckoutCharge} onChange={(event) => setEffectiveCheckoutCharge(event.target.value)} /></div> : null}</div> : <p className="notice">الإلغاء وحده لا يعيد بضاعة إلى المخزون ولا يسجل دفعاً أو استرداداً للنقد.</p>}
                {(detail.targetType === "sale" ? detail.original.lines : []).map((line) => {
                  const id = line.saleLineId;
                  const edit = lines[id]!;
                  return <fieldset className="return-line" key={id}><legend>{line.variant.product.nameAr} — {line.variant.size.nameAr} / {line.variant.color.nameAr}</legend>{changeType === "correction" ? <div className="grid two"><div className="field"><label htmlFor={`effective-quantity-${id}`}>الكمية الصحيحة</label><input id={`effective-quantity-${id}`} type="number" min="0" value={edit.quantity} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, quantity: Math.max(0, Number(event.target.value)) } }))} /></div><div className="field"><label htmlFor={`effective-paid-${id}`}>قيمة السطر الصحيحة بالجنيه</label><input id={`effective-paid-${id}`} inputMode="decimal" value={edit.paid} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, paid: event.target.value } }))} /></div></div> : null}<div className="field"><label htmlFor={`stock-delta-${id}`}>تصحيح رصيد المخزون (+ زيادة الرصيد، − خفض الرصيد)</label><input id={`stock-delta-${id}`} type="number" value={edit.stockDelta} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, stockDelta: Number(event.target.value) } }))} /><p className="muted">يمكن زيادة الرصيد لعكس خصم تسجيل خاطئ لوحدة لم تغادر المحل. مرتجع العميل يُسجل في قسم المرتجعات.</p></div></fieldset>;
                })}
                {(detail.targetType === "return" ? detail.original.lines : []).map((line) => {
                  const id = line.returnLineId;
                  const edit = lines[id]!;
                  return <fieldset className="return-line" key={id}><legend>{line.variant.product.nameAr} — {line.variant.size.nameAr} / {line.variant.color.nameAr}</legend>{changeType === "correction" ? <div className="grid two"><div className="field"><label htmlFor={`effective-quantity-${id}`}>الكمية الصحيحة</label><input id={`effective-quantity-${id}`} type="number" min="0" value={edit.quantity} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, quantity: Math.max(0, Number(event.target.value)) } }))} /></div><div className="field"><label htmlFor={`effective-sellable-${id}`}>منها قابلة للبيع</label><input id={`effective-sellable-${id}`} type="number" min="0" max={edit.quantity} value={edit.sellableQuantity} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, sellableQuantity: Math.max(0, Number(event.target.value)) } }))} /></div></div> : null}<div className="field"><label htmlFor={`stock-delta-${id}`}>تصحيح رصيد المخزون (+ زيادة الرصيد، − خفض الرصيد)</label><input id={`stock-delta-${id}`} type="number" value={edit.stockDelta} onChange={(event) => setLines((current) => ({ ...current, [id]: { ...edit, stockDelta: Number(event.target.value) } }))} /></div></fieldset>;
                })}
                <div className="grid two"><div className="field"><label htmlFor="cash-direction">حركة النقد الفعلية</label><select id="cash-direction" value={cashDirection} onChange={(event) => setCashDirection(event.target.value as typeof cashDirection)}><option value="none">لم يتحرك نقد</option><option value="paid_out">دُفع نقد</option><option value="recovered">استُرد نقد</option></select></div>{cashDirection !== "none" ? <div className="field"><label htmlFor="cash-amount">قيمة النقد بالجنيه</label><input id="cash-amount" inputMode="decimal" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></div> : null}</div>
                <div className="field"><label htmlFor="correction-reason">سبب التصحيح</label><textarea id="correction-reason" required value={reason} onChange={(event) => setReason(event.target.value)} /></div>
                <button type="submit" disabled={busy}>حفظ الإجراء</button>
              </form>
            </section>
          ) : <div className="notice">هذا التسجيل ملغى ومحفوظ في السجل التاريخي.</div>}
        </>
      ) : null}
    </main>
  );
}

// Correction detail `reference` is the record id. Readable POS/RET numbers come from the authorized lists.
const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETURN_PAGE_LIMIT = 100;

type ReferenceResolution =
  | { kind: "stale" }
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "ready"; id: string; readableReference: string | null; enrich: boolean };

function isRecordId(value: string) {
  return RECORD_ID_PATTERN.test(value);
}

function readableListReference(reference: string | null | undefined, id: string) {
  if (typeof reference !== "string" || reference.trim() === "" || reference === id) return null;
  return reference;
}

async function resolveCorrectionTarget(
  target: "sale" | "return",
  entered: string,
  stillCurrent: () => boolean,
): Promise<ReferenceResolution> {
  if (isRecordId(entered)) return { kind: "ready", id: entered, readableReference: null, enrich: true };
  return target === "sale" ? findExactSales(entered, stillCurrent) : findExactReturns(entered, stillCurrent);
}

async function findExactSales(reference: string, stillCurrent: () => boolean): Promise<ReferenceResolution> {
  if (!stillCurrent()) return { kind: "stale" };
  const sales = await listSales();
  if (!stillCurrent()) return { kind: "stale" };
  if (!Array.isArray(sales)) throw new Error("تعذر قراءة قائمة المبيعات.");
  const matches = new Map<string, string>();
  for (const sale of sales) {
    if (sale.reference === reference && typeof sale.id === "string") matches.set(sale.id, sale.reference);
  }
  return resolutionFromMatches(matches);
}

async function findExactReturns(reference: string, stillCurrent: () => boolean): Promise<ReferenceResolution> {
  const seenCursors = new Set<string>();
  const matches = new Map<string, string>();
  let cursor: string | undefined;
  for (;;) {
    if (!stillCurrent()) return { kind: "stale" };
    const page = await listReturns(cursor ? { limit: RETURN_PAGE_LIMIT, cursor } : { limit: RETURN_PAGE_LIMIT });
    if (!stillCurrent()) return { kind: "stale" };
    if (!page || !Array.isArray(page.items)) throw new Error("تعذر قراءة قائمة المرتجعات.");
    for (const item of page.items) {
      if (item?.reference === reference && typeof item.id === "string") matches.set(item.id, item.reference);
    }
    if (matches.size > 1) return { kind: "ambiguous" };
    const next = page.nextCursor;
    if (next === null || next === undefined || next === "") break;
    if (typeof next !== "string" || !isRecordId(next) || seenCursors.has(next) || page.items.length === 0) {
      throw new Error("تعذر متابعة صفحات المرتجعات. أعد تحميل التفاصيل.");
    }
    seenCursors.add(next);
    cursor = next;
  }
  return resolutionFromMatches(matches);
}

function resolutionFromMatches(matches: Map<string, string>): ReferenceResolution {
  if (matches.size === 0) return { kind: "none" };
  if (matches.size > 1) return { kind: "ambiguous" };
  const [id, reference] = [...matches.entries()][0]!;
  return { kind: "ready", id, readableReference: reference, enrich: false };
}

async function lookupSaleReference(id: string, stillCurrent: () => boolean): Promise<string | null | "stale"> {
  if (!stillCurrent()) return "stale";
  const sales = await listSales();
  if (!stillCurrent()) return "stale";
  if (!Array.isArray(sales)) return null;
  const sale = sales.find((item) => item.id === id);
  return sale ? readableListReference(sale.reference, id) : null;
}

async function lookupReturnReference(id: string, stillCurrent: () => boolean): Promise<string | null | "stale"> {
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (!stillCurrent()) return "stale";
    const page = await listReturns(cursor ? { limit: RETURN_PAGE_LIMIT, cursor } : { limit: RETURN_PAGE_LIMIT });
    if (!stillCurrent()) return "stale";
    if (!page || !Array.isArray(page.items)) return null;
    for (const item of page.items) {
      if (item?.id === id) return readableListReference(item.reference, id);
    }
    const next = page.nextCursor;
    if (next === null || next === undefined || next === "") return null;
    if (typeof next !== "string" || !isRecordId(next) || seenCursors.has(next) || page.items.length === 0) return null;
    seenCursors.add(next);
    cursor = next;
  }
}
