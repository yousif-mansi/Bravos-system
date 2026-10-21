import type { PublicProductVariantDto } from "@bravos/contracts/public";

export type ColorChoice = {
  id: string;
  nameAr: string;
  orderable: boolean;
};

export type SizeChoice = {
  variantId: string;
  nameAr: string;
  orderable: boolean;
  sellingPricePiasters: number;
};

// First orderable pair in public variant order. Empty when none can be ordered.
export function firstOrderableVariantId(variants: readonly PublicProductVariantDto[]): string {
  return variants.find((variant) => variant.orderable)?.id ?? "";
}

// One choice per color that already exists. A color stays available when any of its pairs is orderable.
export function colorChoices(variants: readonly PublicProductVariantDto[]): ColorChoice[] {
  const choices: ColorChoice[] = [];
  const indexById = new Map<string, number>();
  for (const variant of variants) {
    const index = indexById.get(variant.color.id);
    if (index === undefined) {
      indexById.set(variant.color.id, choices.length);
      choices.push({ id: variant.color.id, nameAr: variant.color.nameAr, orderable: variant.orderable });
    } else if (variant.orderable) {
      const current = choices[index];
      if (current) current.orderable = true;
    }
  }
  return choices;
}

// Existing pairs for one color, in public variant order. No missing size is added.
export function sizesForColor(variants: readonly PublicProductVariantDto[], colorId: string): SizeChoice[] {
  const sizes: SizeChoice[] = [];
  for (const variant of variants) {
    if (variant.color.id !== colorId) continue;
    sizes.push({
      variantId: variant.id,
      nameAr: variant.size.nameAr,
      orderable: variant.orderable,
      sellingPricePiasters: variant.sellingPricePiasters,
    });
  }
  return sizes;
}

// Keep the current size only when that exact pair is orderable. Otherwise the first orderable pair of the color.
export function variantIdForColor(
  variants: readonly PublicProductVariantDto[],
  colorId: string,
  currentSizeId: string | null,
): string | null {
  let firstOrderable: string | null = null;
  let sameSize: string | null = null;
  for (const variant of variants) {
    if (variant.color.id !== colorId) continue;
    if (variant.orderable && firstOrderable === null) firstOrderable = variant.id;
    if (currentSizeId && variant.size.id === currentSizeId && variant.orderable && sameSize === null) sameSize = variant.id;
  }
  return sameSize ?? firstOrderable;
}
