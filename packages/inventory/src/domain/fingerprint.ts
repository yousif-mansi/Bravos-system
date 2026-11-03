import { createHash } from "node:crypto";

export type ReceivePayload = {
  branchId: string;
  receiptDate: string;
  lines: Array<{
    variantId?: string;
    productId?: string;
    quantity: number;
    unitCostPiasters: number;
  }>;
  /** Present only when the receipt names a supplier. Omitted so older fingerprints stay stable. */
  supplierId?: string;
};

export function normalizeReceivePayload(input: ReceivePayload): ReceivePayload {
  const productLines = input.lines.length > 0 && input.lines.every((line) =>
    typeof line.productId === "string" && line.variantId === undefined);
  const lines = productLines
    ? [...input.lines]
      .map((line) => ({
        productId: line.productId ?? "",
        quantity: line.quantity,
        unitCostPiasters: line.unitCostPiasters,
      }))
      .sort((left, right) => {
        if (left.productId !== right.productId) return left.productId < right.productId ? -1 : 1;
        if (left.unitCostPiasters !== right.unitCostPiasters) return left.unitCostPiasters - right.unitCostPiasters;
        return left.quantity - right.quantity;
      })
    : [...input.lines]
      .map((line) => ({
        variantId: line.variantId ?? "",
        quantity: line.quantity,
        unitCostPiasters: line.unitCostPiasters,
      }))
      .sort((left, right) => {
        if (left.variantId !== right.variantId) return left.variantId < right.variantId ? -1 : 1;
        if (left.unitCostPiasters !== right.unitCostPiasters) return left.unitCostPiasters - right.unitCostPiasters;
        return left.quantity - right.quantity;
      });
  const normalized: ReceivePayload = { branchId: input.branchId, receiptDate: input.receiptDate, lines };
  if (input.supplierId) normalized.supplierId = input.supplierId;
  return normalized;
}

export function fingerprintReceivePayload(input: ReceivePayload): string {
  const canonical = JSON.stringify(normalizeReceivePayload(input));
  return createHash("sha256").update(canonical).digest("hex");
}
