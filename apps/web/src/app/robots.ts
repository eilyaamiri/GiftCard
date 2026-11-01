import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/brand";

/* Indexable by design. Only the pages that are private to a signed-in
 * customer or mid-checkout are kept out, never the storefront itself.
 *
 * `/orders` and `/login` are private and have nothing to offer a search engine.
 * `/search` and the «به‌زودی» pages are NOT listed here on purpose: they carry
 * a `noindex` tag, and a crawler that is forbidden to fetch a page never sees
 * it — the URL could then stay in the index with no content. They have to be
 * crawlable to be dropped. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/account", "/checkout", "/payment", "/quote", "/otp", "/orders", "/login", "/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl(),
  };
}
