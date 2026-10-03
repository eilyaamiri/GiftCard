import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/brand";

/* Indexable by design. Only the pages that are private to a signed-in
 * customer or mid-checkout are kept out, never the storefront itself. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/checkout", "/payment", "/quote", "/otp", "/api/"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
