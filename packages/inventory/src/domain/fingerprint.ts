import { createHash } from "node:crypto";

export type ReceivePayload = {
  branchId: string;
  receiptDate: string;
  lines: Array<{
    variantId: string;
    quantity: number;
    unitCostPiasters: number;
  }>;
};

export function normalizeReceivePayload(input: ReceivePayload): ReceivePayload {
  const lines = [...input.lines]
    .map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitCostPiasters: line.unitCostPiasters,
    }))
    .sort((left, right) => {
      if (left.variantId !== right.variantId) {
        return left.variantId < right.variantId ? -1 : 1;
      }
      if (left.unitCostPiasters !== right.unitCostPiasters) {
        return left.unitCostPiasters - right.unitCostPiasters;
      }
      return left.quantity - right.quantity;
    });
  return { branchId: input.branchId, receiptDate: input.receiptDate, lines };
}

export function fingerprintReceivePayload(input: ReceivePayload): string {
  const canonical = JSON.stringify(normalizeReceivePayload(input));
  return createHash("sha256").update(canonical).digest("hex");
}
