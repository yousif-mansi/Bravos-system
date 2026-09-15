import { createHash } from "node:crypto";

export type ReturnPayload = {
  sourceSaleId: string;
  handlingBranchId: string;
  authorizedRefundPiasters: number;
  lines: Array<{ sourceSaleLineId: string; quantity: number; sellableQuantity: number }>;
};

export function fingerprintReturnPayload(input: ReturnPayload): string {
  const lines = [...input.lines]
    .map((line) => ({ ...line }))
    .sort((left, right) => left.sourceSaleLineId.localeCompare(right.sourceSaleLineId));
  return createHash("sha256")
    .update(JSON.stringify({
      sourceSaleId: input.sourceSaleId,
      handlingBranchId: input.handlingBranchId,
      authorizedRefundPiasters: input.authorizedRefundPiasters,
      lines,
    }))
    .digest("hex");
}

export function fingerprintRefundPayment(returnId: string, amountPiasters: number): string {
  return createHash("sha256").update(JSON.stringify({ returnId, status: "paid", amountPiasters })).digest("hex");
}

export function fingerprintExchangePayload(input: {
  returnId: string;
  replacementSaleId: string;
  replacementSaleOperationId: string;
  quoteId: string;
  expectedRevision: number;
  cashRefundStatus: "owed" | "paid";
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function fingerprintExchangeQuotePayload(input: {
  returnId: string;
  returnRevision: number;
  correctionRevision: number;
  creditAvailablePiasters: number;
  settlement: {
    exchangeId: string;
    operationId: string;
    replacementSaleId: string;
    replacementSaleOperationId: string;
  };
  replacementLines: Array<{ variantId: string; quantity: number }>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    ...input,
    replacementLines: [...input.replacementLines].sort((left, right) => left.variantId.localeCompare(right.variantId)),
  })).digest("hex");
}
