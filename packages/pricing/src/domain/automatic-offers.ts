import type { AppliedAutomaticOfferDto, AutomaticOfferDto } from "@bravos/contracts";
import { cairoDateAt, offerIsActiveOn } from "./cairo-date.ts";
import { PricingValidationError } from "./errors.ts";

export type PricingBasketLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  quantity: number;
  listedUnitPricePiasters: number;
};

export type AutomaticOfferUnitRange = {
  variantId: string;
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  automaticOfferDiscountPiasters: number;
};

export type AutomaticOfferEvaluation = {
  appliedAutomaticOffer: AppliedAutomaticOfferDto | null;
  automaticOfferDiscountPiasters: number;
  unitRanges: AutomaticOfferUnitRange[];
};

type IndexedRange = AutomaticOfferUnitRange & { productId: string; categoryId: string };

export function evaluateAutomaticOffers(input: {
  offers: AutomaticOfferDto[];
  lines: PricingBasketLine[];
  at: Date;
}): AutomaticOfferEvaluation {
  const cairoDate = cairoDateAt(input.at);
  const relevantOffers = input.offers
    .filter((offer) => offerIsActiveOn(offer, cairoDate))
    .filter((offer) => input.lines.some((line) => appliesTo(offer, line)));
  if (relevantOffers.length === 0) {
    return { appliedAutomaticOffer: null, automaticOfferDiscountPiasters: 0, unitRanges: [] };
  }

  const ranges = toRanges(input.lines);
  const candidates = relevantOffers
    .map((offer) => evaluateOffer(offer, ranges))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => {
      if (left.automaticOfferDiscountPiasters !== right.automaticOfferDiscountPiasters) {
        return right.automaticOfferDiscountPiasters - left.automaticOfferDiscountPiasters;
      }
      if (left.offer.updatedAt !== right.offer.updatedAt) {
        return left.offer.updatedAt < right.offer.updatedAt ? -1 : 1;
      }
      return left.offer.id < right.offer.id ? -1 : left.offer.id > right.offer.id ? 1 : 0;
    });
  const winner = candidates[0];
  if (!winner || winner.automaticOfferDiscountPiasters <= 0) {
    return {
      appliedAutomaticOffer: null,
      automaticOfferDiscountPiasters: 0,
      unitRanges: ranges.map(stripScope),
    };
  }
  return {
    appliedAutomaticOffer: {
      id: winner.offer.id,
      nameAr: winner.offer.nameAr,
      discountType: winner.offer.discountType,
      percentageBasisPoints: winner.offer.percentageBasisPoints,
      fixedDiscountPiasters: winner.offer.fixedDiscountPiasters,
      allowCoupon: winner.offer.allowCoupon,
      discountPiasters: winner.automaticOfferDiscountPiasters,
    },
    automaticOfferDiscountPiasters: winner.automaticOfferDiscountPiasters,
    unitRanges: winner.ranges.map(stripScope),
  };
}

function evaluateOffer(offer: AutomaticOfferDto, ranges: IndexedRange[]) {
  const eligible = ranges.filter((range) => appliesTo(offer, range));
  if (eligible.length === 0) {
    return null;
  }

  let discounted: IndexedRange[];
  if (offer.discountType === "fixed") {
    const capacity = eligible.reduce(
      (sum, range) => addSafe(sum, multiplySafe(range.listedPiasters, range.quantity)),
      0,
    );
    discounted = allocateEqualCappedRanges(ranges, offer, Math.min(offer.fixedDiscountPiasters ?? 0, capacity));
  } else {
    discounted = allocatePercentageRanges(ranges, offer, offer.percentageBasisPoints ?? 0);
  }
  const total = discounted.reduce(
    (sum, range) => addSafe(sum, multiplySafe(range.automaticOfferDiscountPiasters, range.quantity)),
    0,
  );
  return { offer, automaticOfferDiscountPiasters: total, ranges: mergeRanges(discounted) };
}

function allocateEqualCappedRanges(
  input: IndexedRange[],
  offer: AutomaticOfferDto,
  requested: number,
): IndexedRange[] {
  let ranges = input.map((range) => ({ ...range }));
  let remaining = requested;
  while (remaining > 0) {
    const eligibleQuantity = ranges.reduce((sum, range) => appliesTo(offer, range)
      && range.automaticOfferDiscountPiasters < range.listedPiasters
      ? addSafe(sum, range.quantity)
      : sum, 0);
    if (eligibleQuantity === 0) break;

    const share = Math.floor(remaining / eligibleQuantity);
    if (share === 0) {
      let unitsToIncrement = remaining;
      const split: IndexedRange[] = [];
      for (const range of ranges) {
        if (unitsToIncrement > 0 && appliesTo(offer, range)
          && range.automaticOfferDiscountPiasters < range.listedPiasters) {
          const quantity = Math.min(unitsToIncrement, range.quantity);
          split.push({ ...range, quantity, automaticOfferDiscountPiasters: range.automaticOfferDiscountPiasters + 1 });
          if (quantity < range.quantity) {
            split.push({ ...range, unitIndex: range.unitIndex + quantity, quantity: range.quantity - quantity });
          }
          unitsToIncrement -= quantity;
        } else {
          split.push(range);
        }
      }
      ranges = split;
      remaining = unitsToIncrement;
      continue;
    }

    let applied = 0;
    ranges = ranges.map((range) => {
      if (!appliesTo(offer, range) || range.automaticOfferDiscountPiasters >= range.listedPiasters) {
        return range;
      }
      const increment = Math.min(share, range.listedPiasters - range.automaticOfferDiscountPiasters);
      applied = addSafe(applied, multiplySafe(increment, range.quantity));
      return { ...range, automaticOfferDiscountPiasters: range.automaticOfferDiscountPiasters + increment };
    });
    remaining -= applied;
  }
  return ranges;
}

function allocatePercentageRanges(
  ranges: IndexedRange[],
  offer: AutomaticOfferDto,
  basisPoints: number,
): IndexedRange[] {
  const subtotal = ranges.reduce((sum, range) => appliesTo(offer, range)
    ? addSafe(sum, multiplySafe(range.listedPiasters, range.quantity))
    : sum, 0);
  if (subtotal === 0 || basisPoints === 0) return ranges.map((range) => ({ ...range }));

  const roundedTotal = Number((BigInt(subtotal) * BigInt(basisPoints) + 5_000n) / 10_000n);
  const denominator = BigInt(subtotal);
  const rows = ranges.map((range, index) => {
    if (!appliesTo(offer, range)) return { range: { ...range }, index, remainder: -1n };
    const numerator = BigInt(range.listedPiasters) * BigInt(roundedTotal);
    return {
      range: { ...range, automaticOfferDiscountPiasters: Number(numerator / denominator) },
      index,
      remainder: numerator % denominator,
    };
  });
  const assigned = rows.reduce((sum, row) => addSafe(
    sum,
    multiplySafe(row.range.automaticOfferDiscountPiasters, row.range.quantity),
  ), 0);
  let extras = roundedTotal - assigned;
  const extraByIndex = new Map<number, number>();
  for (const row of [...rows]
    .filter((candidate) => candidate.remainder >= 0n)
    .sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1)) {
    if (extras === 0) break;
    const quantity = Math.min(extras, row.range.quantity);
    extraByIndex.set(row.index, quantity);
    extras -= quantity;
  }

  const result: IndexedRange[] = [];
  for (const row of rows) {
    const extraQuantity = extraByIndex.get(row.index) ?? 0;
    if (extraQuantity > 0) {
      result.push({
        ...row.range,
        quantity: extraQuantity,
        automaticOfferDiscountPiasters: row.range.automaticOfferDiscountPiasters + 1,
      });
    }
    if (extraQuantity < row.range.quantity) {
      result.push({
        ...row.range,
        unitIndex: row.range.unitIndex + extraQuantity,
        quantity: row.range.quantity - extraQuantity,
      });
    }
  }
  return result;
}

function toRanges(lines: PricingBasketLine[]): IndexedRange[] {
  const sorted = [...lines].sort((left, right) => left.variantId.localeCompare(right.variantId));
  const nextUnitIndex = new Map<string, number>();
  return sorted.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1
      || !Number.isSafeInteger(line.listedUnitPricePiasters) || line.listedUnitPricePiasters < 0) {
      throw new PricingValidationError("بيانات تسعير السلة غير صالحة.");
    }
    const unitIndex = nextUnitIndex.get(line.variantId) ?? 0;
    nextUnitIndex.set(line.variantId, addSafe(unitIndex, line.quantity));
    return {
      variantId: line.variantId,
      productId: line.productId,
      categoryId: line.categoryId,
      unitIndex,
      quantity: line.quantity,
      listedPiasters: line.listedUnitPricePiasters,
      automaticOfferDiscountPiasters: 0,
    };
  });
}

function appliesTo(offer: AutomaticOfferDto, line: { productId: string; categoryId: string }): boolean {
  return offer.productIds.includes(line.productId) || offer.categoryIds.includes(line.categoryId);
}

function mergeRanges(ranges: IndexedRange[]): IndexedRange[] {
  const result: IndexedRange[] = [];
  for (const range of ranges) {
    const previous = result.at(-1);
    if (previous && previous.variantId === range.variantId
      && previous.productId === range.productId
      && previous.categoryId === range.categoryId
      && previous.unitIndex + previous.quantity === range.unitIndex
      && previous.listedPiasters === range.listedPiasters
      && previous.automaticOfferDiscountPiasters === range.automaticOfferDiscountPiasters) {
      previous.quantity = addSafe(previous.quantity, range.quantity);
    } else {
      result.push({ ...range });
    }
  }
  return result;
}

function stripScope(range: IndexedRange): AutomaticOfferUnitRange {
  return {
    variantId: range.variantId,
    unitIndex: range.unitIndex,
    quantity: range.quantity,
    listedPiasters: range.listedPiasters,
    automaticOfferDiscountPiasters: range.automaticOfferDiscountPiasters,
  };
}

function multiplySafe(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new PricingValidationError("إجمالي التسعير كبير جداً.");
  return result;
}

function addSafe(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new PricingValidationError("إجمالي التسعير كبير جداً.");
  return result;
}
