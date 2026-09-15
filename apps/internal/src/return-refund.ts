import type { ReturnSourceDto } from "@bravos/contracts";

export type ReturnLineSelection = Record<string, { quantity: number; sellableQuantity: number }>;

export function calculateReturnRefundSuggestion(source: ReturnSourceDto | null, selection: ReturnLineSelection) {
  if (!source) return { merchandisePiasters: 0, checkoutChargePiasters: 0, totalPiasters: 0 };

  const merchandisePiasters = source.lines.reduce((total, line) => {
    let needed = selection[line.sourceLineId]?.quantity ?? 0;
    let lineTotal = 0;
    for (const range of line.availablePaidRanges) {
      if (needed <= 0) break;
      const take = Math.min(needed, range.quantity);
      lineTotal += take * range.paidUnitPiasters;
      needed -= take;
    }
    return total + lineTotal;
  }, 0);

  const selectedAny = source.lines.some((line) => (selection[line.sourceLineId]?.quantity ?? 0) > 0);
  const exhaustsRemaining = selectedAny && source.lines.every((line) => (
    (selection[line.sourceLineId]?.quantity ?? 0) === line.remainingQuantity
  ));
  const checkoutChargePiasters = exhaustsRemaining ? source.availableCheckoutChargePiasters : 0;
  return { merchandisePiasters, checkoutChargePiasters, totalPiasters: merchandisePiasters + checkoutChargePiasters };
}
