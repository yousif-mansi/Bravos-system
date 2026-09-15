import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ReturnDto, ReturnListItemDto, ReturnSourceDto, WorkspaceDto } from "@bravos/contracts";
import {
  ApiError,
  createReturnDraft,
  getReturn,
  listReturnSources,
  listReturns,
  payReturnRefund,
  postReturn,
  updateReturnDraft,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";

type LineSelection = { quantity: number; sellableQuantity: number };

export default function ReturnsPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [sources, setSources] = useState<ReturnSourceDto[]>([]);
  const [returns, setReturns] = useState<ReturnListItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<ReturnSourceDto | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<ReturnDto | null>(null);
  const [editingReturn, setEditingReturn] = useState<ReturnDto | null>(null);
  const [selection, setSelection] = useState<Record<string, LineSelection>>({});
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [branchId, setBranchId] = useState("");
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [authorized, setAuthorized] = useState("0");
  const [authorizedEdited, setAuthorizedEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const paymentOperationRef = useRef<string | null>(null);

  async function refresh() {
    const [nextSources, page, refreshedSelection] = await Promise.all([
      listReturnSources(),
      listReturns(),
      selectedReturn ? getReturn(selectedReturn.id) : Promise.resolve(null),
    ]);
    setSources(nextSources);
    setReturns(page.items);
    setNextCursor(page.nextCursor);
    if (refreshedSelection) setSelectedReturn(refreshedSelection);
  }

  useEffect(() => {
    void refresh().catch(showError);
  }, []);

  const suggestion = useMemo(() => {
    if (!selectedSource) return 0;
    return selectedSource.lines.reduce((total, line) => {
      let needed = selection[line.saleLineId]?.quantity ?? 0;
      let lineTotal = 0;
      for (const range of line.availablePaidRanges) {
        if (needed <= 0) break;
        const take = Math.min(needed, range.quantity);
        lineTotal += take * range.paidUnitPiasters;
        needed -= take;
      }
      return total + lineTotal;
    }, 0);
  }, [selectedSource, selection]);

  useEffect(() => {
    if (!authorizedEdited) setAuthorized(piastersToEgpInput(suggestion));
  }, [suggestion, authorizedEdited]);

  function selectSource(source: ReturnSourceDto) {
    paymentOperationRef.current = null;
    setSelectedSource(source);
    setSelectedReturn(null);
    setEditingReturn(null);
    setSelection(Object.fromEntries(source.lines.map((line) => [line.saleLineId, { quantity: 0, sellableQuantity: 0 }])));
    setAuthorized("0");
    setAuthorizedEdited(false);
    setError("");
    setNotice("");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const amountPiasters = amount.trim() ? egpInputToPiasters(amount) : undefined;
      if (amount.trim() && amountPiasters === null) throw new Error("قيمة البحث غير صالحة.");
      const next = await listReturnSources({
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(date ? { date } : {}),
        ...(branchId ? { branchId } : {}),
        ...(item.trim() ? { item: item.trim() } : {}),
        ...(amountPiasters !== undefined && amountPiasters !== null ? { amountPiasters } : {}),
      });
      setSources(next);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!selectedSource || !workspace.activeBranch) return;
    const refund = egpInputToPiasters(authorized);
    const lines = selectedSource.lines.flatMap((line) => {
      const value = selection[line.saleLineId];
      return value && value.quantity > 0
        ? [{ sourceSaleLineId: line.saleLineId, quantity: value.quantity, sellableQuantity: value.sellableQuantity }]
        : [];
    });
    if (lines.length === 0) return setError("اختر كمية مرتجعة واحدة على الأقل.");
    if (refund === null) return setError("قيمة الاسترداد المعتمدة غير صالحة.");
    setBusy(true);
    setError("");
    try {
      const value = editingReturn
        ? await updateReturnDraft(editingReturn.id, {
            expectedRevision: editingReturn.revision,
            handlingBranchId: editingReturn.handlingBranch.id,
            authorizedRefundPiasters: refund,
            lines,
          })
        : await createReturnDraft({
            returnId: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            sourceSaleId: selectedSource.saleId,
            handlingBranchId: workspace.activeBranch.id,
            authorizedRefundPiasters: refund,
            lines,
          });
      setSelectedReturn(value);
      setEditingReturn(null);
      setNotice(editingReturn
        ? "تم تحديث المسودة دون تغيير المخزون أو النقد."
        : "حُفظت المسودة دون تغيير المخزون أو النقد.");
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (!selectedReturn) return;
    setBusy(true);
    setError("");
    try {
      const value = await postReturn(selectedReturn.id, selectedReturn.revision);
      setSelectedReturn(value);
      setNotice("تم ترحيل الإرجاع واستعادة الكميات القابلة للبيع فقط.");
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!selectedReturn) return;
    setBusy(true);
    setError("");
    try {
      const operationId = paymentOperationRef.current ?? crypto.randomUUID();
      paymentOperationRef.current = operationId;
      const value = await payReturnRefund(selectedReturn.id, selectedReturn.authorizedRefundPiasters, operationId);
      paymentOperationRef.current = null;
      setSelectedReturn(value);
      setNotice("تم تسجيل دفع الاسترداد النقدي.");
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function openReturn(id: string) {
    setBusy(true);
    setError("");
    try {
      const value = await getReturn(id);
      paymentOperationRef.current = null;
      setSelectedReturn(value);
      setSelectedSource(null);
      setEditingReturn(null);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function editSelectedDraft() {
    if (!selectedReturn || selectedReturn.status !== "draft") return;
    setEditingReturn(selectedReturn);
    setSelectedSource(selectedReturn.source);
    setSelection(Object.fromEntries(selectedReturn.source.lines.map((sourceLine) => {
      const line = selectedReturn.lines.find((candidate) => candidate.sourceSaleLineId === sourceLine.saleLineId);
      return [sourceLine.saleLineId, {
        quantity: line?.quantity ?? 0,
        sellableQuantity: line?.sellableQuantity ?? 0,
      }];
    })));
    setAuthorized(piastersToEgpInput(selectedReturn.authorizedRefundPiasters));
    setAuthorizedEdited(true);
    setSelectedReturn(null);
    setError("");
    setNotice("");
  }

  async function loadMoreReturns() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const page = await listReturns({ cursor: nextCursor });
      setReturns((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function showError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.messageAr : caught instanceof Error ? caught.message : "تعذر إكمال العملية.");
  }

  return (
    <main className="shell returns-page">
      <header className="brand">
        <div><h1>المرتجعات</h1><p className="muted">استلام وفحص مستقل عن نقطة البيع</p></div>
        <Link className="button secondary" to="/workspace">مساحة العمل</Link>
      </header>
      <div className="branch-banner" data-testid="return-handling-branch">فرع معالجة الإرجاع: {workspace.activeBranch?.nameAr}</div>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card">
        <h2>اختيار البيع الأصلي</h2>
        <form aria-label="البحث عن البيع الأصلي" className="return-search" onSubmit={(event) => void search(event)}>
          <div className="field"><label htmlFor="return-reference">المرجع</label><input id="return-reference" value={reference} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="field"><label htmlFor="return-date">تاريخ البيع</label><input id="return-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="field"><label htmlFor="return-branch">الفرع الأصلي</label><select id="return-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">كل الفروع</option>{workspace.authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}</select></div>
          <div className="field"><label htmlFor="return-item">الصنف</label><input id="return-item" value={item} onChange={(event) => setItem(event.target.value)} /></div>
          <div className="field"><label htmlFor="return-amount">إجمالي البيع بالجنيه</label><input id="return-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <button type="submit" disabled={busy}>بحث</button>
        </form>
        <div className="return-source-list" data-testid="return-source-list">
          {sources.map((source) => (
            <button className="return-source" type="button" key={source.saleId} onClick={() => selectSource(source)}>
              <strong>{source.reference}</strong><span>{source.originalBranch.nameAr} · {new Date(source.receivedAt).toLocaleString("ar-EG")}</span><span>{formatEgpFromPiasters(source.finalTotalPiasters)} · {source.lines.map((line) => line.variant.product.nameAr).join("، ")}</span>
            </button>
          ))}
          {sources.length === 0 ? <p className="empty">لا توجد مبيعات مطابقة.</p> : null}
        </div>
      </section>

      {selectedSource && !selectedReturn ? (
        <section className="card return-editor">
          <h2>{editingReturn ? "تعديل مسودة الإرجاع" : "مسودة إرجاع"}</h2>
          <p>البيع من {selectedSource.originalBranch.nameAr} بواسطة {selectedSource.soldByDisplayName}. لا يشترط وجود هاتف للعميل.</p>
          <form aria-label={editingReturn ? "تعديل مسودة إرجاع" : "إنشاء مسودة إرجاع"} onSubmit={(event) => void saveDraft(event)}>
            {selectedSource.lines.map((line) => {
              const value = selection[line.saleLineId] ?? { quantity: 0, sellableQuantity: 0 };
              return <fieldset key={line.saleLineId} className="return-line"><legend>{line.variant.product.nameAr} — {line.variant.size.nameAr} / {line.variant.color.nameAr}</legend><p>المتاح للإرجاع: {line.remainingQuantity} · القيمة المتبقية: {formatEgpFromPiasters(line.remainingSuggestedPiasters)}</p><div className="grid two"><div className="field"><label htmlFor={`qty-${line.saleLineId}`}>الكمية المستلمة</label><input id={`qty-${line.saleLineId}`} type="number" min="0" max={line.remainingQuantity} value={value.quantity} onChange={(event) => { const quantity = Math.max(0, Math.min(line.remainingQuantity, Number(event.target.value))); setSelection((current) => ({ ...current, [line.saleLineId]: { quantity, sellableQuantity: Math.min(current[line.saleLineId]?.sellableQuantity ?? 0, quantity) } })); }} /></div><div className="field"><label htmlFor={`sellable-${line.saleLineId}`}>منها قابلة للبيع بعد الفحص</label><input id={`sellable-${line.saleLineId}`} type="number" min="0" max={value.quantity} value={value.sellableQuantity} onChange={(event) => { const sellableQuantity = Math.max(0, Math.min(value.quantity, Number(event.target.value))); setSelection((current) => ({ ...current, [line.saleLineId]: { ...value, sellableQuantity } })); }} /></div></div></fieldset>;
            })}
            <p data-testid="refund-suggestion">الاقتراح من القيمة المدفوعة: {formatEgpFromPiasters(suggestion)}</p>
            <div className="field"><label htmlFor="authorized-refund">قيمة الاسترداد المعتمدة بالجنيه</label><input id="authorized-refund" inputMode="decimal" value={authorized} onChange={(event) => { setAuthorized(event.target.value); setAuthorizedEdited(true); }} /></div>
            <button type="submit" disabled={busy}>{editingReturn ? "حفظ التعديلات" : "حفظ المسودة"}</button>
          </form>
        </section>
      ) : null}

      <section className="card">
        <h2>سجل المرتجعات</h2>
        <div className="return-history">{returns.map((row) => <button className="return-source" type="button" key={row.id} onClick={() => void openReturn(row.id)}><strong>{row.sourceReference}</strong><span>{row.status === "draft" ? "مسودة" : "مرحّل"} · {row.originalBranch.nameAr} ← {row.handlingBranch.nameAr}</span><span>{formatEgpFromPiasters(row.authorizedRefundPiasters)} · {row.refundStatus === "paid" ? "مدفوع" : row.refundStatus === "owed" ? "مستحق" : "بلا التزام نقدي"}</span></button>)}</div>
        {nextCursor ? <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreReturns()}>تحميل مرتجعات أقدم</button> : null}
      </section>

      {selectedReturn ? (
        <section className="card" data-testid="return-details">
          <h2>تفاصيل الإرجاع</h2>
          <p>الأصل: {selectedReturn.source.reference} · {selectedReturn.source.originalBranch.nameAr}</p>
          <p>المعالجة: {selectedReturn.handlingBranch.nameAr} · الحالة: {selectedReturn.status === "draft" ? "مسودة بلا آثار" : "مرحّل بعد الاستلام والفحص"}</p>
          <p>المقترح: {formatEgpFromPiasters(selectedReturn.suggestedRefundPiasters)} · المعتمد: {formatEgpFromPiasters(selectedReturn.authorizedRefundPiasters)}</p>
          <ul>{selectedReturn.lines.map((line) => <li key={line.id}>{line.variant.product.nameAr}: {line.quantity} مستلم، {line.sellableQuantity} قابل للبيع، {line.unsellableQuantity} غير قابل للبيع</li>)}</ul>
          {selectedReturn.status === "draft" ? <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={editSelectedDraft}>تعديل المسودة</button><button type="button" disabled={busy} onClick={() => void post()}>تأكيد الاستلام والفحص وترحيل الإرجاع</button></div> : null}
          {selectedReturn.status === "posted" && selectedReturn.refund.status === "owed" ? <button type="button" disabled={busy} onClick={() => void pay()}>تسجيل دفع {formatEgpFromPiasters(selectedReturn.authorizedRefundPiasters)}</button> : null}
          {selectedReturn.refund.status === "paid" ? <p className="notice">دُفع {formatEgpFromPiasters(selectedReturn.refund.paidPiasters)} بواسطة المدير في {selectedReturn.refund.recordedAt ? new Date(selectedReturn.refund.recordedAt).toLocaleString("ar-EG") : "—"}</p> : selectedReturn.refund.status === "owed" ? <p className="notice">الاسترداد النقدي مستحق ولم يُدفع بعد.</p> : <p className="notice">المسودة لا تنشئ التزاماً نقدياً قبل ترحيل الاستلام والفحص.</p>}
        </section>
      ) : null}
    </main>
  );
}
