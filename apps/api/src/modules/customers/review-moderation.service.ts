import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import {
  ADMIN_REVIEWS_PAGE_SIZE,
  REVIEW_STATUSES,
  type AdminListReviewsQuery,
  type ModerateReviewInput,
  type ReviewItemType,
} from './reviews.schemas';
import { authorNameFa, type ReviewStatus } from './reviews.service';

export const REVIEW_APPROVED_AUDIT_ACTION = 'REVIEW_APPROVED';
export const REVIEW_REJECTED_AUDIT_ACTION = 'REVIEW_REJECTED';

export interface AdminReviewDto {
  readonly id: string;
  readonly rating: number;
  readonly body: string | null;
  readonly status: ReviewStatus;
  readonly isVerifiedBuyer: boolean;
  /** Exactly as the storefront would print it, so the moderator sees the real thing. */
  readonly authorNameFa: string;
  /** For the moderator to look the customer up, never shown publicly. */
  readonly customerCode: string;
  readonly target: { readonly itemType: ReviewItemType; readonly titleFa: string; readonly href: string } | null;
  readonly createdAt: string;
  /** Send this back with a decision; see `moderateReviewSchema`. */
  readonly updatedAt: string;
  readonly moderatedAt: string | null;
  readonly moderatedByName: string | null;
}

export interface AdminReviewListDto {
  readonly items: readonly AdminReviewDto[];
  readonly counts: Readonly<Record<ReviewStatus, number>>;
  readonly page: number;
  readonly totalPages: number;
}

interface ModerationActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

/**
 * The moderation queue behind the storefront's reviews.
 *
 * Pending reviews come oldest first, so nothing waits indefinitely behind newer
 * ones; decided reviews come most recent decision first. Any decision can be
 * reversed — an approved review can be taken down — and every one is audited.
 */
@Injectable()
export class ReviewModerationService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(query: AdminListReviewsQuery): Promise<AdminReviewListDto> {
    const where: Prisma.ProductReviewWhereInput = { status: query.status };
    const orderBy: Prisma.ProductReviewOrderByWithRelationInput[] =
      query.status === 'PENDING'
        ? [{ updatedAt: 'asc' }, { id: 'asc' }]
        : [{ moderatedAt: 'desc' }, { id: 'desc' }];

    const [grouped, rows] = await Promise.all([
      this.database.productReview.groupBy({ by: ['status'], _count: { _all: true } }),
      this.database.productReview.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * ADMIN_REVIEWS_PAGE_SIZE,
        take: ADMIN_REVIEWS_PAGE_SIZE,
        select: {
          id: true,
          rating: true,
          body: true,
          status: true,
          isVerifiedBuyer: true,
          createdAt: true,
          updatedAt: true,
          moderatedAt: true,
          moderatedById: true,
          customer: {
            select: { customerCode: true, profile: { select: { firstName: true, lastName: true } } },
          },
          product: { select: { slug: true, titleFa: true } },
          topUpGame: { select: { slug: true, nameFa: true, name: true } },
          service: { select: { slug: true, nameFa: true } },
        },
      }),
    ]);

    const counts = Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0])) as Record<ReviewStatus, number>;
    for (const group of grouped) counts[group.status] = group._count._all;

    const staffIds = [...new Set(rows.flatMap((row) => (row.moderatedById === null ? [] : [row.moderatedById])))];
    const staff =
      staffIds.length === 0
        ? []
        : await this.database.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } });
    const staffName = new Map(staff.map((member) => [member.id, member.fullName]));

    return {
      items: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        body: row.body,
        status: row.status,
        isVerifiedBuyer: row.isVerifiedBuyer,
        authorNameFa: authorNameFa(row.customer.profile),
        customerCode: row.customer.customerCode,
        target: row.product
          ? { itemType: 'PRODUCT', titleFa: row.product.titleFa, href: `/gift-cards/${row.product.slug}` }
          : row.topUpGame
            ? { itemType: 'TOPUP_GAME', titleFa: row.topUpGame.nameFa ?? row.topUpGame.name, href: `/games/${row.topUpGame.slug}` }
            : row.service
              ? { itemType: 'SERVICE', titleFa: row.service.nameFa, href: `/services/${row.service.slug}` }
              : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        moderatedAt: row.moderatedAt?.toISOString() ?? null,
        moderatedByName: row.moderatedById === null ? null : (staffName.get(row.moderatedById) ?? null),
      })),
      counts,
      page: query.page,
      totalPages: Math.max(1, Math.ceil(counts[query.status] / ADMIN_REVIEWS_PAGE_SIZE)),
    };
  }

  /**
   * Approve or reject exactly the version the moderator read. The update is
   * conditional on `updatedAt`, so a customer edit that landed after the queue
   * was loaded makes this a conflict instead of publishing unread text.
   */
  async moderate(id: string, input: ModerateReviewInput, actor: ModerationActor): Promise<{ status: ReviewStatus }> {
    const current = await this.database.productReview.findUnique({
      where: { id },
      select: { status: true, rating: true, updatedAt: true },
    });
    if (current === null) throw DomainErrors.notFound('review');

    const { count } = await this.database.productReview.updateMany({
      where: { id, updatedAt: new Date(input.expectedUpdatedAt) },
      data: { status: input.decision, moderatedAt: new Date(), moderatedById: actor.staff.staffId },
    });
    if (count === 0) {
      throw DomainErrors.conflict(
        'این دیدگاه پس از بارگذاری صفحه تغییر کرده است. صفحه را تازه کنید و دوباره بررسی کنید.',
        'Review changed since it was loaded for moderation',
      );
    }

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: input.decision === 'APPROVED' ? REVIEW_APPROVED_AUDIT_ACTION : REVIEW_REJECTED_AUDIT_ACTION,
      entity: 'ProductReview',
      entityId: id,
      before: { status: current.status, rating: current.rating },
      after: { status: input.decision, rating: current.rating },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });
    return { status: input.decision };
  }
}
