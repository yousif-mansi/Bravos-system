import type { PublicProductDto } from "@bravos/contracts/public";

const apiOrigin = process.env.BRAVOS_API_ORIGIN ?? "http://127.0.0.1:3010";

export async function listPublicProducts(): Promise<PublicProductDto[]> {
  const response = await fetch(`${apiOrigin}/api/public/catalog/products`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("تعذر تحميل المنتجات حالياً.");
  }
  return response.json() as Promise<PublicProductDto[]>;
}

export async function getPublicProduct(productId: string): Promise<PublicProductDto | null> {
  const response = await fetch(
    `${apiOrigin}/api/public/catalog/products/${encodeURIComponent(productId)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("تعذر تحميل المنتج حالياً.");
  }
  return response.json() as Promise<PublicProductDto>;
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

export function availabilityLabel(product: PublicProductDto): string {
  if (product.availability === "coming_soon") return "قريباً";
  if (product.availability === "out_of_stock") return "غير متوفر";
  return "متوفر";
}
