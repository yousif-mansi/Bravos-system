import type {
  PublicCatalogBrowseDto,
  PublicProductDto,
  PublicStorefrontContactsDto,
} from "@bravos/contracts/public";

const apiOrigin = process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";
const EMPTY_CONTACTS: PublicStorefrontContactsDto = {
  whatsappUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
};

export async function browsePublicProducts(input: { query?: string; categoryId?: string }): Promise<PublicCatalogBrowseDto> {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.categoryId) params.set("categoryId", input.categoryId);
  const suffix = params.toString();
  return getJson<PublicCatalogBrowseDto>(`${apiOrigin}/api/public/storefront/catalog${suffix ? `?${suffix}` : ""}`, "تعذر تحميل المنتجات حالياً.");
}

export async function getPublicProduct(productId: string): Promise<PublicProductDto | null> {
  const response = await fetch(
    `${apiOrigin}/api/public/catalog/products/${encodeURIComponent(productId)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("تعذر تحميل المنتج حالياً.");
  return response.json() as Promise<PublicProductDto>;
}

export async function getPublicContacts(): Promise<PublicStorefrontContactsDto> {
  try {
    return await getJson<PublicStorefrontContactsDto>(
      `${apiOrigin}/api/public/storefront/contacts`,
      "تعذر تحميل روابط التواصل.",
    );
  } catch {
    return EMPTY_CONTACTS;
  }
}

async function getJson<T>(url: string, message: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(message);
  return response.json() as Promise<T>;
}

export function productMediaUrl(ref: string): string {
  const safePath = ref.split("/").map(encodeURIComponent).join("/");
  return `/api/public/catalog/media/${safePath}`;
}

export function formatEgp(piasters: number): string {
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    minimumFractionDigits: piasters % 100 === 0 ? 0 : 2,
  }).format(piasters / 100);
}

export function availabilityLabel(product: { availability: PublicProductDto["availability"] }): string {
  if (product.availability === "coming_soon") return "قريباً";
  if (product.availability === "out_of_stock") return "غير متوفر";
  return "متوفر";
}
