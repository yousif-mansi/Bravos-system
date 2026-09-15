import type { AppliedAutomaticOfferDto, AppliedCouponDto, CouponDto } from "@bravos/contracts";
import { cairoDateAt, offerIsActiveOn } from "./cairo-date.ts";
import { PricingValidationError } from "./errors.ts";
import type { AutomaticOfferUnitRange, PricingBasketLine } from "./automatic-offers.ts";

export type CouponUnitRange = {
  variantId: string;
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
};

export type CouponEvaluation = {
  appliedCoupon: AppliedCouponDto | null;
  couponDiscountPiasters: number;
  unitRanges: CouponUnitRange[];
};

type ScopedRange = CouponUnitRange & { productId: string; categoryId: string };

export function normalizeCouponCode(value: string): string {
  return value.normalize("NFC").trim().toLocaleUpperCase("en-US");
}

export function evaluateCoupon(input: {
  coupons: CouponDto[];
  code: string | null;
  lines: PricingBasketLine[];
  automaticOffer: AppliedAutomaticOfferDto | null;
  automaticRanges: AutomaticOfferUnitRange[];
  at: Date;
}): CouponEvaluation {
  const ranges = scopedRanges(input.lines, input.automaticOffer ? input.automaticRanges : []);
  if (!input.code) return { appliedCoupon: null, couponDiscountPiasters: 0, unitRanges: ranges };
  const normalized = normalizeCouponCode(input.code);
  const coupon = input.coupons.find((item) => normalizeCouponCode(item.code) === normalized);
  if (!coupon) throw new PricingValidationError("كود الكوبون غير صالح.");
  if (!offerIsActiveOn(coupon, cairoDateAt(input.at))) {
    throw new PricingValidationError("الكوبون غير مفعل أو خارج فترة صلاحيته.");
  }
  if (coupon.usedCount >= coupon.usageLimit) {
    throw new PricingValidationError("بلغ الكوبون الحد الأقصى للاستخدام.");
  }
  if (input.automaticOffer && (!input.automaticOffer.allowCoupon || !coupon.allowAutomaticOffer)) {
    throw new PricingValidationError("لا يمكن جمع هذا الكوبون مع العرض التلقائي.");
  }
  if (!ranges.some((range) => eligible(coupon, range))) {
    throw new PricingValidationError("الكوبون غير مؤهل لهذه السلة.");
  }

  const discounted = coupon.discountType === "fixed"
    ? allocateFixed(ranges, coupon, coupon.fixedDiscountPiasters ?? 0)
    : allocatePercentage(ranges, coupon, coupon.percentageBasisPoints ?? 0);
  const total = discounted.reduce(
    (sum, range) => safeAdd(sum, safeMultiply(range.couponDiscountPiasters, range.quantity)),
    0,
  );
  if (total <= 0) throw new PricingValidationError("الكوبون لا يضيف خصماً لهذه السلة.");
  return {
    appliedCoupon: {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      percentageBasisPoints: coupon.percentageBasisPoints,
      fixedDiscountPiasters: coupon.fixedDiscountPiasters,
      allowAutomaticOffer: coupon.allowAutomaticOffer,
      discountPiasters: total,
    },
    couponDiscountPiasters: total,
    unitRanges: merge(discounted),
  };
}

function allocateFixed(input: ScopedRange[], coupon: CouponDto, requested: number): ScopedRange[] {
  const capacity = input.reduce((sum, range) => eligible(coupon, range)
    ? safeAdd(sum, safeMultiply(remainingValue(range), range.quantity)) : sum, 0);
  let remaining = Math.min(requested, capacity);
  let ranges = input.map((range) => ({ ...range }));
  while (remaining > 0) {
    const eligibleQuantity = ranges.reduce((sum, range) => eligible(coupon, range) && remainingValue(range) > 0
      ? safeAdd(sum, range.quantity) : sum, 0);
    if (eligibleQuantity === 0) break;
    const share = Math.floor(remaining / eligibleQuantity);
    if (share === 0) {
      let need = remaining;
      const split: ScopedRange[] = [];
      for (const range of ranges) {
        if (need > 0 && eligible(coupon, range) && remainingValue(range) > 0) {
          const quantity = Math.min(need, range.quantity);
          split.push({ ...range, quantity, couponDiscountPiasters: range.couponDiscountPiasters + 1 });
          if (quantity < range.quantity) split.push({ ...range, unitIndex: range.unitIndex + quantity, quantity: range.quantity - quantity });
          need -= quantity;
        } else split.push(range);
      }
      ranges = split;
      remaining = need;
      continue;
    }
    let applied = 0;
    ranges = ranges.map((range) => {
      if (!eligible(coupon, range) || remainingValue(range) <= 0) return range;
      const increment = Math.min(share, remainingValue(range));
      applied = safeAdd(applied, safeMultiply(increment, range.quantity));
      return { ...range, couponDiscountPiasters: range.couponDiscountPiasters + increment };
    });
    remaining -= applied;
  }
  return ranges;
}

function allocatePercentage(input: ScopedRange[], coupon: CouponDto, basisPoints: number): ScopedRange[] {
  const subtotal = input.reduce((sum, range) => eligible(coupon, range)
    ? safeAdd(sum, safeMultiply(remainingValue(range), range.quantity)) : sum, 0);
  if (subtotal === 0) return input.map((range) => ({ ...range }));
  const roundedTotal = Number((BigInt(subtotal) * BigInt(basisPoints) + 5_000n) / 10_000n);
  const rows = input.map((range, index) => {
    if (!eligible(coupon, range)) return { range: { ...range }, index, remainder: -1n };
    const numerator = BigInt(remainingValue(range)) * BigInt(roundedTotal);
    return {
      range: { ...range, couponDiscountPiasters: Number(numerator / BigInt(subtotal)) },
      index,
      remainder: numerator % BigInt(subtotal),
    };
  });
  const assigned = rows.reduce((sum, row) => safeAdd(sum, safeMultiply(row.range.couponDiscountPiasters, row.range.quantity)), 0);
  let extras = roundedTotal - assigned;
  const extrasByIndex = new Map<number, number>();
  for (const row of [...rows].filter((row) => row.remainder >= 0n).sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (extras === 0) break;
    const quantity = Math.min(extras, row.range.quantity);
    extrasByIndex.set(row.index, quantity);
    extras -= quantity;
  }
  const result: ScopedRange[] = [];
  for (const row of rows) {
    const quantity = extrasByIndex.get(row.index) ?? 0;
    if (quantity > 0) result.push({ ...row.range, quantity, couponDiscountPiasters: row.range.couponDiscountPiasters + 1 });
    if (quantity < row.range.quantity) result.push({ ...row.range, unitIndex: row.range.unitIndex + quantity, quantity: row.range.quantity - quantity });
  }
  return result;
}

function scopedRanges(lines: PricingBasketLine[], automatic: AutomaticOfferUnitRange[]): ScopedRange[] {
  const byVariant = new Map(lines.map((line) => [line.variantId, line]));
  if (automatic.length > 0) return automatic.map((range) => {
    const line = byVariant.get(range.variantId);
    if (!line) throw new PricingValidationError("تفاصيل العرض التلقائي غير متطابقة.");
    return { ...range, productId: line.productId, categoryId: line.categoryId, couponDiscountPiasters: 0 };
  });
  return [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId)).map((line) => ({
    variantId: line.variantId,
    productId: line.productId,
    categoryId: line.categoryId,
    unitIndex: 0,
    quantity: line.quantity,
    listedPiasters: line.listedUnitPricePiasters,
    automaticOfferDiscountPiasters: 0,
    couponDiscountPiasters: 0,
  }));
}

function eligible(coupon: CouponDto, range: ScopedRange): boolean {
  return coupon.productIds.includes(range.productId) || coupon.categoryIds.includes(range.categoryId);
}

function remainingValue(range: CouponUnitRange): number {
  return range.listedPiasters - range.automaticOfferDiscountPiasters - range.couponDiscountPiasters;
}

function merge(input: ScopedRange[]): CouponUnitRange[] {
  const output: CouponUnitRange[] = [];
  for (const { productId: _p, categoryId: _c, ...range } of input) {
    const last = output.at(-1);
    if (last && last.variantId === range.variantId && last.unitIndex + last.quantity === range.unitIndex
      && last.listedPiasters === range.listedPiasters
      && last.automaticOfferDiscountPiasters === range.automaticOfferDiscountPiasters
      && last.couponDiscountPiasters === range.couponDiscountPiasters) last.quantity += range.quantity;
    else output.push({ ...range });
  }
  return output;
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new PricingValidationError("قيمة الخصم غير صالحة.");
  return value;
}

function safeMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new PricingValidationError("قيمة الخصم غير صالحة.");
  return value;
}
