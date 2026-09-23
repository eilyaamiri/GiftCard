/**
 * The brands the storefront is willing to show.
 *
 * Having cover art is what makes a brand presentable, so one list decides two
 * things: which cover a card draws, and whether the card appears at all. They
 * are the same question — a brand we have no art for is one the catalog is not
 * ready to show — and keeping them in one place is what stops a brand from
 * being listed with no picture, or pictured but unreachable.
 *
 * Each entry is a slug, and the file is always `/brand-art/<slug>.webp` — a
 * naming rule rather than a second column, so the list and the assets cannot
 * drift apart.
 */
const BRAND_ART: ReadonlySet<string> = new Set([
  "airbnb",
  "amazon",
  "apple",
  "blizzard",
  "fortnite",
  "free-fire",
  "google-play",
  "hotels-com",
  "jawaker",
  "netflix",
  "nike",
  "nintendo",
  "playstation",
  "pubg",
  "razer-gold",
  "roblox",
  "shein",
  "spotify",
  "steam",
  "tinder",
  "twitch",
  "uber",
  "xbox",
  "zara",
]);

/**
 * The key a brand's artwork and palette are filed under.
 *
 * Supplier feeds spell one brand several ways — "NetFlix" and "Netflix",
 * "Google play" and "Google Play" — so this follows the API's own `brandSlug`,
 * which is the key the brand filter already joins on. Products whose brand the
 * importer could not resolve have no slug; they fall back to the display name
 * put through the same normalisation, which is how `packages/database`'s
 * `brandSlug` derived the slug in the first place.
 */
export function brandKey(brand: string, brandSlug: string | null | undefined): string {
  return (brandSlug ?? brand)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function hasBrandArt(key: string): boolean {
  return BRAND_ART.has(key);
}

/**
 * The value every storefront catalog read is scoped by.
 *
 * The policy lives here rather than in the API: the API still holds the whole
 * catalog and will still serve any of it, and the storefront says which part of
 * it it is prepared to put on a shelf. That keeps this a display decision — one
 * revert away from showing everything again — instead of an edit to the data.
 *
 * Sorted so the query string is stable, which keeps it cacheable and keeps a
 * diff of this list readable.
 */
export const VISIBLE_BRAND_SLUGS: readonly string[] = [...BRAND_ART].sort();

/** The scope as a query string, for the catalog reads that take no other filter. */
export function visibleBrandsQuery(): string {
  return `brandSlugs=${VISIBLE_BRAND_SLUGS.join(",")}`;
}
