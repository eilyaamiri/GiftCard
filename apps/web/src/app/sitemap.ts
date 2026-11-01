import type { MetadataRoute } from "next";
import { api } from "@/lib/api";
import { VISIBLE_BRAND_SLUGS, visibleBrandsQuery } from "@/lib/brand-art";
import { absoluteUrl } from "@/lib/brand";
import { catalogQueryString } from "@/lib/catalog";
import { INTERNATIONAL_PAYMENT_ENABLED, visibleCategoryLinks } from "@/lib/features";
import { isSteamEntry, isTelegramEntry, listGameTopUps } from "@/lib/game-topups";
import { getKbContent } from "@/lib/kb";
import { brandPath } from "@/lib/seo";
import { fetchAllPages } from "@/lib/paginate";

/* Built from the catalog and the help articles, which admins edit, so it is
 * assembled per request rather than frozen at build time, when the API is not
 * reachable. The result is kept for a few minutes: a crawler asks for it often,
 * and walking every product page by page should not hit the API each time. */
export const dynamic = "force-dynamic";

const CACHE_MS = 10 * 60 * 1000;
const PRODUCT_PAGE_SIZE = 100;

/* No `/business`, `/cento-card`, `/cash`, `/wallet` or `/transfer`: those are
 * «به‌زودی» placeholders, thin pages that should not be offered to a search
 * engine. They return to this list when they have real content. */
const STATIC_PATHS = [
  "/",
  "/gift-cards",
  "/games",
  "/steam",
  "/telegram",
  "/telegram/stars",
  "/telegram/premium",
  ...(INTERNATIONAL_PAYMENT_ENABLED ? ["/services"] : []),
  "/brands",
  "/help",
] as const;

/** One source failing leaves the rest of the sitemap standing. */
async function orEmpty(source: Promise<readonly string[]>): Promise<readonly string[]> {
  try {
    return await source;
  } catch {
    return [];
  }
}

async function productPaths(): Promise<readonly string[]> {
  const products = await fetchAllPages((page) =>
    api.products(
      catalogQueryString({ brandSlugs: VISIBLE_BRAND_SLUGS, page, pageSize: PRODUCT_PAGE_SIZE }),
    ),
  );
  /* A product flagged `needsReview` is listed in the catalog but cannot be
   * ordered; it is not worth sending a search engine to. */
  return products.filter((product) => !product.needsReview).map((product) => `/gift-cards/${encodeURIComponent(product.slug)}`);
}

async function brandPaths(): Promise<readonly string[]> {
  const { items } = await api.brands(visibleBrandsQuery());
  return items
    .filter((brand) => brand.productCount > 0)
    .map((brand) => brandPath(brand.slug));
}

async function categoryPaths(): Promise<readonly string[]> {
  const { items } = await api.categories(visibleBrandsQuery());
  return items.flatMap((category) => {
    if (category.kind === "SERVICES") {
      return visibleCategoryLinks(category.links).length > 0 ? [`/categories/${encodeURIComponent(category.slug)}`] : [];
    }
    return category.productCount > 0 ? [`/gift-cards?category=${encodeURIComponent(category.slug)}`] : [];
  });
}

async function gamePaths(): Promise<readonly string[]> {
  const games = await listGameTopUps();
  /* Steam and Telegram have their own pages; `/games/<slug>` redirects to them. */
  return games
    .filter((game) => !isTelegramEntry(game) && !isSteamEntry(game))
    .map((game) => `/games/${encodeURIComponent(game.slug)}`);
}

async function servicePaths(): Promise<readonly string[]> {
  if (!INTERNATIONAL_PAYMENT_ENABLED) return [];
  const services = await fetchAllPages((page) => api.services({ page, pageSize: PRODUCT_PAGE_SIZE }));
  return services.map((service) => `/services/${encodeURIComponent(service.slug)}`);
}

async function helpPaths(): Promise<readonly string[]> {
  const categories = await getKbContent();
  return categories.flatMap((category) => [
    `/help/${category.slug}`,
    ...category.articles.map((article) => `/help/${category.slug}/${article.slug}`),
  ]);
}

let cached: { readonly at: number; readonly entries: MetadataRoute.Sitemap } | null = null;

/* There is no `lastModified`: the catalog's DTOs carry only `createdAt`, and a
 * date that is not the last change is worse than none — search engines learn
 * to ignore a sitemap whose dates they cannot trust. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (cached !== null && Date.now() - cached.at < CACHE_MS) return cached.entries;
  const groups = await Promise.all([
    orEmpty(productPaths()),
    orEmpty(brandPaths()),
    orEmpty(categoryPaths()),
    orEmpty(gamePaths()),
    orEmpty(servicePaths()),
    orEmpty(helpPaths()),
  ]);
  const paths = [...new Set([...STATIC_PATHS, ...groups.flat()])];
  const entries = paths.map((path) => ({ url: absoluteUrl(path) }));
  /* Keep nothing from a run in which every source failed: that is an outage,
   * and it must not be served for the next ten minutes. */
  if (groups.some((group) => group.length > 0)) cached = { at: Date.now(), entries };
  return entries;
}
