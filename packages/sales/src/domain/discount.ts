import { SalesValidationError } from "./errors.ts";
import { addMoney, assertSafeMoney, multiplyMoney, subtractMoney } from "./money.ts";

/** Same computational ceiling as inventory line quantities; applied after merge, not a new selling policy. */
export const MAX_SALE_QUANTITY = 1_000_000;

export type PricedUnit = {
  variantId: string;
  listedPiasters: number;
};

export type AllocatedUnit = PricedUnit & {
  discountPiasters: number;
  paidPiasters: number;
};

export type VariantLineAllocation = {
  variantId: string;
  quantity: number;
  listedUnitPricePiasters: number;
  originalPiasters: number;
  discountPiasters: number;
  paidPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  employeeDiscountPiasters: number;
  units: Array<{
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters: number;
    employeeDiscountPiasters: number;
  }>;
};

export function mergeVariantQuantities(
  lines: Array<{ variantId: string; quantity: number }>,
): Array<{ variantId: string; quantity: number }> {
  const merged = new Map<string, number>();
  for (const line of lines) {
    merged.set(line.variantId, (merged.get(line.variantId) ?? 0) + line.quantity);
  }
  return [...merged.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function assertMergedSaleQuantities(
  lines: Array<{ variantId: string; quantity: number }>,
): Array<{ variantId: string; quantity: number }> {
  const merged = mergeVariantQuantities(lines);
  for (const item of merged) {
    if (
      !Number.isInteger(item.quantity) ||
      Object.is(item.quantity, -0) ||
      item.quantity < 1 ||
      item.quantity > MAX_SALE_QUANTITY
    ) {
      throw new SalesValidationError("الكمية غير صالحة.");
    }
  }
  return merged;
}

export function expandSoldUnits(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
): PricedUnit[] {
  const merged = new Map<string, { quantity: number; listedUnitPricePiasters: number }>();
  for (const line of lines) {
    const existing = merged.get(line.variantId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      merged.set(line.variantId, {
        quantity: line.quantity,
        listedUnitPricePiasters: line.listedUnitPricePiasters,
      });
    }
  }
  const units: PricedUnit[] = [];
  for (const variantId of [...merged.keys()].sort()) {
    const item = merged.get(variantId);
    if (!item) {
      continue;
    }
    if (item.quantity > MAX_SALE_QUANTITY) {
      throw new SalesValidationError("الكمية غير صالحة.");
    }
    for (let index = 0; index < item.quantity; index += 1) {
      units.push({ variantId, listedPiasters: item.listedUnitPricePiasters });
    }
  }
  return units;
}

export function allocateEmployeeDiscount(units: PricedUnit[], discountPiasters: number): AllocatedUnit[] {
  if (discountPiasters < 0) {
    throw new SalesValidationError("قيمة الخصم غير صالحة.");
  }
  const original = units.reduce((sum, unit) => addMoney(sum, assertSafeMoney(unit.listedPiasters)), 0);
  if (discountPiasters > original) {
    throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
  }
  assertSafeMoney(discountPiasters);
  const discounts = units.map(() => 0);
  let remaining = discountPiasters;
  while (remaining > 0) {
    const eligible: number[] = [];
    for (let index = 0; index < units.length; index += 1) {
      const listed = units[index]?.listedPiasters ?? 0;
      if (listed - (discounts[index] ?? 0) > 0) {
        eligible.push(index);
      }
    }
    if (eligible.length === 0) {
      throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
    }
    const share = Math.floor(remaining / eligible.length);
    if (share === 0) {
      for (const index of eligible) {
        if (remaining <= 0) {
          break;
        }
        discounts[index] = (discounts[index] ?? 0) + 1;
        remaining -= 1;
      }
      continue;
    }
    let applied = 0;
    for (const index of eligible) {
      const listed = units[index]?.listedPiasters ?? 0;
      const current = discounts[index] ?? 0;
      const take = Math.min(share, listed - current);
      discounts[index] = current + take;
      applied += take;
    }
    remaining -= applied;
  }
  return units.map((unit, index) => {
    const discount = discounts[index] ?? 0;
    return {
      ...unit,
      discountPiasters: discount,
      paidPiasters: unit.listedPiasters - discount,
    };
  });
}

export function foldAllocatedUnits(units: AllocatedUnit[]): VariantLineAllocation[] {
  const grouped = new Map<string, AllocatedUnit[]>();
  for (const unit of units) {
    const list = grouped.get(unit.variantId) ?? [];
    list.push(unit);
    grouped.set(unit.variantId, list);
  }
  return [...grouped.keys()].sort().map((variantId) => {
    const group = grouped.get(variantId) ?? [];
    const listedUnitPricePiasters = group[0]?.listedPiasters ?? 0;
    const originalPiasters = group.reduce((sum, unit) => addMoney(sum, assertSafeMoney(unit.listedPiasters)), 0);
    const discountPiasters = group.reduce((sum, unit) => addMoney(sum, assertSafeMoney(unit.discountPiasters)), 0);
    return {
      variantId,
      quantity: group.length,
      listedUnitPricePiasters,
      originalPiasters,
      discountPiasters,
      paidPiasters: subtractMoney(originalPiasters, discountPiasters),
      automaticOfferDiscountPiasters: 0,
      couponDiscountPiasters: 0,
      employeeDiscountPiasters: discountPiasters,
      units: group.map((unit, unitIndex) => ({
        unitIndex,
        quantity: 1,
        listedPiasters: unit.listedPiasters,
        discountPiasters: unit.discountPiasters,
        paidPiasters: unit.paidPiasters,
        automaticOfferDiscountPiasters: 0,
        couponDiscountPiasters: 0,
        employeeDiscountPiasters: unit.discountPiasters,
      })),
    };
  });
}

type DiscountGroup = {
  variantId: string;
  listedPiasters: number;
  discountPiasters: number;
  quantity: number;
};

function allocateDiscountGroups(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
  discountPiasters: number,
): DiscountGroup[] {
  if (discountPiasters < 0) {
    throw new SalesValidationError("قيمة الخصم غير صالحة.");
  }
  const merged = new Map<string, { listedPiasters: number; quantity: number }>();
  for (const line of lines) {
    const existing = merged.get(line.variantId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      merged.set(line.variantId, {
        listedPiasters: line.listedUnitPricePiasters,
        quantity: line.quantity,
      });
    }
  }
  let groups: DiscountGroup[] = [...merged.keys()].sort().map((variantId) => {
    const item = merged.get(variantId);
    return {
      variantId,
      listedPiasters: item?.listedPiasters ?? 0,
      discountPiasters: 0,
      quantity: item?.quantity ?? 0,
    };
  });
  for (const group of groups) {
    if (
      !Number.isInteger(group.quantity) ||
      Object.is(group.quantity, -0) ||
      group.quantity < 1 ||
      group.quantity > MAX_SALE_QUANTITY
    ) {
      throw new SalesValidationError("الكمية غير صالحة.");
    }
  }
  const original = groups.reduce(
    (sum, group) => addMoney(sum, multiplyMoney(group.listedPiasters, group.quantity)),
    0,
  );
  if (discountPiasters > original) {
    throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
  }
  assertSafeMoney(discountPiasters);
  let remaining = discountPiasters;
  while (remaining > 0) {
    const eligible: number[] = [];
    let eligibleUnits = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (!group) {
        continue;
      }
      if (group.listedPiasters - group.discountPiasters > 0) {
        eligible.push(index);
        eligibleUnits += group.quantity;
      }
    }
    if (eligibleUnits === 0) {
      throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
    }
    const share = Math.floor(remaining / eligibleUnits);
    if (share === 0) {
      let need = remaining;
      const next: DiscountGroup[] = [];
      for (const group of groups) {
        const capacity = group.listedPiasters - group.discountPiasters;
        if (need <= 0 || capacity <= 0) {
          next.push(group);
          continue;
        }
        const take = Math.min(group.quantity, need);
        if (take === group.quantity) {
          next.push({ ...group, discountPiasters: group.discountPiasters + 1 });
        } else {
          next.push({ ...group, quantity: take, discountPiasters: group.discountPiasters + 1 });
          next.push({ ...group, quantity: group.quantity - take });
        }
        need -= take;
      }
      groups = next;
      remaining = 0;
      continue;
    }
    let applied = 0;
    for (const index of eligible) {
      const group = groups[index];
      if (!group) {
        continue;
      }
      const take = Math.min(share, group.listedPiasters - group.discountPiasters);
      group.discountPiasters += take;
      applied = addMoney(applied, multiplyMoney(take, group.quantity));
    }
    remaining -= applied;
  }
  return groups;
}

function foldDiscountGroups(groups: DiscountGroup[]): VariantLineAllocation[] {
  const byVariant = new Map<string, DiscountGroup[]>();
  for (const group of groups) {
    const list = byVariant.get(group.variantId) ?? [];
    list.push(group);
    byVariant.set(group.variantId, list);
  }
  return [...byVariant.keys()].sort().map((variantId) => {
    const variantGroups = byVariant.get(variantId) ?? [];
    const listedUnitPricePiasters = variantGroups[0]?.listedPiasters ?? 0;
    const quantity = variantGroups.reduce((sum, group) => sum + group.quantity, 0);
    const originalPiasters = variantGroups.reduce(
      (sum, group) => addMoney(sum, multiplyMoney(group.listedPiasters, group.quantity)),
      0,
    );
    const discountPiasters = variantGroups.reduce(
      (sum, group) => addMoney(sum, multiplyMoney(group.discountPiasters, group.quantity)),
      0,
    );
    const units: VariantLineAllocation["units"] = [];
    let ordinal = 0;
    for (const group of variantGroups) {
      units.push({
        unitIndex: ordinal,
        quantity: group.quantity,
        listedPiasters: group.listedPiasters,
        discountPiasters: group.discountPiasters,
        paidPiasters: subtractMoney(group.listedPiasters, group.discountPiasters),
        automaticOfferDiscountPiasters: 0,
        couponDiscountPiasters: 0,
        employeeDiscountPiasters: group.discountPiasters,
      });
      ordinal += group.quantity;
    }
    return {
      variantId,
      quantity,
      listedUnitPricePiasters,
      originalPiasters,
      discountPiasters,
      paidPiasters: subtractMoney(originalPiasters, discountPiasters),
      automaticOfferDiscountPiasters: 0,
      couponDiscountPiasters: 0,
      employeeDiscountPiasters: discountPiasters,
      units,
    };
  });
}

export function priceSaleLines(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
  employeeDiscountPiasters: number,
  automaticRanges?: Array<{
    variantId: string;
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    automaticOfferDiscountPiasters: number;
  }>,
  couponRanges?: Array<{
    variantId: string;
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters: number;
  }>,
): { lines: VariantLineAllocation[]; originalTotalPiasters: number; finalTotalPiasters: number } {
  const configuredRanges = couponRanges ?? automaticRanges;
  const folded = configuredRanges
    ? priceWithConfiguredEffects(lines, configuredRanges, employeeDiscountPiasters)
    : foldDiscountGroups(allocateDiscountGroups(lines, employeeDiscountPiasters));
  const originalTotalPiasters = folded.reduce((sum, line) => addMoney(sum, line.originalPiasters), 0);
  const automaticOfferDiscountPiasters = folded.reduce(
    (sum, line) => addMoney(sum, line.automaticOfferDiscountPiasters),
    0,
  );
  const couponDiscountPiasters = folded.reduce((sum, line) => addMoney(sum, line.couponDiscountPiasters), 0);
  return {
    lines: folded,
    originalTotalPiasters,
    finalTotalPiasters: subtractMoney(
      subtractMoney(originalTotalPiasters, automaticOfferDiscountPiasters),
      addMoney(couponDiscountPiasters, employeeDiscountPiasters),
    ),
  };
}

type EffectRange = {
  variantId: string;
  unitIndex: number;
  quantity: number;
  listedPiasters: number;
  automaticOfferDiscountPiasters: number;
  couponDiscountPiasters: number;
  employeeDiscountPiasters: number;
};

function priceWithConfiguredEffects(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
  automaticRanges: Array<{
    variantId: string;
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    automaticOfferDiscountPiasters: number;
    couponDiscountPiasters?: number;
  }>,
  employeeDiscountPiasters: number,
): VariantLineAllocation[] {
  const expected = new Map<string, { quantity: number; listedPiasters: number }>();
  for (const line of lines) {
    const current = expected.get(line.variantId);
    if (current && current.listedPiasters !== line.listedUnitPricePiasters) {
      throw new SalesValidationError("تفاصيل العرض التلقائي غير متطابقة.");
    }
    expected.set(line.variantId, {
      quantity: (current?.quantity ?? 0) + line.quantity,
      listedPiasters: line.listedUnitPricePiasters,
    });
  }
  assertMergedSaleQuantities(lines);

  const nextIndex = new Map<string, number>();
  const effects: EffectRange[] = automaticRanges.map((automatic) => {
    const source = expected.get(automatic.variantId);
    const expectedIndex = nextIndex.get(automatic.variantId) ?? 0;
    if (!source || automatic.unitIndex !== expectedIndex || automatic.listedPiasters !== source.listedPiasters
      || !Number.isSafeInteger(automatic.quantity) || automatic.quantity < 1
      || automatic.quantity > source.quantity - expectedIndex) {
      throw new SalesValidationError("تفاصيل العرض التلقائي غير متطابقة.");
    }
    nextIndex.set(automatic.variantId, expectedIndex + automatic.quantity);
    const discount = assertSafeMoney(automatic.automaticOfferDiscountPiasters);
    const couponDiscount = assertSafeMoney(automatic.couponDiscountPiasters ?? 0);
    if (addMoney(discount, couponDiscount) > automatic.listedPiasters) {
      throw new SalesValidationError("تفاصيل العرض التلقائي غير صالحة.");
    }
    return { ...automatic, automaticOfferDiscountPiasters: discount, couponDiscountPiasters: couponDiscount, employeeDiscountPiasters: 0 };
  });
  for (const [variantId, source] of expected) {
    if ((nextIndex.get(variantId) ?? 0) !== source.quantity) {
      throw new SalesValidationError("تفاصيل العرض التلقائي غير متطابقة.");
    }
  }
  if (nextIndex.size !== expected.size) {
    throw new SalesValidationError("تفاصيل العرض التلقائي غير متطابقة.");
  }

  return foldEffectRanges(allocateEmployeeEffectRanges(effects, employeeDiscountPiasters));
}

function allocateEmployeeEffectRanges(input: EffectRange[], discountPiasters: number): EffectRange[] {
  if (discountPiasters < 0) throw new SalesValidationError("قيمة الخصم غير صالحة.");
  assertSafeMoney(discountPiasters);
  const available = input.reduce((sum, range) => addMoney(
    sum,
    multiplyMoney(subtractMoney(range.listedPiasters, addMoney(range.automaticOfferDiscountPiasters, range.couponDiscountPiasters)), range.quantity),
  ), 0);
  if (discountPiasters > available) throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");

  let ranges = input.map((range) => ({ ...range }));
  let remaining = discountPiasters;
  while (remaining > 0) {
    const eligibleQuantity = ranges.reduce((sum, range) =>
      range.listedPiasters - range.automaticOfferDiscountPiasters - range.couponDiscountPiasters - range.employeeDiscountPiasters > 0
        ? addMoney(sum, range.quantity)
        : sum, 0);
    if (eligibleQuantity === 0) throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
    const share = Math.floor(remaining / eligibleQuantity);
    if (share === 0) {
      let need = remaining;
      const split: EffectRange[] = [];
      for (const range of ranges) {
        const capacity = range.listedPiasters - range.automaticOfferDiscountPiasters - range.couponDiscountPiasters - range.employeeDiscountPiasters;
        if (need <= 0 || capacity <= 0) {
          split.push(range);
          continue;
        }
        const quantity = Math.min(need, range.quantity);
        split.push({ ...range, quantity, employeeDiscountPiasters: range.employeeDiscountPiasters + 1 });
        if (quantity < range.quantity) {
          split.push({ ...range, unitIndex: range.unitIndex + quantity, quantity: range.quantity - quantity });
        }
        need -= quantity;
      }
      ranges = split;
      remaining = need;
      continue;
    }
    let applied = 0;
    ranges = ranges.map((range) => {
      const capacity = range.listedPiasters - range.automaticOfferDiscountPiasters - range.couponDiscountPiasters - range.employeeDiscountPiasters;
      if (capacity <= 0) return range;
      const increment = Math.min(share, capacity);
      applied = addMoney(applied, multiplyMoney(increment, range.quantity));
      return { ...range, employeeDiscountPiasters: range.employeeDiscountPiasters + increment };
    });
    remaining -= applied;
  }
  return ranges;
}

function foldEffectRanges(ranges: EffectRange[]): VariantLineAllocation[] {
  const grouped = new Map<string, EffectRange[]>();
  for (const range of ranges) {
    const list = grouped.get(range.variantId) ?? [];
    list.push(range);
    grouped.set(range.variantId, list);
  }
  return [...grouped.keys()].sort().map((variantId) => {
    const source = grouped.get(variantId) ?? [];
    const automaticOfferDiscountPiasters = source.reduce((sum, range) =>
      addMoney(sum, multiplyMoney(range.automaticOfferDiscountPiasters, range.quantity)), 0);
    const employeeDiscountPiasters = source.reduce((sum, range) =>
      addMoney(sum, multiplyMoney(range.employeeDiscountPiasters, range.quantity)), 0);
    const couponDiscountPiasters = source.reduce((sum, range) =>
      addMoney(sum, multiplyMoney(range.couponDiscountPiasters, range.quantity)), 0);
    const originalPiasters = source.reduce((sum, range) =>
      addMoney(sum, multiplyMoney(range.listedPiasters, range.quantity)), 0);
    const compact: VariantLineAllocation["units"] = [];
    for (const range of source) {
      const last = compact.at(-1);
      const discountPiasters = addMoney(addMoney(range.automaticOfferDiscountPiasters, range.couponDiscountPiasters), range.employeeDiscountPiasters);
      const paidPiasters = subtractMoney(range.listedPiasters, discountPiasters);
      if (
        last && last.unitIndex + last.quantity === range.unitIndex
        && last.listedPiasters === range.listedPiasters
        && last.automaticOfferDiscountPiasters === range.automaticOfferDiscountPiasters
        && last.couponDiscountPiasters === range.couponDiscountPiasters
        && last.employeeDiscountPiasters === range.employeeDiscountPiasters
      ) {
        last.quantity += range.quantity;
      } else {
        compact.push({
          unitIndex: range.unitIndex,
          quantity: range.quantity,
          listedPiasters: range.listedPiasters,
          automaticOfferDiscountPiasters: range.automaticOfferDiscountPiasters,
          couponDiscountPiasters: range.couponDiscountPiasters,
          employeeDiscountPiasters: range.employeeDiscountPiasters,
          discountPiasters,
          paidPiasters,
        });
      }
    }
    const discountPiasters = addMoney(addMoney(automaticOfferDiscountPiasters, couponDiscountPiasters), employeeDiscountPiasters);
    return {
      variantId,
      quantity: source.reduce((sum, range) => sum + range.quantity, 0),
      listedUnitPricePiasters: source[0]?.listedPiasters ?? 0,
      originalPiasters,
      automaticOfferDiscountPiasters,
      couponDiscountPiasters,
      employeeDiscountPiasters,
      discountPiasters,
      paidPiasters: subtractMoney(originalPiasters, discountPiasters),
      units: compact,
    };
  });
}
