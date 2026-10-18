import { z } from 'zod';

/**
 * Product reviews: what a customer may send, and what the storefront may ask.
 *
 * Kept with the customers module rather than in `packages/contracts`, like the
 * favorites and bank-account shapes: the web app pins its own copy of the
 * responses (see `apps/web/src/lib/reviews.ts`).
 */

export const REVIEW_ITEM_TYPES = ['PRODUCT', 'TOPUP_GAME', 'SERVICE'] as const;
export type ReviewItemType = (typeof REVIEW_ITEM_TYPES)[number];

/** Long enough for a real opinion, short enough to moderate by reading it. */
export const REVIEW_BODY_MAX = 1_000;
export const REVIEWS_PAGE_SIZE = 10;

const reviewTargetShape = {
  itemType: z.enum(REVIEW_ITEM_TYPES),
  itemSlug: z.string().trim().min(1).max(160),
};

export const reviewTargetQuerySchema = z.object(reviewTargetShape);
export type ReviewTargetQuery = z.infer<typeof reviewTargetQuerySchema>;

export const listReviewsQuerySchema = z.object({
  ...reviewTargetShape,
  page: z.coerce.number().int().min(1).max(1_000).default(1),
});
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

/**
 * A rating is required; the comment is not. A blank comment is stored as null
 * so the storefront never renders an empty quote under someone's stars.
 */
export const submitReviewRequestSchema = z.object({
  ...reviewTargetShape,
  rating: z.number().int().min(1).max(5),
  body: z
    .string()
    .trim()
    .max(REVIEW_BODY_MAX)
    .nullable()
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
});
export type SubmitReviewRequest = z.infer<typeof submitReviewRequestSchema>;

/* ------------------------------------------------------------ moderation */

export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const ADMIN_REVIEWS_PAGE_SIZE = 20;

export const adminListReviewsQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).default('PENDING'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type AdminListReviewsQuery = z.infer<typeof adminListReviewsQuerySchema>;

export const reviewIdParamSchema = z.object({ id: z.string().trim().min(1).max(64) });
export type ReviewIdParam = z.infer<typeof reviewIdParamSchema>;

/**
 * The version of the review the moderator actually read. A customer can edit
 * while the queue is open; approving without this would publish text nobody
 * looked at, so a stale version is refused rather than applied.
 */
export const moderateReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
