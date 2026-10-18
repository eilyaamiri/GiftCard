import { z } from "zod";

/**
 * Per-product FAQs, as the API hands them back.
 *
 * The shape mirrors reviews.ts — a target (itemType + itemSlug) resolves to a
 * product, game or service on both the API and the storefront.
 */

export type FaqItemType = "PRODUCT" | "TOPUP_GAME" | "SERVICE";

/** Where the tab anchor lives; the page scrolls to it on `#faqs`. */
export const FAQS_HASH = "faqs";

export const productFaqSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
});
export type ProductFaq = z.infer<typeof productFaqSchema>;

export const listFaqsResponseSchema = z.array(productFaqSchema);
export type ListFaqsResponse = z.infer<typeof listFaqsResponseSchema>;
