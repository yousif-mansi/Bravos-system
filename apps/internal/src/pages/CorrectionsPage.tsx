import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  ReturnCorrectionDetailDto,
  SaleCorrectionDetailDto,
  WorkspaceDto,
} from "@bravos/contracts";
import {
  ApiError,
  changeReturnCorrection,
  changeSaleCorrection,
  getReturnCorrection,
  getSaleCorrection,
  type ReturnCorrectionWrite,
  type SaleCorrectionWrite,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";

type Detail = SaleCorrectionDetailDto | ReturnCorrectionDetailDto;
type LineEdit = { quantity: number; paid: string; sellableQuantity: number; stockDelta: number };

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
  const [lines, setLines] = useState<Record<string, LineEdit>>({});
  const [cashDirection, setCashDirection] = useState<"none" | "paid_out" | "recovered">("none");
  const [cashAmount, setCashAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingOperation = useRef<{ id: string; payload: string } | null>(null);

  useEffect(() => {
    if (!initialId) return;
    void loadRecord(initialTarget, initialId);
  }, []);

  async function load(event: FormEvent) {
    event.preventDefault();
    if (!recordId.trim()) return setError("أدخل مرجع البيع أو الإرجاع.");
    await loadRecord(target, recordId.trim());
  }

  async function loadRecord(nextTarget: "sale" | "return", id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = nextTarget === "sale" ? await getSaleCorrection(id) : await getReturnCorrection(id);
      select(value);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function select(value: Detail) {
    setDetail(value);
    setRecordId(value.id);
    setChangeType("correction");
    setReason("");
    setCashDirection("none");
    setCashAmount("");
    pendingOperation.current = null;
    if (value.targetType === "sale") {
      const effective = value.effective ?? value.original;
      setEffectiveAmount(piastersToEgpInput(effective.finalTotalPiasters));
      setLines(Object.fromEntries(effective.lines.map((line) => [line.saleLineId, {
        quantity: line.quantity,
        paid: piastersToEgpInput(line.paidPiasters),
        sellableQuantity: 0,
        stockDelta: 0,
      }])));
    } else {
      const effective = value.effective ?? value.original;
      setEffectiveAmount(piastersToEgpInput(effective.authorizedRefundPiasters));
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
    const cashPiasters = cashDirection === "none" ? null : egpInputToPiasters(cashAmount);
    if (changeType === "correction" && amountPiasters === null) return setError("القيمة الفعالة غير صالحة.");
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
        authorizedRefundPiasters: amountPiasters!,
        lines: detail.original.lines.map((line) => ({
          lineId: line.returnLineId,
          quantity: lines[line.returnLineId]!.quantity,
          sellableQuantity: lines[line.returnLineId]!.sellableQuantity,
        })),
      };
    }
    const stablePayload = JSON.stringify({ expectedRevision: detail.revision, changeType, reason: reason.trim(), effective, merchandise, cash });
    const operationId = pendingOperation.current?.payload === stablePayload
      ? pendingOperation.current.id
      : crypto.randomUUID();
    pendingOperation.current = { id: operationId, payload: stablePayload };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const common = { operationId, expectedRevision: detail.revision, type: changeType, reason, merchandise, cash };
      const value = detail.targetType === "sale"
        ? await changeSaleCorrection(detail.id, { ...common, effective: effective as SaleCorrectionWrite["effective"] })
        : await changeReturnCorrection(detail.id, { ...common, effective: effective as ReturnCorrectionWrite["effective"] });
      pendingOperation.current = null;
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
      <header className="brand">
        <div><h1>تصحيح التسجيلات</h1><p className="muted">للمدير فقط — مرتجعات العملاء تبقى في قسم المرتجعات</p></div>
        <Link className="button secondary" to="/workspace">مساحة العمل</Link>
      </header>
      <div className="branch-banner">المدير المسؤول: {workspace.staff.displayName}</div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card">
        <h2>فتح التسجيل الأصلي</h2>
        <form aria-label="فتح تسجيل للتصحيح" className="grid two" onSubmit={(event) => void load(event)}>
          <div className="field"><label htmlFor="correction-target">نوع التسجيل</label><select id="correction-target" value={target} onChange={(event) => { setTarget(event.target.value as "sale" | "return"); setDetail(null); }}><option value="sale">بيع نقدي مكتمل</option><option value="return">إرجاع مرحّل</option></select></div>
          <div className="field"><label htmlFor="correction-record">مرجع التسجيل</label><input id="correction-record" value={recordId} onChange={(event) => setRecordId(event.target.value)} /></div>
          <button type="submit" disabled={busy}>فتح التفاصيل</button>
        </form>
      </section>

      {detail ? (
        <>
          <section className="card" data-testid="correction-details">
            <h2>الأصل والقيمة المستخدمة حالياً</h2>
            <p>المرجع: {detail.reference}</p>
            <p>القيمة الأصلية المسجلة: {formatEgpFromPiasters(originalAmount ?? 0)}</p>
            <p>القيمة المستخدمة حالياً: {currentAmount === null || currentAmount === undefined ? "ملغاة" : formatEgpFromPiasters(currentAmount)}</p>
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
                {changeType === "correction" ? <div className="field"><label htmlFor="effective-amount">{detail.targetType === "sale" ? "إجمالي البيع المصحح بالجنيه" : "الاسترداد المعتمد المصحح بالجنيه"}</label><input id="effective-amount" inputMode="decimal" value={effectiveAmount} onChange={(event) => setEffectiveAmount(event.target.value)} /></div> : <p className="notice">الإلغاء وحده لا يعيد بضاعة إلى المخزون ولا يسجل دفعاً أو استرداداً للنقد.</p>}
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
