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
  units: Array<{
    unitIndex: number;
    quantity: number;
    listedPiasters: number;
    discountPiasters: number;
    paidPiasters: number;
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
      units: group.map((unit, unitIndex) => ({
        unitIndex,
        quantity: 1,
        listedPiasters: unit.listedPiasters,
        discountPiasters: unit.discountPiasters,
        paidPiasters: unit.paidPiasters,
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
      units,
    };
  });
}

export function priceSaleLines(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
  employeeDiscountPiasters: number,
): { lines: VariantLineAllocation[]; originalTotalPiasters: number; finalTotalPiasters: number } {
  const folded = foldDiscountGroups(allocateDiscountGroups(lines, employeeDiscountPiasters));
  const originalTotalPiasters = folded.reduce((sum, line) => addMoney(sum, line.originalPiasters), 0);
  return {
    lines: folded,
    originalTotalPiasters,
    finalTotalPiasters: subtractMoney(originalTotalPiasters, employeeDiscountPiasters),
  };
}
