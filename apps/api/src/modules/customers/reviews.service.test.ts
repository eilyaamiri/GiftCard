import { describe, expect, it, vi } from 'vitest';

import type { CustomersDatabase } from './customers.tokens';
import { submitReviewRequestSchema } from './reviews.schemas';
import { authorNameFa, ReviewsService, summarise } from './reviews.service';

const CUSTOMER = 'cus_1';
const NOW = new Date('2026-10-18T10:00:00.000Z');

/** Only the delegates and methods the service touches; each test scripts its answers. */
function harness() {
  const db = {
    product: { findFirst: vi.fn(async () => ({ id: 'prod_1' })) },
    topUpGame: { findFirst: vi.fn(async () => ({ id: 'game_1' })) },
    internationalService: { findFirst: vi.fn(async () => ({ id: 'svc_1' })) },
    order: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    productReview: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { create: { rating: number; body: string | null; isVerifiedBuyer: boolean } }) => ({
        rating: args.create.rating,
        body: args.create.body,
        status: 'PENDING' as const,
        isVerifiedBuyer: args.create.isVerifiedBuyer,
        updatedAt: NOW,
      })),
    },
  };
  return { db, service: new ReviewsService(db as unknown as CustomersDatabase) };
}

describe('summarise', () => {
  it('averages to one decimal and fills the per-star distribution', () => {
    expect(
      summarise([
        { rating: 5, count: 3 },
        { rating: 4, count: 1 },
      ]),
    ).toEqual({ average: 4.8, count: 4, distribution: [0, 0, 0, 1, 3] });
  });

  it('has no average at all with no approved reviews, rather than zero stars', () => {
    expect(summarise([])).toEqual({ average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
  });

  it('ignores a rating outside one to five instead of letting it skew the average', () => {
    expect(summarise([{ rating: 9, count: 5 }, { rating: 2, count: 1 }])).toEqual({
      average: 2,
      count: 1,
      distribution: [0, 1, 0, 0, 0],
    });
  });
});

describe('authorNameFa', () => {
  it('shows a first name and a surname initial, never the full surname', () => {
    expect(authorNameFa({ firstName: 'علی', lastName: 'محمدی' })).toBe('علی م.');
  });

  it('falls back sensibly when parts of the name are missing', () => {
    expect(authorNameFa({ firstName: 'سارا', lastName: null })).toBe('سارا');
    expect(authorNameFa({ firstName: '  ', lastName: 'رضایی' })).toBe('کاربر سنتو');
    expect(authorNameFa(null)).toBe('کاربر سنتو');
  });
});

describe('listPublic', () => {
  it('reads only APPROVED reviews of the resolved target, for the list and the average alike', async () => {
    const { db, service } = harness();
    await service.listPublic({ itemType: 'PRODUCT', itemSlug: 'steam-wallet', page: 1 });

    const approved = { productId: 'prod_1', status: 'APPROVED' };
    expect(db.productReview.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: approved }));
    expect(db.productReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: approved }));
  });

  it('never selects anything that identifies the author beyond their name', async () => {
    const { db, service } = harness();
    await service.listPublic({ itemType: 'SERVICE', itemSlug: 'hosting', page: 1 });

    const select = JSON.stringify(db.productReview.findMany.mock.calls[0]?.[0]);
    for (const leak of ['mobile', 'email', 'identities', 'customerCode', 'customerId']) {
      expect(select).not.toContain(leak);
    }
  });

  it('refuses a product that is not on sale', async () => {
    const { db, service } = harness();
    db.product.findFirst.mockResolvedValueOnce(null as never);
    await expect(service.listPublic({ itemType: 'PRODUCT', itemSlug: 'gone', page: 1 })).rejects.toThrow();
    expect(db.productReview.findMany).not.toHaveBeenCalled();
  });

  it('applies the storefront game page visibility rule to a top-up game', async () => {
    const { db, service } = harness();
    await service.listPublic({ itemType: 'TOPUP_GAME', itemSlug: 'pubg-mobile', page: 1 });
    expect(db.topUpGame.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          isListed: true,
          requiresCredentials: false,
          supplier: { isActive: true },
        }),
      }),
    );
  });
});

describe('submit', () => {
  it('always lands PENDING with moderation cleared, so an edit leaves the storefront until re-read', async () => {
    const { db, service } = harness();
    await service.submit(CUSTOMER, { itemType: 'PRODUCT', itemSlug: 'steam-wallet', rating: 5, body: 'عالی' });

    const args = db.productReview.upsert.mock.calls[0]?.[0] as unknown as {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    for (const branch of [args.create, args.update]) {
      expect(branch).toMatchObject({ status: 'PENDING', moderatedAt: null, moderatedById: null, rating: 5 });
    }
    expect(args.where).toEqual({ customerId_productId: { customerId: CUSTOMER, productId: 'prod_1' } });
    expect(args.create).toMatchObject({ customerId: CUSTOMER, productId: 'prod_1' });
  });

  it.each([
    ['TOPUP_GAME', { customerId_topUpGameId: { customerId: CUSTOMER, topUpGameId: 'game_1' } }],
    ['SERVICE', { customerId_serviceId: { customerId: CUSTOMER, serviceId: 'svc_1' } }],
  ] as const)('keys a %s review on its own unique pair', async (itemType, where) => {
    const { db, service } = harness();
    await service.submit(CUSTOMER, { itemType, itemSlug: 'x', rating: 3, body: null });
    expect(db.productReview.upsert).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });

  it('marks a buyer only from a paid, unrefunded order for this very target', async () => {
    const { db, service } = harness();
    db.order.count.mockResolvedValueOnce(1 as never);
    const review = await service.submit(CUSTOMER, { itemType: 'PRODUCT', itemSlug: 'steam-wallet', rating: 4, body: null });

    expect(review.isVerifiedBuyer).toBe(true);
    const where = (db.order.count.mock.calls[0]?.[0] as unknown as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ customerId: CUSTOMER, quote: { sku: { productId: 'prod_1' } } });
    const statuses = (where['status'] as { in: string[] }).in;
    expect(statuses).toEqual(expect.arrayContaining(['PAID', 'FULFILLED']));
    for (const notBought of ['REFUNDED', 'REFUND_PENDING', 'CANCELLED', 'AWAITING_PAYMENT', 'DRAFT']) {
      expect(statuses).not.toContain(notBought);
    }
  });

  it('is not a buyer without such an order', async () => {
    const { service } = harness();
    const review = await service.submit(CUSTOMER, { itemType: 'SERVICE', itemSlug: 'hosting', rating: 2, body: null });
    expect(review.isVerifiedBuyer).toBe(false);
  });
});

describe('forOrder', () => {
  it('looks only at the customer’s own delivered order', async () => {
    const { db, service } = harness();
    expect(await service.forOrder(CUSTOMER, 'BP-2026-000001')).toBeNull();
    expect(db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderNumber: 'BP-2026-000001', customerId: CUSTOMER, status: 'FULFILLED' } }),
    );
  });

  it('points a gift-card order at its product page and reports the existing review', async () => {
    const { db, service } = harness();
    db.order.findFirst.mockResolvedValueOnce({
      quote: {
        serviceId: null,
        sku: { product: { slug: 'steam-wallet', titleFa: 'گیفت‌کارت استیم', isActive: true } },
        topUpOffer: null,
        service: null,
      },
    } as never);
    db.productReview.findUnique.mockResolvedValueOnce({
      rating: 4, body: null, status: 'APPROVED', isVerifiedBuyer: true, updatedAt: NOW,
    } as never);

    expect(await service.forOrder(CUSTOMER, 'BP-2026-000002')).toEqual({
      itemType: 'PRODUCT',
      itemSlug: 'steam-wallet',
      titleFa: 'گیفت‌کارت استیم',
      href: '/gift-cards/steam-wallet',
      myReview: { rating: 4, body: null, status: 'APPROVED', isVerifiedBuyer: true, updatedAt: NOW.toISOString() },
    });
  });

  it('offers no prompt for a product that has since left sale', async () => {
    const { db, service } = harness();
    db.order.findFirst.mockResolvedValueOnce({
      quote: { serviceId: 'svc_1', sku: null, topUpOffer: null, service: { slug: 'old', nameFa: 'قدیمی', isActive: false } },
    } as never);
    expect(await service.forOrder(CUSTOMER, 'BP-2026-000003')).toBeNull();
  });
});

describe('submitReviewRequestSchema', () => {
  const base = { itemType: 'PRODUCT', itemSlug: 'steam-wallet' } as const;

  it('stores a blank or missing comment as null', () => {
    expect(submitReviewRequestSchema.parse({ ...base, rating: 5, body: '   ' }).body).toBeNull();
    expect(submitReviewRequestSchema.parse({ ...base, rating: 5 }).body).toBeNull();
  });

  it('accepts whole stars from one to five only', () => {
    for (const rating of [0, 6, 4.5, -1]) {
      expect(submitReviewRequestSchema.safeParse({ ...base, rating }).success).toBe(false);
    }
    expect(submitReviewRequestSchema.safeParse({ ...base, rating: 1 }).success).toBe(true);
  });

  it('refuses a comment past the length a moderator can read', () => {
    expect(submitReviewRequestSchema.safeParse({ ...base, rating: 3, body: 'x'.repeat(1_001) }).success).toBe(false);
  });
});
