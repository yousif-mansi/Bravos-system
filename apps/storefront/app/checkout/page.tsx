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
import { cartWithinSharedPool, lineQuantityCap } from "../cart/shared-pool";
import { formatEgp } from "../public-catalog";
import { type CheckoutFields, useCheckoutDraft } from "./checkout-draft";
import { publicCheckoutErrorMessage } from "./public-error-message";
import styles from "./checkout.module.css";

const CHECKOUT_STORAGE_KEY = "bravos-guest-checkout-v1";
const CHECKOUT_STORAGE_VERSION = 1;
const CHECKOUT_LOCK = "bravos-guest-checkout-submit";

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
type SubmissionAcknowledgement = "pending-request" | "already-received";

export default function CheckoutPage() {
  const cart = useCart();
  const { fields, setFields, clearDraft } = useCheckoutDraft();
  const [orderingState, setOrderingState] = useState<OrderingState>("loading");
  const [areas, setAreas] = useState<PublicDeliveryAreaDto[]>([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [areasError, setAreasError] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuoteDto | null>(null);
  const [quoteKey, setQuoteKey] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicOrderSubmissionDto | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<SubmissionAcknowledgement>("pending-request");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"status" | "error">("status");
  const [stockRepair, setStockRepair] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [hasPendingAttempt, setHasPendingAttempt] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(() =>
    Boolean(fields.alternatePhone.trim() || fields.landmark.trim() || fields.notes.trim()),
  );
  const recoveryStarted = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const activeOperationId = useRef<string | null>(null);
  const submitStarted = useRef(false);
  const currentInputKey = useMemo(
    () => checkoutInputKey(cart.items, fields.deliveryAreaId, fields.couponCode),
    [cart.items, fields.deliveryAreaId, fields.couponCode],
  );
  const currentInputKeyRef = useRef(currentInputKey);
  currentInputKeyRef.current = currentInputKey;

  useEffect(() => {
    if (!result) return;
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [result]);

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
          showMessage("Ordering availability could not be checked right now. Any earlier send attempt is kept.", "error");
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
    showMessage("The bag, delivery area, or coupon changed. Review the current price again.", "status");
  }, [currentInputKey, quote, quoteKey]);

  useEffect(() => {
    if (!cart.hydrated || orderingState === "loading" || recoveryStarted.current) return;
    const stored = readAttempt();
    if (stored === "invalid") {
      recoveryStarted.current = true;
      setStorageBlocked(true);
      showMessage("A saved order attempt could not be read. New sending is stopped so an earlier request is not repeated.", "error");
      return;
    }
    if (!stored) return;
    if (stored.status === "accepted") {
      recoveryStarted.current = true;
      if (!stored.cartCompleted || cart.items.length === 0) void acceptResult(stored.result, stored.request, stored.cartCompleted, "already-received");
      return;
    }
    recoveryStarted.current = true;
    setHasPendingAttempt(true);
    activeOperationId.current = stored.request.operationId;
    showMessage("Checking the result of the previous send…", "status");
    void recoverStoredAttempt();
  }, [cart.hydrated, orderingState]);

  useEffect(() => {
    function syncAttempt(event: StorageEvent) {
      if (event.key !== CHECKOUT_STORAGE_KEY || !event.newValue) return;
      const stored = parseAttempt(event.newValue);
      if (!stored) return;
      if (stored.status === "accepted" && activeOperationId.current === stored.request.operationId) {
        void acceptResult(stored.result, stored.request, stored.cartCompleted, "already-received");
      } else if (stored.status === "pending" && !submitting && orderingState !== "loading") {
        setHasPendingAttempt(true);
        activeOperationId.current = stored.request.operationId;
        showMessage("A send is in progress in another window. We are checking the same request…", "status");
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
        showMessage(publicCheckoutErrorMessage(body, "quote", "The current price could not be calculated."), "error", isStockRejection((body as ApiError).error?.code));
        return;
      }
      if (requestedKey !== currentInputKeyRef.current) {
        showMessage("The order details changed while the price was being reviewed. Review the price again.", "status");
        return;
      }
      setQuote(body as CheckoutQuoteDto);
      setQuoteKey(requestedKey);
      showMessage("The price was updated from current stock and settings.", "status");
    } catch {
      showMessage("The price could not be reached. No order request was sent.", "error");
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
        showMessage("Ordering on the store is not available right now.", "error");
        return;
      }
      if (!quote || quoteKey !== currentInputKey) {
        showMessage("Review the current price before placing the order request.", "error");
        return;
      }
      if (cart.storageStatus !== "ready") {
        showMessage("This browser must be able to save the request so a lost connection cannot create a duplicate.", "error");
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
          showMessage("The saved order attempt could not be read. No new request was sent, so an earlier request is not repeated.", "error");
          return;
        }
        if (stored?.status === "accepted") {
          if (cart.items.length === 0 || !stored.cartCompleted || stored.request.quoteId === request.quoteId
            || !attemptAtStart || attemptAtStart === "invalid" || attemptAtStart.status === "pending"
            || attemptAtStart.request.operationId !== stored.request.operationId) {
            await acceptResult(stored.result, stored.request, stored.cartCompleted, "already-received");
            return;
          }
        }
        if (stored?.status === "pending") {
          activeOperationId.current = stored.request.operationId;
          showMessage("Continuing the same saved send…", "status");
          await sendExact(stored.request);
          return;
        }
        if (requestedInputKey !== currentInputKeyRef.current) {
          setQuote(null);
          setQuoteKey("");
          showMessage("The bag changed while waiting to send. Review the current price before starting a new order request.", "status");
          return;
        }
        try {
          writeAttempt({ version: CHECKOUT_STORAGE_VERSION, status: "pending", request });
          setHasPendingAttempt(true);
          activeOperationId.current = request.operationId;
        } catch {
          setStorageBlocked(true);
          showMessage("The request identity could not be saved in this browser, so nothing was sent.", "error");
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
        await acceptResult(stored.result, stored.request, stored.cartCompleted, "already-received");
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
        await acceptResult(accepted, request, cartCompleted, response.status === 200 ? "already-received" : "pending-request");
        return;
      }
      const code = (body as ApiError).error?.code;
      if (code === "OPERATION_CONFLICT") {
        setStorageBlocked(true);
        setUnresolved(true);
        showMessage(publicCheckoutErrorMessage(body, "submit", "This saved attempt does not match an order request already stored for that attempt. Contact Bravos before placing another request. Nothing new was accepted."), "error");
        return;
      }
      if (code === "QUOTE_ALREADY_USED") {
        setUnresolved(true);
        showMessage(publicCheckoutErrorMessage(body, "submit", "This price review was already used for an earlier order request. The saved send attempt is kept. Contact Bravos to check that request before starting another one."), "error");
        return;
      }
      if (!isDefiniteRejection(response.status, code)) {
        setUnresolved(true);
        showMessage("We could not tell the result of this send. Your bag and the same request identity are kept. You can check this same attempt without placing another order request.", "error");
        return;
      }
      removePendingAttempt(request.operationId);
      setHasPendingAttempt(false);
      activeOperationId.current = null;
      setUnresolved(false);
      setQuote(null);
      setQuoteKey("");
      if (code === "QUOTE_STALE") {
        showMessage(publicCheckoutErrorMessage(body, "submit", "The price or delivery fee changed after your review. Review the new price, then place the order request again."), "error");
      } else {
        showMessage(publicCheckoutErrorMessage(body, "submit", "The order request could not be sent. Check the details and try again."), "error", isStockRejection(code));
      }
    } catch {
      setUnresolved(true);
      showMessage("We could not tell the result of this send. Your bag and the request identity are kept. The same request is checked again when you reload this page or open it in another window.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptResult(accepted: PublicOrderSubmissionDto, request: PublicOrderSubmissionRequest, alreadyCompleted: boolean, acknowledgementKind: SubmissionAcknowledgement) {
    const cartCompleted = alreadyCompleted || await cart.completeCheckout(request.operationId, request.lines);
    if (cartCompleted && !alreadyCompleted) {
      const stored = readAttempt();
      if (stored && stored !== "invalid" && stored.status === "accepted" && stored.request.operationId === request.operationId) {
        writeAttempt({ ...stored, cartCompleted: true });
      }
    }
    setAcknowledgement(acknowledgementKind);
    setResult(accepted);
    clearDraft();
    setStorageBlocked(false);
    setUnresolved(false);
    setHasPendingAttempt(false);
    activeOperationId.current = null;
    setMessage("");
  }

  function showMessage(value: string, kind: "status" | "error", needsStockRepair = false) {
    setMessage(value);
    setMessageKind(kind);
    setStockRepair(needsStockRepair);
  }

  const intro = (
    <div className={`page-title ${styles.intro}`}>
      <p className="eyebrow">Order request</p>
      <h1>Checkout</h1>
      <p>No account is needed. Enter the delivery details on this page.</p>
    </div>
  );

  if (!cart.hydrated || orderingState === "loading") {
    return <main id="main-content" lang="en" dir="ltr" className={`checkout-page ${styles.page}`}>{intro}<p role="status" className={styles.loading}>Preparing checkout.</p></main>;
  }

  if (result) {
    const alreadyReceived = acknowledgement === "already-received";
    return (
      <main id="main-content" lang="en" dir="ltr" className={`checkout-page checkout-success ${styles.page} ${styles.success}`}>
        <p className="eyebrow">Order request</p>
        <h1 ref={resultHeading} tabIndex={-1}>{alreadyReceived ? "Order request already received" : "Order request received"}</h1>
        <p className="order-reference">Order reference: <strong>{result.reference}</strong></p>
        <p role="status" className={`success ${styles.pendingNotice}`}>{alreadyReceived
          ? "This order request was already received and was not submitted again. This receipt does not establish its current status."
          : "We received your order request. It is pending. Placing the request does not reserve the items, and this is not a completed sale."}</p>
        {alreadyReceived ? null : <p>A Bravos representative confirms the request later on WhatsApp.</p>}
        <p className="success-total">Cash on delivery total you reviewed: <strong>{formatEgp(result.quote.finalTotalPiasters)}</strong></p>
        <Link className="button-link" href="/">Back to the store</Link>
      </main>
    );
  }

  if (orderingState === "disabled" || orderingState === "unavailable") {
    return (
      <main id="main-content" lang="en" dir="ltr" className={`checkout-page ${styles.page}`}>
        <div className="empty-state">
          <p className="eyebrow">The store is open for browsing</p>
          <h1>Ordering on the store is not available right now</h1>
          <p>{orderingState === "disabled"
            ? "Delivery requests are not being accepted yet. You can browse products and keep what you added to the bag until ordering opens."
            : "Ordering availability could not be checked right now. Your bag and any earlier send attempt are kept. Try again shortly."}</p>
          {hasPendingAttempt ? <p role="status">An earlier send attempt still has an unknown result. The same request is being checked. It may already have been received before ordering closed.</p> : null}
          {message && hasPendingAttempt ? <p role={messageKind === "error" ? "alert" : "status"}>{message}</p> : null}
          {hasPendingAttempt && !storageBlocked ? <button type="button" className="secondary-action" disabled={submitting} onClick={() => void recoverStoredAttempt()}>{submitting ? "Checking this same request…" : "Check the same request"}</button> : null}
          <div className="checkout-actions">
            <Link className="button-link" href="/">Back to the store</Link>
            <Link href="/cart">View bag</Link>
          </div>
        </div>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main id="main-content" lang="en" dir="ltr" className={`checkout-page ${styles.page}`}>
        <div className="empty-state">
          <h1>Your bag is empty</h1>
          <p>Add products to the bag before checkout.</p>
          <Link className="button-link" href="/">Browse products</Link>
        </div>
      </main>
    );
  }

  const cartValid = cartWithinSharedPool(cart.items);
  const areasMissing = !areasLoading && !areasError && areas.length === 0;

  return (
    <main id="main-content" lang="en" dir="ltr" className={`checkout-page ${styles.page}`}>
      {intro}
      {!cartValid ? <div className={styles.repairNotice} role="alert"><strong>Update the bag before checkout</strong><p>Some choices or quantities are unavailable. Return to the bag to reduce a quantity or remove the unavailable choice.</p><Link className={styles.editCartLink} href="/cart">Edit bag</Link></div> : null}
      {stockRepair && message ? <div className={`checkout-message error-message ${styles.repairNotice}`} role="alert"><strong>{message}</strong><p>These bag choices cannot all be supplied together. Return to the bag to refresh availability and reduce quantities or remove a choice, then review the price again.</p><Link className={styles.editCartLink} href="/cart">Edit bag</Link></div> : null}
      {areasMissing ? <div className={styles.repairNotice} role="alert"><strong>No delivery areas are available right now</strong><p>The price cannot be reviewed and an order request cannot be placed until a delivery area is available. Your bag is unchanged.</p><Link className={styles.editCartLink} href="/cart">Back to bag</Link></div> : null}
      <div className={`checkout-layout ${styles.layout}`}>
        <form className={`checkout-form ${styles.form}`} aria-label="Checkout" onSubmit={(event) => void submit(event)} onInvalidCapture={markInvalidField} onChange={clearCorrectedField}>
          <div className={styles.mobileContext} aria-label="Preliminary order summary">
            <div className={styles.mobileSummary}>
              <p className={styles.mobileCount}>{cart.itemCount === 1 ? "1 item" : `${cart.itemCount} items`}</p>
              <p className={styles.mobileAmount}>
                <span className={styles.mobileAmountLabel}>Preliminary total</span>
                <strong>{formatEgp(cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0))}</strong>
              </p>
            </div>
            <Link className={styles.editCartLink} href="/cart">Edit bag</Link>
          </div>
          <fieldset disabled={!cartValid || areasMissing || submitting || storageBlocked || unresolved}>
            <legend>Your details</legend>
            <p className={styles.sectionHint}>Required details for contact and delivery</p>
            <div className={`checkout-fields ${styles.fields}`}>
              <CheckoutInput label="Name" name="customerName" value={fields.customerName} required autoComplete="name" onChange={updateField} invalid={invalidFields.includes("customerName")} />
              <CheckoutInput label="Primary mobile number" name="primaryPhone" value={fields.primaryPhone} required type="tel" inputMode="tel" autoComplete="tel" dir="ltr" onChange={updateField} invalid={invalidFields.includes("primaryPhone")} />
              <label className={`checkout-field ${styles.field}`}>
                <span>Delivery <span className={styles.requiredTag} aria-hidden="true">Required</span></span>
                <select name="deliveryAreaId" required value={fields.deliveryAreaId} aria-invalid={invalidFields.includes("deliveryAreaId") || undefined} aria-describedby={invalidFields.includes("deliveryAreaId") ? "deliveryAreaId-error" : undefined} disabled={areasLoading || areas.length === 0 || submitting || storageBlocked || unresolved} onChange={(event) => setField("deliveryAreaId", event.target.value)}>
                  <option value="">{areasLoading ? "Loading areas…" : "Choose an area"}</option>
                  {areas.map((area) => <option key={area.id} value={area.id}>{area.nameAr} — {formatEgp(area.feePiasters)}</option>)}
                </select>
                {invalidFields.includes("deliveryAreaId") ? <small id="deliveryAreaId-error" className={styles.fieldError}>Choose a delivery area.</small> : null}
                {areasError ? <><small className={styles.fieldError} role="alert">Delivery areas could not be loaded. Your details stay on this page. Try again.</small><button type="button" className="secondary-action" disabled={areasLoading} onClick={() => void loadDeliveryAreas()}>Reload delivery areas</button></> : null}
                {!areasLoading && !areasError && areas.length === 0 ? <small className={styles.areaHelp}>No delivery areas are available right now. The price cannot be reviewed until a supported area is available.</small> : null}
              </label>
              <label className={`checkout-field checkout-wide ${styles.field}`}>
                <span>Detailed address <span className={styles.requiredTag} aria-hidden="true">Required</span></span>
                <textarea name="detailedAddress" required rows={3} autoComplete="street-address" value={fields.detailedAddress} aria-invalid={invalidFields.includes("detailedAddress") || undefined} aria-describedby={invalidFields.includes("detailedAddress") ? "detailedAddress-error" : undefined} onChange={(event) => setField("detailedAddress", event.target.value)} onFocus={(event) => {
                  if (window.innerWidth > 900) return;
                  const address = event.currentTarget;
                  const bounds = address.getBoundingClientRect();
                  if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
                    address.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
                  }
                }} />
                {invalidFields.includes("detailedAddress") ? <small id="detailedAddress-error" className={styles.fieldError}>Enter the detailed address.</small> : null}
              </label>
            </div>
            <details className={styles.optionalDetails} open={optionalDetailsOpen} onToggle={(event) => setOptionalDetailsOpen(event.currentTarget.open)}>
              <summary>Optional delivery details</summary>
              <div className={`checkout-fields ${styles.fields}`}>
                <CheckoutInput label="Alternate number (optional)" name="alternatePhone" value={fields.alternatePhone} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" onChange={updateField} />
                <CheckoutInput label="Landmark (optional)" name="landmark" value={fields.landmark} onChange={updateField} />
                <label className={`checkout-field checkout-wide ${styles.field}`}>
                  <span>Notes (optional)</span>
                  <textarea rows={3} value={fields.notes} onChange={(event) => setField("notes", event.target.value)} />
                </label>
              </div>
            </details>
          </fieldset>
          <fieldset disabled={!cartValid || areasMissing || submitting || storageBlocked || unresolved}>
            <legend>Review order</legend>
            <label className={`checkout-field coupon-field ${styles.field}`}>
              <span>Coupon code (optional)</span>
              <input value={fields.couponCode} autoCapitalize="characters" onChange={(event) => setField("couponCode", event.target.value)} />
            </label>
            <p className={styles.reviewHint}>Review the total, including delivery and discounts.</p>
            <button type="button" className="secondary-action review-price" disabled={!cartValid || areasLoading || areasError || areasMissing || !fields.deliveryAreaId || quoting} onClick={() => void reviewPrice()}>
              {quoting ? "Reviewing the price…" : quote ? "Review price again" : "Review price"}
            </button>
          </fieldset>
          {quoting ? <p aria-live="polite" className={styles.processNotice}>Reviewing the current price and delivery fee.</p> : null}
          {quote && quoteKey === currentInputKey ? <PriceReview quote={quote} /> : null}
          {message && !stockRepair ? <p className={messageKind === "error" ? "checkout-message error-message" : "checkout-message"} role={messageKind === "error" ? "alert" : "status"}>{message}</p> : null}
          {submitting ? <p aria-live="polite" className={styles.processNotice}>Checking the result of this same order request. Please wait.</p> : null}
          {unresolved && !submitting ? <div className={styles.uncertainNotice}><strong>Send result is uncertain</strong><p>The same order attempt is kept. Use the check below before any new order request.</p></div> : null}
          {unresolved && !storageBlocked ? <button type="button" className="secondary-action" disabled={submitting} onClick={() => void recoverStoredAttempt()}>Check the same request</button> : null}
          {storageBlocked ? <p className="recovery-help">A new send cannot be started safely from this page. Saved data was not cleared.</p> : null}
          <div className={styles.commit}>
            <p className={`muted ${styles.disclosure}`}>You are placing an order request for review, with cash on delivery. Items are not reserved and the coupon is not used when you place the request. A Bravos representative confirms it later on WhatsApp.</p>
            <p className={styles.infoLinks}><Link href="/shipping">Shipping</Link><Link href="/returns">Returns</Link><Link href="/contact">Contact</Link></p>
            {quote && quoteKey === currentInputKey ? (
              <button type="submit" className="submit-order" disabled={submitting || !cartValid || areasLoading || areasError || areasMissing || storageBlocked || unresolved}>
                {submitting ? "Checking this same request…" : "Place order request"}
              </button>
            ) : null}
          </div>
        </form>
        <aside className={`checkout-cart ${styles.summary}`} aria-label="Your items">
          <div className="checkout-cart-heading"><h2>Your items</h2><Link className={styles.editCartLink} href="/cart">Edit bag</Link></div>
          {cart.items.map((item) => {
            const reviewed = quoteKey === currentInputKey ? quote?.lines.find((line) => line.variantId === item.variantId) : undefined;
            return (
            <article key={item.variantId}>
              <div><strong>{reviewed?.productNameAr ?? item.productNameAr}</strong><small>{reviewed?.sizeNameAr ?? item.sizeNameAr} · {reviewed?.colorNameAr ?? item.colorNameAr}</small></div>
              <span>{reviewed?.quantity ?? item.quantity} × {formatEgp(reviewed?.listedUnitPricePiasters ?? item.unitPricePiasters)}</span>
              {!item.orderable || item.quantity > lineQuantityCap(cart.items, item.variantId) ? <p className="stock-warning">This quantity needs a change in the bag.</p> : null}
            </article>
          );})}
          <p><span>{quote && quoteKey === currentInputKey ? "Merchandise total before discount" : "Preliminary merchandise total"}</span><strong>{formatEgp(quote && quoteKey === currentInputKey ? quote.merchandiseOriginalPiasters : cart.items.reduce((sum, item) => sum + item.unitPricePiasters * item.quantity, 0))}</strong></p>
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
  return <label className={`checkout-field ${styles.field}`}><span>{label} {input.required ? <span className={styles.requiredTag} aria-hidden="true">Required</span> : null}</span><input name={name} value={value} onChange={onChange} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${name}-error` : undefined} {...input} />{invalid ? <small id={`${name}-error`} className={styles.fieldError}>Complete this field.</small> : null}</label>;
}

function PriceReview({ quote }: { quote: CheckoutQuoteDto }) {
  return (
    <section className={`price-review ${styles.priceReview}`} aria-label="Price details">
      <h2>Price details</h2>
      <p className={styles.authoritativeHint}>The amount from the latest review, including discounts and the delivery fee.</p>
      <p><span>Merchandise total before discount</span><strong>{formatEgp(quote.merchandiseOriginalPiasters)}</strong></p>
      {quote.appliedAutomaticOffer ? <p><span>{quote.appliedAutomaticOffer.nameAr}</span><strong>− {formatEgp(quote.automaticOfferDiscountPiasters)}</strong></p> : null}
      {quote.appliedCoupon ? <p><span>Coupon {quote.appliedCoupon.code}</span><strong>− {formatEgp(quote.couponDiscountPiasters)}</strong></p> : null}
      <p><span>Merchandise total after discount</span><strong>{formatEgp(quote.merchandiseTotalPiasters)}</strong></p>
      <p><span>Delivery fee to {quote.area.nameAr}</span><strong>{formatEgp(quote.deliveryFeePiasters)}</strong></p>
      <p className="final-total"><span>Cash on delivery total</span><strong>{formatEgp(quote.finalTotalPiasters)}</strong></p>
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

function isStockRejection(code: string | undefined) {
  return code === "INSUFFICIENT_STOCK" || code === "VARIANT_NOT_ORDERABLE";
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
