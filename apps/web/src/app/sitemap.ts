import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/brand";
import { getKbContent } from "@/lib/kb";

/* The help articles are admin-edited, so the sitemap is built per request
 * rather than frozen at build time, when the API is not reachable. */
export const dynamic = "force-dynamic";

const STATIC_PATHS = [
  "/",
  "/gift-cards",
  "/games",
  "/steam",
  "/telegram",
  "/telegram/stars",
  "/telegram/premium",
  "/services",
  "/brands",
  "/help",
  "/business",
  "/cento-card",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const categories = await getKbContent();
  const help = categories.flatMap((category) => [
    `/help/${category.slug}`,
    ...category.articles.map((article) => `/help/${category.slug}/${article.slug}`),
  ]);
  return [...STATIC_PATHS, ...help].map((path) => ({ url: absoluteUrl(path) }));
}
