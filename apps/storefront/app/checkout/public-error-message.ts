export type CheckoutErrorContext = "quote" | "submit";

const COPY: Record<string, Record<CheckoutErrorContext, string>> = {
  VALIDATION: {
    quote: "The price could not be reviewed. Check the delivery area, coupon, and bag, then try again.",
    submit: "The order request was not accepted. Check your details and review the price again.",
  },
  UNSUPPORTED_DELIVERY_AREA: {
    quote: "This delivery area is not available. Choose a supported area. No order request was sent.",
    submit: "This delivery area is not available. Choose a supported area, review the price, and place the order request again.",
  },
  VARIANT_NOT_ORDERABLE: {
    quote: "One of these choices can no longer be ordered. Update the bag, then review the price again.",
    submit: "One of these choices can no longer be ordered. Update the bag, review the price, and place the order request again.",
  },
  INSUFFICIENT_STOCK: {
    quote: "These choices cannot all be supplied together. Update the bag, then review the price again.",
    submit: "These choices cannot all be supplied together. Update the bag, review the price, and place the order request again.",
  },
  QUOTE_STALE: {
    quote: "The price changed while it was being reviewed. Review the current price again.",
    submit: "The price or delivery fee changed after your review. Review the new price, then place the order request again.",
  },
  OPERATION_CONFLICT: {
    quote: "This request could not be matched to a saved order attempt. No order request was sent.",
    submit: "This saved attempt does not match an order request already stored for that attempt. Contact Bravos before placing another request. Nothing new was accepted.",
  },
  QUOTE_ALREADY_USED: {
    quote: "This price review was already used for an earlier order request. Review the price again before placing a request.",
    submit: "This price review was already used for an earlier order request. The saved send attempt is kept. Contact Bravos to check that request before starting another one.",
  },
  PUBLIC_ORDERING_DISABLED: {
    quote: "Ordering on the store is not available right now. No order request was sent.",
    submit: "Ordering on the store is not available right now. A still-unresolved earlier send is kept and was not marked as failed.",
  },
};

export function publicCheckoutErrorMessage(body: unknown, context: CheckoutErrorContext, fallback: string): string {
  const code = errorCode(body);
  if (!code) return fallback;
  return COPY[code]?.[context] ?? fallback;
}

function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("error" in body)) return undefined;
  const error = (body as { error?: { code?: unknown } }).error;
  return error && typeof error.code === "string" && error.code.length > 0 ? error.code : undefined;
}
