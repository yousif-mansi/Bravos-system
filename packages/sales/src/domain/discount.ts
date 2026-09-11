import { SalesValidationError } from "./errors.ts";

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
  const original = units.reduce((sum, unit) => sum + unit.listedPiasters, 0);
  if (discountPiasters > original) {
    throw new SalesValidationError("لا يمكن أن يكون إجمالي البيع سالباً.");
  }
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
    const originalPiasters = group.reduce((sum, unit) => sum + unit.listedPiasters, 0);
    const discountPiasters = group.reduce((sum, unit) => sum + unit.discountPiasters, 0);
    return {
      variantId,
      quantity: group.length,
      listedUnitPricePiasters,
      originalPiasters,
      discountPiasters,
      paidPiasters: originalPiasters - discountPiasters,
      units: group.map((unit) => ({
        listedPiasters: unit.listedPiasters,
        discountPiasters: unit.discountPiasters,
        paidPiasters: unit.paidPiasters,
      })),
    };
  });
}

export function priceSaleLines(
  lines: Array<{ variantId: string; quantity: number; listedUnitPricePiasters: number }>,
  employeeDiscountPiasters: number,
): { lines: VariantLineAllocation[]; originalTotalPiasters: number; finalTotalPiasters: number } {
  const allocated = allocateEmployeeDiscount(expandSoldUnits(lines), employeeDiscountPiasters);
  const folded = foldAllocatedUnits(allocated);
  const originalTotalPiasters = folded.reduce((sum, line) => sum + line.originalPiasters, 0);
  return {
    lines: folded,
    originalTotalPiasters,
    finalTotalPiasters: originalTotalPiasters - employeeDiscountPiasters,
  };
}
