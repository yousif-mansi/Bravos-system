export type PooledLine = {
  productId: string;
  variantId: string;
  quantity: number;
  knownAvailableQuantity: number;
  orderable: boolean;
};

export function sharedPoolLimit(items: readonly PooledLine[], productId: string, incoming?: number): number {
  const limits = items
    .filter((item) => item.productId === productId)
    .map((item) => item.knownAvailableQuantity);
  if (incoming !== undefined) limits.push(incoming);
  if (limits.length === 0) return 0;
  return Math.min(...limits);
}

export function productQuantity(items: readonly PooledLine[], productId: string, exceptVariantId?: string): number {
  return items.reduce(
    (sum, item) => sum + (item.productId === productId && item.variantId !== exceptVariantId ? item.quantity : 0),
    0,
  );
}

/** Absolute quantity this one option may hold without the other options exceeding the shared pool. */
export function lineQuantityCap(items: readonly PooledLine[], variantId: string): number {
  const item = items.find((row) => row.variantId === variantId);
  if (!item) return 0;
  const others = productQuantity(items, item.productId, variantId);
  return Math.max(0, sharedPoolLimit(items, item.productId) - others);
}

export function cartWithinSharedPool(items: readonly PooledLine[]): boolean {
  const productIds = new Set(items.map((item) => item.productId));
  for (const productId of productIds) {
    if (productQuantity(items, productId) > sharedPoolLimit(items, productId)) return false;
  }
  return items.every((item) => item.orderable);
}
