import { CatalogValidationError } from "./errors.ts";

const MAX_PIASTERS = 1_000_000_000;

export function assertPiasters(value: unknown, messageAr: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0)) {
    throw new CatalogValidationError(messageAr);
  }
  if (value < 0 || value > MAX_PIASTERS) {
    throw new CatalogValidationError(messageAr);
  }
  return value;
}

export function resolvedSellingPricePiasters(
  defaultSellingPricePiasters: number,
  sellingPricePiastersOverride: number | null,
): number {
  return sellingPricePiastersOverride ?? defaultSellingPricePiasters;
}
