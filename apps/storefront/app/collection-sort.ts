import type { PublicProductSummaryDto } from "@bravos/contracts/public";

export type CollectionSort = "default" | "name" | "price-asc" | "price-desc";

export function parseCollectionSort(value: string | undefined): CollectionSort {
  return value === "name" || value === "price-asc" || value === "price-desc" ? value : "default";
}

export function sortCollection(products: PublicProductSummaryDto[], sort: CollectionSort): PublicProductSummaryDto[] {
  if (sort === "default") return products;

  const sorted = [...products];
  if (sort === "name") {
    const arabic = new Intl.Collator("ar-EG", { sensitivity: "base", numeric: true });
    return sorted.sort((left, right) => arabic.compare(left.nameAr, right.nameAr));
  }

  return sorted.sort((left, right) => {
    const leftPrice = left.lowestSellingPricePiasters;
    const rightPrice = right.lowestSellingPricePiasters;
    if (leftPrice === null) return rightPrice === null ? 0 : 1;
    if (rightPrice === null) return -1;
    return sort === "price-asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
  });
}

export function collectionHref(input: { query?: string; categoryId?: string; sort?: CollectionSort }): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.categoryId) params.set("category", input.categoryId);
  if (input.sort && input.sort !== "default") params.set("sort", input.sort);
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}
