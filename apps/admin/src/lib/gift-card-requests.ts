import { z } from "zod";

import { api } from "@/lib/api";

export const GIFT_CARD_REQUEST_ADMIN_ROLES = ["ADMIN", "MANAGEMENT", "OPS_MANAGER"] as const;

export const giftCardRequestSchema = z.object({
  id: z.string().min(1),
  requestNumber: z.string().min(1),
  workItemId: z.string().min(1),
  workItemCode: z.string().min(1),
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  kind: z.enum(["CODE", "CODE_PIN"]),
  status: z.enum(["OPEN", "FULFILLED", "CANCELLED"]),
  requestReason: z.string().nullable(),
  responseNote: z.string().nullable(),
  requestedByStaffId: z.string().min(1),
  requestedByStaffName: z.string(),
  fulfilledByStaffName: z.string().nullable(),
  giftCardAssetId: z.string().nullable(),
  maskedCode: z.string().nullable(),
  requestedAt: z.coerce.date(),
  fulfilledAt: z.coerce.date().nullable(),
});

const giftCardRequestsSchema = z.array(giftCardRequestSchema);
export type GiftCardRequest = z.infer<typeof giftCardRequestSchema>;
export type GiftCardRequestKind = GiftCardRequest["kind"];
export type GiftCardRequestStatus = GiftCardRequest["status"];

export const GIFT_CARD_REQUEST_KIND_LABEL: Record<GiftCardRequestKind, string> = {
  CODE: "فقط کد گیفت‌کارت",
  CODE_PIN: "کد گیفت‌کارت و پین",
};

export const GIFT_CARD_REQUEST_STATUS_LABEL: Record<GiftCardRequestStatus, string> = {
  OPEN: "در انتظار ادمین",
  FULFILLED: "کد آماده است",
  CANCELLED: "لغوشده",
};

export const giftCardRequests = {
  list: (status?: GiftCardRequestStatus) =>
    api.get<GiftCardRequest[]>(
      `/api/gift-card-requests${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      giftCardRequestsSchema,
    ),
  mine: () => api.get<GiftCardRequest[]>("/api/gift-card-requests/mine", giftCardRequestsSchema),
  create: (input: { workItemId: string; kind: GiftCardRequestKind; reason: string }) =>
    api.post<GiftCardRequest>("/api/gift-card-requests", input, giftCardRequestSchema),
  fulfill: (requestId: string, input: { code: string; pin?: string }) =>
    api.post<GiftCardRequest>(
      `/api/gift-card-requests/${encodeURIComponent(requestId)}/fulfill`,
      input,
      giftCardRequestSchema,
    ),
};
