import { describe, expect, it } from "vitest";
import type { PublicProductSummaryDto } from "@bravos/contracts/public";
import { parseCollectionSort, sortCollection } from "../../apps/storefront/app/collection-sort";

const category = { id: "category", nameAr: "قمصان" };
const products: PublicProductSummaryDto[] = [
  { id: "c", nameAr: "قميص جيم", category, availability: "coming_soon", previewImageRef: null, lowestSellingPricePiasters: null },
  { id: "b", nameAr: "قميص باء", category, availability: "out_of_stock", previewImageRef: null, lowestSellingPricePiasters: 0 },
  { id: "a", nameAr: "قميص ألف", category, availability: "in_stock", previewImageRef: null, lowestSellingPricePiasters: 25000 },
  { id: "d", nameAr: "قميص دال", category, availability: "in_stock", previewImageRef: null, lowestSellingPricePiasters: 10000 },
];

describe("storefront collection sorting", () => {
  it("keeps zero as a real price and missing prices last in both directions", () => {
    expect(sortCollection(products, "price-asc").map((product) => product.id)).toEqual(["b", "d", "a", "c"]);
    expect(sortCollection(products, "price-desc").map((product) => product.id)).toEqual(["a", "d", "b", "c"]);
    expect(products.map((product) => product.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("orders Arabic names across the full matching set and ignores unsupported sorts", () => {
    const expected = [...products].sort((left, right) =>
      new Intl.Collator("ar-EG", { sensitivity: "base", numeric: true }).compare(left.nameAr, right.nameAr),
    );
    expect(sortCollection(products, "name").map((product) => product.id)).toEqual(expected.map((product) => product.id));
    expect(parseCollectionSort("popular")).toBe("default");
    expect(sortCollection(products, parseCollectionSort("popular"))).toBe(products);
  });
});
