import type { Metadata } from "next";
import type { PublicProductDto } from "@bravos/contracts/public";
import { availabilityLabel, formatEgp, productMediaUrl } from "./public-catalog";

export const STORE_NAME = "Bravos";
export const STORE_TITLE = "Bravos | Menswear";
export const STORE_DESCRIPTION = "Bravos menswear in Fayoum";
export const SITE_SHARE_IMAGE_PATH = "/brand/cover.jpg";

const PUBLIC_ORIGIN_ENV = "BRAVOS_PUBLIC_ORIGIN";

// Canonical and sitemap URLs use this env when it is a valid origin. There is no localhost or purchased-domain default.
export function configuredPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[PUBLIC_ORIGIN_ENV];
  if (value === undefined || value.trim() === "") return null;
  const production = (env.NODE_ENV ?? "development") === "production";
  if (production) {
    if (!isCanonicalHttpsOrigin(value)) return null;
    return isLoopbackHostname(new URL(value).hostname) ? null : value;
  }
  return isCanonicalOrigin(value) ? value : null;
}

export function publicPageUrl(path: string, origin = configuredPublicOrigin()): string | null {
  if (!origin) return null;
  if (path === "/") return origin;
  if (!path.startsWith("/")) return null;
  return `${origin}${path}`;
}

export function publicAssetUrl(path: string, origin = configuredPublicOrigin()): string | null {
  if (!origin || !path.startsWith("/")) return null;
  return `${origin}${path}`;
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function rootMetadata(env: NodeJS.ProcessEnv = process.env): Metadata {
  const origin = configuredPublicOrigin(env);
  const image = publicAssetUrl(SITE_SHARE_IMAGE_PATH, origin);
  return {
    metadataBase: origin ? new URL(origin) : null,
    title: { default: STORE_TITLE, template: `%s | ${STORE_NAME}` },
    description: STORE_DESCRIPTION,
    applicationName: STORE_NAME,
    icons: { icon: "/favicon.svg" },
    openGraph: {
      type: "website",
      locale: "en",
      siteName: STORE_NAME,
      title: STORE_TITLE,
      description: STORE_DESCRIPTION,
      ...(origin ? { url: origin } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: STORE_TITLE,
      description: STORE_DESCRIPTION,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export function homePageMetadata(): Metadata {
  return pageMetadata({
    title: { absolute: STORE_TITLE },
    description: STORE_DESCRIPTION,
    path: "/",
    imagePath: SITE_SHARE_IMAGE_PATH,
  });
}

export function collectionPageMetadata(title: string, path: string): Metadata {
  return pageMetadata({
    title,
    description: `${title}. ${STORE_DESCRIPTION}.`,
    path,
    imagePath: SITE_SHARE_IMAGE_PATH,
  });
}

export function informationPageMetadata(page: "shipping" | "returns" | "contact"): Metadata {
  const copy = INFORMATION_PAGES[page];
  return pageMetadata({
    title: copy.title,
    description: copy.description,
    path: copy.path,
    imagePath: SITE_SHARE_IMAGE_PATH,
  });
}

export function productPageMetadata(product: PublicProductDto, origin = configuredPublicOrigin()): Metadata {
  const path = `/products/${product.id}`;
  const imagePath = product.imageRefs[0] ? productMediaUrl(product.imageRefs[0]) : null;
  const description = productShareDescription(product);
  const title = product.nameAr;
  return pageMetadata({
    title,
    description,
    path,
    imagePath,
    origin,
    openGraphTitle: `${title} | ${STORE_NAME}`,
  });
}

export function productStructuredData(product: PublicProductDto, origin = configuredPublicOrigin()): Record<string, unknown> {
  const url = publicPageUrl(`/products/${product.id}`, origin);
  const image = product.imageRefs[0] ? publicAssetUrl(productMediaUrl(product.imageRefs[0]), origin) : null;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.nameAr,
    category: product.category.nameAr,
    brand: { "@type": "Brand", name: STORE_NAME },
  };
  const description = product.descriptionAr.trim();
  if (description) data.description = description;
  if (image) data.image = image;
  if (url) data.url = url;
  if (product.availability !== "coming_soon" && product.variants.length > 0) {
    data.offers = product.variants.map((variant) => {
      const offer: Record<string, unknown> = {
        "@type": "Offer",
        name: `${variant.color.nameAr} / ${variant.size.nameAr}`,
        price: (variant.sellingPricePiasters / 100).toFixed(2),
        priceCurrency: "EGP",
        availability: variant.orderable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      };
      if (url) offer.url = url;
      return offer;
    });
  }
  return data;
}

export function sitemapUrls(origin: string, productIds: readonly string[]): string[] {
  return [
    origin,
    `${origin}/shipping`,
    `${origin}/returns`,
    `${origin}/contact`,
    ...productIds.map((id) => `${origin}/products/${id}`),
  ];
}

const INFORMATION_PAGES = {
  shipping: {
    title: "Shipping",
    path: "/shipping",
    description: "Pay on delivery. Your reviewed checkout total includes the delivery fee for your selected area. An order request does not reserve the items.",
  },
  returns: {
    title: "Returns",
    path: "/returns",
    description: "Contact Bravos within 14 days of receiving your items. In-store, that period starts when the sale is completed; online, it starts on delivery.",
  },
  contact: {
    title: "Contact",
    path: "/contact",
    description: "No account is needed to shop. After you place an order request, our team confirms it on WhatsApp.",
  },
} as const;

function pageMetadata(input: {
  title: string | { absolute: string };
  description: string;
  path: string;
  imagePath?: string | null;
  origin?: string | null;
  openGraphTitle?: string;
}): Metadata {
  const origin = input.origin === undefined ? configuredPublicOrigin() : input.origin;
  const url = publicPageUrl(input.path, origin);
  const image = input.imagePath ? publicAssetUrl(input.imagePath, origin) : null;
  const titleString = typeof input.title === "string" ? input.title : input.title.absolute;
  const openGraphTitle = input.openGraphTitle
    ?? (typeof input.title === "string" ? `${input.title} | ${STORE_NAME}` : titleString);
  return {
    title: input.title,
    description: input.description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: "website",
      locale: "en",
      siteName: STORE_NAME,
      title: openGraphTitle,
      description: input.description,
      ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: openGraphTitle,
      description: input.description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

function productShareDescription(product: PublicProductDto): string {
  const status = availabilityLabel(product);
  const text = product.descriptionAr.trim();
  const intro = text || `${product.nameAr}. ${product.category.nameAr}.`;
  const price = product.availability === "coming_soon" ? "" : productPricePhrase(product);
  return [intro, `${status}.`, price].filter(Boolean).join(" ");
}

function productPricePhrase(product: PublicProductDto): string {
  const source = product.orderable
    ? product.variants.filter((variant) => variant.orderable)
    : product.variants;
  const prices = [...new Set(source.map((variant) => variant.sellingPricePiasters))].sort((left, right) => left - right);
  if (prices.length === 0) return "";
  const lowest = prices[0];
  if (lowest === undefined) return "";
  if (prices.length === 1) return `${formatEgp(lowest)}.`;
  return `From ${formatEgp(lowest)}.`;
}

function isCanonicalHttpsOrigin(value: string): boolean {
  return isCanonicalOrigin(value, "https:");
}

function isCanonicalOrigin(value: string, protocol?: "http:" | "https:"): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const protocolOk = protocol ? parsed.protocol === protocol : parsed.protocol === "http:" || parsed.protocol === "https:";
  return protocolOk
    && parsed.username === ""
    && parsed.password === ""
    && parsed.pathname === "/"
    && parsed.search === ""
    && parsed.hash === ""
    && parsed.hostname !== ""
    && !parsed.hostname.includes("*")
    && value === parsed.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}
