import type { MetadataRoute } from "next";
import { configuredPublicOrigin } from "./storefront-metadata";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = configuredPublicOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/cart", "/checkout"],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
