import type { PrismaClient } from '@barat/database';

import type { DeliveryRetryClient } from '../clients/delivery-retry.client';
import { QUEUE_NAMES } from '../queues';
import type { DeliveryRetryJobData, JobHandler, JobResult } from './job-types';

const DEFAULT_MIN_RETRY_DELAY_MINUTES = 15;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;

type PrismaSlice = Pick<PrismaClient, 'giftCardAsset' | 'deliveryAttempt'>;

/**
 * Re-sends assets whose last delivery attempt failed.
 *
 * The invariant this job exists to protect: a failed delivery is a *messaging*
 * failure, never a supply failure. The gift card has already been bought with
 * real money. So this handler is written so that there is no expression in it
 * capable of producing a new asset — it selects existing `GiftCardAsset` rows by
 * id and asks the API to re-send those same ids. It never calls a supplier and
 * never writes to `giftCardAsset` except through the API's own dispatch path.
 *
 * Idempotency comes from the status machine rather than from a dedupe key: only
 * `DELIVERY_FAILED` rows are selected, a successful retry leaves the row `SENT`,
 * and the API's compare-and-set into `SENDING` rejects a second concurrent
 * dispatch of the same asset. A re-run therefore reports `changed: 0`.
 *
 * Assets past `maxAttempts` are left alone rather than escalated from here: the
 * order is still unfulfilled, so its fulfillment work item is still open in the
 * operator queue, and a human already sees it. Inventing a second work item from
 * the worker would only duplicate that.
 */
export class DeliveryRetryHandler implements JobHandler<DeliveryRetryJobData> {
  readonly queueName = QUEUE_NAMES.DELIVERY_DISPATCH;

  constructor(
    private readonly db: PrismaSlice,
    private readonly client: DeliveryRetryClient,
  ) {}

  async handle(data: DeliveryRetryJobData = {}): Promise<JobResult> {
    const now = data.now === undefined ? new Date() : new Date(data.now);
    if (Number.isNaN(now.getTime())) {
      throw new Error('delivery-retry: invalid `now`');
    }
    const maxAttempts = data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;
    const cutoff = new Date(
      now.getTime() - (data.minRetryDelayMinutes ?? DEFAULT_MIN_RETRY_DELAY_MINUTES) * 60_000,
    );

    const candidates = await this.db.giftCardAsset.findMany({
      where: { status: 'DELIVERY_FAILED', updatedAt: { lte: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    let delivered = 0;
    let skipped = 0;
    let failed = 0;
    let exhausted = 0;

    for (const candidate of candidates) {
      const attempts = await this.db.deliveryAttempt.count({
        where: { giftCardAssetId: candidate.id },
      });

      if (attempts >= maxAttempts) {
        exhausted += 1;
        skipped += 1;
        continue;
      }

      try {
        const outcome = await this.client.retry(candidate.id);
        if (outcome.delivered) {
          delivered += 1;
        } else {
          // Still DELIVERY_FAILED; the next sweep picks it up after the cooldown.
          failed += 1;
        }
      } catch {
        // A transport or auth problem on our side is not the asset's fault. The
        // error is swallowed (it may carry a provider body) and the asset is left
        // in DELIVERY_FAILED so the next run retries it. One bad asset must not
        // abort the batch and strand the rest.
        failed += 1;
      }
    }

    return {
      changed: delivered,
      skipped,
      details: {
        queue: this.queueName,
        scannedAt: now.toISOString(),
        examined: candidates.length,
        stillFailing: failed,
        exhausted,
      },
    };
  }
}
