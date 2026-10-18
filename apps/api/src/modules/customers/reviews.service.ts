import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import {
  REVIEWS_PAGE_SIZE,
  type ListReviewsQuery,
  type ReviewItemType,
  type ReviewTargetQuery,
  type SubmitReviewRequest,
} from './reviews.schemas';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReviewSummaryDto {
  /** One decimal, over APPROVED reviews only; null when there are none. */
  readonly average: number | null;
  readonly count: number;
  /** Approved reviews per star, index 0 = one star … index 4 = five stars. */
  readonly distribution: readonly [number, number, number, number, number];
}

export interface PublicReviewDto {
  readonly id: string;
  readonly rating: number;
  readonly body: string | null;
  /** «علی م.», never a full surname, a phone number or an e-mail. */
  readonly authorNameFa: string;
  readonly isVerifiedBuyer: boolean;
  readonly createdAt: string;
}

export interface ListReviewsResponse {
  readonly summary: ReviewSummaryDto;
  readonly items: readonly PublicReviewDto[];
  readonly page: number;
  readonly totalPages: number;
}

export interface MyReviewDto {
  readonly rating: number;
  readonly body: string | null;
  readonly status: ReviewStatus;
  readonly isVerifiedBuyer: boolean;
  readonly updatedAt: string;
}

export interface OrderReviewTargetDto {
  readonly itemType: ReviewItemType;
  readonly itemSlug: string;
  readonly titleFa: string;
  /** Storefront path of the product page; the reviews tab is `#reviews`. */
  readonly href: string;
  readonly myReview: MyReviewDto | null;
}

type TargetColumn = 'productId' | 'topUpGameId' | 'serviceId';

interface ResolvedTarget {
  readonly column: TargetColumn;
  readonly id: string;
}

/**
 * The paid order states. A refunded or cancelled order is deliberately absent:
 * the «خریدار» badge says the reviewer kept what they bought.
 */
const PURCHASED_ORDER_STATUSES = ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING', 'FULFILLED'] as const;

const ANONYMOUS_AUTHOR_FA = 'کاربر سنتو';

/**
 * Product reviews.
 *
 * Moderation is the whole design: every write lands as PENDING, an edit sends an
 * approved review back to PENDING, and the public read and the average only
 * ever see APPROVED rows. So a customer can never put text on the storefront by
 * themselves, and the star average cannot be moved by an unread review.
 */
@Injectable()
export class ReviewsService {
  constructor(@Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase) {}

  async listPublic(query: ListReviewsQuery): Promise<ListReviewsResponse> {
    const target = await this.resolveTarget(query);
    const approved: Prisma.ProductReviewWhereInput = { ...targetFields(target), status: 'APPROVED' };

    const [grouped, rows] = await Promise.all([
      this.database.productReview.groupBy({ by: ['rating'], where: approved, _count: { _all: true } }),
      this.database.productReview.findMany({
        where: approved,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * REVIEWS_PAGE_SIZE,
        take: REVIEWS_PAGE_SIZE,
        select: {
          id: true,
          rating: true,
          body: true,
          isVerifiedBuyer: true,
          createdAt: true,
          customer: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
      }),
    ]);

    const summary = summarise(grouped.map((group) => ({ rating: group.rating, count: group._count._all })));
    return {
      summary,
      items: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        body: row.body,
        authorNameFa: authorNameFa(row.customer.profile),
        isVerifiedBuyer: row.isVerifiedBuyer,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      totalPages: Math.max(1, Math.ceil(summary.count / REVIEWS_PAGE_SIZE)),
    };
  }

  async mine(customerId: string, query: ReviewTargetQuery): Promise<MyReviewDto | null> {
    const target = await this.resolveTarget(query);
    const row = await this.database.productReview.findUnique({
      where: uniqueKey(customerId, target),
      select: { rating: true, body: true, status: true, isVerifiedBuyer: true, updatedAt: true },
    });
    return row === null ? null : toMyReview(row);
  }

  /**
   * Creates the customer's review of the target, or replaces it. Either way the
   * result is PENDING: an edit to an approved review has not been read yet, so
   * it comes off the storefront until it has.
   */
  async submit(customerId: string, input: SubmitReviewRequest): Promise<MyReviewDto> {
    const target = await this.resolveTarget(input);
    const isVerifiedBuyer = await this.hasPurchased(customerId, target);
    const fields = {
      rating: input.rating,
      body: input.body,
      status: 'PENDING' as const,
      isVerifiedBuyer,
      moderatedAt: null,
      moderatedById: null,
    };

    /* One statement on the (customer, target) unique key, so a double-click
     * cannot race a find-then-create into a duplicate-key error. */
    const row = await this.database.productReview.upsert({
      where: uniqueKey(customerId, target),
      create: { customerId, ...targetFields(target), ...fields },
      update: fields,
      select: { rating: true, body: true, status: true, isVerifiedBuyer: true, updatedAt: true },
    });
    return toMyReview(row);
  }

  /**
   * What to invite a review of from an order page: only a delivered order, only
   * the customer's own, and only while the product is still on sale. Anything
   * else is null rather than an error — the page simply shows no prompt.
   */
  async forOrder(customerId: string, orderNumber: string): Promise<OrderReviewTargetDto | null> {
    const order = await this.database.order.findFirst({
      where: { orderNumber, customerId, status: 'FULFILLED' },
      select: {
        quote: {
          select: {
            serviceId: true,
            sku: { select: { product: { select: { slug: true, titleFa: true, isActive: true } } } },
            topUpOffer: { select: { game: { select: { slug: true, nameFa: true, name: true } } } },
            service: { select: { slug: true, nameFa: true, isActive: true } },
          },
        },
      },
    });
    if (order === null) return null;

    const { quote } = order;
    let query: ReviewTargetQuery;
    let titleFa: string;
    let href: string;
    if (quote.sku !== null) {
      if (!quote.sku.product.isActive) return null;
      query = { itemType: 'PRODUCT', itemSlug: quote.sku.product.slug };
      titleFa = quote.sku.product.titleFa;
      href = `/gift-cards/${quote.sku.product.slug}`;
    } else if (quote.topUpOffer !== null) {
      const game = quote.topUpOffer.game;
      query = { itemType: 'TOPUP_GAME', itemSlug: game.slug };
      titleFa = game.nameFa ?? game.name;
      href = `/games/${game.slug}`;
    } else if (quote.service !== null) {
      if (!quote.service.isActive) return null;
      query = { itemType: 'SERVICE', itemSlug: quote.service.slug };
      titleFa = quote.service.nameFa;
      href = `/services/${quote.service.slug}`;
    } else {
      return null;
    }

    let myReview: MyReviewDto | null;
    try {
      myReview = await this.mine(customerId, query);
    } catch {
      /* The product left sale since the order: nothing to review any more. */
      return null;
    }
    return { ...query, titleFa, href, myReview };
  }

  /** Slug to id, and only for something a customer could open and buy today. */
  private async resolveTarget(query: ReviewTargetQuery): Promise<ResolvedTarget> {
    const { itemType, itemSlug } = query;
    if (itemType === 'PRODUCT') {
      const row = await this.database.product.findFirst({
        where: { slug: itemSlug, isActive: true },
        select: { id: true },
      });
      if (row === null) throw DomainErrors.notFound('product');
      return { column: 'productId', id: row.id };
    }
    if (itemType === 'TOPUP_GAME') {
      /* The same visibility rule as the storefront's game page. */
      const row = await this.database.topUpGame.findFirst({
        where: {
          slug: itemSlug,
          isActive: true,
          isListed: true,
          requiresCredentials: false,
          supplier: { isActive: true },
        },
        select: { id: true },
      });
      if (row === null) throw DomainErrors.notFound('top-up game');
      return { column: 'topUpGameId', id: row.id };
    }
    const row = await this.database.internationalService.findFirst({
      where: { slug: itemSlug, isActive: true },
      select: { id: true },
    });
    if (row === null) throw DomainErrors.notFound('service');
    return { column: 'serviceId', id: row.id };
  }

  private async hasPurchased(customerId: string, target: ResolvedTarget): Promise<boolean> {
    const quote: Prisma.QuoteWhereInput =
      target.column === 'productId'
        ? { sku: { productId: target.id } }
        : target.column === 'topUpGameId'
          ? { topUpOffer: { gameId: target.id } }
          : { serviceId: target.id };
    const count = await this.database.order.count({
      where: { customerId, status: { in: [...PURCHASED_ORDER_STATUSES] }, quote },
    });
    return count > 0;
  }
}

/** The target as Prisma column values: exactly one of the three, as the CHECK demands. */
function targetFields(
  target: ResolvedTarget,
): { productId: string } | { topUpGameId: string } | { serviceId: string } {
  if (target.column === 'productId') return { productId: target.id };
  if (target.column === 'topUpGameId') return { topUpGameId: target.id };
  return { serviceId: target.id };
}

/** The (customer, target) unique key, one per target kind. */
function uniqueKey(customerId: string, target: ResolvedTarget): Prisma.ProductReviewWhereUniqueInput {
  if (target.column === 'productId') {
    return { customerId_productId: { customerId, productId: target.id } };
  }
  if (target.column === 'topUpGameId') {
    return { customerId_topUpGameId: { customerId, topUpGameId: target.id } };
  }
  return { customerId_serviceId: { customerId, serviceId: target.id } };
}

/** Exported for tests: the average is over approved rows only, to one decimal. */
export function summarise(groups: ReadonlyArray<{ rating: number; count: number }>): ReviewSummaryDto {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let count = 0;
  let total = 0;
  for (const { rating, count: n } of groups) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    distribution[rating - 1] += n;
    count += n;
    total += rating * n;
  }
  return {
    average: count === 0 ? null : Math.round((total / count) * 10) / 10,
    count,
    distribution,
  };
}

/**
 * «علی م.» — first name and a surname initial, the way review sites show a
 * person without publishing who they are. Nothing else from the account ever
 * leaves: no phone, no e-mail, no customer code.
 */
export function authorNameFa(
  profile: { firstName: string | null; lastName: string | null } | null,
): string {
  const first = profile?.firstName?.trim() ?? '';
  const last = profile?.lastName?.trim() ?? '';
  if (first === '') return ANONYMOUS_AUTHOR_FA;
  const initial = [...last][0];
  return initial === undefined ? first : `${first} ${initial}.`;
}

function toMyReview(row: {
  rating: number;
  body: string | null;
  status: ReviewStatus;
  isVerifiedBuyer: boolean;
  updatedAt: Date;
}): MyReviewDto {
  return {
    rating: row.rating,
    body: row.body,
    status: row.status,
    isVerifiedBuyer: row.isVerifiedBuyer,
    updatedAt: row.updatedAt.toISOString(),
  };
}
