import type { MetadataRoute } from "next";
import { browsePublicProducts } from "./public-catalog";
import { configuredPublicOrigin, sitemapUrls } from "./storefront-metadata";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = configuredPublicOrigin();
  if (!origin) return [];
  let productIds: string[] = [];
  try {
    const catalog = await browsePublicProducts({});
    productIds = catalog.products.map((product) => product.id);
  } catch {
    productIds = [];
  }
  return sitemapUrls(origin, productIds).map((url) => ({ url }));
}
