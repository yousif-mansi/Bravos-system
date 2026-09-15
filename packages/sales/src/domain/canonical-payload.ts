export type SalePayload = {
  saleId: string;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number }>;
};

export type AcceptedSalePayload = {
  saleId: string;
  snapshotId: string;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number }>;
};

function sortedLines(lines: Array<{ variantId: string; quantity: number }>) {
  return [...lines]
    .map((line) => ({ variantId: line.variantId, quantity: line.quantity }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      return left.quantity - right.quantity;
    });
}

export function normalizeSalePayload(input: SalePayload): SalePayload {
  return {
    saleId: input.saleId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: sortedLines(input.lines),
  };
}

export function normalizeAcceptedSalePayload(input: AcceptedSalePayload): AcceptedSalePayload {
  return {
    saleId: input.saleId,
    snapshotId: input.snapshotId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: sortedLines(input.lines),
  };
}

export function canonicalSalePayloadJson(input: SalePayload): string {
  return JSON.stringify(normalizeSalePayload(input));
}

export function canonicalAcceptedSalePayloadJson(input: AcceptedSalePayload): string {
  return JSON.stringify(normalizeAcceptedSalePayload(input));
}

export function canonicalOfflineSaleFactsJson(input: {
  id: string;
  kind: "accepted" | "connected";
  snapshotId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number }>;
}): string {
  if (input.kind === "accepted" && input.snapshotId) {
    return canonicalAcceptedSalePayloadJson({
      saleId: input.id,
      snapshotId: input.snapshotId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      employeeDiscountPiasters: input.employeeDiscountPiasters,
      discountReason: input.discountReason,
      lines: input.lines,
    });
  }
  return canonicalSalePayloadJson({
    saleId: input.id,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: input.lines,
  });
}
