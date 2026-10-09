"use client";

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useCallback, useContext, useMemo, useState } from "react";

export type CheckoutFields = {
  customerName: string;
  primaryPhone: string;
  deliveryAreaId: string;
  detailedAddress: string;
  alternatePhone: string;
  landmark: string;
  notes: string;
  couponCode: string;
};

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

type CheckoutDraft = {
  fields: CheckoutFields;
  setFields: Dispatch<SetStateAction<CheckoutFields>>;
  clearDraft: () => void;
};

const CheckoutDraftContext = createContext<CheckoutDraft | null>(null);

// Keep editable fields during client navigation only. Quotes and durable submission
// attempts are separate; customer data is never written to browser storage here.
export function CheckoutDraftProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const clearDraft = useCallback(() => setFields(EMPTY_FIELDS), []);
  const value = useMemo(() => ({ fields, setFields, clearDraft }), [fields, clearDraft]);
  return <CheckoutDraftContext.Provider value={value}>{children}</CheckoutDraftContext.Provider>;
}

export function useCheckoutDraft() {
  const draft = useContext(CheckoutDraftContext);
  if (!draft) throw new Error("useCheckoutDraft must be used within CheckoutDraftProvider");
  return draft;
}
