"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, type InputHTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import type {
  CheckoutQuoteDto,
  CheckoutQuoteRequest,
  PublicDeliveryAreaDto,
  PublicOrderSubmissionDto,
  PublicOrderSubmissionRequest,
  PublicRuntimeDto,
} from "@bravos/contracts/public";
import { useCart } from "../cart/cart-provider";
import { formatEgp } from "../public-catalog";
import styles from "./checkout.module.css";

const CHECKOUT_STORAGE_KEY = "bravos-guest-checkout-v1";
const CHECKOUT_STORAGE_VERSION = 1;
const CHECKOUT_LOCK = "bravos-guest-checkout-submit";

type CheckoutFields = {
  customerName: string;
  primaryPhone: string;
  deliveryAreaId: string;
  detailedAddress: string;
  alternatePhone: string;
  landmark: string;
  notes: string;
  couponCode: string;
};

type StoredAttempt = {
  version: typeof CHECKOUT_STORAGE_VERSION;
  status: "pending";
  request: PublicOrderSubmissionRequest;
} | {
  version: typeof CHECKOUT_STORAGE_VERSION;
  status: "accepted";
  request: PublicOrderSubmissionRequest;
  result: PublicOrderSubmissionDto;
  cartCompleted: boolean;
};

type ApiError = { error?: { code?: string; messageAr?: string } };
type OrderingState = "loading" | "enabled" | "disabled" | "unavailable";

const EMPTY_FIELDS: CheckoutFields = {
  customerName: "",
  primaryPhone: "",
  deliveryAreaId: "",
  detailedAddress: "",
  alternatePhone: "",
  landmark: "",
  notes: "",
  couponCode: "",
};

export default function CheckoutPage() {
  const cart = useCart();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [orderingState, setOrderingState] = useState<OrderingState>("loading");
  const [areas, setAreas] = useState<PublicDeliveryAreaDto[]>([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [areasError, setAreasError] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuoteDto | null>(null);
  const [quoteKey, setQuoteKey] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicOrderSubmissionDto | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"status" | "error">("status");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [hasPendingAttempt, setHasPendingAttempt] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const recoveryStarted = useRef(false);
  const activeOperationId = useRef<string | null>(null);
  const submitStarted = useRef(false);
  const currentInputKey = useMemo(
    () => checkoutInputKey(cart.items, fields.deliveryAreaId, fields.couponCode),
    [cart.items, fields.deliveryAreaId, fields.couponCode],
  );
  const currentInputKeyRef = useRef(currentInputKey);
  currentInputKeyRef.current = currentInputKey;

  useEffect(() => {
    let active = true;
    void fetch("/api/public/runtime", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("runtime");
        return response.json() as Promise<PublicRuntimeDto>;
      })
      .then(async (runtime) => {
        if (!active) return;
        if (!runtime.publicOrderingEnabled) {
          setOrderingState("disabled");
          setAreasLoading(false);
          return;
        }
        setOrderingState("enabled");
        await loadDeliveryAreas(() => active);
      })
      .catch(() => {
        if (active) {
          setOrderingState("unavailable");
          showMessage("تعذر التحقق من إتاحة الطلب حالياً. احتفظنا ببيانات أي محاولة إرسال سابقة.", "error");
        }
      })
      .finally(() => {
        if (active) setAreasLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!quote || quoteKey === currentInputKey) return;
    setQuote(null);
    setQuoteKey("");
    showMessage("تغيّرت السلة أو منطقة التوصيل أو الكوبون. راجع السعر الحالي من جديد.", "status");
  }, [currentInputKey, quote, quoteKey]);

  useEffect(() => {
    if (!cart.hydrated || orderingState === "loading" || recoveryStarted.current) return;
    const stored = readAttempt();
    if (stored === "invalid") {
      recoveryStarted.current = true;
      setStorageBlocked(true);
      showMessage("تعذر قراءة محاولة طلب محفوظة. أوقفنا أي إرسال جديد حتى لا يتكرر طلب سابق.", "error");
      return;
    }
    if (!stored) return;
    if (stored.status === "accepted") {
      recoveryStarted.current = true;
      if (!stored.cartCompleted || cart.items.length === 0) void acceptResult(stored.result, stored.request, stored.cartCompleted);
      return;
    }
    recoveryStarted.current = true;
    setHasPendingAttempt(true);
    activeOperationId.current = stored.request.operationId;
    showMessage("جارٍ التحقق من نتيجة الإرسال السابق…", "status");
    void recoverStoredAttempt();
  }, [cart.hydrated, orderingState]);

  useEffect(() => {
    function syncAttempt(event: StorageEvent) {
      if (event.key !== CHECKOUT_STORAGE_KEY || !event.newValue) return;
      const stored = parseAttempt(event.newValue);
      if (!stored) return;
      if (stored.status === "accepted" && activeOperationId.current === stored.request.operationId) {
        void acceptResult(stored.result, stored.request, stored.cartCompleted);
      } else if (stored.status === "pending" && !submitting && orderingState !== "loading") {
        setHasPendingAttempt(true);
        activeOperationId.current = stored.request.operationId;
        showMessage("يوجد إرسال جارٍ من نافذة أخرى. نتحقق من نفس الطلب…", "status");
        void recoverStoredAttempt();
      }
    }
    window.addEventListener("storage", syncAttempt);
    return () => window.removeEventListener("storage", syncAttempt);
  }, [orderingState, submitting]);

  async function loadDeliveryAreas(isActive: () => boolean = () => true) {
    setAreasLoading(true);
    setAreasError(false);
    try {
      const response = await fetch("/api/public/checkout/delivery-areas", { cache: "no-store" });
      if (!response.ok) throw new Error("areas");
      const loaded = await response.json() as PublicDeliveryAreaDto[];
      if (isActive()) setAreas(loaded);
    } catch {
      if (isActive()) setAreasError(true);
    } finally {
      if (isActive()) setAreasLoading(false);
    }
  }

  async function reviewPrice() {
    if (orderingState !== "enabled") return;
    if (!fields.deliveryAreaId || cart.items.length === 0) return;
    const requestedKey = currentInputKey;
    const request: CheckoutQuoteRequest = {
      lines: cart.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      deliveryAreaId: fields.deliveryAreaId,
      ...optionalValue("couponCode", normalizedCoupon(fields.couponCode)),
    };
    setQuoting(true);
    setQuote(null);
    setQuoteKey("");
    showMessage("", "status");
    try {
      const response = await fetch("/api/public/checkout/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json() as CheckoutQuoteDto | ApiError;
      if (!response.ok) {
        showMessage(apiMessage(body, "تعذر حساب السعر الحالي."), "error");
        return;
      }
      if (requestedKey !== currentInputKeyRef.current) {
        showMessage("تغيّرت بيانات الطلب أثناء حساب السعر. راجع السعر مرة أخرى.", "status");
        return;
      }
      setQuote(body as CheckoutQuoteDto);
      setQuoteKey(requestedKey);
      showMessage("تم تحديث السعر من المخزون والإعدادات الحالية.", "status");
    } catch {
      showMessage("تعذر الاتصال لحساب السعر. لم يتم إرسال أي طلب.", "error");
    } finally {
      setQuoting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitStarted.current) return;
    submitStarted.current = true;
    setSubmitting(true);
    try {
      if (orderingState !== "enabled") {
        showMessage("الطلب عبر المتجر غير متاح حالياً.", "error");
        return;
      }
      if (!quote || quoteKey !== currentInputKey) {
        showMessage("راجع السعر الحالي قبل إرسال الطلب.", "error");
        return;
      }
      if (cart.storageStatus !== "ready") {
        showMessage("يلزم إتاحة حفظ المتصفح لضمان عدم تكرار الطلب عند انقطاع الاتصال.", "error");
        return;
      }
      const request: PublicOrderSubmissionRequest = {
        operationId: crypto.randomUUID(),
        quoteId: quote.quoteId,
        lines: cart.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        deliveryAreaId: fields.deliveryAreaId,
        customerName: fields.customerName.trim(),
        primaryPhone: fields.primaryPhone.trim(),
        detailedAddress: fields.detailedAddress.trim(),
        ...optionalValue("alternatePhone", fields.alternatePhone.trim()),
        ...optionalValue("landmark", fields.landmark.trim()),
        ...optionalValue("notes", fields.notes.trim()),
        ...optionalValue("couponCode", normalizedCoupon(fields.couponCode)),
      };
      const attemptAtStart = readAttempt();
      const requestedInputKey = currentInputKey;
      await withCheckoutLock(async () => {
        const stored = readAttempt();
        if (stored === "invalid") {
          setStorageBlocked(true);
          showMessage("تعذر قراءة محاولة الطلب المحفوظة. لم نرسل طلباً جديداً حتى لا يتكرر طلب سابق.", "error");
          return;
        }
        if (stored?.status === "accepted") {
          if (cart.items.length === 0 || !stored.cartCompleted || stored.request.quoteId === request.quoteId
            || !attemptAtStart || attemptAtStart === "invalid" || attemptAtStart.status === "pending"
            || attemptAtStart.request.operationId !== stored.request.operationId) {
            await acceptResult(stored.result, stored.request, stored.cartCompleted);
            return;
          }
        }
        if (stored?.status === "pending") {
          activeOperationId.current = stored.request.operationId;
          showMessage("نستكمل محاولة الإرسال المحفوظة نفسها…", "status");
          await sendExact(stored.request);
          return;
        }
        if (requestedInputKey !== currentInputKeyRef.current) {
          setQuote(null);
          setQuoteKey("");
          showMessage("تغيّرت السلة أثناء انتظار الإرسال. راجع السعر الحالي قبل بدء طلب جديد.", "status");
          return;
        }
        try {
          writeAttempt({ version: CHECKOUT_STORAGE_VERSION, status: "pending", request });
          setHasPendingAttempt(true);
          activeOperationId.current = request.operationId;
        } catch {
          setStorageBlocked(true);
          showMessage("تعذر حفظ هوية الطلب في هذا المتصفح، لذلك لم يتم الإرسال.", "error");
          return;
        }
        await sendExact(request);
      });
    } finally {
      submitStarted.current = false;
      setSubmitting(false);
    }
  }

  async function recoverStoredAttempt() {
    await withCheckoutLock(async () => {
      const stored = readAttempt();
      if (!stored || stored === "invalid") return;
      if (stored.status === "accepted") {
        await acceptResult(stored.result, stored.request, stored.cartCompleted);
        return;
      }
      activeOperationId.current = stored.request.operationId;
      await sendExact(stored.request);
    });
  }

  async function sendExact(request: PublicOrderSubmissionRequest) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/public/checkout/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json() as PublicOrderSubmissionDto | ApiError;
      if (response.ok) {
        const accepted = body as PublicOrderSubmissionDto;
        const cartCompleted = await cart.completeCheckout(request.operationId, request.lines);
        writeAttempt({ version: CHECKOUT_STORAGE_VERSION, status: "accepted", request, result: accepted, cartCompleted });
        await acceptResult(accepted, request, cartCompleted);
        return;
      }
      const code = (body as ApiError).error?.code;
      if (code === "OPERATION_CONFLICT") {
        setStorageBlocked(true);
        setUnresolved(true);
        showMessage(apiMessage(body, "تعذر مطابقة محاولة الطلب المحفوظة. تواصل مع برافوس قبل إعادة الإرسال."), "error");
        return;
      }
      if (code === "QUOTE_ALREADY_USED") {
        setUnresolved(true);
        showMessage("تم استخدام مراجعة السعر هذه في طلب سابق. احتفظنا بمحاولة الإرسال؛ تواصل مع برافوس للتحقق من الطلب قبل بدء طلب آخر.", "error");
        return;
      }
      if (!isDefiniteRejection(response.status, code)) {
        setUnresolved(true);
        showMessage("لم نتمكن من معرفة نتيجة الإرسال. احتفظنا بالسلة وبنفس هوية الطلب، ويمكن التحقق من المحاولة نفسها دون إنشاء طلب آخر.", "error");
        return;
      }
      removePendingAttempt(request.operationId);
      setHasPendingAttempt(false);
      activeOperationId.current = null;
      setUnresolved(false);
      setQuote(null);
      setQuoteKey("");
      if (code === "QUOTE_STALE") {
        showMessage("تغيّر السعر أو رسوم التوصيل منذ مراجعتك. راجع السعر الجديد ثم أرسل الطلب مرة أخرى.", "error");
      } else {
        showMessage(apiMessage(body, "تعذر إرسال الطلب. راجع البيانات وحاول مرة أخرى."), "error");
      }
    } catch {
      setUnresolved(true);
      showMessage("لم نتمكن من معرفة نتيجة الإرسال. احتفظنا بالسلة وهوية الطلب وسنتحقق من نفس الطلب عند إعادة تحميل الصفحة أو فتحها في نافذة أخرى.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptResult(accepted: PublicOrderSubmissionDto, request: PublicOrderSubmissionRequest, alreadyCompleted: boolean) {
    const cartCompleted = alreadyCompleted || await cart.completeCheckout(request.operationId, request.lines);
    if (cartCompleted && !alreadyCompleted) {
      const stored = readAttempt();
      if (stored && stored !== "invalid" && stored.status === "accepted" && stored.request.operationId === request.operationId) {
        writeAttempt({ ...stored, cartCompleted: true });
      }
    }
    setResult(accepted);
    setStorageBlocked(false);
    setUnresolved(false);
    setHasPendingAttempt(false);
    activeOperationId.current = null;
    setMessage("");
  }

  function showMessage(value: string, kind: "status" | "error") {
    setMessage(value);
    setMessageKind(kind);
  }

  const intro = (
    <div className={`page-title ${styles.intro}`}>
      <p className="eyebrow">الدفع نقداً عند الاستلام</p>
      <h1>إتمام طلب التوصيل</h1>
      <p>لا تحتاج إلى إنشاء حساب. راجع إجمالي الدفع عند الاستلام، ثم أرسل طلبك ليتواصل معك ممثل برافوس عبر واتساب للتأكيد.</p>
    </div>
  );

  if (!cart.hydrated || orderingState === "loading") {
    return <main id="main-content" className={`checkout-page ${styles.page}`}>{intro}<p role="status" className={styles.loading}>لحظات... نجهّز بيانات الطلب.</p></main>;
  }

  if (result) {
    return (
      <main id="main-content" className={`checkout-page checkout-success ${styles.page} ${styles.success}`}>
        <p className="eyebrow">طلب توصيل نقداً عند الاستلام</p>
        <h1>تم استلام طلبك</h1>
        <p className="order-reference">رقم الطلب: <strong>{result.reference}</strong></p>
        <p role="status" className={`success ${styles.pendingNotice}`}>الطلب قيد المراجعة، ولم تُحجز القطع حتى الآن.</p>
        <p>سيتواصل معك ممثل برافوس عبر واتساب لتأكيد الطلب والتأكد من توفر القطع.</p>
        <p className="success-total">الإجمالي النقدي عند الاستلام الذي راجعته: <strong>{formatEgp(result.quote.finalTotalPiasters)}</strong></p>
        <Link className="button-link" href="/">العودة إلى المتجر</Link>
      </main>
    );
  }

  if (orderingState === "disabled" || orderingState === "unavailable") {
    return (
      <main id="main-content" className={`checkout-page ${styles.page}`}>
        <div className="empty-state">
          <p className="eyebrow">المتجر متاح للتصفح</p>
          <h1>الطلب عبر المتجر غير متاح حالياً</h1>
          <p>{orderingState === "disabled"
            ? "نجهّز استقبال طلبات التوصيل. يمكنك تصفح المنتجات والاحتفاظ بما أضفته إلى السلة حتى يبدأ استقبال الطلبات."
            : "تعذر التحقق من إتاحة الطلب الآن. احتفظنا بسلتك وبيانات أي محاولة إرسال سابقة؛ أعد المحاولة بعد قليل."}</p>
          {hasPendingAttempt ? <p role="status">توجد محاولة إرسال سابقة لم تتأكد نتيجتها بعد. نتحقق من نفس الطلب، وقد يكون قد تم استلامه قبل إيقاف الطلبات.</p> : null}
          {message && hasPendingAttempt ? <p role={messageKind === "error" ? "alert" : "status"}>{message}</p> : null}
          {hasPendingAttempt && !storageBlocked ? <button type="button" className="secondary-action" disabled={submitting} onClick={() => void recoverStoredAttempt()}>{submitting ? "لحظات... نتحقق من نفس الطلب" : "التحقق من نفس الطلب"}</button> : null}
          <div className="checkout-actions">
            <Link className="button-link" href="/">العودة إلى المتجر</Link>
            <Link href="/cart">عرض السلة</Link>
          </div>
        </div>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main id="main-content" className={`checkout-page ${styles.page}`}>
        <div className="empty-state">
          <h1>السلة فارغة</h1>
          <p>أضف منتجات إلى السلة قبل إتمام طلب التوصيل.</p>
          <Link className="button-link" href="/">تصفّح المنتجات</Link>
        </div>
      </main>
    );
  }

  const cartValid = cart.items.every((item) => item.orderable && item.quantity <= item.knownAvailableQuantity);

  return (
    <main id="main-content" className={`checkout-page ${styles.page}`}>
      {intro}
      <div className={`checkout-layout ${styles.layout}`}>
        <form className={`checkout-form ${styles.form}`} aria-label="بيانات طلب التوصيل" onSubmit={(event) => void submit(event)} onInvalidCapture={markInvalidField} onChange={clearCorrectedField}>
          <fieldset disabled={submitting || storageBlocked || unresolved}>
            <legend>بيانات التواصل والتوصيل</legend>
            <p className={styles.sectionHint}>البيانات المطلوبة للتواصل معك وتوصيل الطلب</p>
            <div className={`checkout-fields ${styles.fields}`}>
              <CheckoutInput label="الاسم" name="customerName" value={fields.customerName} required autoComplete="name" onChange={updateField} invalid={invalidFields.includes("customerName")} />
              <CheckoutInput label="رقم الموبايل الأساسي" name="primaryPhone" value={fields.primaryPhone} required type="tel" inputMode="tel" autoComplete="tel" dir="ltr" onChange={updateField} invalid={invalidFields.includes("primaryPhone")} />
              <label className={`checkout-field ${styles.field}`}>
                <span>منطقة التوصيل <span className={styles.requiredTag} aria-hidden="true">مطلوب</span></span>
                <select name="deliveryAreaId" required value={fields.deliveryAreaId} aria-invalid={invalidFields.includes("deliveryAreaId") || undefined} aria-describedby={invalidFields.includes("deliveryAreaId") ? "deliveryAreaId-error" : undefined} disabled={areasLoading || areas.length === 0 || submitting || storageBlocked || unresolved} onChange={(event) => setField("deliveryAreaId", event.target.value)}>
                  <option value="">{areasLoading ? "لحظات... نحمّل المناطق" : "اختر المنطقة"}</option>
                  {areas.map((area) => <option key={area.id} value={area.id}>{area.nameAr} — {formatEgp(area.feePiasters)}</option>)}
                </select>
                {invalidFields.includes("deliveryAreaId") ? <small id="deliveryAreaId-error" className={styles.fieldError}>اختر منطقة التوصيل.</small> : null}
                {areasError ? <><small className={styles.fieldError} role="alert">تعذر تحميل مناطق التوصيل. بياناتك محفوظة في هذه الصفحة؛ أعد المحاولة.</small><button type="button" className="secondary-action" disabled={areasLoading} onClick={() => void loadDeliveryAreas()}>إعادة تحميل مناطق التوصيل</button></> : null}
                {!areasLoading && !areasError && areas.length === 0 ? <small className={styles.areaHelp}>لا تظهر مناطق توصيل متاحة حالياً. لا يمكن مراجعة السعر قبل اختيار منطقة مدعومة.</small> : null}
              </label>
              <label className={`checkout-field checkout-wide ${styles.field}`}>
                <span>العنوان بالتفصيل <span className={styles.requiredTag} aria-hidden="true">مطلوب</span></span>
                <textarea name="detailedAddress" required rows={3} autoComplete="street-address" value={fields.detailedAddress} aria-invalid={invalidFields.includes("detailedAddress") || undefined} aria-describedby={invalidFields.includes("detailedAddress") ? "detailedAddress-error" : undefined} onChange={(event) => setField("detailedAddress", event.target.value)} />
                {invalidFields.includes("detailedAddress") ? <small id="detailedAddress-error" className={styles.fieldError}>اكتب العنوان بالتفصيل.</small> : null}
              </label>
            </div>
            <p className={styles.optionalHeading}>تفاصيل اختيارية تساعد في التوصيل</p>
            <div className={`checkout-fields ${styles.fields}`}>
              <CheckoutInput label="رقم بديل (اختياري)" name="alternatePhone" value={fields.alternatePhone} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" onChange={updateField} />
              <CheckoutInput label="علامة مميزة (اختياري)" name="landmark" value={fields.landmark} onChange={updateField} />
              <label className={`checkout-field checkout-wide ${styles.field}`}>
                <span>ملاحظات (اختياري)</span>
                <textarea rows={3} value={fields.notes} onChange={(event) => setField("notes", event.target.value)} />
              </label>
            </div>
          </fieldset>
          <fieldset disabled={submitting || storageBlocked || unresolved}>
            <legend>الكوبون ومراجعة السعر</legend>
            <label className={`checkout-field coupon-field ${styles.field}`}>
              <span>كود الكوبون (اختياري)</span>
              <input value={fields.couponCode} autoCapitalize="characters" onChange={(event) => setField("couponCode", event.target.value)} />
            </label>
            <p className={styles.reviewHint}>رسوم التوصيل والخصومات والإجمالي النهائي تظهر بعد مراجعة السعر.</p>
            <button type="button" className="secondary-action review-price" disabled={!cartValid || !fields.deliveryAreaId || quoting} onClick={() => void reviewPrice()}>
              {quoting ? "لحظات... نراجع السعر" : quote ? "مراجعة السعر من جديد" : "مراجعة السعر"}
            </button>
          </fieldset>
          {quoting ? <p aria-live="polite" className={styles.processNotice}>لحظات... نراجع السعر ورسوم التوصيل الحالية.</p> : null}
          {quote && quoteKey === currentInputKey ? <PriceReview quote={quote} /> : null}
          {message ? <p className={messageKind === "error" ? "checkout-message error-message" : "checkout-message"} role={messageKind === "error" ? "alert" : "status"}>{message}</p> : null}
          {submitting ? <p aria-live="polite" className={styles.processNotice}>لحظات... نتحقق من نتيجة إرسال نفس الطلب. يُرجى الانتظار.</p> : null}
          {unresolved && !submitting ? <div className={styles.uncertainNotice}><strong>نتيجة الإرسال غير مؤكدة</strong><p>احتفظنا بنفس محاولة الطلب. استخدم التحقق أدناه قبل أي طلب جديد.</p></div> : null}
          {unresolved && !storageBlocked ? <button type="button" className="secondary-action" disabled={submitting} onClick={() => void recoverStoredAttempt()}>التحقق من نفس الطلب</button> : null}
          {storageBlocked ? <p className="recovery-help">لا يمكن بدء إرسال جديد بأمان من هذه الصفحة. لم نمسح أي بيانات محفوظة؛ تواصل مع برافوس عبر الروابط أسفل الصفحة قبل بدء طلب آخر.</p> : null}
          {quote && quoteKey === currentInputKey ? (
            <button type="submit" className="submit-order" disabled={submitting || !cartValid || storageBlocked || unresolved}>
              {submitting ? "لحظات... نتحقق من نفس الطلب" : "إرسال طلب التوصيل"}
            </button>
          ) : null}
          <p className="muted">ترسل طلباً للمراجعة، والدفع نقداً عند الاستلام. لا تُحجز القطع ولا يُستهلك الكوبون عند الإرسال؛ يؤكد ممثل برافوس الطلب لاحقاً عبر واتساب.</p>
        </form>
        <aside className={`checkout-cart ${styles.summary}`} aria-label="ملخص منتجات الطلب">
          <div className="checkout-cart-heading"><h2>منتجاتك</h2><Link className={styles.editCartLink} href="/cart">تعديل السلة</Link></div>
          {cart.items.map((item) => {
            const reviewed = quoteKey === currentInputKey ? quote?.lines.find((line) => line.variantId === item.variantId) : undefined;
            return (
            <article key={item.variantId}>
              <div><strong>{reviewed?.productNameAr ?? item.productNameAr}</strong><small>{reviewed?.sizeNameAr ?? item.sizeNameAr} · {reviewed?.colorNameAr ?? item.colorNameAr}</small></div>
              <span>{reviewed?.quantity ?? item.quantity} × {formatEgp(reviewed?.listedUnitPricePiasters ?? item.unitPricePiasters)}</span>
              {!item.orderable || item.quantity > item.knownAvailableQuantity ? <p className="stock-warning">هذه الكمية تحتاج إلى تعديل في السلة.</p> : null}
            </article>
          );})}
          <p><span>{quote && quoteKey === currentInputKey ? "مجموع المنتجات قبل الخصم" : "مجموع المنتجات المبدئي"}</span><strong>{formatEgp(quote && quoteKey === currentInputKey ? quote.merchandiseOriginalPiasters : cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0))}</strong></p>
          <p className="muted">هذا المجموع قبل الخصومات ورسوم التوصيل. راجع الإجمالي النقدي النهائي في تفاصيل السعر.</p>
        </aside>
      </div>
    </main>
  );

  function updateField(event: ChangeEvent<HTMLInputElement>) {
    setField(event.target.name as keyof CheckoutFields, event.target.value);
  }

  function setField(name: keyof CheckoutFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function markInvalidField(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && target.required) {
      setInvalidFields((current) => current.includes(target.name) ? current : [...current, target.name]);
    }
  }

  function clearCorrectedField(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && target.name && target.validity.valid) {
      setInvalidFields((current) => current.includes(target.name) ? current.filter((name) => name !== target.name) : current);
    }
  }
}

function CheckoutInput({ label, name, value, onChange, invalid = false, ...input }: {
  label: string;
  name: keyof CheckoutFields;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange">) {
  return <label className={`checkout-field ${styles.field}`}><span>{label} {input.required ? <span className={styles.requiredTag} aria-hidden="true">مطلوب</span> : null}</span><input name={name} value={value} onChange={onChange} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${name}-error` : undefined} {...input} />{invalid ? <small id={`${name}-error`} className={styles.fieldError}>أكمل هذا الحقل.</small> : null}</label>;
}

function PriceReview({ quote }: { quote: CheckoutQuoteDto }) {
  return (
    <section className={`price-review ${styles.priceReview}`} aria-label="تفاصيل السعر">
      <h2>تفاصيل السعر</h2>
      <p className={styles.authoritativeHint}>المبلغ المحسوب عند آخر مراجعة، شاملاً الخصومات ورسوم التوصيل.</p>
      <p><span>إجمالي المنتجات قبل الخصم</span><strong>{formatEgp(quote.merchandiseOriginalPiasters)}</strong></p>
      {quote.appliedAutomaticOffer ? <p><span>{quote.appliedAutomaticOffer.nameAr}</span><strong>− {formatEgp(quote.automaticOfferDiscountPiasters)}</strong></p> : null}
      {quote.appliedCoupon ? <p><span>كوبون {quote.appliedCoupon.code}</span><strong>− {formatEgp(quote.couponDiscountPiasters)}</strong></p> : null}
      <p><span>إجمالي المنتجات بعد الخصم</span><strong>{formatEgp(quote.merchandiseTotalPiasters)}</strong></p>
      <p><span>رسوم التوصيل إلى {quote.area.nameAr}</span><strong>{formatEgp(quote.deliveryFeePiasters)}</strong></p>
      <p className="final-total"><span>الإجمالي عند الاستلام</span><strong>{formatEgp(quote.finalTotalPiasters)}</strong></p>
    </section>
  );
}

function checkoutInputKey(items: Array<{ variantId: string; quantity: number }>, deliveryAreaId: string, couponCode: string) {
  return JSON.stringify({
    lines: items.map(({ variantId, quantity }) => ({ variantId, quantity })).sort((left, right) => left.variantId.localeCompare(right.variantId)),
    deliveryAreaId,
    couponCode: normalizedCoupon(couponCode),
  });
}

function normalizedCoupon(value: string) {
  return value.trim().toUpperCase();
}

function optionalValue<Key extends string>(key: Key, value: string): { [Property in Key]?: string } {
  return value ? { [key]: value } as { [Property in Key]?: string } : {};
}

function apiMessage(body: CheckoutQuoteDto | PublicOrderSubmissionDto | ApiError, fallback: string) {
  return "error" in body && body.error?.messageAr ? body.error.messageAr : fallback;
}

function isDefiniteRejection(status: number, code: string | undefined) {
  return status >= 400 && status < 500 && new Set([
    "VALIDATION",
    "UNSUPPORTED_DELIVERY_AREA",
    "VARIANT_NOT_ORDERABLE",
    "INSUFFICIENT_STOCK",
    "QUOTE_STALE",
  ]).has(code ?? "");
}

async function withCheckoutLock<T>(run: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(CHECKOUT_LOCK, run);
  return run();
}

function readAttempt(): StoredAttempt | "invalid" | null {
  try {
    const raw = window.localStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (!raw) return null;
    return parseAttempt(raw) ?? "invalid";
  } catch {
    return "invalid";
  }
}

function parseAttempt(raw: string): StoredAttempt | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredAttempt>;
    if (value.version !== CHECKOUT_STORAGE_VERSION || (value.status !== "pending" && value.status !== "accepted") || !validRequest(value.request)) return null;
    if (value.status === "accepted" && (!validResult(value.result) || typeof value.cartCompleted !== "boolean")) return null;
    return value as StoredAttempt;
  } catch {
    return null;
  }
}

function validRequest(value: unknown): value is PublicOrderSubmissionRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.operationId === "string" && request.operationId.length > 0
    && typeof request.quoteId === "string" && request.quoteId.length > 0
    && typeof request.customerName === "string" && request.customerName.length > 0
    && typeof request.primaryPhone === "string" && request.primaryPhone.length > 0
    && typeof request.deliveryAreaId === "string" && request.deliveryAreaId.length > 0
    && typeof request.detailedAddress === "string" && request.detailedAddress.length > 0
    && Array.isArray(request.lines)
    && request.lines.length > 0
    && request.lines.every((line) => Boolean(line) && typeof line === "object"
      && typeof (line as Record<string, unknown>).variantId === "string"
      && Number.isInteger((line as Record<string, unknown>).quantity)
      && Number((line as Record<string, unknown>).quantity) > 0);
}

function validResult(value: unknown): value is PublicOrderSubmissionDto {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.orderId === "string" && typeof result.reference === "string" && result.status === "pending"
    && typeof result.submittedAt === "string" && Boolean(result.quote) && typeof result.quote === "object";
}

function writeAttempt(attempt: StoredAttempt) {
  window.localStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(attempt));
}

function removePendingAttempt(operationId: string) {
  const stored = readAttempt();
  if (stored && stored !== "invalid" && stored.status === "pending" && stored.request.operationId === operationId) {
    window.localStorage.removeItem(CHECKOUT_STORAGE_KEY);
  }
}
