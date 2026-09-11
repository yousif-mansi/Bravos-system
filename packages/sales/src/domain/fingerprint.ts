import { createHash } from "node:crypto";

export type SalePayload = {
  saleId: string;
  customerName: string | null;
  customerPhone: string | null;
  employeeDiscountPiasters: number;
  discountReason: string | null;
  lines: Array<{ variantId: string; quantity: number }>;
};

export function normalizeSalePayload(input: SalePayload): SalePayload {
  const lines = [...input.lines]
    .map((line) => ({ variantId: line.variantId, quantity: line.quantity }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      return left.quantity - right.quantity;
    });
  return {
    saleId: input.saleId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    employeeDiscountPiasters: input.employeeDiscountPiasters,
    discountReason: input.discountReason,
    lines,
  };
}

export function fingerprintSalePayload(input: SalePayload): string {
  const canonical = JSON.stringify(normalizeSalePayload(input));
  return createHash("sha256").update(canonical).digest("hex");
}
