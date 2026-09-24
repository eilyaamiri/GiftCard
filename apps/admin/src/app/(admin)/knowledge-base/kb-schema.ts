import { z } from "zod";
import { isoDateTimeSchema } from "@barat/contracts";

/** Kept in lockstep with `KB_ICON_KEYS` in the API's `kb.schemas.ts`. */
export const KB_ICON_KEYS = ["book-open", "credit-card", "gift", "life-buoy"] as const;
export type KbIconKey = (typeof KB_ICON_KEYS)[number];

export const kbArticleSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  isEnabled: z.boolean(),
  isPromoted: z.boolean(),
  sortOrder: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
});
export type KbArticle = z.infer<typeof kbArticleSchema>;

export const kbCategorySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string(),
  description: z.string(),
  icon: z.enum(KB_ICON_KEYS),
  isEnabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
  articles: z.array(kbArticleSchema),
});
export type KbCategory = z.infer<typeof kbCategorySchema>;

export const kbListSchema = z.object({ categories: z.array(kbCategorySchema) });
export const kbCategoryMutationSchema = z.object({ category: kbCategorySchema });
export const kbArticleMutationSchema = z.object({ article: kbArticleSchema });
export const kbDeleteSchema = z.object({ id: z.string().min(1) });
