export type SalePayload = {
  saleId: string;
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number }>;
};

export type AcceptedSalePayload = {
  saleId: string;
  snapshotId: string;
  pricingVersion?: 1;
  occurredAt?: string;
  pricingOccurredAt?: string;
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number | null }>;
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

function sortedAcceptedLines(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number | null }>,
) {
  return [...lines]
    .map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      listedUnitPricePiasters: line.listedUnitPricePiasters ?? null,
    }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      if (left.quantity !== right.quantity) {
        return left.quantity - right.quantity;
      }
      return (left.listedUnitPricePiasters ?? -1) - (right.listedUnitPricePiasters ?? -1);
    });
}

export function normalizeSalePayload(input: SalePayload): SalePayload {
  const couponCode = input.couponCode?.normalize("NFC").trim().toLocaleUpperCase("en-US") || null;
  return {
    saleId: input.saleId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    ...(couponCode ? { couponCode } : {}),
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: sortedLines(input.lines),
  };
}

export function normalizeAcceptedSalePayload(input: AcceptedSalePayload): AcceptedSalePayload {
  const couponCode = input.couponCode?.normalize("NFC").trim().toLocaleUpperCase("en-US") || null;
  const versionedPricing = input.pricingVersion === 1;
  const occurredAt = versionedPricing ? new Date(input.occurredAt ?? "").toISOString() : null;
  const pricingOccurredAt = versionedPricing ? new Date(input.pricingOccurredAt ?? "").toISOString() : null;
  return {
    saleId: input.saleId,
    snapshotId: input.snapshotId,
    ...(versionedPricing
      ? { pricingVersion: 1 as const, occurredAt: occurredAt!, pricingOccurredAt: pricingOccurredAt! }
      : {}),
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    ...(couponCode ? { couponCode } : {}),
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: versionedPricing ? sortedAcceptedLines(input.lines) : sortedLines(input.lines),
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
  pricingVersion?: 1 | null;
  occurredAt?: string;
  pricingOccurredAt?: string;
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number | null }>;
}): string {
  if (input.kind === "accepted" && input.snapshotId) {
    return canonicalAcceptedSalePayloadJson({
      saleId: input.id,
      snapshotId: input.snapshotId,
      ...(input.pricingVersion === 1
        ? {
            pricingVersion: 1 as const,
            occurredAt: input.occurredAt ?? "",
            pricingOccurredAt: input.pricingOccurredAt ?? "",
          }
        : {}),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      employeeDiscountPiasters: input.employeeDiscountPiasters,
      discountReason: input.discountReason,
      lines: input.lines,
    });
  }
  return canonicalSalePayloadJson({
    saleId: input.id,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines: input.lines,
  });
}
