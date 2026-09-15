import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  OnlineOrderAgreementQuoteDto,
  OnlineOrderDto,
  OnlineOrderSettingsDto,
  WorkspaceDto,
} from "@bravos/contracts";
import type { PublicProductDto, PublicProductSummaryDto } from "@bravos/contracts/public";
import { accountGeneration } from "../account-session.ts";
import {
  ApiError,
  cancelUnreachableOnlineOrder,
  confirmOnlineOrder,
  getOnlineOrder,
  getOnlineOrderSettings,
  getPublicProduct,
  listOnlineOrders,
  recordOnlineOrderContactAttempt,
  reviewOnlineOrderAgreement,
  saveOnlineOrderAgreement,
  searchPublicProducts,
  updateOnlineOrderSettings,
} from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";

type AgreementLineDraft = {
  variantId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  quantity: string;
};

type ContactPayload = {
  operationId: string;
  expectedRevision: number;
  outcome: "no_answer" | "reached";
  note?: string;
};

type AgreementPayload = {
  operationId: string;
  expectedRevision: number;
  quoteId: string;
  reviewDigest: string;
  customerAgreed: true;
};

type ConfirmationPayload = {
  operationId: string;
  expectedRevision: number;
  agreedRevision: number;
  itemsLocatedAndSetAside: true;
};

type CancellationPayload = {
  operationId: string;
  expectedRevision: number;
  reason: string;
};

type PendingAttempt =
  | { action: "contact"; orderId: string; payload: ContactPayload }
  | { action: "agreement"; orderId: string; payload: AgreementPayload }
  | { action: "confirmation"; orderId: string; payload: ConfirmationPayload }
  | { action: "cancellation"; orderId: string; payload: CancellationPayload };

export default function OnlineOrdersPage({ workspace }: { workspace: WorkspaceDto }) {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const lifecycle = useRef(0);
  const routeIdentity = `${workspace.staff.id}:${orderId ?? "list"}`;
  const currentRouteIdentity = useRef(routeIdentity);
  currentRouteIdentity.current = routeIdentity;
  const [orders, setOrders] = useState<OnlineOrderDto[]>([]);
  const [selected, setSelected] = useState<OnlineOrderDto | null>(null);
  const [settings, setSettings] = useState<OnlineOrderSettingsDto | null>(null);
  const [waitHours, setWaitHours] = useState("");
  const [minimumAttempts, setMinimumAttempts] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [contactOutcome, setContactOutcome] = useState<"no_answer" | "reached">("no_answer");
  const [contactNote, setContactNote] = useState("");
  const [agreementLines, setAgreementLines] = useState<AgreementLineDraft[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [agreementQuote, setAgreementQuote] = useState<OnlineOrderAgreementQuoteDto | null>(null);
  const [customerAgreed, setCustomerAgreed] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementResults, setReplacementResults] = useState<PublicProductSummaryDto[]>([]);
  const [replacementProduct, setReplacementProduct] = useState<PublicProductDto | null>(null);
  const [replacementVariantId, setReplacementVariantId] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState("1");
  const [itemsSetAside, setItemsSetAside] = useState(false);
  const [confirmationNeedsReview, setConfirmationNeedsReview] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [uncertainAttempt, setUncertainAttempt] = useState<PendingAttempt | null>(null);
  const manager = workspace.staff.role === "manager";

  useEffect(() => {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = ++lifecycle.current;
    let cancelled = false;
    const stillCurrent = () => !cancelled
      && workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === routeIdentity;
    setLoading(true);
    setPending("");
    setError("");
    setNotice("");
    setSelected(null);
    setOrders([]);
    setSettings(null);
    setUncertainAttempt(orderId ? readPendingAttempt(staffId, orderId) : null);
    void (async () => {
      try {
        const [listed, order, currentSettings] = await Promise.all([
          listOnlineOrders(),
          orderId ? getOnlineOrder(orderId) : Promise.resolve(null),
          getOnlineOrderSettings(),
        ]);
        if (!stillCurrent()) return;
        setOrders(listed);
        setSelected(order);
        setSettings(currentSettings);
        setWaitHours(String(currentSettings.unreachableWaitHours));
        setMinimumAttempts(String(currentSettings.minimumContactAttempts));
      } catch (caught) {
        if (stillCurrent()) setError(errorMessage(caught, "تعذر تحميل الطلبات الأونلاين."));
      } finally {
        if (stillCurrent()) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (lifecycle.current === token) lifecycle.current += 1;
    };
  }, [workspace.staff.id, orderId]);

  useEffect(() => {
    if (!selected) return;
    const source = selected.agreedRevision?.quote.lines ?? selected.lines.map((line) => ({
      variantId: line.variantId,
      productNameAr: line.productNameAr,
      sizeNameAr: line.sizeNameAr,
      colorNameAr: line.colorNameAr,
      quantity: line.requestedQuantity,
    }));
    setAgreementLines(source.map((line) => ({
      variantId: line.variantId,
      productNameAr: line.productNameAr,
      sizeNameAr: line.sizeNameAr,
      colorNameAr: line.colorNameAr,
      quantity: String(line.quantity),
    })));
    setCouponCode(selected.agreedRevision?.quote.couponCode ?? selected.requestedCouponCode ?? "");
    setAgreementQuote(null);
    setCustomerAgreed(false);
    setItemsSetAside(false);
    setConfirmationNeedsReview(false);
    setCancellationReason("");
  }, [selected?.id, selected?.agreedRevision?.version]);

  useEffect(() => {
    if (!orderId) return;
    const key = attemptKey(workspace.staff.id, orderId);
    function onStorage(event: StorageEvent) {
      if (event.key !== key) return;
      setUncertainAttempt(readPendingAttempt(workspace.staff.id, orderId!));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id, orderId]);

  const cancellationReady = Boolean(
    selected
      && settings
      && selected.contactAttempts.filter((attempt) => attempt.outcome === "no_answer").length >= settings.minimumContactAttempts
      && Date.now() >= new Date(selected.submittedAt).getTime() + settings.unreachableWaitHours * 60 * 60 * 1000,
  );
  const selectedReplacement = replacementProduct?.variants.find((variant) => variant.id === replacementVariantId) ?? null;
  const agreementDraft = useMemo(() => validateAgreementLines(agreementLines), [agreementLines]);
  const reviewLines = agreementDraft.lines;
  const frozen = Boolean(uncertainAttempt || pending);

  function replaceOrder(order: OnlineOrderDto) {
    setSelected(order);
    setOrders((current) => current.map((item) => item.id === order.id ? order : item));
  }

  async function refreshOrder() {
    if (!orderId) return;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const order = await getOnlineOrder(orderId);
    if (
      workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute
    ) replaceOrder(order);
  }

  async function saveSettings() {
    if (!settings) return;
    const nextWait = Number(waitHours);
    const nextMinimum = Number(minimumAttempts);
    if (!Number.isInteger(nextWait) || nextWait < 1 || !Number.isInteger(nextMinimum) || nextMinimum < 2) {
      setError("أدخل مهلة صحيحة وعدداً صحيحاً لمحاولات التواصل.");
      return;
    }
    const result = await run("settings", () => updateOnlineOrderSettings({
        expectedRevision: settings.revision,
        unreachableWaitHours: nextWait,
        minimumContactAttempts: nextMinimum,
      }));
    if (!result) return;
    setSettings(result);
    setWaitHours(String(result.unreachableWaitHours));
    setMinimumAttempts(String(result.minimumContactAttempts));
    setNotice("تم حفظ إعدادات الطلبات.");
  }

  async function recordContact() {
    if (!selected) return;
    const note = contactNote.trim();
    await executeAttempt({
      action: "contact",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        outcome: contactOutcome,
        ...(note ? { note } : {}),
      },
    });
  }

  async function searchReplacement() {
    const query = replacementQuery.trim();
    if (!query) return;
    const result = await run("search", () => searchPublicProducts(query));
    if (result) setReplacementResults(result.products.filter((product) => product.availability === "in_stock"));
  }

  async function chooseReplacement(productId: string) {
    const product = await run("replacement", () => getPublicProduct(productId));
    if (!product) return;
    setReplacementProduct(product);
    setReplacementVariantId(product.variants.find((variant) => variant.orderable)?.id ?? "");
    setReplacementQuantity("1");
  }

  function addReplacement() {
    if (!replacementProduct || !selectedReplacement || !selectedReplacement.orderable) return;
    const quantity = Number(replacementQuantity);
    const existingValue = agreementLines.find((line) => line.variantId === selectedReplacement.id)?.quantity ?? "0";
    const existingQuantity = Number(existingValue);
    if (
      !Number.isSafeInteger(quantity)
      || quantity < 1
      || !Number.isSafeInteger(existingQuantity)
      || existingQuantity < 0
      || existingQuantity + quantity > selectedReplacement.availableQuantity
    ) {
      setError("أدخل كمية صحيحة لا تتجاوز المتاح للصنف البديل.");
      return;
    }
    setAgreementLines((current) => {
      const existing = current.find((line) => line.variantId === selectedReplacement.id);
      if (existing) {
        return current.map((line) => line.variantId === selectedReplacement.id
          ? { ...line, quantity: String(Number(line.quantity || 0) + quantity) }
          : line);
      }
      return [...current, {
        variantId: selectedReplacement.id,
        productNameAr: replacementProduct.nameAr,
        sizeNameAr: selectedReplacement.size.nameAr,
        colorNameAr: selectedReplacement.color.nameAr,
        quantity: String(quantity),
      }];
    });
    invalidateAgreementReview();
    setReplacementProduct(null);
    setReplacementResults([]);
    setReplacementQuery("");
    setReplacementVariantId("");
    setNotice("أضيف الصنف البديل إلى مسودة الاتفاق. راجع السعر قبل حفظ موافقة العميل.");
  }

  async function reviewAgreement() {
    if (!selected || agreementDraft.error || reviewLines.length === 0) {
      setError(agreementDraft.error ?? "يجب أن يحتوي الاتفاق على صنف واحد على الأقل بكمية صحيحة.");
      return;
    }
    const result = await run("review", () => reviewOnlineOrderAgreement(selected.id, {
        expectedRevision: selected.revision,
        lines: reviewLines,
        ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
      }));
    if (!result) return;
    setAgreementQuote(result);
    setCustomerAgreed(false);
    setNotice("راجع المنتجات والأسعار مع العميل ثم سجل موافقته الصريحة.");
  }

  async function saveAgreement() {
    if (!selected || !agreementQuote || !customerAgreed) return;
    await executeAttempt({
      action: "agreement",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: agreementQuote.orderRevision,
        quoteId: agreementQuote.quoteId,
        reviewDigest: agreementQuote.reviewDigest,
        customerAgreed: true,
      },
    });
  }

  async function confirm() {
    if (!selected?.agreedRevision || !itemsSetAside) return;
    await executeAttempt({
      action: "confirmation",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        agreedRevision: selected.agreedRevision.version,
        itemsLocatedAndSetAside: true,
      },
    });
  }

  async function cancelUnreachable() {
    if (!selected || !cancellationReason.trim()) return;
    await executeAttempt({
      action: "cancellation",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        reason: cancellationReason.trim(),
      },
    });
  }

  async function executeAttempt(candidate: PendingAttempt) {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute;
    await withAttemptLock(staffId, candidate.orderId, async () => {
      if (!stillCurrent()) return;
      const saved = readPendingAttempt(staffId, candidate.orderId);
      if (saved && saved.payload.operationId !== candidate.payload.operationId) {
        setUncertainAttempt(saved);
        setError("توجد عملية سابقة لم نعرف نتيجتها. أعد محاولة العملية السابقة بنفس رقمها قبل بدء عملية جديدة.");
        setNotice("");
        return;
      }
      const attempt = saved ?? candidate;
      try {
        saveAttempt(staffId, attempt);
      } catch {
        if (stillCurrent()) {
          setError("تعذر حفظ محاولة العملية على هذا الجهاز، لذلك لم يتم إرسالها. حرر مساحة التخزين ثم حاول مرة أخرى.");
        }
        return;
      }
      if (stillCurrent()) {
        setUncertainAttempt(attempt);
        setPending(attempt.action);
        setError("");
        setNotice("");
      }
      try {
        const result = await dispatchAttempt(attempt);
        if (!stillCurrent()) return;
        clearAttempt(staffId, attempt);
        setUncertainAttempt(null);
        replaceOrder(result);
        if (attempt.action === "contact") {
          setContactNote("");
          setAgreementQuote(null);
          setCustomerAgreed(false);
          setNotice("تم تسجيل محاولة التواصل.");
        } else if (attempt.action === "agreement") {
          setAgreementQuote(null);
          setCustomerAgreed(false);
          setConfirmationNeedsReview(false);
          setNotice("تم حفظ الاتفاق مع العميل.");
        } else if (attempt.action === "confirmation") {
          setItemsSetAside(false);
          setNotice("تم تأكيد الطلب وخصم المخزون مرة واحدة.");
        } else {
          setCancellationReason("");
          setNotice("أُلغي الطلب يدوياً لتعذر الوصول إلى العميل.");
        }
      } catch (caught) {
        if (!stillCurrent()) return;
        if (caught instanceof ApiError && caught.status < 500) {
          clearAttempt(staffId, attempt);
          setUncertainAttempt(null);
          await refreshOrder().catch(() => undefined);
          if (!stillCurrent()) return;
          const direction = attempt.action === "confirmation" && caught.status === 409
            ? " راجع الاتفاق والسعر والمخزون مع العميل قبل محاولة تأكيد جديدة."
            : "";
          if (attempt.action === "confirmation" && caught.status === 409) {
            setItemsSetAside(false);
            setConfirmationNeedsReview(true);
          }
          setError(`${caught.messageAr}${direction}`);
        } else {
          setError(uncertainMessage(attempt.action));
        }
      } finally {
        if (stillCurrent()) setPending("");
      }
    });
  }

  function dispatchAttempt(attempt: PendingAttempt) {
    if (attempt.action === "contact") return recordOnlineOrderContactAttempt(attempt.orderId, attempt.payload);
    if (attempt.action === "agreement") return saveOnlineOrderAgreement(attempt.orderId, attempt.payload);
    if (attempt.action === "confirmation") return confirmOnlineOrder(attempt.orderId, attempt.payload);
    return cancelUnreachableOnlineOrder(attempt.orderId, attempt.payload);
  }

  async function run<T>(action: string, work: () => Promise<T>): Promise<T | null> {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute;
    setPending(action);
    setError("");
    setNotice("");
    try {
      const result = await work();
      return stillCurrent() ? result : null;
    } catch (caught) {
      if (stillCurrent()) setError(errorMessage(caught, "تعذر إكمال العملية."));
      return null;
    } finally {
      if (stillCurrent()) setPending("");
    }
  }

  function invalidateAgreementReview() {
    setAgreementQuote(null);
    setCustomerAgreed(false);
  }

  if (loading) {
    return <main className="shell"><p>جارٍ تحميل الطلبات…</p></main>;
  }

  return (
    <main className="shell online-orders-page">
      <header className="brand">
        <div>
          <h1>الطلبات الأونلاين</h1>
          <p className="muted">متابعة طلبات واتساب وحماية الأصناف التي تم فصلها فعلياً.</p>
        </div>
        <Link className="button secondary" to="/workspace">مساحة العمل</Link>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      {!orderId ? (
        <>
          {manager && settings ? (
            <form className="card order-settings" aria-label="إعدادات تعذر الوصول" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
              <h2>إعدادات تعذر الوصول</h2>
              <p className="muted">الإلغاء يدوي فقط بعد انقضاء المهلة وتسجيل العدد الأدنى من المحاولات مع سبب.</p>
              <div className="grid two">
                <div className="field">
                  <label htmlFor="order-wait-hours">مهلة تعذر الوصول بالساعات</label>
                  <input id="order-wait-hours" type="number" min="1" step="1" value={waitHours} onChange={(event) => setWaitHours(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="order-minimum-attempts">الحد الأدنى لمحاولات التواصل</label>
                  <input id="order-minimum-attempts" type="number" min="2" step="1" value={minimumAttempts} onChange={(event) => setMinimumAttempts(event.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={Boolean(pending)}>حفظ الإعدادات</button>
            </form>
          ) : null}
          <section className="card">
            <h2>طلبات العملاء</h2>
            {orders.length === 0 ? <p className="empty">لا توجد طلبات أونلاين حتى الآن.</p> : (
              <div className="list-stack">
                {orders.map((order) => (
                  <article className="summary-card online-order-row" data-testid="online-order-row" key={order.id}>
                    <div>
                      <strong>{order.reference}</strong>
                      <p>{order.customerName} — {statusLabel(order.status)}</p>
                      <p className="muted">{formatDate(order.submittedAt)} — {formatEgpFromPiasters(order.agreedRevision?.quote.finalTotalPiasters ?? order.requestedFinalTotalPiasters)}</p>
                    </div>
                    <Link className="button secondary" to={`/online-orders/${order.id}`}>فتح التفاصيل</Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : selected ? (
        <>
          <div className="actions order-back"><button className="secondary" type="button" onClick={() => navigate("/online-orders")}>العودة إلى الطلبات</button></div>
          <section className="card order-heading">
            <div>
              <h2>{selected.reference}</h2>
              <p id="order-status" data-testid="order-status">الحالة: {statusLabel(selected.status)}</p>
              {selected.confirmedAt ? <p>أكد الطلب المسؤول {selected.confirmedByStaffId} في {formatDate(selected.confirmedAt)}.</p> : null}
              {selected.cancelledAt ? <p>ألغاه المسؤول {selected.cancelledByStaffId} في {formatDate(selected.cancelledAt)} — {selected.cancellationReason}</p> : null}
            </div>
            <p className="muted">أُرسل {formatDate(selected.submittedAt)} — إصدار الطلب {selected.revision}</p>
          </section>

          {uncertainAttempt ? (
            <section className="notice uncertain-order-attempt">
              <h2>{uncertainTitle(uncertainAttempt.action)}</h2>
              <p>احتفظ النظام بنفس رقم العملية ونفس القيم. أعد المحاولة لمعرفة النتيجة دون تكرار الأثر.</p>
              <button type="button" disabled={Boolean(pending)} onClick={() => void executeAttempt(uncertainAttempt)}>
                {retryLabel(uncertainAttempt.action)}
              </button>
            </section>
          ) : null}

          <section className="card" role="region" aria-label="الطلب الأصلي">
            <h2>الطلب الأصلي كما أرسله العميل</h2>
            <div className="grid two order-customer-details">
              <div><strong>العميل</strong><p>{selected.customerName}</p></div>
              <div>
                <strong>الموبايل الأساسي</strong>
                <p dir="ltr">{selected.primaryPhone}</p>
                <a href={whatsappUrl(selected.primaryPhone)} target="_blank" rel="noreferrer">فتح واتساب</a>
              </div>
              <div><strong>رقم بديل</strong><p dir="ltr">{selected.alternatePhone ?? "غير مسجل"}</p></div>
              <div><strong>منطقة التوصيل</strong><p>{selected.deliveryArea.nameAr}</p></div>
              <div><strong>العنوان</strong><p>{selected.detailedAddress}</p></div>
              <div><strong>علامة مميزة</strong><p>{selected.landmark ?? "غير مسجلة"}</p></div>
              <div><strong>ملاحظات العميل</strong><p>{selected.notes ?? "لا توجد"}</p></div>
            </div>
            <OrderLines
              lines={selected.lines.map((line) => ({
                key: line.id,
                name: line.productNameAr,
                variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
                quantity: line.requestedQuantity,
                total: line.requestedMerchandiseTotalPiasters,
                quantityLabel: "الكمية المطلوبة",
              }))}
            />
            <PriceSummary
              original={selected.requestedMerchandiseOriginalPiasters}
              automatic={selected.requestedAutomaticOfferDiscountPiasters}
              coupon={selected.requestedCouponDiscountPiasters}
              merchandise={selected.requestedMerchandiseTotalPiasters}
              delivery={selected.requestedDeliveryFeePiasters}
              final={selected.requestedFinalTotalPiasters}
            />
            <PromotionSummary
              offer={selected.requestedAppliedAutomaticOffer}
              coupon={selected.requestedAppliedCoupon}
            />
          </section>

          <section className="card" data-testid="contact-attempts">
            <h2>محاولات التواصل</h2>
            {selected.contactAttempts.length === 0 ? <p className="empty">لم تُسجل محاولة تواصل بعد.</p> : selected.contactAttempts.map((attempt) => (
              <article className="history-item" key={attempt.id}>
                <strong>{attempt.outcome === "reached" ? "تم التواصل" : "لا توجد إجابة"}</strong>
                <p>{attempt.note ?? "من دون ملاحظة"}</p>
                <p className="muted">{formatDate(attempt.occurredAt)} — المسؤول {attempt.actorStaffId}</p>
              </article>
            ))}
          </section>

          {selected.agreedRevision ? <AgreementSnapshot quote={selected.agreedRevision.quote} agreedAt={selected.agreedRevision.agreedAt} actorId={selected.agreedRevision.agreedByStaffId} /> : null}

          {selected.status === "pending" ? (
            <>
              <form className="card" aria-label="تسجيل محاولة تواصل" onSubmit={(event) => { event.preventDefault(); void recordContact(); }}>
                <h2>تسجيل محاولة تواصل</h2>
                <div className="field">
                  <label htmlFor="contact-outcome">نتيجة التواصل</label>
                  <select id="contact-outcome" value={contactOutcome} disabled={frozen} onChange={(event) => setContactOutcome(event.target.value as typeof contactOutcome)}>
                    <option value="no_answer">لا توجد إجابة</option>
                    <option value="reached">تم التواصل</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="contact-note">ملاحظة التواصل (اختياري)</label>
                  <textarea id="contact-note" value={contactNote} disabled={frozen} onChange={(event) => setContactNote(event.target.value)} />
                </div>
                <button type="submit" disabled={frozen}>حفظ محاولة التواصل</button>
              </form>

              <form className="card" aria-label="مراجعة الاتفاق مع العميل" onSubmit={(event) => { event.preventDefault(); void reviewAgreement(); }}>
                <h2>مراجعة الاتفاق مع العميل</h2>
                <p className="muted">عدّل الكميات أو أضف بديلاً وافق عليه العميل. الصفر يحذف الصنف من الاتفاق الجديد.</p>
                {agreementLines.map((line) => (
                  <div className="agreement-line" key={line.variantId}>
                    <div><strong>{line.productNameAr}</strong><p className="muted">{line.sizeNameAr} / {line.colorNameAr}</p></div>
                    <div className="field compact-field">
                      <label htmlFor={`agreement-quantity-${line.variantId}`}>الكمية</label>
                      <input
                        id={`agreement-quantity-${line.variantId}`}
                        data-testid={`agreement-quantity-${line.variantId}`}
                        type="number"
                        min="0"
                        step="1"
                        value={line.quantity}
                        disabled={frozen}
                        onChange={(event) => {
                          setAgreementLines((current) => current.map((item) => item.variantId === line.variantId ? { ...item, quantity: event.target.value } : item));
                          invalidateAgreementReview();
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="replacement-picker">
                  <h3>إضافة صنف بديل اتفق عليه العميل</h3>
                  <div className="field">
                    <label htmlFor="replacement-query">بحث عن منتج بديل</label>
                    <input id="replacement-query" value={replacementQuery} disabled={frozen} onChange={(event) => setReplacementQuery(event.target.value)} />
                  </div>
                  <button className="secondary" type="button" disabled={frozen || !replacementQuery.trim()} onClick={() => void searchReplacement()}>بحث</button>
                  {replacementResults.map((product) => (
                    <article className="summary-card" data-testid="replacement-product" key={product.id}>
                      <div><strong>{product.nameAr}</strong><p className="muted">{product.category.nameAr}</p></div>
                      <button className="secondary" type="button" disabled={frozen} onClick={() => void chooseReplacement(product.id)}>اختيار</button>
                    </article>
                  ))}
                  {replacementProduct ? (
                    <div className="replacement-variant">
                      <div className="field">
                        <label htmlFor="replacement-variant">الصنف البديل</label>
                        <select id="replacement-variant" value={replacementVariantId} disabled={frozen} onChange={(event) => setReplacementVariantId(event.target.value)}>
                          {replacementProduct.variants.filter((variant) => variant.orderable).map((variant) => (
                            <option key={variant.id} value={variant.id}>{variant.size.nameAr} / {variant.color.nameAr} — متاح {variant.availableQuantity}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="replacement-quantity">كمية الصنف البديل</label>
                        <input id="replacement-quantity" type="number" min="1" max={selectedReplacement?.availableQuantity} step="1" value={replacementQuantity} disabled={frozen} onChange={(event) => setReplacementQuantity(event.target.value)} />
                      </div>
                      <button type="button" disabled={frozen || !replacementVariantId} onClick={addReplacement}>إضافة الصنف البديل</button>
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="agreement-coupon">كود الكوبون المتفق عليه (اختياري)</label>
                  <input id="agreement-coupon" value={couponCode} disabled={frozen} onChange={(event) => { setCouponCode(event.target.value); invalidateAgreementReview(); }} />
                </div>
                {agreementDraft.error ? <p className="error" data-testid="agreement-quantity-error">{agreementDraft.error}</p> : null}
                <button type="submit" disabled={frozen || Boolean(agreementDraft.error) || reviewLines.length === 0}>مراجعة السعر</button>
                {agreementQuote ? (
                  <div className="price-review" role="region" aria-label="مراجعة السعر المتفق عليه">
                    <h3>مراجعة السعر قبل تسجيل موافقة العميل</h3>
                    <OrderLines lines={agreementQuote.lines.map((line) => ({
                      key: line.variantId,
                      name: line.productNameAr,
                      variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
                      quantity: line.quantity,
                      total: line.merchandiseTotalPiasters,
                      quantityLabel: "الكمية",
                    }))} />
                    <PriceSummary
                      original={agreementQuote.merchandiseOriginalPiasters}
                      automatic={agreementQuote.automaticOfferDiscountPiasters}
                      coupon={agreementQuote.couponDiscountPiasters}
                      merchandise={agreementQuote.merchandiseTotalPiasters}
                      delivery={agreementQuote.deliveryFeePiasters}
                      final={agreementQuote.finalTotalPiasters}
                    />
                    <PromotionSummary offer={agreementQuote.appliedAutomaticOffer} coupon={agreementQuote.appliedCoupon} />
                    <label className="checkbox-row">
                      <input type="checkbox" checked={customerAgreed} disabled={frozen} onChange={(event) => setCustomerAgreed(event.target.checked)} />
                      وافق العميل على هذه المنتجات والأسعار
                    </label>
                    <button type="button" disabled={frozen || !customerAgreed} onClick={() => void saveAgreement()}>حفظ اتفاق العميل</button>
                  </div>
                ) : null}
              </form>

              {selected.agreedRevision ? (
                <form className="card confirmation-card" aria-label="تأكيد تجهيز الطلب" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
                  <h2>تأكيد تجهيز الطلب</h2>
                  <p>طابق الأصناف الفعلية مع الاتفاق الحالي وافصلها عن المخزون المتاح قبل التأكيد.</p>
                  {confirmationNeedsReview ? <p className="error">يلزم إنشاء مراجعة سعر جديدة وحفظ موافقة العميل قبل التأكيد.</p> : null}
                  <label className="checkbox-row">
                    <input type="checkbox" checked={itemsSetAside} disabled={frozen || confirmationNeedsReview} onChange={(event) => setItemsSetAside(event.target.checked)} />
                    وجدت الأصناف الفعلية وفصلتها لهذا الطلب
                  </label>
                  <button type="submit" disabled={frozen || confirmationNeedsReview || !itemsSetAside}>تأكيد الطلب وخصم المخزون</button>
                </form>
              ) : (
                <p className="card muted">لا يمكن تأكيد الطلب قبل حفظ اتفاق العميل على المنتجات والأسعار.</p>
              )}

              <form className="card cancellation-card" aria-label="إلغاء طلب لتعذر الوصول" onSubmit={(event) => { event.preventDefault(); void cancelUnreachable(); }}>
                <h2>إلغاء يدوي لتعذر الوصول</h2>
                <p>
                  يتطلب {settings?.minimumContactAttempts ?? "—"} محاولات بلا إجابة على الأقل وانتظار {settings?.unreachableWaitHours ?? "—"} ساعة من استلام الطلب.
                  لا يحدث إلغاء تلقائي.
                </p>
                <div className="field">
                  <label htmlFor="cancellation-reason">سبب الإلغاء</label>
                  <textarea id="cancellation-reason" value={cancellationReason} disabled={frozen} onChange={(event) => setCancellationReason(event.target.value)} required />
                </div>
                <button className="danger" type="submit" disabled={frozen || !cancellationReady || !cancellationReason.trim()}>إلغاء يدوياً لتعذر الوصول</button>
                {!cancellationReady ? <p className="muted">لم تكتمل المهلة ومحاولات التواصل المطلوبة بعد.</p> : null}
              </form>
            </>
          ) : null}
        </>
      ) : (
        <section className="card"><p className="empty">لم يتم العثور على الطلب.</p></section>
      )}
    </main>
  );
}

function AgreementSnapshot({ quote, agreedAt, actorId }: { quote: OnlineOrderAgreementQuoteDto; agreedAt: string; actorId: string }) {
  return (
    <section className="card agreed-order" role="region" aria-label="الاتفاق الحالي مع العميل">
      <h2>الاتفاق الحالي مع العميل</h2>
      <OrderLines lines={quote.lines.map((line) => ({
        key: line.variantId,
        name: line.productNameAr,
        variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
        quantity: line.quantity,
        total: line.merchandiseTotalPiasters,
        quantityLabel: "الكمية",
      }))} />
      <PriceSummary
        original={quote.merchandiseOriginalPiasters}
        automatic={quote.automaticOfferDiscountPiasters}
        coupon={quote.couponDiscountPiasters}
        merchandise={quote.merchandiseTotalPiasters}
        delivery={quote.deliveryFeePiasters}
        final={quote.finalTotalPiasters}
      />
      <PromotionSummary offer={quote.appliedAutomaticOffer} coupon={quote.appliedCoupon} />
      <p className="muted">وافق العميل {formatDate(agreedAt)} — المسؤول {actorId}</p>
    </section>
  );
}

function PromotionSummary({ offer, coupon }: {
  offer: { nameAr: string; discountPiasters: number } | null;
  coupon: { code: string; discountPiasters: number } | null;
}) {
  if (!offer && !coupon) return <p className="muted">لا يوجد عرض أو كوبون مطبق.</p>;
  return (
    <div className="order-promotions">
      {offer ? <p>العرض: {offer.nameAr} — {formatEgpFromPiasters(offer.discountPiasters)}</p> : null}
      {coupon ? <p>الكوبون: {coupon.code} — {formatEgpFromPiasters(coupon.discountPiasters)}</p> : null}
    </div>
  );
}

function OrderLines({ lines }: { lines: Array<{ key: string; name: string; variant: string; quantity: number; total: number; quantityLabel: string }> }) {
  return (
    <div className="order-lines">
      {lines.map((line) => (
        <article className="order-line" key={line.key}>
          <div><strong>{line.name}</strong><p className="muted">{line.variant}</p></div>
          <p>{line.quantityLabel}: {line.quantity}</p>
          <p>{formatEgpFromPiasters(line.total)}</p>
        </article>
      ))}
    </div>
  );
}

function PriceSummary({ original, automatic, coupon, merchandise, delivery, final }: {
  original: number;
  automatic: number;
  coupon: number;
  merchandise: number;
  delivery: number;
  final: number;
}) {
  return (
    <dl className="order-price-summary">
      <div><dt>المنتجات قبل الخصم</dt><dd>{formatEgpFromPiasters(original)}</dd></div>
      <div><dt>خصم العرض</dt><dd>{formatEgpFromPiasters(automatic)}</dd></div>
      <div><dt>خصم الكوبون</dt><dd>{formatEgpFromPiasters(coupon)}</dd></div>
      <div><dt>إجمالي المنتجات</dt><dd>{formatEgpFromPiasters(merchandise)}</dd></div>
      <div><dt>رسوم التوصيل:</dt><dd>{formatEgpFromPiasters(delivery)}</dd></div>
      <div className="order-final"><dt>الإجمالي النهائي:</dt><dd>{formatEgpFromPiasters(final)}</dd></div>
    </dl>
  );
}

function statusLabel(status: OnlineOrderDto["status"]) {
  if (status === "confirmed") return "مؤكد";
  if (status === "cancelled_unreachable") return "ملغي لتعذر الوصول";
  return "بانتظار التأكيد";
}

function uncertainTitle(action: PendingAttempt["action"]) {
  if (action === "confirmation") return "توجد محاولة تأكيد لم نعرف نتيجتها";
  if (action === "agreement") return "توجد محاولة حفظ اتفاق لم نعرف نتيجتها";
  if (action === "contact") return "توجد محاولة تواصل لم نعرف نتيجتها";
  return "توجد محاولة إلغاء لم نعرف نتيجتها";
}

function retryLabel(action: PendingAttempt["action"]) {
  if (action === "confirmation") return "إعادة محاولة التأكيد بنفس العملية";
  if (action === "agreement") return "إعادة محاولة حفظ الاتفاق بنفس العملية";
  if (action === "contact") return "إعادة محاولة حفظ التواصل بنفس العملية";
  return "إعادة محاولة الإلغاء بنفس العملية";
}

function uncertainMessage(action: PendingAttempt["action"]) {
  if (action === "confirmation") return "انقطع الرد وقد يكون التأكيد حُفظ. أعد تحميل الصفحة ثم أعد محاولة التأكيد بنفس العملية.";
  if (action === "agreement") return "انقطع الرد وقد يكون الاتفاق حُفظ. أعد المحاولة بنفس العملية قبل إجراء تعديل جديد.";
  if (action === "contact") return "انقطع الرد وقد تكون محاولة التواصل حُفظت. أعد المحاولة بنفس العملية.";
  return "انقطع الرد وقد يكون الإلغاء حُفظ. أعد المحاولة بنفس العملية.";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}

function whatsappUrl(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("0") ? `20${digits.slice(1)}` : digits}`;
}

function errorMessage(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) return caught.messageAr;
  if (caught instanceof Error && caught.message) return caught.message;
  return fallback;
}

function attemptKey(staffId: string, orderId: string) {
  return `bravos.online-order.pending.${staffId}.${orderId}`;
}

function readPendingAttempt(staffId: string, orderId: string): PendingAttempt | null {
  try {
    const raw = localStorage.getItem(attemptKey(staffId, orderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAttempt;
    if (!validAttemptAction(parsed.action) || parsed.orderId !== orderId || !validAttemptPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validAttemptAction(value: unknown): value is PendingAttempt["action"] {
  return value === "contact" || value === "agreement" || value === "confirmation" || value === "cancellation";
}

function validAttemptPayload(attempt: PendingAttempt) {
  if (typeof attempt.payload?.operationId !== "string" || typeof attempt.payload.expectedRevision !== "number") return false;
  if (attempt.action === "contact") {
    return (attempt.payload.outcome === "no_answer" || attempt.payload.outcome === "reached")
      && (attempt.payload.note === undefined || typeof attempt.payload.note === "string");
  }
  if (attempt.action === "agreement") {
    return typeof attempt.payload.quoteId === "string"
      && typeof attempt.payload.reviewDigest === "string"
      && attempt.payload.customerAgreed === true;
  }
  if (attempt.action === "confirmation") {
    return typeof attempt.payload.agreedRevision === "number" && attempt.payload.itemsLocatedAndSetAside === true;
  }
  return typeof attempt.payload.reason === "string";
}

function saveAttempt(staffId: string, attempt: PendingAttempt) {
  localStorage.setItem(attemptKey(staffId, attempt.orderId), JSON.stringify(attempt));
}

function clearAttempt(staffId: string, attempt: PendingAttempt) {
  const current = readPendingAttempt(staffId, attempt.orderId);
  if (current?.payload.operationId === attempt.payload.operationId) {
    localStorage.removeItem(attemptKey(staffId, attempt.orderId));
  }
}

async function withAttemptLock<T>(staffId: string, orderId: string, work: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) {
    return await navigator.locks.request(
      `bravos.online-order.lock.${staffId}.${orderId}`,
      { mode: "exclusive" },
      work,
    );
  }
  return await work();
}

function validateAgreementLines(lines: AgreementLineDraft[]): {
  lines: Array<{ variantId: string; quantity: number }>;
  error: string | null;
} {
  const accepted: Array<{ variantId: string; quantity: number }> = [];
  for (const line of lines) {
    if (!line.quantity.trim()) {
      return { lines: [], error: `أدخل كمية ${line.productNameAr} أو اكتب صفر لحذف الصنف من الاتفاق.` };
    }
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
      return { lines: [], error: `كمية ${line.productNameAr} يجب أن تكون عدداً صحيحاً غير سالب.` };
    }
    if (quantity > 0) accepted.push({ variantId: line.variantId, quantity });
  }
  return { lines: accepted, error: null };
}
