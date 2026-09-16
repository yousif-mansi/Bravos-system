export type SaleCorrectionReportingFact = {
  saleId: string;
  revision: number;
  status: "active" | "cancelled";
  effectiveTotalPiasters: number | null;
  effectiveLines: Array<{ saleLineId: string; quantity: number; paidPiasters: number }> | null;
  changes: Array<{
    id: string;
    type: "correction" | "cancellation";
    revision: number;
    reason: string;
    changedByStaffId: string;
    changedAt: Date;
  }>;
  merchandise: Array<{
    correctionId: string;
    lineId: string;
    variantId: string;
    direction: "restore" | "deduct";
    batchId: string;
    quantity: number;
  }>;
};

export type SaleCorrectionReportingReader = {
  listEffectiveFacts(saleIds: string[]): Promise<SaleCorrectionReportingFact[]>;
};

export type ReturnCorrectionReportingFact = {
  returnId: string;
  revision: number;
  status: "active" | "cancelled";
  effectiveRefund: null | {
    merchandisePiasters: number;
    checkoutChargePiasters: number;
    totalPiasters: number;
  };
  effectiveLines: Array<{ returnLineId: string; quantity: number; sellableQuantity: number }> | null;
  changes: Array<{
    id: string;
    type: "correction" | "cancellation";
    revision: number;
    reason: string;
    changedByStaffId: string;
    changedAt: Date;
  }>;
  cashEvents: Array<{ direction: "paid_out" | "recovered"; amountPiasters: number; recordedAt: Date }>;
  merchandise: Array<{
    correctionId: string;
    lineId: string;
    variantId: string;
    direction: "restore" | "deduct";
    batchId: string;
    quantity: number;
  }>;
};

export type ReturnCorrectionReportingReader = {
  listEffectiveFacts(returnIds: string[]): Promise<ReturnCorrectionReportingFact[]>;
};
