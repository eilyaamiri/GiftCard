import type { PrismaClient } from '@barat/database';

import {
  DeliveryRetryClientError,
  type DeliveryProblem,
  type DeliveryRetryClient,
} from '../clients/delivery-retry.client';
import { QUEUE_NAMES } from '../queues';
import { deliveryRetryPayloadSchema, parsePayload, resolveNow } from './job-payloads';
import type { DeliveryRetryJobData, JobHandler, JobResult } from './job-types';

const DEFAULT_MIN_RETRY_DELAY_MINUTES = 15;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;

/**
 * How long an asset may sit in SENDING before a human is told. A dispatch holds
 * SENDING for one transport call (seconds); a quarter of an hour means the API
 * died between claiming the asset and recording the outcome.
 */
export const STUCK_SENDING_MINUTES = 15;

/**
 * The reconciliation issue the API opens for each reported problem. Mirrors
 * `DELIVERY_PROBLEM_ISSUE_TYPES` in the API; read here only to avoid asking the
 * API again, every two minutes, about an asset it has already reported.
 */
const PROBLEM_ISSUE_TYPES = {
  SENDING_STUCK: 'gift_card_entered_not_sent',
  RETRIES_EXHAUSTED: 'delivery_failed',
} as const satisfies Record<DeliveryProblem, string>;

/**
 * Orders whose card may still be delivered. Mirrors `DELIVERABLE_ORDER_STATUSES`
 * in the API's send gate: a retry for any other order (refunded, cancelled,
 * already fulfilled) is refused there anyway, and asking every two minutes
 * would only write a refusal to the audit log each time.
 */
const DELIVERABLE_ORDER_STATUSES = ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'] as const;

type PrismaSlice = Pick<PrismaClient, 'giftCardAsset' | 'deliveryAttempt' | 'reconciliationIssue'>;

interface ReportCounts {
  reported: number;
  conflicts: number;
  failed: number;
}

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
 * Two cases are handed to a human instead of retried, each reported to the API
 * once per asset (it opens a reconciliation issue and pages Telegram):
 *   - an asset past the automatic attempt cap. Only the worker's own attempts
 *     count towards the cap; an operator pressing "resend" does not use it up.
 *   - an asset stuck in SENDING. Re-sending it could mail the code twice, since
 *     the stuck dispatch may well have reached the customer.
 *
 * A superseded asset (replaced by a manager) is never retried: the customer
 * must not receive the card that was swapped out.
 */
export class DeliveryRetryHandler implements JobHandler<DeliveryRetryJobData> {
  readonly queueName = QUEUE_NAMES.DELIVERY_DISPATCH;

  constructor(
    private readonly db: PrismaSlice,
    private readonly client: DeliveryRetryClient,
  ) {}

  async handle(raw: DeliveryRetryJobData = {}): Promise<JobResult> {
    const data = parsePayload(
      deliveryRetryPayloadSchema({
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        minRetryDelayMinutes: DEFAULT_MIN_RETRY_DELAY_MINUTES,
      }),
      raw,
      this.queueName,
    );
    const now = resolveNow(data.now, this.queueName);
    const maxAttempts = data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;
    const cutoff = new Date(
      now.getTime() - (data.minRetryDelayMinutes ?? DEFAULT_MIN_RETRY_DELAY_MINUTES) * 60_000,
    );

    /* Assets already at the cap are excluded from the batch up front. Without
     * this they never leave DELIVERY_FAILED, keep the oldest `updatedAt`, and
     * after enough of them every batch would be full of assets it may not touch
     * while newer failures wait forever. */
    const exhaustedIds = await this.findExhausted(maxAttempts);

    const candidates = await this.db.giftCardAsset.findMany({
      where: {
        status: 'DELIVERY_FAILED',
        supersededAt: null,
        updatedAt: { lte: cutoff },
        order: { status: { in: [...DELIVERABLE_ORDER_STATUSES] } },
        ...(exhaustedIds.length === 0 ? {} : { id: { notIn: exhaustedIds } }),
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    let delivered = 0;
    let skipped = 0;
    let failed = 0;
    let superseded = 0;
    let conflicts = 0;
    let mismatched = 0;
    const newlyExhausted: string[] = [];

    for (const candidate of candidates) {
      /* Re-check right before acting. The batch was read up to minutes ago (each
       * retry can take the full HTTP timeout), and in the meantime an operator's
       * "retry" button or another dispatch may have attempted this asset. A
       * fresh failure resets `updatedAt`, so the cool-down applies to it again;
       * without this re-read the sweep would mail the customer a second time
       * seconds after the operator's attempt. */
      const stillDue = await this.db.giftCardAsset.findFirst({
        where: {
          id: candidate.id,
          status: 'DELIVERY_FAILED',
          supersededAt: null,
          updatedAt: { lte: cutoff },
        },
        select: { id: true },
      });
      if (stillDue === null) {
        superseded += 1;
        skipped += 1;
        continue;
      }

      const attempts = await this.db.deliveryAttempt.count({
        where: { giftCardAssetId: candidate.id, initiatedByStaffId: null },
      });

      if (attempts >= maxAttempts) {
        newlyExhausted.push(candidate.id);
        skipped += 1;
        continue;
      }

      try {
        const outcome = await this.client.retry(candidate.id);
        if (outcome.assetId !== candidate.id) {
          /* The API dispatched a different asset than the one asked for. Never
           * count that as this asset's delivery: it is still undelivered, and
           * reporting it as delivered would hide a stranded gift card. */
          mismatched += 1;
          failed += 1;
        } else if (outcome.delivered) {
          delivered += 1;
        } else {
          // Still DELIVERY_FAILED; the next sweep picks it up after the cooldown.
          failed += 1;
        }
      } catch (error: unknown) {
        this.rethrowIfCredentialsRefused(error);
        if (error instanceof DeliveryRetryClientError && error.statusCode === 409) {
          // Another dispatch holds the asset, or the send gate blocks it now.
          conflicts += 1;
          skipped += 1;
          continue;
        }
        // A transport problem on our side is not the asset's fault. The error is
        // not logged (it may carry a provider body) and the asset is left in
        // DELIVERY_FAILED so the next run retries it. One bad asset must not
        // abort the batch and strand the rest.
        failed += 1;
      }
    }

    const exhausted = [...exhaustedIds, ...newlyExhausted];
    const exhaustedReports = await this.reportOnce(exhausted, 'RETRIES_EXHAUSTED');

    const stuck = await this.db.giftCardAsset.findMany({
      where: {
        status: 'SENDING',
        supersededAt: null,
        updatedAt: { lte: new Date(now.getTime() - STUCK_SENDING_MINUTES * 60_000) },
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    const stuckReports = await this.reportOnce(
      stuck.map((row) => row.id),
      'SENDING_STUCK',
    );

    return {
      changed: delivered,
      skipped,
      details: {
        queue: this.queueName,
        scannedAt: now.toISOString(),
        examined: candidates.length,
        stillFailing: failed,
        exhausted: exhausted.length,
        superseded,
        conflicts,
        mismatched,
        stuckSending: stuck.length,
        problemsReported: exhaustedReports.reported + stuckReports.reported,
        problemReportConflicts: exhaustedReports.conflicts + stuckReports.conflicts,
        problemReportsFailed: exhaustedReports.failed + stuckReports.failed,
      },
    };
  }

  /** Live, still-failed assets whose automatic attempts reached the cap. */
  private async findExhausted(maxAttempts: number): Promise<string[]> {
    const groups = await this.db.deliveryAttempt.groupBy({
      by: ['giftCardAssetId'],
      where: {
        initiatedByStaffId: null,
        giftCardAsset: {
          status: 'DELIVERY_FAILED',
          supersededAt: null,
          order: { status: { in: [...DELIVERABLE_ORDER_STATUSES] } },
        },
      },
      having: { giftCardAssetId: { _count: { gte: maxAttempts } } },
    });
    return groups
      .map((group) => group.giftCardAssetId)
      .filter((id): id is string => typeof id === 'string');
  }

  /**
   * Hands each asset's problem to the API, once. Assets with an issue of that
   * kind on record (open or closed) are skipped without a call; the API also
   * refuses a duplicate itself, so a race between two reads costs nothing.
   */
  private async reportOnce(
    ids: readonly string[],
    problem: DeliveryProblem,
  ): Promise<ReportCounts> {
    const counts: ReportCounts = { reported: 0, conflicts: 0, failed: 0 };
    if (ids.length === 0) {
      return counts;
    }

    const known = await this.db.reconciliationIssue.findMany({
      where: { giftCardAssetId: { in: [...ids] }, type: PROBLEM_ISSUE_TYPES[problem] },
      select: { giftCardAssetId: true },
    });
    const alreadyReported = new Set(known.map((issue) => issue.giftCardAssetId));

    for (const id of ids) {
      if (alreadyReported.has(id)) {
        continue;
      }
      try {
        const report = await this.client.reportProblem(id, problem);
        if (report.reported) {
          counts.reported += 1;
        }
      } catch (error: unknown) {
        this.rethrowIfCredentialsRefused(error);
        if (
          error instanceof DeliveryRetryClientError &&
          (error.statusCode === 404 || error.statusCode === 409)
        ) {
          // The asset moved on (sent, retried, replaced) since it was read.
          counts.conflicts += 1;
          continue;
        }
        // Not reported this time; the next sweep asks again.
        counts.failed += 1;
      }
    }
    return counts;
  }

  private rethrowIfCredentialsRefused(error: unknown): void {
    if (isCredentialRejection(error)) {
      /* Every remaining call would be refused the same way, so continuing
       * only hides the outage behind a "successful" sweep. Failing the job
       * puts it in the failed set and the logs, where someone will see it.
       * Nothing was dispatched by a refused call, so a re-run is harmless. */
      throw new Error(
        `${this.queueName}: API refused the internal service credentials (HTTP ${String(
          error.statusCode,
        )}); sweep aborted`,
        { cause: error },
      );
    }
  }
}

function isCredentialRejection(error: unknown): error is DeliveryRetryClientError {
  return (
    error instanceof DeliveryRetryClientError &&
    (error.statusCode === 401 || error.statusCode === 403)
  );
}
