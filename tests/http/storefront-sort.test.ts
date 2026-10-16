import { describe, expect, it } from "vitest";
import type { PublicProductSummaryDto } from "@bravos/contracts/public";
import { collectionHref, parseCollectionSort, sortCollection } from "../../apps/storefront/app/collection-sort";

const category = { id: "category", nameAr: "قمصان" };
const products: PublicProductSummaryDto[] = [
  { id: "c", nameAr: "قميص جيم", category, availability: "coming_soon", previewImageRef: null, lowestSellingPricePiasters: null },
  { id: "b", nameAr: "قميص باء", category, availability: "out_of_stock", previewImageRef: null, lowestSellingPricePiasters: 0 },
  { id: "a", nameAr: "قميص ألف", category, availability: "in_stock", previewImageRef: null, lowestSellingPricePiasters: 25000 },
  { id: "d", nameAr: "قميص دال", category, availability: "in_stock", previewImageRef: null, lowestSellingPricePiasters: 10000 },
];

describe("storefront collection sorting", () => {
  it("keeps zero as a real price and missing prices last in both directions", () => {
    const original = structuredClone(products);
    expect(sortCollection(products, "price-asc").map((product) => product.id)).toEqual(["b", "d", "a", "c"]);
    expect(sortCollection(products, "price-desc").map((product) => product.id)).toEqual(["a", "d", "b", "c"]);
    expect(products).toEqual(original);
  });

  it("preserves catalog order for tied prices and missing prices without mutating the input", () => {
    const tied = [...products, { ...products[3]!, id: "e" }, { ...products[0]!, id: "f" }];
    const original = structuredClone(tied);
    expect(sortCollection(tied, "price-asc").map((product) => product.id)).toEqual(["b", "d", "e", "a", "c", "f"]);
    expect(sortCollection(tied, "price-desc").map((product) => product.id)).toEqual(["a", "d", "e", "b", "c", "f"]);
    expect(tied).toEqual(original);
  });

  it("keeps default order and rejects retired or unsupported sorts", () => {
    expect(parseCollectionSort("price-asc")).toBe("price-asc");
    expect(parseCollectionSort("price-desc")).toBe("price-desc");
    for (const value of [undefined, "default", "name", "newest", "popular"]) {
      expect(parseCollectionSort(value)).toBe("default");
      expect(sortCollection(products, parseCollectionSort(value))).toBe(products);
    }
  });

  it("serializes category and price sorting without a search parameter", () => {
    expect(collectionHref({})).toBe("/");
    expect(collectionHref({ sort: "default" })).toBe("/");
    expect(collectionHref({ categoryId: "category-id", sort: "default" })).toBe("/?category=category-id");
    expect(collectionHref({ sort: "price-asc" })).toBe("/?sort=price-asc");
    for (const sort of ["price-asc", "price-desc"] as const) {
      const href = collectionHref({ categoryId: "category-id", sort });
      expect(href).toBe(`/?category=category-id&sort=${sort}`);
      expect([...new URL(href, "https://shop.example").searchParams]).toEqual([
        ["category", "category-id"], ["sort", sort],
      ]);
    }
  });
});
