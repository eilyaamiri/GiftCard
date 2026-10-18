import { z } from "zod";
import { isoDateTimeSchema } from "@barat/contracts";

/**
 * Product reviews, as the API hands them back.
 *
 * Pinned here rather than in `packages/contracts`, like the other account
 * shapes in `lib/api.ts`. A drift in the API fails the parse instead of
 * rendering a half-read review.
 */

export type ReviewItemType = "PRODUCT" | "TOPUP_GAME" | "SERVICE";
export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Mirrors `REVIEW_BODY_MAX` in the API. */
export const REVIEW_BODY_MAX = 1_000;

export const reviewSummarySchema = z.object({
  average: z.number().min(1).max(5).nullable(),
  count: z.number().int().min(0),
  distribution: z.tuple([
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
  ]),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const publicReviewSchema = z.object({
  id: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  authorNameFa: z.string().min(1),
  isVerifiedBuyer: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

export const listReviewsResponseSchema = z.object({
  summary: reviewSummarySchema,
  items: z.array(publicReviewSchema),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(1),
});
export type ListReviewsResponse = z.infer<typeof listReviewsResponseSchema>;

export const myReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  isVerifiedBuyer: z.boolean(),
  updatedAt: isoDateTimeSchema,
});
export type MyReview = z.infer<typeof myReviewSchema>;

export const orderReviewTargetSchema = z.object({
  itemType: z.enum(["PRODUCT", "TOPUP_GAME", "SERVICE"]),
  itemSlug: z.string().min(1),
  titleFa: z.string().min(1),
  href: z.string().startsWith("/"),
  myReview: myReviewSchema.nullable(),
});
export type OrderReviewTarget = z.infer<typeof orderReviewTargetSchema>;

export interface SubmitReview {
  readonly itemType: ReviewItemType;
  readonly itemSlug: string;
  readonly rating: number;
  readonly body: string | null;
}

/** The hash that opens a product page's reviews tab. */
export const REVIEWS_HASH = "reviews";

export function reviewsQuery(itemType: ReviewItemType, itemSlug: string, page = 1): string {
  const params = new URLSearchParams({ itemType, itemSlug, page: String(page) });
  return params.toString();
}

/** What a customer sees about their own review's moderation, in one line. */
export function reviewStatusFa(status: ReviewStatus): string {
  if (status === "APPROVED") return "دیدگاه شما منتشر شده است.";
  if (status === "REJECTED") return "دیدگاه شما تأیید نشد. می‌توانید آن را ویرایش و دوباره ارسال کنید.";
  return "دیدگاه شما ثبت شد و پس از تأیید نمایش داده می‌شود.";
}
