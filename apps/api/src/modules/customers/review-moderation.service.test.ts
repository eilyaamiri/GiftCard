import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { CustomersDatabase } from './customers.tokens';
import {
  REVIEW_APPROVED_AUDIT_ACTION,
  REVIEW_REJECTED_AUDIT_ACTION,
  ReviewModerationService,
} from './review-moderation.service';
import { moderateReviewSchema } from './reviews.schemas';

const SEEN = '2026-10-18T10:00:00.000Z';
const ACTOR = {
  staff: { staffId: 'staff_1', role: 'SUPPORT' },
  metadata: { ip: '10.0.0.1', userAgent: 'test' },
} as never;

function harness() {
  const db = {
    productReview: {
      findUnique: vi.fn(async () => ({ status: 'PENDING', rating: 4, updatedAt: new Date(SEEN) })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      groupBy: vi.fn(async () => [
        { status: 'PENDING', _count: { _all: 3 } },
        { status: 'APPROVED', _count: { _all: 41 } },
      ]),
      findMany: vi.fn(async () => []),
    },
    staffUser: { findMany: vi.fn(async () => []) },
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new ReviewModerationService(db as unknown as CustomersDatabase, audit as unknown as AuditService);
  return { db, audit, service };
}

describe('moderate', () => {
  it('applies the decision only to the version the moderator read', async () => {
    const { db, service } = harness();
    await service.moderate('rev_1', { decision: 'APPROVED', expectedUpdatedAt: SEEN }, ACTOR);

    expect(db.productReview.updateMany).toHaveBeenCalledWith({
      where: { id: 'rev_1', updatedAt: new Date(SEEN) },
      data: expect.objectContaining({ status: 'APPROVED', moderatedById: 'staff_1' }),
    });
  });

  it('refuses, and records nothing, when the customer edited after the queue was loaded', async () => {
    const { db, audit, service } = harness();
    db.productReview.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.moderate('rev_1', { decision: 'APPROVED', expectedUpdatedAt: SEEN }, ACTOR),
    ).rejects.toThrow();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a review that does not exist as not found, before trying to change it', async () => {
    const { db, service } = harness();
    db.productReview.findUnique.mockResolvedValueOnce(null as never);

    await expect(
      service.moderate('missing', { decision: 'REJECTED', expectedUpdatedAt: SEEN }, ACTOR),
    ).rejects.toThrow();
    expect(db.productReview.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['APPROVED', REVIEW_APPROVED_AUDIT_ACTION],
    ['REJECTED', REVIEW_REJECTED_AUDIT_ACTION],
  ] as const)('audits a %s decision with who, from what, to what', async (decision, action) => {
    const { audit, service } = harness();
    await service.moderate('rev_1', { decision, expectedUpdatedAt: SEEN }, ACTOR);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'staff_1',
        actorRole: 'SUPPORT',
        action,
        entity: 'ProductReview',
        entityId: 'rev_1',
        before: { status: 'PENDING', rating: 4 },
        after: { status: decision, rating: 4 },
      }),
    );
  });
});

describe('list', () => {
  it('serves pending reviews oldest first, so none waits forever behind newer ones', async () => {
    const { db, service } = harness();
    await service.list({ status: 'PENDING', page: 1 });
    expect(db.productReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('serves decided reviews most recent decision first', async () => {
    const { db, service } = harness();
    await service.list({ status: 'APPROVED', page: 1 });
    expect(db.productReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ moderatedAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('counts every state, including the empty ones, and pages on the chosen state', async () => {
    const { service } = harness();
    const result = await service.list({ status: 'APPROVED', page: 1 });
    expect(result.counts).toEqual({ PENDING: 3, APPROVED: 41, REJECTED: 0 });
    expect(result.totalPages).toBe(3);
  });
});

describe('moderateReviewSchema', () => {
  it('requires the version the moderator saw, as an ISO timestamp', () => {
    expect(moderateReviewSchema.safeParse({ decision: 'APPROVED' }).success).toBe(false);
    expect(moderateReviewSchema.safeParse({ decision: 'APPROVED', expectedUpdatedAt: 'yesterday' }).success).toBe(false);
    expect(moderateReviewSchema.safeParse({ decision: 'PENDING', expectedUpdatedAt: SEEN }).success).toBe(false);
    expect(moderateReviewSchema.safeParse({ decision: 'REJECTED', expectedUpdatedAt: SEEN }).success).toBe(true);
  });
});
