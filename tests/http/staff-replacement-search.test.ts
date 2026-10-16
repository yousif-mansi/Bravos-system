import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicProductDto } from "@bravos/contracts/public";
import { searchPublicProducts } from "../../apps/internal/src/api";

function product(id: string, overrides: Partial<PublicProductDto> = {}): PublicProductDto {
  return {
    id,
    nameAr: "قطعة أساسية",
    descriptionAr: "وصف داخلي للعرض العام",
    category: { id: "shirts", nameAr: "قمصان" },
    publication: "available",
    availability: "in_stock",
    orderable: true,
    imageRefs: [`${id}-front.webp`, `${id}-back.webp`],
    sizeGuideAr: "تفاصيل المقاسات",
    variants: [{
      id: `${id}-variant`,
      size: { id: "medium", nameAr: "M" },
      color: { id: "black", nameAr: "أسود" },
      sellingPricePiasters: 25_000,
      availableQuantity: 4,
      orderable: true,
    }],
    ...overrides,
  };
}

const named = product("named", { nameAr: "BRAVOS Daily" });
named.variants.push({ ...named.variants[0]!, id: "lower-price", sellingPricePiasters: 18_000 });
const described = product("described", {
  descriptionAr: "نسيج قطني مريح",
  availability: "out_of_stock",
  orderable: false,
  variants: [
    { ...named.variants[0]!, id: "positive-price", availableQuantity: 0, orderable: false },
    { ...named.variants[0]!, id: "zero-price", sellingPricePiasters: 0, availableQuantity: 0, orderable: false },
  ],
});
const categorized = product("categorized", {
  category: { id: "jackets", nameAr: "جاكيتات شتوية" },
  publication: "coming_soon",
  availability: "coming_soon",
  orderable: false,
  imageRefs: [],
  variants: [],
});
const published: PublicProductDto[] = [named, described, categorized];

function stubProducts() {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
    new Response(JSON.stringify(published), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("staff online-order replacement search", () => {
  it("matches trimmed case-insensitive names, descriptions and categories locally without sending q", async () => {
    const fetchMock = stubProducts();
    for (const [query, expectedIds] of [
      ["  bravos daily  ", ["named"]],
      ["  قطني  ", ["described"]],
      [" شتوية ", ["categorized"]],
      ["لا يوجد تطابق 999", []],
    ] as const) {
      const result = await searchPublicProducts(query);
      expect(result.products.map((entry) => entry.id)).toEqual(expectedIds);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toBe("/api/public/catalog/products");
    }
  });

  it("returns only summary fields and preserves zero prices, missing prices and published availability", async () => {
    stubProducts();
    const result = await searchPublicProducts("   ");
    expect(result.products).toEqual([
      {
        id: named.id, nameAr: named.nameAr, category: named.category, availability: "in_stock",
        previewImageRef: "named-front.webp", lowestSellingPricePiasters: 18_000,
      },
      {
        id: described.id, nameAr: described.nameAr, category: described.category, availability: "out_of_stock",
        previewImageRef: "described-front.webp", lowestSellingPricePiasters: 0,
      },
      {
        id: categorized.id, nameAr: categorized.nameAr, category: categorized.category, availability: "coming_soon",
        previewImageRef: null, lowestSellingPricePiasters: null,
      },
    ]);
    for (const entry of result.products) {
      expect(Object.keys(entry).sort()).toEqual([
        "availability", "category", "id", "lowestSellingPricePiasters", "nameAr", "previewImageRef",
      ]);
    }
  });

  it("propagates HTTP and network failures instead of returning an empty replacement list", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "UNAVAILABLE", messageAr: "تعذر تحميل المنتجات." } }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchPublicProducts("قطعة")).rejects.toMatchObject({
      name: "ApiError", status: 503, code: "UNAVAILABLE", messageAr: "تعذر تحميل المنتجات.",
    });
    const networkFailure = new Error("network unavailable");
    fetchMock.mockRejectedValueOnce(networkFailure);
    await expect(searchPublicProducts("قطعة")).rejects.toBe(networkFailure);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) expect(url).toBe("/api/public/catalog/products");
  });
});
