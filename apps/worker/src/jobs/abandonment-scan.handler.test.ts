import { describe, expect, it, vi } from 'vitest';

import { AbandonmentScanHandler } from './abandonment-scan.handler';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const STALE = new Date('2026-10-20T06:00:00.000Z');
/** Inside the default 60-minute cart window. */
const RECENT = new Date('2026-10-20T09:40:00.000Z');

interface State {
  carts: Map<string, { id: string; status: string; updatedAt: Date }>;
  paidOrdersByCart: Map<string, number>;
  quotes: Map<string, { id: string; status: string; acceptedAt: Date | null }>;
  records: Array<Record<string, unknown>>;
  advisoryLocks: string[];
}

/**
 * A tiny transactional fake: `$transaction` snapshots the mutable state and
 * restores it when the callback throws, which is what lets the test observe a
 * claim being rolled back.
 */
interface Hooks {
  beforeTxQuoteCheck?: () => void;
  /** Overrides the evidence the cart branch reads. */
  evidence?: { orderUpdatedAt?: Date; paymentUpdatedAt?: Date; quoteUpdatedAt?: Date };
  /** Makes the next record insert fail like the unique index would. */
  uniqueViolationOnCreate?: boolean;
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function fakePrisma(state: State, hooks: Hooks = {}) {
  const tx = {
    cart: {
      updateMany: vi.fn(async ({ where }: { where: { id: string; status: string } }) => {
        const cart = state.carts.get(where.id);
        if (cart?.status !== where.status) return { count: 0 };
        cart.status = 'ABANDONED';
        return { count: 1 };
      }),
    },
    order: {
      count: vi.fn(
        async ({ where }: { where: { cartId: string } }) =>
          state.paidOrdersByCart.get(where.cartId) ?? 0,
      ),
    },
    quote: {
      count: vi.fn(async ({ where }: { where: { id: string } }) => {
        hooks.beforeTxQuoteCheck?.();
        const quote = state.quotes.get(where.id);
        return quote !== undefined &&
          quote.acceptedAt === null &&
          ['ACTIVE', 'EXPIRED'].includes(quote.status)
          ? 1
          : 0;
      }),
    },
    abandonmentRecord: {
      findFirst: vi.fn(
        async ({ where }: { where: { quoteId?: string; cartId?: string; type?: unknown } }) => {
          const hit = state.records.find((r) =>
            where.cartId !== undefined
              ? r['cartId'] === where.cartId && r['type'] === where.type
              : r['quoteId'] === where.quoteId,
          );
          return hit === undefined ? null : { id: 'r' };
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (hooks.uniqueViolationOnCreate === true) {
          throw uniqueViolation();
        }
        state.records.push(data);
        return data;
      }),
    },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.advisoryLocks.push(`${strings.join('?')}|${values.join(',')}`);
      return 1;
    }),
  };

  return {
    cart: {
      findMany: vi.fn(async () =>
        [...state.carts.values()]
          .filter((c) => c.status === 'OPEN')
          .map((c) => ({
            id: c.id,
            customerId: null,
            commerceSessionId: 's1',
            updatedAt: c.updatedAt,
          })),
      ),
      findUnique: vi.fn(async () => ({
        orders: [
          {
            id: 'o1',
            totalAmountIrr: 1_000_000n,
            updatedAt: hooks.evidence?.orderUpdatedAt ?? STALE,
            payments: [{ id: 'p1', updatedAt: hooks.evidence?.paymentUpdatedAt ?? STALE }],
          },
        ],
        quotes:
          hooks.evidence?.quoteUpdatedAt === undefined
            ? []
            : [
                {
                  id: 'q-cart',
                  finalAmountIrr: 1_000_000n,
                  status: 'ACTIVE',
                  updatedAt: hooks.evidence.quoteUpdatedAt,
                },
              ],
      })),
    },
    quote: {
      findMany: vi.fn(async () =>
        [...state.quotes.values()].map((q) => ({
          id: q.id,
          status: q.status,
          customerId: null,
          commerceSessionId: 's1',
          finalAmountIrr: 500_000n,
          updatedAt: STALE,
        })),
      ),
    },
    abandonmentRecord: tx.abandonmentRecord,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = {
        carts: new Map([...state.carts].map(([k, v]) => [k, { ...v }])),
        records: [...state.records],
      };
      try {
        return await fn(tx);
      } catch (error) {
        state.carts = snapshot.carts;
        state.records = snapshot.records;
        throw error;
      }
    }),
  };
}

function emptyState(): State {
  return {
    carts: new Map(),
    paidOrdersByCart: new Map(),
    quotes: new Map(),
    records: [],
    advisoryLocks: [],
  };
}

describe('AbandonmentScanHandler — races with the payment flow', () => {
  it('rolls the cart claim back when the order got paid after the evidence was read', async () => {
    const state = emptyState();
    state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });
    // The customer completed payment between the evidence read and the claim.
    state.paidOrdersByCart.set('c1', 1);

    const result = await new AbandonmentScanHandler(fakePrisma(state) as never).handle({
      now: NOW.toISOString(),
    });

    expect(result.details).toMatchObject({ cartsClassified: 0 });
    expect(state.records).toHaveLength(0);
    expect(state.carts.get('c1')?.status).toBe('OPEN');
  });

  it('still classifies a genuinely abandoned cart exactly once', async () => {
    const state = emptyState();
    state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });
    const prisma = fakePrisma(state);
    const handler = new AbandonmentScanHandler(prisma as never);

    await handler.handle({ now: NOW.toISOString() });
    await handler.handle({ now: NOW.toISOString() });

    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toMatchObject({ type: 'PAYMENT_ABANDONMENT', cartId: 'c1' });
    expect(state.carts.get('c1')?.status).toBe('ABANDONED');
  });

  it('does not record a direct quote that was accepted after the batch was read', async () => {
    const state = emptyState();
    state.quotes.set('q1', { id: 'q1', status: 'ACTIVE', acceptedAt: null });
    const prisma = fakePrisma(state, {
      beforeTxQuoteCheck: () => {
        state.quotes.set('q1', { id: 'q1', status: 'ACCEPTED', acceptedAt: NOW });
      },
    });

    const result = await new AbandonmentScanHandler(prisma as never).handle({
      now: NOW.toISOString(),
    });

    expect(result.details).toMatchObject({ quotesClassified: 0 });
    expect(state.records).toHaveLength(0);
  });

  it('serialises the quote read-then-write with a per-quote advisory lock', async () => {
    const state = emptyState();
    state.quotes.set('q1', { id: 'q1', status: 'EXPIRED', acceptedAt: null });
    const handler = new AbandonmentScanHandler(fakePrisma(state) as never);

    await handler.handle({ now: NOW.toISOString() });
    await handler.handle({ now: NOW.toISOString() });

    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toMatchObject({ type: 'EXPIRED_QUOTE', quoteId: 'q1' });
    expect(state.advisoryLocks[0]).toBe(
      'SELECT pg_advisory_xact_lock(hashtext(?))|abandonment:quote:q1',
    );
  });

  it.each([
    ['order', { orderUpdatedAt: RECENT }],
    ['payment', { paymentUpdatedAt: RECENT }],
    ['quote', { quoteUpdatedAt: RECENT }],
  ] as const)(
    'does not call a cart abandoned while its %s saw activity inside the window',
    async (_label, evidence) => {
      const state = emptyState();
      // The cart row itself has been untouched for four hours.
      state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });

      const result = await new AbandonmentScanHandler(
        fakePrisma(state, { evidence }) as never,
      ).handle({ now: NOW.toISOString() });

      expect(result.details).toMatchObject({ cartsClassified: 0 });
      expect(state.records).toHaveLength(0);
      expect(state.carts.get('c1')?.status).toBe('OPEN');
    },
  );

  it('records the latest funnel activity as the abandonment time', async () => {
    const state = emptyState();
    state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });
    const paymentAt = new Date('2026-10-20T08:30:00.000Z');

    await new AbandonmentScanHandler(
      fakePrisma(state, { evidence: { paymentUpdatedAt: paymentAt } }) as never,
    ).handle({ now: NOW.toISOString() });

    expect(state.records[0]).toMatchObject({ cartId: 'c1', lastEventAt: paymentAt });
  });

  it('counts a write refused by the unique index as skipped, not a failed sweep', async () => {
    const state = emptyState();
    state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });
    state.quotes.set('q1', { id: 'q1', status: 'EXPIRED', acceptedAt: null });

    const result = await new AbandonmentScanHandler(
      fakePrisma(state, { uniqueViolationOnCreate: true }) as never,
    ).handle({ now: NOW.toISOString() });

    expect(result).toMatchObject({ changed: 0, skipped: 2 });
    // The cart claim rolled back with the insert; the next sweep sees the record.
    expect(state.carts.get('c1')?.status).toBe('OPEN');
  });

  it('does not write a second record for a cart already recorded with that type', async () => {
    const state = emptyState();
    state.carts.set('c1', { id: 'c1', status: 'OPEN', updatedAt: STALE });
    state.records.push({ type: 'PAYMENT_ABANDONMENT', cartId: 'c1' });

    const result = await new AbandonmentScanHandler(fakePrisma(state) as never).handle({
      now: NOW.toISOString(),
    });

    expect(result.details).toMatchObject({ cartsClassified: 0 });
    expect(state.records).toHaveLength(1);
  });

  it('rejects malformed payload overrides by field name', async () => {
    const handler = new AbandonmentScanHandler(fakePrisma(emptyState()) as never);
    await expect(handler.handle({ cartIdleMinutes: -5 })).rejects.toThrow(
      /invalid job payload \(cartIdleMinutes\)/,
    );
  });
});
