import { z } from "zod";
import { api } from "./api";

/** Kept in lockstep with `KB_ICON_KEYS` in the API's `kb.schemas.ts`. */
export const KB_ICON_KEYS = ["book-open", "credit-card", "gift", "life-buoy"] as const;
export type KbIconKey = (typeof KB_ICON_KEYS)[number];

export type KbArticle = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly isPromoted: boolean;
};

export type KbCategory = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly icon: KbIconKey;
  readonly articles: readonly KbArticle[];
};

const kbArticleSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string(),
  content: z.string().min(1),
  isPromoted: z.boolean(),
});
const kbCategorySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  icon: z.enum(KB_ICON_KEYS),
  articles: z.array(kbArticleSchema),
});
const kbListSchema = z.object({ categories: z.array(kbCategorySchema) });

/**
 * A category that holds site copy rather than help articles. Staff edit it in
 * the same KB panel, but it never shows up under `/help` or in the sitemap:
 * `getKbContent` drops it, and only the home page reads it back.
 */
export const SITE_CONTENT_CATEGORY_SLUG = "site-content";
/** The article inside that category rendered as the home page's text section. */
export const HOME_INTRO_ARTICLE_SLUG = "home-intro";
/** The text under the gift-card catalogue and the games shelf (unfiltered view). */
export const GIFT_CARDS_PAGE_ARTICLE_SLUG = "gift-cards-page";
export const GAMES_PAGE_ARTICLE_SLUG = "games-page";

/** The article shown under a service-list category page, keyed by its slug. */
export function categoryArticleSlug(categorySlug: string): string {
  return `category-${categorySlug}`;
}

export type SiteArticle = {
  readonly title: string;
  readonly content: string;
};

/** The help centre's own categories: everything except the site-copy one. */
export function withoutSiteContent(categories: readonly KbCategory[]): readonly KbCategory[] {
  return categories.filter((category) => category.slug !== SITE_CONTENT_CATEGORY_SLUG);
}

/** A page's text from the site-copy category, or null when it has not been written. */
export function findSiteArticle(categories: readonly KbCategory[], articleSlug: string): SiteArticle | null {
  const category = categories.find((item) => item.slug === SITE_CONTENT_CATEGORY_SLUG);
  const article = category?.articles.find((item) => item.slug === articleSlug);
  return article === undefined ? null : { title: article.title, content: article.content };
}

async function fetchKbCategories(): Promise<readonly KbCategory[]> {
  try {
    const response = await api.get("/api/kb", kbListSchema);
    return response.categories;
  } catch {
    return [];
  }
}

/**
 * Read the published knowledge base ("راهنما") for a page.
 *
 * A failure here must not take the page with it: every KB page renders an
 * empty state for an empty list, the same way `FaqSection` hides itself.
 */
export async function getKbContent(): Promise<readonly KbCategory[]> {
  return withoutSiteContent(await fetchKbCategories());
}

/** Same fail-open rule: no article, or an API error, simply hides the section. */
export async function getSiteArticle(articleSlug: string): Promise<SiteArticle | null> {
  return findSiteArticle(await fetchKbCategories(), articleSlug);
}

export type FlattenedKbArticle = {
  readonly article: KbArticle;
  readonly category: KbCategory;
};

/** One flat list for search and for the "promoted articles" strip. */
export function flattenArticles(categories: readonly KbCategory[]): readonly FlattenedKbArticle[] {
  return categories.flatMap((category) => category.articles.map((article) => ({ article, category })));
}
