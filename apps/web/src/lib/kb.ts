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
 * Read the published knowledge base ("راهنما") for a page.
 *
 * A failure here must not take the page with it: every KB page renders an
 * empty state for an empty list, the same way `FaqSection` hides itself.
 */
export async function getKbContent(): Promise<readonly KbCategory[]> {
  try {
    const response = await api.get("/api/kb", kbListSchema);
    return response.categories;
  } catch {
    return [];
  }
}

export type FlattenedKbArticle = {
  readonly article: KbArticle;
  readonly category: KbCategory;
};

/** One flat list for search and for the "promoted articles" strip. */
export function flattenArticles(categories: readonly KbCategory[]): readonly FlattenedKbArticle[] {
  return categories.flatMap((category) => category.articles.map((article) => ({ article, category })));
}
