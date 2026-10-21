import { cache } from "react";
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

export async function browsePublicProducts(input: { categoryId?: string } = {}): Promise<PublicCatalogBrowseDto> {
  const params = new URLSearchParams();
  if (input.categoryId) params.set("categoryId", input.categoryId);
  const suffix = params.toString();
  return getJson<PublicCatalogBrowseDto>(`${apiOrigin}/api/public/storefront/catalog${suffix ? `?${suffix}` : ""}`, "The products could not be loaded right now.");
}

export async function getPublicProduct(productId: string): Promise<PublicProductDto | null> {
  const response = await fetch(
    `${apiOrigin}/api/public/catalog/products/${encodeURIComponent(productId)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("This product could not be loaded right now.");
  return response.json() as Promise<PublicProductDto>;
}

// Stall cap for this optional request only. Not a measured contact-API latency.
const CONTACT_STALL_MS = 10_000;

const CONTACT_URL_KEYS = ["whatsappUrl", "facebookUrl", "instagramUrl", "tiktokUrl"] as const;

function contactsFromBody(body: unknown): PublicStorefrontContactsDto | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const contacts: PublicStorefrontContactsDto = { ...EMPTY_CONTACTS };
  for (const key of CONTACT_URL_KEYS) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") return null;
    contacts[key] = value;
  }
  return contacts;
}

// Request-scoped dedupe so the footer slot and /contact share one read.
export const getPublicContacts = cache(async function getPublicContacts(): Promise<PublicStorefrontContactsDto> {
  try {
    const response = await fetch(`${apiOrigin}/api/public/storefront/contacts`, {
      cache: "no-store",
      signal: AbortSignal.timeout(CONTACT_STALL_MS),
    });
    if (!response.ok) return EMPTY_CONTACTS;
    return contactsFromBody(await response.json()) ?? EMPTY_CONTACTS;
  } catch {
    return EMPTY_CONTACTS;
  }
});

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
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: "EGP",
    currencyDisplay: "code",
    minimumFractionDigits: piasters % 100 === 0 ? 0 : 2,
  }).format(piasters / 100);
}

export function availabilityLabel(product: { availability: PublicProductDto["availability"] }): string {
  if (product.availability === "coming_soon") return "Coming soon";
  if (product.availability === "out_of_stock") return "Out of stock";
  return "In stock";
}
