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
    .filter((offer) => offerRelevant(offer, input.lines));
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
      bundlePricePiasters: winner.offer.bundlePricePiasters,
      bundleItems: winner.offer.bundleItems,
      buyQuantity: winner.offer.buyQuantity,
      rewardQuantity: winner.offer.rewardQuantity,
      rewardPercentageBasisPoints: winner.offer.rewardPercentageBasisPoints,
      allowCoupon: winner.offer.allowCoupon,
      discountPiasters: winner.automaticOfferDiscountPiasters,
    },
    automaticOfferDiscountPiasters: winner.automaticOfferDiscountPiasters,
    unitRanges: winner.ranges.map(stripScope),
  };
}

function evaluateOffer(offer: AutomaticOfferDto, ranges: IndexedRange[]) {
  let discounted: IndexedRange[] | null;
  switch (offer.discountType) {
    case "fixed": {
      const eligible = ranges.filter((range) => appliesToStandard(offer, range));
      if (eligible.length === 0) return null;
      const capacity = eligible.reduce(
        (sum, range) => addSafe(sum, multiplySafe(range.listedPiasters, range.quantity)),
        0,
      );
      discounted = allocateEqualCappedRanges(
        ranges,
        (range) => appliesToStandard(offer, range),
        Math.min(offer.fixedDiscountPiasters ?? 0, capacity),
      );
      break;
    }
    case "percentage":
      if (!ranges.some((range) => appliesToStandard(offer, range))) return null;
      discounted = allocatePercentageRanges(
        ranges,
        (range) => appliesToStandard(offer, range),
        offer.percentageBasisPoints ?? 0,
      );
      break;
    case "fixed_bundle":
      discounted = evaluateFixedBundle(offer, ranges);
      break;
    case "buy_x_get_y":
      discounted = evaluateBuyXGetY(offer, ranges);
      break;
  }
  if (!discounted) return null;
  const total = discounted.reduce(
    (sum, range) => addSafe(sum, multiplySafe(range.automaticOfferDiscountPiasters, range.quantity)),
    0,
  );
  return { offer, automaticOfferDiscountPiasters: total, ranges: mergeRanges(discounted) };
}

function allocateEqualCappedRanges(
  input: IndexedRange[],
  eligible: (range: IndexedRange) => boolean,
  requested: number,
): IndexedRange[] {
  let ranges = input.map((range) => ({ ...range }));
  let remaining = requested;
  while (remaining > 0) {
    const eligibleQuantity = ranges.reduce((sum, range) => eligible(range)
      && range.automaticOfferDiscountPiasters < range.listedPiasters
      ? addSafe(sum, range.quantity)
      : sum, 0);
    if (eligibleQuantity === 0) break;

    const share = Math.floor(remaining / eligibleQuantity);
    if (share === 0) {
      let unitsToIncrement = remaining;
      const split: IndexedRange[] = [];
      for (const range of ranges) {
        if (unitsToIncrement > 0 && eligible(range)
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
      if (!eligible(range) || range.automaticOfferDiscountPiasters >= range.listedPiasters) {
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
  eligible: (range: IndexedRange) => boolean,
  basisPoints: number,
): IndexedRange[] {
  const subtotal = ranges.reduce((sum, range) => eligible(range)
    ? addSafe(sum, multiplySafe(range.listedPiasters, range.quantity))
    : sum, 0);
  if (subtotal === 0 || basisPoints === 0) return ranges.map((range) => ({ ...range }));

  const roundedTotal = Number((BigInt(subtotal) * BigInt(basisPoints) + 5_000n) / 10_000n);
  const denominator = BigInt(subtotal);
  const rows = ranges.map((range, index) => {
    if (!eligible(range)) return { range: { ...range }, index, remainder: -1n };
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

function appliesToStandard(offer: AutomaticOfferDto, line: { productId: string; categoryId: string }): boolean {
  return offer.productIds.includes(line.productId) || offer.categoryIds.includes(line.categoryId);
}

function offerRelevant(offer: AutomaticOfferDto, lines: PricingBasketLine[]): boolean {
  switch (offer.discountType) {
    case "percentage":
    case "fixed":
      return lines.some((line) => appliesToStandard(offer, line));
    case "fixed_bundle": {
      const variants = new Set(lines.map((line) => line.variantId));
      return offer.bundleItems.every((item) => variants.has(item.variantId));
    }
    case "buy_x_get_y":
      return lines.some((line) => matchesScope(line, offer.buyProductIds, offer.buyCategoryIds))
        && lines.some((line) => matchesScope(line, offer.rewardProductIds, offer.rewardCategoryIds));
  }
}

function evaluateFixedBundle(offer: AutomaticOfferDto, ranges: IndexedRange[]): IndexedRange[] | null {
  if (offer.bundlePricePiasters === null || offer.bundleItems.length === 0) return null;
  const quantityByVariant = new Map<string, number>();
  for (const range of ranges) {
    quantityByVariant.set(range.variantId, addSafe(quantityByVariant.get(range.variantId) ?? 0, range.quantity));
  }
  let applications = Number.MAX_SAFE_INTEGER;
  for (const item of offer.bundleItems) {
    applications = Math.min(
      applications,
      Math.floor((quantityByVariant.get(item.variantId) ?? 0) / item.requiredQuantity),
    );
  }
  if (applications < 1 || !Number.isSafeInteger(applications)) return null;

  const includedByVariant = new Map(offer.bundleItems.map((item) => [
    item.variantId,
    multiplySafe(item.requiredQuantity, applications),
  ]));
  const included = (range: IndexedRange) => range.unitIndex < (includedByVariant.get(range.variantId) ?? 0);
  const listedTotal = ranges.reduce((sum, range) => included(range)
    ? addSafe(sum, multiplySafe(range.listedPiasters, Math.min(
        range.quantity,
        (includedByVariant.get(range.variantId) ?? 0) - range.unitIndex,
      )))
    : sum, 0);
  const bundleTotal = multiplySafe(offer.bundlePricePiasters, applications);
  if (bundleTotal >= listedTotal) return null;
  return allocateEqualCappedRanges(
    splitAtQuantities(ranges, includedByVariant),
    included,
    listedTotal - bundleTotal,
  );
}

function evaluateBuyXGetY(offer: AutomaticOfferDto, ranges: IndexedRange[]): IndexedRange[] | null {
  const buyQuantity = offer.buyQuantity ?? 0;
  const rewardQuantity = offer.rewardQuantity ?? 0;
  const rewardBasisPoints = offer.rewardPercentageBasisPoints ?? 0;
  if (buyQuantity < 1 || rewardQuantity < 1 || rewardBasisPoints < 1) return null;

  const isBuy = (range: IndexedRange) => matchesScope(range, offer.buyProductIds, offer.buyCategoryIds);
  const isReward = (range: IndexedRange) => matchesScope(range, offer.rewardProductIds, offer.rewardCategoryIds);
  const purchaseCount = ranges.reduce((sum, range) => isBuy(range) ? addSafe(sum, range.quantity) : sum, 0);
  const rewardCount = ranges.reduce((sum, range) => isReward(range) ? addSafe(sum, range.quantity) : sum, 0);
  const overlappingCount = ranges.reduce(
    (sum, range) => isBuy(range) && isReward(range) ? addSafe(sum, range.quantity) : sum,
    0,
  );
  const rewardOnlyCount = rewardCount - overlappingCount;
  let low = 0;
  let high = Math.min(Math.floor(purchaseCount / buyQuantity), Math.floor(rewardCount / rewardQuantity));
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    if (buyXGetYApplicationsAreFeasible(
      candidate,
      purchaseCount,
      rewardOnlyCount,
      overlappingCount,
      buyQuantity,
      rewardQuantity,
    )) low = candidate;
    else high = candidate - 1;
  }
  if (low === 0) return null;

  let rewardUnitsNeeded = multiplySafe(low, rewardQuantity);
  let overlappingUnitsAllowed = purchaseCount - multiplySafe(low, buyQuantity);
  const selectedByVariant = new Map<string, number>();
  const candidates = ranges.filter(isReward).sort((left, right) =>
    left.listedPiasters - right.listedPiasters
    || left.variantId.localeCompare(right.variantId)
    || left.unitIndex - right.unitIndex);
  for (const range of candidates) {
    if (rewardUnitsNeeded === 0) break;
    const overlap = isBuy(range);
    const quantity = Math.min(
      range.quantity,
      rewardUnitsNeeded,
      overlap ? overlappingUnitsAllowed : range.quantity,
    );
    if (quantity <= 0) continue;
    selectedByVariant.set(range.variantId, addSafe(selectedByVariant.get(range.variantId) ?? 0, quantity));
    rewardUnitsNeeded -= quantity;
    if (overlap) overlappingUnitsAllowed -= quantity;
  }
  if (rewardUnitsNeeded !== 0) return null;
  const selected = (range: IndexedRange) => range.unitIndex < (selectedByVariant.get(range.variantId) ?? 0);
  return allocatePercentageRanges(
    splitAtQuantities(ranges, selectedByVariant),
    selected,
    rewardBasisPoints,
  );
}

function buyXGetYApplicationsAreFeasible(
  applications: number,
  purchaseCount: number,
  rewardOnlyCount: number,
  overlappingCount: number,
  buyQuantity: number,
  rewardQuantity: number,
): boolean {
  const rewardsNeeded = multiplySafe(applications, rewardQuantity);
  const overlapAllowed = purchaseCount - multiplySafe(applications, buyQuantity);
  return overlapAllowed >= 0 && rewardsNeeded <= addSafe(rewardOnlyCount, Math.min(overlappingCount, overlapAllowed));
}

function splitAtQuantities(ranges: IndexedRange[], quantities: Map<string, number>): IndexedRange[] {
  const result: IndexedRange[] = [];
  for (const range of ranges) {
    const boundary = quantities.get(range.variantId) ?? 0;
    const split = boundary - range.unitIndex;
    if (split > 0 && split < range.quantity) {
      result.push({ ...range, quantity: split });
      result.push({ ...range, unitIndex: range.unitIndex + split, quantity: range.quantity - split });
    } else {
      result.push({ ...range });
    }
  }
  return result;
}

function matchesScope(
  line: { productId: string; categoryId: string },
  productIds: string[],
  categoryIds: string[],
): boolean {
  return productIds.includes(line.productId) || categoryIds.includes(line.categoryId);
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
