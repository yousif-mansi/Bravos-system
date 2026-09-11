import { InventoryValidationError } from "./errors.ts";

const MAX_PIASTERS = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;
const MAX_THRESHOLD = 1_000_000;

export function assertPiasters(value: unknown, messageAr: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0)) {
    throw new InventoryValidationError(messageAr);
  }
  if (value < 0 || value > MAX_PIASTERS) {
    throw new InventoryValidationError(messageAr);
  }
  return value;
}

export function assertQuantity(value: unknown, messageAr: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0)) {
    throw new InventoryValidationError(messageAr);
  }
  if (value < 1 || value > MAX_QUANTITY) {
    throw new InventoryValidationError(messageAr);
  }
  return value;
}

export function assertThreshold(value: unknown, messageAr: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || Object.is(value, -0)) {
    throw new InventoryValidationError(messageAr);
  }
  if (value < 0 || value > MAX_THRESHOLD) {
    throw new InventoryValidationError(messageAr);
  }
  return value;
}
