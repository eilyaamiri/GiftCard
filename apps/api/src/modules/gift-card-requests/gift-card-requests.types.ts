import type { Prisma, PrismaClient } from '@barat/database';

export const GIFT_CARD_REQUESTS_DATABASE = Symbol('GIFT_CARD_REQUESTS_DATABASE');

export type GiftCardRequestsDatabase = Pick<
  PrismaClient,
  'giftCardCodeRequest' | 'workItem' | 'giftCardAsset' | 'order' | '$transaction'
>;

export type GiftCardRequestStatus = 'OPEN' | 'FULFILLED' | 'CANCELLED';
export type GiftCardRequestKind = 'CODE' | 'CODE_PIN';

export const GIFT_CARD_REQUEST_INCLUDE = {
  workItem: { select: { code: true } },
  order: { select: { orderNumber: true } },
  requestedBy: { select: { fullName: true } },
  fulfilledBy: { select: { fullName: true } },
  giftCardAsset: { select: { id: true, maskedCode: true } },
} satisfies Prisma.GiftCardCodeRequestInclude;

export type GiftCardRequestRow = Prisma.GiftCardCodeRequestGetPayload<{
  include: typeof GIFT_CARD_REQUEST_INCLUDE;
}>;

export interface GiftCardRequestView {
  readonly id: string;
  readonly requestNumber: string;
  readonly workItemId: string;
  readonly workItemCode: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly kind: GiftCardRequestKind;
  readonly status: GiftCardRequestStatus;
  readonly requestReason: string | null;
  readonly responseNote: string | null;
  readonly requestedByStaffId: string;
  readonly requestedByStaffName: string;
  readonly fulfilledByStaffName: string | null;
  readonly giftCardAssetId: string | null;
  readonly maskedCode: string | null;
  readonly requestedAt: Date;
  readonly fulfilledAt: Date | null;
}
