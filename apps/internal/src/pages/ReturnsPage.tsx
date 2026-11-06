import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CashierProductLookupDto, ReturnDto, ReturnExchangeQuoteDto, ReturnListItemDto, ReturnSourceDto, WorkspaceDto } from "@bravos/contracts";
import {
  ApiError,
  listCashierCatalog,
} from "../api.ts";
import {
  completeReturnExchange,
  createReturnDraft,
  getReturn,
  listReturnSourcesPage,
  type ReturnSourceSearch,
  listReturns,
  payReturnRefund,
  postReturn,
  quoteReturnExchange,
  updateReturnDraft,
} from "../returns-api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { officialSaleNumber, RECEIPT_NUMBER_CONFLICT } from "../receipt-number.ts";
import { calculateReturnRefundSuggestion, type ReturnLineSelection } from "../return-refund.ts";
import "./ReturnsPage.css";
import { EmptyState } from "../ui/EmptyState.tsx";
import { DetailPanel, Modal } from "../ui/BusinessUi.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import { accountGeneration } from "../account-session.ts";
import {
  assignPendingReturnAttempt,
  clearPendingReturnAttempt,
  pendingReturnStorageKey,
  readPendingReturnAttempt,
  type PendingReturnAttempt,
  withPendingReturnLock,
} from "../returns-pending.ts";

function sourceHeading(source: ReturnSourceDto): string {
  if (source.channel === "online") return `طلب ${source.reference}`;
  return `إيصال ${officialSaleNumber({
    receiptReference: source.receiptReference ?? null,
    reference: source.reference,
    blockedIds: [source.source.id],
  })}`;
}

export default function ReturnsPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [searchParams] = useSearchParams();
  const linkedReturnId = searchParams.get("returnId")?.trim() || null;
  const [sources, setSources] = useState<ReturnSourceDto[]>([]);
  const [sourceNextCursor, setSourceNextCursor] = useState<string | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reason, setReason] = useState("");
  const submittedSearch = useRef<ReturnSourceSearch>({});
  const sourceRequest = useRef(0);
  const historyRequest = useRef(0);
  const mounted = useRef(true);
  const staffRef = useRef(workspace.staff.id);
  staffRef.current = workspace.staff.id;
  const [returns, setReturns] = useState<ReturnListItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<ReturnSourceDto | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<ReturnDto | null>(null);
  const [editingReturn, setEditingReturn] = useState<ReturnDto | null>(null);
  const [selection, setSelection] = useState<ReturnLineSelection>({});
  const [lookup, setLookup] = useState("");
  const [lookupType, setLookupType] = useState<"reference" | "phone">("reference");
  const [date, setDate] = useState("");
  const [branchId, setBranchId] = useState("");
  const [amount, setAmount] = useState("");
  const [authorizedMerchandise, setAuthorizedMerchandise] = useState("0");
  const [authorizedCheckoutCharge, setAuthorizedCheckoutCharge] = useState("0");
  const [authorizedEdited, setAuthorizedEdited] = useState(false);
  const [handlingBranchId, setHandlingBranchId] = useState(workspace.activeBranch?.id ?? "");
  const [exchangeCatalog, setExchangeCatalog] = useState<CashierProductLookupDto[]>([]);
  const [replacementVariantId, setReplacementVariantId] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState(1);
  const [replacementBasket, setReplacementBasket] = useState<Array<{ variantId: string; quantity: number }>>([]);
  const [exchangeQuote, setExchangeQuote] = useState<ReturnExchangeQuoteDto | null>(null);
  const [cashRefundStatus, setCashRefundStatus] = useState<"owed" | "paid">("owed");
  const [busy, setBusy] = useState(false);
  const [loadingReturnId, setLoadingReturnId] = useState<string | null>(null);
  const sourceFeedback = useRevealFeedback<HTMLElement>();
  const detailsFeedback = useRevealFeedback<HTMLDivElement>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertainAttempt, setUncertainAttempt] = useState<PendingReturnAttempt | null>(() => readPendingReturnAttempt(workspace.staff.id));
  const exchangeIdentityRef = useRef<{
    exchangeId: string;
    operationId: string;
    replacementSaleId: string;
    replacementSaleOperationId: string;
  } | null>(null);
  const exchangeQuoteIdRef = useRef<string | null>(null);
  const linkedReturnRequest = useRef(0);

  function accountGuard() {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    return (checkEpoch = true) => mounted.current && staffRef.current === staffId && (!checkEpoch || accountGeneration() === epoch);
  }

  async function fetchSources(filters: ReturnSourceSearch, cursor?: string) {
    const token = ++sourceRequest.current;
    const accountCurrent = accountGuard();
    const current = (checkEpoch = true) => accountCurrent(checkEpoch) && sourceRequest.current === token;
    setSourceBusy(true);
    try {
      const page = await listReturnSourcesPage(filters, { limit: 25, ...(cursor ? { cursor } : {}) });
      if (!current()) return;
      setSources((previous) => cursor
        ? [...previous, ...page.items.filter((item) => !previous.some((old) => old.source.kind === item.source.kind && old.source.id === item.source.id))]
        : page.items);
      setSourceNextCursor(page.nextCursor);
    } catch (caught) {
      if (current()) showError(caught);
    } finally {
      if (current(false)) setSourceBusy(false);
    }
  }

  async function refresh() {
    const token = ++historyRequest.current;
    const accountCurrent = accountGuard();
    const [page] = await Promise.all([
      listReturns(),
      fetchSources(submittedSearch.current),
    ]);
    if (!accountCurrent() || historyRequest.current !== token) return;
    setReturns(page.items);
    setNextCursor(page.nextCursor);
  }

  useEffect(() => {
    mounted.current = true;
    const current = accountGuard();
    submittedSearch.current = {};
    setSources([]);
    setSourceNextCursor(null);
    setReturns([]);
    setNextCursor(null);
    setSelectedSource(null);
    setSelectedReturn(null);
    setEditingReturn(null);
    setReason("");
    setBusy(false);
    void Promise.all([refresh(), listCashierCatalog().then((catalog) => {
      if (current()) setExchangeCatalog(catalog);
    })]).catch((caught: unknown) => { if (current()) showError(caught); });
    return () => {
      mounted.current = false;
      sourceRequest.current += 1;
      historyRequest.current += 1;
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    if (!linkedReturnId) return;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = ++linkedReturnRequest.current;
    let cancelled = false;
    const stillCurrent = (checkEpoch = true) => !cancelled
      && mounted.current && staffRef.current === staffId
      && (!checkEpoch || accountGeneration() === epoch)
      && linkedReturnRequest.current === token;
    setBusy(true);
    setError("");
    void getReturn(linkedReturnId).then((value) => {
      if (!stillCurrent()) return;
      setSelectedReturn(value);
      setSelectedSource(null);
      setEditingReturn(null);
      setHistoryOpen(true);
      detailsFeedback.reveal();
    }).catch((caught: unknown) => {
      if (stillCurrent()) showError(caught);
    }).finally(() => {
      if (stillCurrent(false)) setBusy(false);
    });
    return () => {
      cancelled = true;
      if (linkedReturnRequest.current === token) linkedReturnRequest.current += 1;
    };
  }, [linkedReturnId, workspace.staff.id]);

  useEffect(() => {
    const key = pendingReturnStorageKey(workspace.staff.id);
    setUncertainAttempt(readPendingReturnAttempt(workspace.staff.id));
    function onStorage(event: StorageEvent) {
      if (event.key === key) setUncertainAttempt(readPendingReturnAttempt(workspace.staff.id));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  const replacementOptions = useMemo(() => exchangeCatalog.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant }))), [exchangeCatalog]);

  useEffect(() => {
    if (!replacementVariantId && replacementOptions[0]) {
      setReplacementVariantId(replacementOptions[0].variant.id);
    }
  }, [replacementOptions, replacementVariantId]);

  useEffect(() => {
    if (exchangeQuote && selectedReturn
      && (exchangeQuote.returnRevision !== selectedReturn.revision
        || exchangeQuote.correctionRevision !== selectedReturn.correctionRevision
        || exchangeQuote.creditAvailablePiasters !== selectedReturn.authorizedRefundPiasters
        || selectedReturn.refund.paidPiasters > 0)) {
      resetExchangeQuote();
    }
  }, [exchangeQuote, selectedReturn]);

  const suggestion = useMemo(() => calculateReturnRefundSuggestion(selectedSource, selection), [selectedSource, selection]);

  useEffect(() => {
    if (!authorizedEdited) {
      setAuthorizedMerchandise(piastersToEgpInput(suggestion.merchandisePiasters));
      setAuthorizedCheckoutCharge(piastersToEgpInput(suggestion.checkoutChargePiasters));
    }
  }, [suggestion, authorizedEdited]);

  function confirmLeavingDraft() {
    return !selectedSource || (!editingReturn && !reason.trim() && !authorizedEdited
      && handlingBranchId === (workspace.activeBranch?.id ?? "")
      && !Object.values(selection).some((line) => line.quantity > 0))
      || window.confirm("لديك تغييرات غير محفوظة في المرتجع. هل تريد تركها؟");
  }

  function selectSource(source: ReturnSourceDto) {
    if (!confirmLeavingDraft()) return;
    linkedReturnRequest.current += 1;
    setReason("");
    exchangeIdentityRef.current = null;
    exchangeQuoteIdRef.current = null;
    setExchangeQuote(null);
    setReplacementBasket([]);
    setSelectedSource(source);
    setLookupOpen(false);
    setSelectedReturn(null);
    setEditingReturn(null);
    setHandlingBranchId(workspace.activeBranch?.id ?? "");
    setSelection(Object.fromEntries(source.lines.map((line) => [line.sourceLineId, { quantity: 0, sellableQuantity: 0 }])));
    setAuthorizedMerchandise("0");
    setAuthorizedCheckoutCharge("0");
    setAuthorizedEdited(false);
    setError("");
    setNotice("");
    sourceFeedback.reveal();
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!confirmLeavingDraft()) return;
    setError("");
    try {
      const amountPiasters = amount.trim() ? egpInputToPiasters(amount) : undefined;
      if (amount.trim() && amountPiasters === null) throw new Error("قيمة البحث غير صالحة.");
      const filters: ReturnSourceSearch = {
        ...(lookup.trim() ? { [lookupType]: lookup.trim() } : {}),
        ...(date ? { date } : {}),
        ...(branchId ? { branchId } : {}),
        ...(amountPiasters !== undefined && amountPiasters !== null ? { amountPiasters } : {}),
      };
      submittedSearch.current = filters;
      linkedReturnRequest.current += 1;
      setSelectedSource(null);
      setSelectedReturn(null);
      setEditingReturn(null);
      setSources([]);
      setSourceNextCursor(null);
      await fetchSources(filters);
    } catch (caught) {
      showError(caught);
    }
  }

  async function loadMoreSources() {
    if (!sourceNextCursor || sourceBusy) return;
    setError("");
    await fetchSources(submittedSearch.current, sourceNextCursor);
  }

  function reviewReturn(event: FormEvent) {
    event.preventDefault();
    if (!selectedSource || !handlingBranchId) return;
    if (!Object.values(selection).some((line) => line.quantity > 0)) {
      setError("اختر كمية مرتجعة واحدة على الأقل.");
      return;
    }
    if (egpInputToPiasters(authorizedMerchandise) === null || egpInputToPiasters(authorizedCheckoutCharge) === null) {
      setError("تفاصيل الاسترداد المعتمد غير صالحة.");
      return;
    }
    setError("");
    setReviewOpen(true);
  }

  async function saveDraft(event: { preventDefault(): void }, finalize = false) {
    event.preventDefault();
    if (!selectedSource || !handlingBranchId) return;
    const merchandisePiasters = egpInputToPiasters(authorizedMerchandise);
    const checkoutChargePiasters = egpInputToPiasters(authorizedCheckoutCharge);
    const lines = selectedSource.lines.flatMap((line) => {
      const value = selection[line.sourceLineId];
      return value && value.quantity > 0
        ? [{ sourceLineId: line.sourceLineId, quantity: value.quantity, sellableQuantity: value.sellableQuantity }]
        : [];
    });
    if (lines.length === 0) return setError("اختر كمية مرتجعة واحدة على الأقل.");
    if (merchandisePiasters === null || checkoutChargePiasters === null) return setError("تفاصيل الاسترداد المعتمد غير صالحة.");
    setBusy(true);
    setError("");
    try {
      let value: ReturnDto | null;
      if (editingReturn) {
        value = await updateReturnDraft(editingReturn.id, {
            expectedRevision: editingReturn.revision,
            handlingBranchId,
            reason: reason.trim() || null,
            authorizedRefund: { merchandisePiasters, checkoutChargePiasters },
            lines,
          });
      } else {
        const operationId = crypto.randomUUID();
        const payload: Parameters<typeof createReturnDraft>[0] = {
            returnId: crypto.randomUUID(),
            operationId,
            source: selectedSource.source,
            handlingBranchId,
            reason: reason.trim() || null,
            authorizedRefund: { merchandisePiasters, checkoutChargePiasters },
            lines,
        };
        value = await executeAttempt({ staffId: workspace.staff.id, action: "create", operationId, payload });
      }
      if (!value) return;
      setSelectedReturn(value);
      setSelectedSource(null);
      setEditingReturn(null);
      setHistoryOpen(true);
      detailsFeedback.reveal();
      setNotice(editingReturn
        ? "تم تحديث المسودة دون تغيير المخزون أو النقد."
        : "حُفظت المسودة دون تغيير المخزون أو النقد.");
      if (finalize) {
        const posted = await executeAttempt({
          staffId: workspace.staff.id,
          action: "post",
          operationId: crypto.randomUUID(),
          payload: { returnId: value.id, expectedRevision: value.revision },
        });
        if (!posted) return;
        setSelectedReturn(posted);
        setNotice("تم تأكيد المرتجع وإعادة القطع الصالحة للبيع إلى المخزون. سجّل دفع المبلغ عند دفعه فعلياً.");
      }
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
      const value = await executeAttempt({
        staffId: workspace.staff.id,
        action: "post",
        operationId: crypto.randomUUID(),
        payload: { returnId: selectedReturn.id, expectedRevision: selectedReturn.revision },
      });
      if (!value) return;
      setSelectedReturn(value);
      setNotice("تم تأكيد المرتجع وإعادة القطع الصالحة للبيع إلى المخزون.");
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
      const operationId = crypto.randomUUID();
      const value = await executeAttempt({
        staffId: workspace.staff.id,
        action: "refund",
        operationId,
        payload: { returnId: selectedReturn.id, amountPiasters: selectedReturn.refund.owedPiasters, operationId },
      });
      if (!value) return;
      setSelectedReturn(value);
      setNotice("تم تسجيل دفع الاسترداد النقدي.");
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  function resetExchangeQuote() {
    exchangeQuoteIdRef.current = null;
    exchangeIdentityRef.current = null;
    setExchangeQuote(null);
  }

  function addReplacementLine() {
    if (!replacementVariantId) return;
    setReplacementBasket((current) => {
      const existing = current.find((line) => line.variantId === replacementVariantId);
      return existing
        ? current.map((line) => line.variantId === replacementVariantId
          ? { ...line, quantity: line.quantity + replacementQuantity }
          : line)
        : [...current, { variantId: replacementVariantId, quantity: replacementQuantity }];
    });
    resetExchangeQuote();
  }

  function removeReplacementLine(variantId: string) {
    setReplacementBasket((current) => current.filter((line) => line.variantId !== variantId));
    resetExchangeQuote();
  }

  async function previewExchange() {
    if (!selectedReturn || replacementBasket.length === 0) return;
    const quoteId = exchangeQuoteIdRef.current ?? crypto.randomUUID();
    const identity = exchangeIdentityRef.current ?? {
      exchangeId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      replacementSaleId: crypto.randomUUID(),
      replacementSaleOperationId: crypto.randomUUID(),
    };
    exchangeQuoteIdRef.current = quoteId;
    exchangeIdentityRef.current = identity;
    setBusy(true);
    setError("");
    try {
      const value = await quoteReturnExchange(selectedReturn.id, {
        quoteId,
        ...identity,
        expectedRevision: selectedReturn.revision,
        replacementLines: replacementBasket,
      });
      setExchangeQuote(value);
      setNotice("راجع سعر البضاعة ورصيد الإرجاع وفرق النقد قبل التأكيد.");
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function exchange(event: FormEvent) {
    event.preventDefault();
    if (!selectedReturn || !exchangeQuote) return;
    const identity = exchangeIdentityRef.current ?? {
      exchangeId: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      replacementSaleId: crypto.randomUUID(),
      replacementSaleOperationId: crypto.randomUUID(),
    };
    exchangeIdentityRef.current = identity;
    setBusy(true);
    setError("");
    try {
      const input = {
        ...identity,
        receivedAndInspected: true,
        expectedRevision: selectedReturn.revision,
        cashRefundStatus,
        quoteId: exchangeQuote.id,
      } as const;
      const value = await executeAttempt({
        staffId: workspace.staff.id,
        action: "exchange",
        operationId: identity.operationId,
        payload: { returnId: selectedReturn.id, input },
      });
      if (!value) return;
      exchangeIdentityRef.current = null;
      exchangeQuoteIdRef.current = null;
      setExchangeQuote(null);
      setReplacementBasket([]);
      setSelectedReturn(value);
      setNotice("تم إتمام الاستبدال وتسجيل فرق النقد الفعلي.");
      await refresh();
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function executeAttempt(candidate: PendingReturnAttempt): Promise<ReturnDto | null> {
    return withPendingReturnLock(candidate.staffId, async () => {
      const assignment = assignPendingReturnAttempt(candidate);
      if (assignment.kind === "blocked") {
        setUncertainAttempt(assignment.attempt);
        setError("توجد عملية مرتجع سابقة لم نعرف نتيجتها. أعد محاولة العملية نفسها قبل بدء عملية جديدة.");
        return null;
      }
      const attempt = assignment.attempt;
      setUncertainAttempt(attempt);
      try {
        const value = await dispatchAttempt(attempt);
        clearPendingReturnAttempt(attempt.staffId, attempt.operationId);
        setUncertainAttempt(null);
        return value;
      } catch (caught) {
        if (attempt.action === "post" && caught instanceof ApiError && caught.status === 409) {
          const current = await getReturn(attempt.payload.returnId);
          if (current.status === "posted" && current.revision > attempt.payload.expectedRevision) {
            clearPendingReturnAttempt(attempt.staffId, attempt.operationId);
            setUncertainAttempt(null);
            return current;
          }
        }
        if (caught instanceof ApiError && caught.status < 500) {
          clearPendingReturnAttempt(attempt.staffId, attempt.operationId);
          setUncertainAttempt(null);
        }
        throw caught;
      }
    });
  }

  function dispatchAttempt(attempt: PendingReturnAttempt) {
    switch (attempt.action) {
      case "create": return createReturnDraft(attempt.payload);
      case "post": return postReturn(attempt.payload.returnId, attempt.payload.expectedRevision);
      case "refund": return payReturnRefund(attempt.payload.returnId, attempt.payload.amountPiasters, attempt.payload.operationId);
      case "exchange": return completeReturnExchange(attempt.payload.returnId, attempt.payload.input);
    }
  }

  async function retryUncertainAttempt() {
    if (!uncertainAttempt || uncertainAttempt.staffId !== workspace.staff.id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await executeAttempt(uncertainAttempt);
      if (!value) return;
      setSelectedReturn(value);
      setSelectedSource(null);
      setEditingReturn(null);
      setHistoryOpen(true);
      setNotice("تم العثور على نتيجة العملية السابقة وإكمالها بنفس المعرّف.");
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status < 500) showError(caught);
      else setError("ما زالت نتيجة العملية غير مؤكدة. أعد المحاولة بنفس العملية بعد عودة الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  async function openReturn(id: string) {
    if (!confirmLeavingDraft()) return;
    const token = ++linkedReturnRequest.current;
    const accountCurrent = accountGuard();
    const current = (checkEpoch = true) => accountCurrent(checkEpoch) && linkedReturnRequest.current === token;
    setBusy(true);
    setLoadingReturnId(id);
    setError("");
    try {
      const value = await getReturn(id);
      if (!current()) return;
      exchangeIdentityRef.current = null;
      exchangeQuoteIdRef.current = null;
      setExchangeQuote(null);
      setReplacementBasket([]);
      setSelectedReturn(value);
      setSelectedSource(null);
      setEditingReturn(null);
      setHistoryOpen(true);
      detailsFeedback.reveal();
    } catch (caught) {
      if (current()) showError(caught);
    } finally {
      if (current(false)) { setBusy(false); setLoadingReturnId(null); }
    }
  }

  function editSelectedDraft() {
    if (!selectedReturn || selectedReturn.status !== "draft") return;
    setEditingReturn(selectedReturn);
    setReason(selectedReturn.reason ?? "");
    setHandlingBranchId(selectedReturn.handlingBranch.id);
    setSelectedSource(selectedReturn.source);
    setLookupOpen(false);
    setSelection(Object.fromEntries(selectedReturn.source.lines.map((sourceLine) => {
      const line = selectedReturn.lines.find((candidate) => candidate.sourceLineId === sourceLine.sourceLineId);
      return [sourceLine.sourceLineId, {
        quantity: line?.quantity ?? 0,
        sellableQuantity: line?.sellableQuantity ?? 0,
      }];
    })));
    setAuthorizedMerchandise(piastersToEgpInput(selectedReturn.authorizedRefund.merchandisePiasters));
    setAuthorizedCheckoutCharge(piastersToEgpInput(selectedReturn.authorizedRefund.checkoutChargePiasters));
    setAuthorizedEdited(true);
    setSelectedReturn(null);
    setError("");
    setNotice("");
    sourceFeedback.reveal();
  }

  async function loadMoreReturns() {
    if (!nextCursor) return;
    const token = ++historyRequest.current;
    const accountCurrent = accountGuard();
    const current = (checkEpoch = true) => accountCurrent(checkEpoch) && historyRequest.current === token;
    setBusy(true);
    try {
      const page = await listReturns({ cursor: nextCursor });
      if (!current()) return;
      setReturns((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (current()) showError(caught);
    } finally {
      if (current(false)) setBusy(false);
    }
  }

  function showError(caught: unknown) {
    setError(caught instanceof ApiError ? caught.messageAr : caught instanceof Error ? caught.message : "تعذر إكمال العملية.");
  }

  return (
    <main className="shell business-page returns-page">
      <header className="business-page-header">
        <h1>المرتجعات</h1>
      </header>
      <div className="branch-banner" data-testid="return-handling-branch">الفرع النشط: {workspace.activeBranch?.nameAr} · اختر فرع استلام المرتجع داخل المسودة</div>
      {error ? <div className="error point-feedback" role="alert">{error}</div> : null}
      {notice ? <div className="notice point-feedback" role="status">{notice}</div> : null}
      {uncertainAttempt ? <div className="notice" data-testid="pending-return-attempt"><p>توجد عملية مرتجع لم يصل تأكيد نتيجتها. ستُعاد بنفس البيانات ومعرّف العملية لمنع تكرار المخزون أو النقد.</p><button type="button" disabled={busy} onClick={() => void retryUncertainAttempt()}>إعادة محاولة العملية السابقة نفسها</button></div> : null}

      <details className="card return-search-section" open={lookupOpen} onToggle={(event) => setLookupOpen(event.currentTarget.open)}>
        <summary><strong>{selectedSource ? "تغيير المعاملة الأصلية" : "اختيار المعاملة الأصلية"}</strong></summary>
        <form aria-label="البحث عن المعاملة الأصلية — البحث عن البيع الأصلي" className="return-search" onSubmit={(event) => void search(event)}>
          <div className="return-lookup">
            <div className="field"><label htmlFor="return-lookup-type">البحث باستخدام</label><select id="return-lookup-type" value={lookupType} onChange={(event) => setLookupType(event.target.value as "reference" | "phone")}><option value="reference">رقم الإيصال أو الطلب</option><option value="phone">هاتف العميل</option></select></div>
            <div className="field return-lookup-input"><label htmlFor="return-lookup">رقم الإيصال أو الطلب أو هاتف العميل</label><input id="return-lookup" inputMode={lookupType === "phone" ? "tel" : "text"} value={lookup} onChange={(event) => setLookup(event.target.value)} /></div>
            <button type="submit" disabled={busy || sourceBusy}>{sourceBusy ? "جارٍ البحث…" : "بحث"}</button>
          </div>
          <details className="business-secondary-details"><summary>فلاتر إضافية</summary><div className="business-field-grid">
            <div className="field"><label htmlFor="return-date">تاريخ الاستلام</label><input id="return-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
            <div className="field"><label htmlFor="return-branch">فرع البيع الأصلي</label><select id="return-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">كل الفروع والطلبات الأونلاين</option>{workspace.authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}</select></div>
            <div className="field"><label htmlFor="return-amount">إجمالي المعاملة بالجنيه</label><input id="return-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          </div></details>
        </form>
        <div className="business-table-wrap" data-testid="return-source-list">
          {sources.length > 0 ? <table className="business-table"><thead><tr><th>المعاملة</th><th>العميل والتاريخ</th><th>الفرع</th><th>الإجمالي</th><th><span className="return-sr-only">اختيار</span></th></tr></thead><tbody>
            {sources.map((source) => <tr key={`${source.source.kind}:${source.source.id}`}><td><strong>{sourceHeading(source)}</strong>{source.channel !== "online" && source.receiptNumberingConflict ? <div>{RECEIPT_NUMBER_CONFLICT}</div> : null}</td><td>{source.customerName ?? "عميل غير مسجل"}<br />{formatCairoDate(source.receivedAt)}</td><td>{source.originalBranch?.nameAr ?? "غير مسجل"}</td><td>{formatEgpFromPiasters(source.originalPayment.totalPiasters)}</td><td><button type="button" className="secondary" disabled={busy} onClick={() => selectSource(source)}>اختيار</button></td></tr>)}
          </tbody></table> : !sourceBusy ? <EmptyState title="مفيش عملية ترجع" message="ابحث برقم الهاتف أو الإيصال أو الطلب." /> : null}
        </div>
        {sourceBusy ? <p aria-live="polite">جارٍ تحميل الطلبات…</p> : null}
        {sourceNextCursor ? <button type="button" className="secondary" disabled={busy || sourceBusy} onClick={() => void loadMoreSources()}>طلبات أقدم</button> : null}
      </details>

      {selectedSource && !selectedReturn ? (
        <section ref={sourceFeedback.regionRef} className={`card return-editor reveal-feedback${sourceFeedback.highlighted ? " is-highlighted" : ""}`}>
          <h2 ref={sourceFeedback.headingRef} tabIndex={-1}>{editingReturn ? "تعديل مسودة الإرجاع" : sourceHeading(selectedSource)}</h2>
          {selectedSource.channel !== "online" && selectedSource.receiptNumberingConflict ? <p>{RECEIPT_NUMBER_CONFLICT}</p> : null}
          <div className="return-invoice-summary">
            <span><small>العميل والهاتف</small><strong>{selectedSource.customerName ?? "غير مسجل"} · {selectedSource.customerPhone ?? "غير مسجل"}</strong></span>
            <span><small>التاريخ</small><strong>{formatCairoDate(selectedSource.receivedAt)}</strong></span>
            <span><small>{selectedSource.channel === "online" ? "فرع تجهيز الطلب" : "فرع البيع الأصلي"}</small><strong>{selectedSource.originalBranch?.nameAr ?? "غير مسجل"}</strong></span>
            <span><small>إجمالي المعاملة</small><strong>{formatEgpFromPiasters(selectedSource.originalPayment.totalPiasters)}</strong></span>
          </div>
          <form aria-label={editingReturn ? "تعديل مسودة إرجاع" : "إنشاء مسودة إرجاع"} onSubmit={reviewReturn}>
            <div className="business-table-wrap return-items-wrap"><table className="business-table return-items"><thead><tr><th>الصنف</th><th>المدفوع الأصلي</th><th>المتاح للإرجاع</th><th>الكمية المستلمة</th><th>قابلة للبيع بعد الفحص</th><th>استرداد البضاعة المقترح</th></tr></thead><tbody>
            {selectedSource.lines.map((line) => {
              const value = selection[line.sourceLineId] ?? { quantity: 0, sellableQuantity: 0 };
              return <tr key={line.sourceLineId}><td><strong>{line.variant.product.nameAr}</strong><br />{line.variant.size.nameAr} / {line.variant.color.nameAr}</td><td>{formatEgpFromPiasters(line.paidPiasters)}<br /><small>المتبقي المقترح: {formatEgpFromPiasters(line.remainingSuggestedPiasters)}</small></td><td>{line.remainingQuantity} من {line.purchasedQuantity}</td><td><label className="return-sr-only" htmlFor={`qty-${line.sourceLineId}`}>الكمية المستلمة: {line.variant.product.nameAr}</label><input id={`qty-${line.sourceLineId}`} type="number" min="0" max={line.remainingQuantity} value={value.quantity} onChange={(event) => { const quantity = Math.max(0, Math.min(line.remainingQuantity, Number(event.target.value))); setSelection((current) => ({ ...current, [line.sourceLineId]: { quantity, sellableQuantity: Math.min(current[line.sourceLineId]?.sellableQuantity ?? 0, quantity) } })); }} /></td><td><label className="return-sr-only" htmlFor={`sellable-${line.sourceLineId}`}>قابلة للبيع بعد الفحص: {line.variant.product.nameAr}</label><input id={`sellable-${line.sourceLineId}`} type="number" min="0" max={value.quantity} value={value.sellableQuantity} onChange={(event) => { const sellableQuantity = Math.max(0, Math.min(value.quantity, Number(event.target.value))); setSelection((current) => ({ ...current, [line.sourceLineId]: { ...value, sellableQuantity } })); }} /></td><td>{formatEgpFromPiasters(calculateReturnRefundSuggestion(selectedSource, { [line.sourceLineId]: value }).merchandisePiasters)}</td></tr>;
            })}</tbody></table></div>
            <div className="notice" data-testid="refund-suggestion"><strong>الاسترداد المقترح من الدفع الأصلي</strong><p>قيمة البضاعة: {formatEgpFromPiasters(suggestion.merchandisePiasters)} · رسوم التوصيل: {formatEgpFromPiasters(suggestion.checkoutChargePiasters)} · الإجمالي: {formatEgpFromPiasters(suggestion.totalPiasters)}</p>{selectedSource.channel === "online" && suggestion.checkoutChargePiasters === 0 ? <p className="muted">لا تُقترح رسوم التوصيل للإرجاع الجزئي أو إذا سبق أن حملها مرتجع فعّال.</p> : null}</div>
            <div className="return-editor-fields">
            <div className="field"><label htmlFor="return-handling-branch-select">فرع استلام المرتجع</label><select id="return-handling-branch-select" value={handlingBranchId} onChange={(event) => setHandlingBranchId(event.target.value)} required>{workspace.authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}</select></div>
            <div className="grid two"><div className="field"><label htmlFor="authorized-merchandise-refund">{selectedSource.channel === "online" ? "استرداد البضاعة المعتمد بالجنيه" : "قيمة الاسترداد المعتمدة بالجنيه"}</label><input id="authorized-merchandise-refund" inputMode="decimal" value={authorizedMerchandise} onChange={(event) => { setAuthorizedMerchandise(event.target.value); setAuthorizedEdited(true); }} /></div>{selectedSource.channel === "online" ? <div className="field"><label htmlFor="authorized-checkout-refund">استرداد رسوم التوصيل المعتمد بالجنيه</label><input id="authorized-checkout-refund" inputMode="decimal" value={authorizedCheckoutCharge} onChange={(event) => { setAuthorizedCheckoutCharge(event.target.value); setAuthorizedEdited(true); }} /></div> : null}</div>
            <div className="field"><label htmlFor="return-reason">سبب المرتجع (اختياري)</label><input id="return-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
            </div>
            <div className="business-actions"><button type="submit" className="confirm" disabled={busy}>تأكيد استلام وفحص المرتجع</button><details className="business-secondary-details"><summary>خيارات المسودة</summary><button type="button" className="secondary" disabled={busy} onClick={(event) => void saveDraft(event)}>{editingReturn ? "حفظ تعديلات المسودة" : "حفظ كمسودة"}</button></details></div>
          </form>
        </section>
      ) : null}

      <details className="card return-history-section" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary><strong>سجل المرتجعات والمسودات</strong></summary>
        <div className="business-master-detail"><div className="business-list-panel"><div className="business-table-wrap"><table className="business-table"><thead><tr><th>المرتجع / المعاملة</th><th>العميل</th><th>التاريخ</th><th>الفرع المستلم</th><th>المبلغ</th><th>الحالة</th><th><span className="return-sr-only">التفاصيل</span></th></tr></thead><tbody>
          {returns.map((row) => <tr key={row.id}><td>مرتجع {row.reference}<br />{row.sourceReference}</td><td>{row.customerName ?? "عميل غير مسجل"}</td><td>{formatCairoDate(row.postedAt ?? row.createdAt)}</td><td>{row.handlingBranch.nameAr}</td><td>{formatEgpFromPiasters(row.authorizedRefund.totalPiasters)}</td><td>{row.status === "draft" ? "مسودة" : row.effectiveStatus === "cancelled" ? "ملغى" : "مرحّل"}</td><td><button type="button" className="secondary" disabled={busy} onClick={() => void openReturn(row.id)}>{loadingReturnId === row.id ? "جارٍ الفتح…" : "التفاصيل"}</button></td></tr>)}
        </tbody></table>{returns.length === 0 ? <p>لا توجد مرتجعات محفوظة.</p> : null}</div>
        {nextCursor ? <button type="button" className="secondary" disabled={busy} onClick={() => void loadMoreReturns()}>تحميل مرتجعات أقدم</button> : null}
        </div>
      {selectedReturn ? (
        <DetailPanel title={`مرتجع ${selectedReturn.reference}`} onClose={() => setSelectedReturn(null)} className={`reveal-feedback${detailsFeedback.highlighted ? " is-highlighted" : ""}`} data-testid="return-details">
          <div ref={detailsFeedback.regionRef}><h3 ref={detailsFeedback.headingRef} tabIndex={-1} className="return-sr-only">تفاصيل مرتجع {selectedReturn.reference}</h3>
          <p>{sourceHeading(selectedReturn.source)} · التاريخ: {formatCairoDate(selectedReturn.postedAt ?? selectedReturn.createdAt)}</p>
          {selectedReturn.source.channel !== "online" && selectedReturn.source.receiptNumberingConflict ? <p data-testid="receipt-number-conflict">{RECEIPT_NUMBER_CONFLICT}</p> : null}
          <p>العميل: {selectedReturn.source.customerName ?? "غير مسجل"} · الهاتف: {selectedReturn.source.customerPhone ?? "غير مسجل"}</p>
          <p>{selectedReturn.source.channel === "online" ? "فرع التجهيز" : "فرع البيع الأصلي"}: {selectedReturn.source.originalBranch?.nameAr ?? "غير مسجل"} · فرع استلام المرتجع: {selectedReturn.handlingBranch.nameAr} · الحالة: {selectedReturn.status === "draft" ? "مسودة" : "مرحّل"}</p>
          {selectedReturn.reason ? <p>سبب الإرجاع: {selectedReturn.reason}</p> : null}
          {selectedReturn.source.channel === "online" ? <><p>المقترح: البضاعة {formatEgpFromPiasters(selectedReturn.suggestedRefund.merchandisePiasters)} · رسوم التوصيل {formatEgpFromPiasters(selectedReturn.suggestedRefund.checkoutChargePiasters)} · الإجمالي {formatEgpFromPiasters(selectedReturn.suggestedRefund.totalPiasters)}</p><p>المعتمد حالياً: البضاعة {formatEgpFromPiasters(selectedReturn.authorizedRefund.merchandisePiasters)} · رسوم التوصيل {formatEgpFromPiasters(selectedReturn.authorizedRefund.checkoutChargePiasters)} · الإجمالي {formatEgpFromPiasters(selectedReturn.authorizedRefund.totalPiasters)}</p></> : <p>المقترح: {formatEgpFromPiasters(selectedReturn.suggestedRefundPiasters)} · المعتمد حالياً: {formatEgpFromPiasters(selectedReturn.authorizedRefundPiasters)}</p>}
          {selectedReturn.correctionRevision > 0 ? selectedReturn.source.channel === "online" ? <p className="muted">المعتمد الأصلي المحفوظ: بضاعة {formatEgpFromPiasters(selectedReturn.originalAuthorizedRefund.merchandisePiasters)} · رسوم توصيل {formatEgpFromPiasters(selectedReturn.originalAuthorizedRefund.checkoutChargePiasters)} · إجمالي {formatEgpFromPiasters(selectedReturn.originalAuthorizedRefund.totalPiasters)}. توجد تصحيحات إدارية مرتبطة بهذا الأصل.</p> : <p className="muted">المعتمد الأصلي المحفوظ: {formatEgpFromPiasters(selectedReturn.originalAuthorizedRefundPiasters)} · توجد تصحيحات إدارية مرتبطة بهذا الأصل.</p> : null}
          <ul>{selectedReturn.lines.map((line) => <li key={line.id}>{line.variant.product.nameAr}: {line.quantity} مستلم، {line.sellableQuantity} قابل للبيع، {line.unsellableQuantity} غير قابل للبيع</li>)}</ul>
          {selectedReturn.status === "draft" ? <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={editSelectedDraft}>تعديل المسودة</button><button type="button" className="confirm" disabled={busy} onClick={() => void post()}>تأكيد استلام وفحص المرتجع</button></div> : null}
          {!selectedReturn.exchange && selectedReturn.effectiveStatus === "active" && selectedReturn.refund.paidPiasters === 0 ? (
            <details className="business-secondary-details"><summary>إجراءات الاستبدال</summary><form aria-label="إتمام استبدال" className="return-line" onSubmit={(event) => void exchange(event)}>
              <h3>سلة الاستبدال</h3>
              <div className="field">
                <label htmlFor="replacement-variant">صنف الاستبدال</label>
                <select id="replacement-variant" value={replacementVariantId} onChange={(event) => setReplacementVariantId(event.target.value)} required>
                  {replacementOptions.map(({ product, variant }) => (
                    <option key={variant.id} value={variant.id}>
                      {product.nameAr} — {variant.size.nameAr} / {variant.color.nameAr} — {formatEgpFromPiasters(variant.sellingPricePiasters)} — متاح {variant.availableQuantity}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid two">
                <div className="field"><label htmlFor="replacement-quantity">كمية الاستبدال</label><input id="replacement-quantity" type="number" min="1" value={replacementQuantity} onChange={(event) => setReplacementQuantity(Math.max(1, Number(event.target.value)))} /></div>
                <div className="field"><label htmlFor="cash-refund-status">إذا كان هناك فرق مسترد</label><select id="cash-refund-status" value={cashRefundStatus} onChange={(event) => setCashRefundStatus(event.target.value as "owed" | "paid")}><option value="owed">يظل مستحقاً</option><option value="paid">دُفع الآن</option></select></div>
              </div>
              <button type="button" className="secondary" disabled={busy || !replacementVariantId} onClick={addReplacementLine}>إضافة إلى سلة الاستبدال</button>
              {replacementBasket.length > 0 ? (
                <ul aria-label="أصناف سلة الاستبدال">
                  {replacementBasket.map((line) => {
                    const option = replacementOptions.find(({ variant }) => variant.id === line.variantId);
                    return <li key={line.variantId}>
                      {option?.product.nameAr ?? line.variantId} — {option?.variant.size.nameAr} / {option?.variant.color.nameAr} × {line.quantity}
                      <button type="button" className="danger" onClick={() => removeReplacementLine(line.variantId)}>حذف</button>
                    </li>;
                  })}
                </ul>
              ) : <p className="muted">أضف صنفاً واحداً أو أكثر ثم اعرض السعر النهائي.</p>}
              <button type="button" disabled={busy || replacementBasket.length === 0} onClick={() => void previewExchange()}>عرض السعر والفرق</button>
              {exchangeQuote ? (
                <div className="notice" data-testid="exchange-quote">
                  <p>قيمة البضاعة بعد العروض: {formatEgpFromPiasters(exchangeQuote.replacementMerchandisePiasters)}</p>
                  <p>رصيد الإرجاع المستخدم: {formatEgpFromPiasters(exchangeQuote.creditAppliedPiasters)}</p>
                  <p>النقد المطلوب تحصيله: {formatEgpFromPiasters(exchangeQuote.cashCollectedPiasters)}</p>
                  <p>فرق نقدي للعميل: {formatEgpFromPiasters(exchangeQuote.cashRefundPiasters)}</p>
                  {exchangeQuote.appliedAutomaticOffer ? <p>العرض المطبق: {exchangeQuote.appliedAutomaticOffer.nameAr}</p> : null}
                </div>
              ) : null}
              <p className="muted">السعر المعروض أعلاه هو السعر المقبول للبيع البديل. أي تعديل لاحق في الإرجاع يتطلب عرضاً جديداً. لا يُنشأ رصيد دائم للعميل.</p>
              {exchangeQuote ? <button type="button" className="secondary" disabled={busy} onClick={resetExchangeQuote}>إلغاء العرض وإعادة التسعير</button> : null}
              <button type="submit" className="confirm" disabled={busy || !exchangeQuote}>تأكيد الاستبدال بعد مراجعة فرق النقد</button>
            </form></details>
          ) : null}
          {selectedReturn.exchange ? (
            <div className="notice" data-testid="exchange-details">
              <p>بيع الاستبدال مسجل</p>
              <p>قيمة البضاعة: {formatEgpFromPiasters(selectedReturn.exchange.replacementMerchandisePiasters)} · الرصيد المستخدم: {formatEgpFromPiasters(selectedReturn.exchange.creditAppliedPiasters)}</p>
              <p>النقد المحصل: {formatEgpFromPiasters(selectedReturn.exchange.cashCollectedPiasters)}</p>
              <p>فرق الاسترداد المقبول: {formatEgpFromPiasters(selectedReturn.exchange.cashRefund.acceptedAmountPiasters)} · الحالة الحالية: {selectedReturn.exchange.cashRefund.status === "paid" ? "مدفوع" : selectedReturn.exchange.cashRefund.status === "owed" ? "مستحق" : selectedReturn.exchange.cashRefund.status === "cancelled" ? "ملغى بتصحيح إداري" : "لا يوجد"} · المدفوع نقداً فعلياً: {formatEgpFromPiasters(selectedReturn.exchange.cashRefund.paidPiasters)} · المتبقي: {formatEgpFromPiasters(selectedReturn.exchange.cashRefund.owedPiasters)}</p>
              <p>أتم الاستبدال المدير {selectedReturn.exchange.completedByDisplayName} في {formatCairoDate(selectedReturn.exchange.completedAt)}.</p>
            </div>
          ) : null}
          {selectedReturn.status === "posted" && selectedReturn.refund.status === "owed" ? <button type="button" disabled={busy} onClick={() => void pay()}>تسجيل دفع {formatEgpFromPiasters(selectedReturn.refund.owedPiasters)}</button> : null}
          {selectedReturn.refund.status === "paid" ? <p className="notice">دُفع {formatEgpFromPiasters(selectedReturn.refund.paidPiasters)} فعلياً بواسطة المدير {selectedReturn.refund.recordedByDisplayName ?? "—"} في {selectedReturn.refund.recordedAt ? formatCairoDate(selectedReturn.refund.recordedAt) : "—"}</p> : selectedReturn.refund.status === "owed" ? <p className="notice">الاسترداد النقدي مستحق. المتبقي للدفع: {formatEgpFromPiasters(selectedReturn.refund.owedPiasters)}.</p> : selectedReturn.refund.status === "overpaid" ? <p className="notice">المدفوع الفعلي يزيد عن المعتمد حالياً بمقدار {formatEgpFromPiasters(selectedReturn.refund.overpaidPiasters)}. لا يُسجل استرداد نقد تلقائياً.</p> : selectedReturn.refund.status === "cancelled" ? <p className="notice">أُلغي أثر تسجيل الإرجاع مع بقاء الأصل وحركات النقد الفعلية محفوظة.</p> : <p className="notice">المسودة لا تنشئ التزاماً نقدياً قبل تأكيد الاستلام والفحص.</p>}
          {selectedReturn.status === "posted" ? <Link className="button secondary" to={`/corrections?target=return&id=${selectedReturn.id}`}>تصحيح تسجيل هذا الإرجاع</Link> : null}
          </div>
        </DetailPanel>
      ) : null}</div>
      </details>
      <Modal open={reviewOpen} title="مراجعة المرتجع قبل التأكيد" onClose={() => setReviewOpen(false)} closeDisabled={busy}>
        {selectedSource ? <>
          <p>{sourceHeading(selectedSource)} · فرع الاستلام: {workspace.authorizedBranches.find((branch) => branch.id === handlingBranchId)?.nameAr ?? "—"}</p>
          <ul>{selectedSource.lines.filter((line) => (selection[line.sourceLineId]?.quantity ?? 0) > 0).map((line) => <li key={line.sourceLineId}>{line.variant.product.nameAr} — {line.variant.size.nameAr} / {line.variant.color.nameAr}: {selection[line.sourceLineId]?.quantity ?? 0} مستلم، {selection[line.sourceLineId]?.sellableQuantity ?? 0} قابل للبيع</li>)}</ul>
          <p>الاسترداد المقترح: {formatEgpFromPiasters(suggestion.totalPiasters)}</p>
          <p>استرداد البضاعة المعتمد: {authorizedMerchandise} جنيه{selectedSource.channel === "online" ? ` · رسوم التوصيل المعتمدة: ${authorizedCheckoutCharge} جنيه` : ""}</p>
          <p>سيُسجل استلام وفحص المرتجع وتُعاد القطع القابلة للبيع للمخزون. يُسجل الدفع النقدي بشكل منفصل عند دفعه فعلياً.</p>
          <div className="business-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setReviewOpen(false)}>العودة للتعديل</button><button type="button" className="confirm" disabled={busy} onClick={(event) => { setReviewOpen(false); void saveDraft(event, true); }}>تأكيد المرتجع</button></div>
        </> : null}
      </Modal>
    </main>
  );
}

function formatCairoDate(value: string) {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}
