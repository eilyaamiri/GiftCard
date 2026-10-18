import { z } from "zod";

import { api } from "@/lib/api";

/** Mirrors `@Roles` on `/api/admin/reviews`. */
export const REVIEW_MODERATION_ROLES = ["ADMIN", "OPS_MANAGER", "SUPPORT"] as const;

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: "در انتظار بررسی",
  APPROVED: "منتشرشده",
  REJECTED: "ردشده",
};

export const REVIEW_ITEM_TYPE_LABEL = {
  PRODUCT: "گیفت‌کارت",
  TOPUP_GAME: "شارژ بازی",
  SERVICE: "پرداخت بین‌المللی",
} as const;

export const adminReviewSchema = z.object({
  id: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  body: z.string().nullable(),
  status: z.enum(REVIEW_STATUSES),
  isVerifiedBuyer: z.boolean(),
  authorNameFa: z.string().min(1),
  customerCode: z.string().min(1),
  target: z
    .object({
      itemType: z.enum(["PRODUCT", "TOPUP_GAME", "SERVICE"]),
      titleFa: z.string().min(1),
      href: z.string().startsWith("/"),
    })
    .nullable(),
  createdAt: z.string().min(1),
  /** Sent back with a decision, so only the version that was read gets decided. */
  updatedAt: z.string().min(1),
  moderatedAt: z.string().nullable(),
  moderatedByName: z.string().nullable(),
});
export type AdminReview = z.infer<typeof adminReviewSchema>;

const adminReviewListSchema = z.object({
  items: z.array(adminReviewSchema),
  counts: z.object({ PENDING: z.number().int(), APPROVED: z.number().int(), REJECTED: z.number().int() }),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(1),
});
export type AdminReviewList = z.infer<typeof adminReviewListSchema>;

export const reviewModeration = {
  list: (status: ReviewStatus, page = 1) =>
    api.get<AdminReviewList>(
      `/api/admin/reviews?${new URLSearchParams({ status, page: String(page) }).toString()}`,
      adminReviewListSchema,
    ),
  decide: (id: string, decision: "APPROVED" | "REJECTED", expectedUpdatedAt: string) =>
    api.post<{ status: ReviewStatus }>(
      `/api/admin/reviews/${encodeURIComponent(id)}/decision`,
      { decision, expectedUpdatedAt },
      z.object({ status: z.enum(REVIEW_STATUSES) }),
    ),
};

export function isReviewStatus(value: string | undefined): value is ReviewStatus {
  return value !== undefined && (REVIEW_STATUSES as readonly string[]).includes(value);
}
