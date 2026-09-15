"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, type InputHTMLAttributes, useEffect, useMemo, useRef, useState } from "react";
import type {
  CheckoutQuoteDto,
  CheckoutQuoteRequest,
  PublicDeliveryAreaDto,
  PublicOrderSubmissionDto,
  PublicOrderSubmissionRequest,
} from "@bravos/contracts/public";
import { useCart } from "../cart/cart-provider";
import { formatEgp } from "../public-catalog";

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
  const [areas, setAreas] = useState<PublicDeliveryAreaDto[]>([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [quote, setQuote] = useState<CheckoutQuoteDto | null>(null);
  const [quoteKey, setQuoteKey] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicOrderSubmissionDto | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"status" | "error">("status");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const recoveryStarted = useRef(false);
  const activeOperationId = useRef<string | null>(null);
  const currentInputKey = useMemo(
    () => checkoutInputKey(cart.items, fields.deliveryAreaId, fields.couponCode),
    [cart.items, fields.deliveryAreaId, fields.couponCode],
  );
  const currentInputKeyRef = useRef(currentInputKey);
  currentInputKeyRef.current = currentInputKey;

  useEffect(() => {
    let active = true;
    void fetch("/api/public/checkout/delivery-areas", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("areas");
        return response.json() as Promise<PublicDeliveryAreaDto[]>;
      })
      .then((loaded) => {
        if (active) setAreas(loaded);
      })
      .catch(() => {
        if (active) showMessage("تعذر تحميل مناطق التوصيل حالياً. أعد المحاولة بعد قليل.", "error");
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
    if (!cart.hydrated || recoveryStarted.current) return;
    recoveryStarted.current = true;
    const stored = readAttempt();
    if (stored === "invalid") {
      setStorageBlocked(true);
      showMessage("تعذر قراءة محاولة طلب محفوظة. أوقفنا أي إرسال جديد حتى لا يتكرر طلب سابق.", "error");
      return;
    }
    if (!stored) return;
    if (stored.status === "accepted") {
      if (!stored.cartCompleted || cart.items.length === 0) void acceptResult(stored.result, stored.request, stored.cartCompleted);
      return;
    }
    activeOperationId.current = stored.request.operationId;
    showMessage("جارٍ التحقق من نتيجة الإرسال السابق…", "status");
    void recoverStoredAttempt();
  }, [cart.hydrated]);

  useEffect(() => {
    function syncAttempt(event: StorageEvent) {
      if (event.key !== CHECKOUT_STORAGE_KEY || !event.newValue) return;
      const stored = parseAttempt(event.newValue);
      if (!stored) return;
      if (stored.status === "accepted" && activeOperationId.current === stored.request.operationId) {
        void acceptResult(stored.result, stored.request, stored.cartCompleted);
      } else if (stored.status === "pending" && !submitting) {
        activeOperationId.current = stored.request.operationId;
        showMessage("يوجد إرسال جارٍ من نافذة أخرى. نتحقق من نفس الطلب…", "status");
        void recoverStoredAttempt();
      }
    }
    window.addEventListener("storage", syncAttempt);
    return () => window.removeEventListener("storage", syncAttempt);
  }, [submitting]);

  async function reviewPrice() {
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
    await withCheckoutLock(async () => {
      const stored = readAttempt();
      if (stored === "invalid") {
        setStorageBlocked(true);
        showMessage("تعذر قراءة محاولة الطلب المحفوظة. لم نرسل طلباً جديداً حتى لا يتكرر طلب سابق.", "error");
        return;
      }
      if (stored?.status === "accepted") {
        if (cart.items.length === 0) {
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
      try {
        writeAttempt({ version: CHECKOUT_STORAGE_VERSION, status: "pending", request });
        activeOperationId.current = request.operationId;
      } catch {
        setStorageBlocked(true);
        showMessage("تعذر حفظ هوية الطلب في هذا المتصفح، لذلك لم يتم الإرسال.", "error");
        return;
      }
      await sendExact(request);
    });
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
      if (!isDefiniteRejection(response.status, code)) {
        setUnresolved(true);
        showMessage("لم نتمكن من معرفة نتيجة الإرسال. احتفظنا بالسلة وبنفس هوية الطلب، ويمكن التحقق من المحاولة نفسها دون إنشاء طلب آخر.", "error");
        return;
      }
      removePendingAttempt(request.operationId);
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
    activeOperationId.current = null;
    setMessage("");
  }

  function showMessage(value: string, kind: "status" | "error") {
    setMessage(value);
    setMessageKind(kind);
  }

  if (!cart.hydrated) {
    return <main id="main-content" className="checkout-page"><p>جارٍ تحميل بيانات الطلب…</p></main>;
  }

  if (result) {
    return (
      <main id="main-content" className="checkout-page checkout-success">
        <p className="eyebrow">طلب توصيل نقداً عند الاستلام</p>
        <h1>تم استلام طلبك</h1>
        <p className="order-reference">رقم الطلب: <strong>{result.reference}</strong></p>
        <p role="status" className="success">الطلب قيد المراجعة، ولم تُحجز القطع حتى الآن.</p>
        <p>سيتواصل معك ممثل برافوس عبر واتساب لتأكيد الطلب والتأكد من توفر القطع.</p>
        <p className="success-total">الإجمالي الذي راجعته: <strong>{formatEgp(result.quote.finalTotalPiasters)}</strong></p>
        <Link className="button-link" href="/">العودة إلى المتجر</Link>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main id="main-content" className="checkout-page">
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
    <main id="main-content" className="checkout-page">
      <div className="page-title">
        <p className="eyebrow">الدفع نقداً عند الاستلام</p>
        <h1>إتمام طلب التوصيل</h1>
        <p>لا تحتاج إلى إنشاء حساب. نراجع السعر الآن، ثم يتواصل معك ممثل برافوس عبر واتساب لتأكيد الطلب.</p>
      </div>
      <div className="checkout-layout">
        <form className="checkout-form" aria-label="بيانات طلب التوصيل" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={submitting || storageBlocked || unresolved}>
            <legend>بيانات التواصل والتوصيل</legend>
            <div className="checkout-fields">
              <CheckoutInput label="الاسم" name="customerName" value={fields.customerName} required autoComplete="name" onChange={updateField} />
              <CheckoutInput label="رقم الموبايل الأساسي" name="primaryPhone" value={fields.primaryPhone} required type="tel" inputMode="tel" autoComplete="tel" onChange={updateField} />
              <CheckoutInput label="رقم بديل (اختياري)" name="alternatePhone" value={fields.alternatePhone} type="tel" inputMode="tel" onChange={updateField} />
              <label className="checkout-field">
                <span>منطقة التوصيل</span>
                <select required value={fields.deliveryAreaId} disabled={areasLoading || areas.length === 0 || submitting || storageBlocked || unresolved} onChange={(event) => setField("deliveryAreaId", event.target.value)}>
                  <option value="">{areasLoading ? "جارٍ تحميل المناطق…" : "اختر المنطقة"}</option>
                  {areas.map((area) => <option key={area.id} value={area.id}>{area.nameAr} — {formatEgp(area.feePiasters)}</option>)}
                </select>
              </label>
              <label className="checkout-field checkout-wide">
                <span>العنوان بالتفصيل</span>
                <textarea required rows={3} autoComplete="street-address" value={fields.detailedAddress} onChange={(event) => setField("detailedAddress", event.target.value)} />
              </label>
              <CheckoutInput label="علامة مميزة (اختياري)" name="landmark" value={fields.landmark} onChange={updateField} />
              <label className="checkout-field checkout-wide">
                <span>ملاحظات (اختياري)</span>
                <textarea rows={3} value={fields.notes} onChange={(event) => setField("notes", event.target.value)} />
              </label>
            </div>
          </fieldset>
          <fieldset disabled={submitting || storageBlocked || unresolved}>
            <legend>الكوبون ومراجعة السعر</legend>
            <label className="checkout-field coupon-field">
              <span>كود الكوبون (اختياري)</span>
              <input value={fields.couponCode} autoCapitalize="characters" onChange={(event) => setField("couponCode", event.target.value)} />
            </label>
            <button type="button" className="secondary-action review-price" disabled={!cartValid || !fields.deliveryAreaId || quoting} onClick={() => void reviewPrice()}>
              {quoting ? "جارٍ حساب السعر…" : quote ? "مراجعة السعر من جديد" : "مراجعة السعر"}
            </button>
          </fieldset>
          {quote && quoteKey === currentInputKey ? <PriceReview quote={quote} /> : null}
          {message ? <p className={messageKind === "error" ? "checkout-message error-message" : "checkout-message"} role={messageKind === "error" ? "alert" : "status"}>{message}</p> : null}
          {unresolved && !storageBlocked ? <button type="button" className="secondary-action" disabled={submitting} onClick={() => void recoverStoredAttempt()}>التحقق من نفس الطلب</button> : null}
          {storageBlocked ? <p className="recovery-help">لا يمكن بدء إرسال جديد بأمان من هذه الصفحة. لم نمسح أي بيانات محفوظة؛ تواصل مع برافوس عبر الروابط أسفل الصفحة قبل بدء طلب آخر.</p> : null}
          {quote && quoteKey === currentInputKey ? (
            <button type="submit" className="submit-order" disabled={submitting || !cartValid || storageBlocked || unresolved}>
              {submitting ? "جارٍ إرسال نفس الطلب…" : "إرسال طلب التوصيل"}
            </button>
          ) : null}
          <p className="muted">إرسال الطلب لا يحجز المخزون ولا يستهلك الكوبون. يتم ذلك فقط بعد تأكيد ممثل برافوس عبر واتساب.</p>
        </form>
        <aside className="checkout-cart" aria-label="ملخص منتجات الطلب">
          <div className="checkout-cart-heading"><h2>منتجاتك</h2><Link href="/cart">تعديل السلة</Link></div>
          {cart.items.map((item) => (
            <article key={item.variantId}>
              <div><strong>{item.productNameAr}</strong><small>{item.sizeNameAr} · {item.colorNameAr}</small></div>
              <span>{item.quantity} × {formatEgp(item.unitPricePiasters)}</span>
              {!item.orderable || item.quantity > item.knownAvailableQuantity ? <p className="stock-warning">هذه الكمية تحتاج إلى تعديل في السلة.</p> : null}
            </article>
          ))}
          <p><span>المجموع المبدئي</span><strong>{formatEgp(cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0))}</strong></p>
          <p className="muted">سيعاد التحقق من الأسعار والمخزون عند الإرسال.</p>
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
}

function CheckoutInput({ label, name, value, onChange, ...input }: {
  label: string;
  name: keyof CheckoutFields;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "value" | "onChange">) {
  return <label className="checkout-field"><span>{label}</span><input name={name} value={value} onChange={onChange} {...input} /></label>;
}

function PriceReview({ quote }: { quote: CheckoutQuoteDto }) {
  return (
    <section className="price-review" aria-label="تفاصيل السعر">
      <h2>تفاصيل السعر</h2>
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
