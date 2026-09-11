import type { FifoBatchRef } from "@bravos/contracts";

export function sortFifoBatches<T extends { recordedAt: string; id: string }>(batches: T[]): T[] {
  return [...batches].sort((left, right) => {
    if (left.recordedAt !== right.recordedAt) {
      return left.recordedAt < right.recordedAt ? -1 : 1;
    }
    return left.id < right.id ? -1 : 1;
  });
}

export function toFifoBatchRef(batch: {
  id: string;
  variantId: string;
  remainingQuantity: number;
  unitCostPiasters: number;
  recordedAt: string;
}): FifoBatchRef {
  return {
    batchId: batch.id,
    variantId: batch.variantId,
    remainingQuantity: batch.remainingQuantity,
    unitCostPiasters: batch.unitCostPiasters,
    recordedAt: batch.recordedAt,
  };
}
