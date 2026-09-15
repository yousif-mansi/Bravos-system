import { canonicalOfflineSaleFactsJson } from "./canonical-payload.ts";
import { sha256Hex } from "./web-digest.ts";

export async function digestAcceptedSalePayload(input: {
  saleId: string;
  snapshotId: string;
  pricingVersion?: 1 | null;
  occurredAt?: string;
  pricingOccurredAt?: string;
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number | null }>;
}): Promise<string> {
  return sha256Hex(
    canonicalOfflineSaleFactsJson({
      id: input.saleId,
      kind: "accepted",
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
    }),
  );
}

export async function digestConnectedSalePayload(input: {
  saleId: string;
  customerName: string | null;
  customerPhone: string | null;
  couponCode?: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters?: number | null }>;
}): Promise<string> {
  return sha256Hex(
    canonicalOfflineSaleFactsJson({
      id: input.saleId,
      kind: "connected",
      snapshotId: null,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      couponCode: input.couponCode ?? null,
      employeeDiscountPiasters: input.employeeDiscountPiasters,
      discountReason: input.discountReason,
      lines: input.lines,
    }),
  );
}

export async function digestOfflineSale(input: {
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
  payloadFingerprint?: string | null;
}): Promise<string> {
  if (input.payloadFingerprint && /^[0-9a-f]{64}$/i.test(input.payloadFingerprint)) {
    return input.payloadFingerprint;
  }
  return sha256Hex(canonicalOfflineSaleFactsJson(input));
}
