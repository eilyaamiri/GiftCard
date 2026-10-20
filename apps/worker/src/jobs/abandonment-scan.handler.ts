import type { AbandonmentType, PrismaClient } from '@barat/database';

import { QUEUE_NAMES } from '../queues';
import { abandonmentScanPayloadSchema, parsePayload, resolveNow } from './job-payloads';
import type { AbandonmentScanJobData, JobHandler, JobResult } from './job-types';

const DEFAULT_CART_IDLE_MINUTES = 60;
const DEFAULT_QUOTE_IDLE_MINUTES = 120;
const DEFAULT_BATCH_SIZE = 200;

/** Order statuses that mean "the customer never got past paying". */
const UNPAID_ORDER_STATUSES = ['DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'FAILED'] as const;

/** A payment row in any of these states proves the customer reached the gateway. */
const PAYMENT_STARTED_STATUSES = [
  'CREATED',
  'REDIRECTED',
  'PENDING',
  'FAILED',
  'CANCELLED',
] as const;

/** Order statuses that mean the customer *did* pay — such a cart converted. */
const PAID_ORDER_STATUSES = [
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
  'FULFILLED',
  'REVIEW_REQUIRED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

/** Thrown inside a transaction purely to roll back a claim that lost a race. */
class ClaimRolledBack extends Error {
  constructor() {
    super('abandonment claim rolled back');
    this.name = 'ClaimRolledBack';
  }
}

type PrismaSlice = Pick<PrismaClient, 'cart' | 'quote' | 'abandonmentRecord' | '$transaction'>;

interface CartCandidate {
  readonly id: string;
  readonly customerId: string | null;
  readonly commerceSessionId: string | null;
  readonly updatedAt: Date;
}

/**
 * Classifies stale funnels into `AbandonmentRecord` rows.
 *
 * Idempotency for carts is not a "have I seen this before?" lookup — it is the
 * `OPEN -> ABANDONED` status transition itself. The conditional `updateMany`
 * returns 1 for exactly one caller, and only that caller writes the record, so
 * two overlapping sweeps (or a BullMQ retry after a mid-batch crash) cannot
 * produce two records for one cart.
 *
 * GAP NOTE: `AbandonmentRecord` has no unique index on `(type, quoteId)` in the
 * frozen schema, so the quote branch has no equivalent DB-level guard. It uses a
 * read-then-write guard inside a transaction and is safe under the single
 * repeatable job that actually drives this queue, but a genuinely concurrent
 * enqueue could double-write. The fix is a `@@unique([type, quoteId])` in
 * `packages/database/prisma/schema.prisma`, which this agent must not edit.
 */
export class AbandonmentScanHandler implements JobHandler<AbandonmentScanJobData> {
  readonly queueName = QUEUE_NAMES.ABANDONMENT_SCAN;

  constructor(private readonly db: PrismaSlice) {}

  async handle(raw: AbandonmentScanJobData = {}): Promise<JobResult> {
    const data = parsePayload(abandonmentScanPayloadSchema, raw, this.queueName);
    const now = resolveNow(data.now, this.queueName);
    const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;
    const cartCutoff = minutesBefore(now, data.cartIdleMinutes ?? DEFAULT_CART_IDLE_MINUTES);
    const quoteCutoff = minutesBefore(now, data.quoteIdleMinutes ?? DEFAULT_QUOTE_IDLE_MINUTES);

    const carts = await this.scanCarts(cartCutoff, batchSize);
    const quotes = await this.scanQuotes(quoteCutoff, batchSize);

    return {
      changed: carts.changed + quotes.changed,
      skipped: carts.skipped + quotes.skipped,
      details: {
        queue: this.queueName,
        scannedAt: now.toISOString(),
        cartsClassified: carts.changed,
        quotesClassified: quotes.changed,
      },
    };
  }

  private async scanCarts(
    cutoff: Date,
    batchSize: number,
  ): Promise<{ changed: number; skipped: number }> {
    const candidates: CartCandidate[] = await this.db.cart.findMany({
      where: { status: 'OPEN', updatedAt: { lte: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true, customerId: true, commerceSessionId: true, updatedAt: true },
    });

    let changed = 0;
    let skipped = 0;

    for (const cart of candidates) {
      const classified = await this.classifyCart(cart);
      if (classified) {
        changed += 1;
      } else {
        skipped += 1;
      }
    }

    return { changed, skipped };
  }

  private async classifyCart(cart: CartCandidate): Promise<boolean> {
    // Read the evidence before taking the lock so the transaction stays short.
    const evidence = await this.db.cart.findUnique({
      where: { id: cart.id },
      select: {
        orders: {
          where: { status: { in: [...UNPAID_ORDER_STATUSES] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            totalAmountIrr: true,
            updatedAt: true,
            payments: {
              where: { status: { in: [...PAYMENT_STARTED_STATUSES] } },
              take: 1,
              select: { id: true },
            },
          },
        },
        quotes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, finalAmountIrr: true, status: true, updatedAt: true },
        },
      },
    });

    const order = evidence?.orders[0];
    const quote = evidence?.quotes[0];

    // A cart whose quote was accepted and paid is not abandoned; the paid order
    // would have flipped it to CONVERTED. Guarding anyway keeps a lagging write
    // from producing a false positive in the recovery report.
    if (quote?.status === 'ACCEPTED' && order === undefined) {
      return false;
    }

    const type = classifyCartType(
      order !== undefined,
      (order?.payments.length ?? 0) > 0,
      quote !== undefined,
    );
    const amountIrr = order?.totalAmountIrr ?? quote?.finalAmountIrr ?? null;
    const lastEventAt = latestTimestamp([cart.updatedAt, order?.updatedAt, quote?.updatedAt]);

    try {
      return await this.db.$transaction(async (tx) => {
        // The lock. Exactly one concurrent runner sees count === 1.
        const claimed = await tx.cart.updateMany({
          where: { id: cart.id, status: 'OPEN' },
          data: { status: 'ABANDONED' },
        });
        if (claimed.count !== 1) {
          return false;
        }

        /* The evidence above was read before the claim. A customer who was at the
         * gateway then may have paid since: the callback moves the order to PAID
         * without touching the cart. Re-check under the claim and roll it back, so
         * a paying customer is never recorded (or later contacted) as abandoned. */
        const paidOrders = await tx.order.count({
          where: { cartId: cart.id, status: { in: [...PAID_ORDER_STATUSES] } },
        });
        if (paidOrders > 0) {
          throw new ClaimRolledBack();
        }

        await tx.abandonmentRecord.create({
          data: {
            type,
            cartId: cart.id,
            customerId: cart.customerId,
            commerceSessionId: cart.commerceSessionId,
            ...(quote === undefined ? {} : { quoteId: quote.id }),
            ...(order === undefined ? {} : { orderId: order.id }),
            lastEventAt,
            amountIrr,
          },
        });

        return true;
      });
    } catch (error: unknown) {
      if (error instanceof ClaimRolledBack) {
        return false;
      }
      throw error;
    }
  }

  private async scanQuotes(
    cutoff: Date,
    batchSize: number,
  ): Promise<{ changed: number; skipped: number }> {
    // Cart-attached quotes are already covered by the cart branch above; this
    // catches direct quotes (a customer who priced a SKU without a cart).
    const candidates = await this.db.quote.findMany({
      where: {
        cartId: null,
        status: { in: ['ACTIVE', 'EXPIRED'] },
        acceptedAt: null,
        updatedAt: { lte: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: {
        id: true,
        status: true,
        customerId: true,
        commerceSessionId: true,
        finalAmountIrr: true,
        updatedAt: true,
      },
    });

    let changed = 0;
    let skipped = 0;

    for (const quote of candidates) {
      const type: AbandonmentType =
        quote.status === 'EXPIRED' ? 'EXPIRED_QUOTE' : 'QUOTE_ABANDONMENT';

      const written = await this.db.$transaction(async (tx) => {
        /* There is no unique index on (type, quoteId), so the read-then-write
         * below is only safe if no other runner is between the same two lines.
         * A transaction-scoped advisory lock on the quote id serialises them
         * across processes; it is released by the commit or rollback. */
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`abandonment:quote:${quote.id}`}))`;

        // The quote may have been accepted since the batch was read.
        const stillUnaccepted = await tx.quote.count({
          where: { id: quote.id, acceptedAt: null, status: { in: ['ACTIVE', 'EXPIRED'] } },
        });
        if (stillUnaccepted === 0) {
          return false;
        }

        const existing = await tx.abandonmentRecord.findFirst({
          where: { quoteId: quote.id, type: { in: ['QUOTE_ABANDONMENT', 'EXPIRED_QUOTE'] } },
          select: { id: true },
        });
        if (existing !== null) {
          return false;
        }

        await tx.abandonmentRecord.create({
          data: {
            type,
            quoteId: quote.id,
            customerId: quote.customerId,
            commerceSessionId: quote.commerceSessionId,
            lastEventType: 'QUOTE_GENERATED',
            lastEventAt: quote.updatedAt,
            amountIrr: quote.finalAmountIrr,
          },
        });
        return true;
      });

      if (written) {
        changed += 1;
      } else {
        skipped += 1;
      }
    }

    return { changed, skipped };
  }
}

export function classifyCartType(
  hasUnpaidOrder: boolean,
  hasStartedPayment: boolean,
  hasQuote: boolean,
): AbandonmentType {
  if (hasUnpaidOrder && hasStartedPayment) {
    return 'PAYMENT_ABANDONMENT';
  }
  if (hasUnpaidOrder) {
    return 'CHECKOUT_ABANDONMENT';
  }
  if (hasQuote) {
    return 'QUOTE_ABANDONMENT';
  }
  return 'BROWSE_ABANDONMENT';
}

function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function latestTimestamp(values: readonly (Date | undefined)[]): Date {
  let latest: Date | undefined;
  for (const value of values) {
    if (value !== undefined && (latest === undefined || value.getTime() > latest.getTime())) {
      latest = value;
    }
  }
  return latest ?? new Date(0);
}
