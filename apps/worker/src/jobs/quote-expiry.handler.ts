import type { PrismaClient } from '@barat/database';

import { QUEUE_NAMES } from '../queues';
import type { JobHandler, JobResult, QuoteExpiryJobData } from './job-types';

const DEFAULT_BATCH_SIZE = 500;

/**
 * Expires quotes whose TTL has elapsed.
 *
 * The whole sweep is one conditional `UPDATE ... WHERE status = 'ACTIVE' AND
 * expiresAt <= now`, which is what makes it idempotent: the second run matches
 * nothing because the first run already moved the rows out of `ACTIVE`.
 *
 * `ACCEPTED` is deliberately excluded rather than merely unmatched-by-accident.
 * A quote whose checkout has started is an immutable financial snapshot
 * (AGENTS.md rule 10); expiring it under a customer who is mid-payment would
 * change the amount they are being charged.
 */
export class QuoteExpiryHandler implements JobHandler<QuoteExpiryJobData> {
  readonly queueName = QUEUE_NAMES.QUOTE_EXPIRY;

  constructor(private readonly db: Pick<PrismaClient, 'quote'>) {}

  async handle(data: QuoteExpiryJobData = {}): Promise<JobResult> {
    const now = data.now === undefined ? new Date() : new Date(data.now);
    if (Number.isNaN(now.getTime())) {
      throw new Error('quote-expiry: invalid `now`');
    }
    const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;

    const candidates = await this.db.quote.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      orderBy: { expiresAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    if (candidates.length === 0) {
      return { changed: 0, skipped: 0 };
    }

    const ids = candidates.map((row) => row.id);

    // The status predicate is repeated here on purpose: between the read and the
    // write a customer may have accepted one of these quotes, and that quote must
    // survive. Without it the sweep would silently expire a live checkout.
    const result = await this.db.quote.updateMany({
      where: { id: { in: ids }, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });

    return {
      changed: result.count,
      skipped: ids.length - result.count,
      details: { queue: this.queueName, scannedAt: now.toISOString() },
    };
  }
}
