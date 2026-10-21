import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@barat/database';

/* The concrete module, not the barrel: the barrel's ConfigModule validates the
 * whole environment at import time. */
import { AlertLogger } from '../../common/alert/alert-logger';
import { DomainErrors } from '../../common/errors/domain.exception';
import type { DeliveryProblem } from './fulfillment.schemas';

export const DELIVERY_PROBLEM_DATABASE = Symbol('DELIVERY_PROBLEM_DATABASE');

export type DeliveryProblemDatabase = Pick<
  PrismaClient,
  'giftCardAsset' | 'deliveryAttempt' | 'reconciliationIssue'
>;

/**
 * The reconciliation issue each problem opens. Mirrored in the worker, which
 * reads it to avoid re-reporting an asset every sweep.
 */
export const DELIVERY_PROBLEM_ISSUE_TYPES = {
  SENDING_STUCK: 'gift_card_entered_not_sent',
  RETRIES_EXHAUSTED: 'delivery_failed',
} as const satisfies Record<DeliveryProblem, string>;

/**
 * How long SENDING must have lasted before the API agrees it is stuck. Equal to
 * the worker's threshold; checked here too so a report cannot page anyone about
 * a dispatch that is merely in flight.
 */
export const STUCK_SENDING_AFTER_MS = 15 * 60_000;

/**
 * Turns a delivery the worker must not fix by itself into a human's job.
 *
 * Two cases (WRK-2, WRK-3): an asset stuck in SENDING — the API died between
 * claiming it and recording the outcome, so the code may or may not have
 * reached the customer and an automatic re-send could deliver it twice — and an
 * asset whose automatic retries are used up.
 *
 * Each is reported once per asset: a reconciliation issue is the durable
 * record (its `openDedupeKey` is unique), and a Telegram page goes out only
 * when that issue was newly opened. The worker's claim is never taken on
 * trust; the asset's current state is re-read and must still match.
 *
 * Nothing secret is read: no code, no PIN, no recipient address.
 */
@Injectable()
export class DeliveryProblemService {
  constructor(
    @Inject(DELIVERY_PROBLEM_DATABASE) private readonly db: DeliveryProblemDatabase,
    @Optional() @Inject(AlertLogger) private readonly alerts?: AlertLogger,
  ) {}

  async report(
    input: { readonly assetId: string; readonly problem: DeliveryProblem },
    now: Date = new Date(),
  ): Promise<{ reported: boolean }> {
    const asset = await this.db.giftCardAsset.findUnique({
      where: { id: input.assetId },
      select: {
        id: true,
        orderId: true,
        fulfillmentId: true,
        status: true,
        updatedAt: true,
        supersededAt: true,
        order: { select: { orderNumber: true } },
      },
    });
    if (asset === null) {
      throw DomainErrors.notFound(`gift card asset ${input.assetId}`);
    }

    const stillTrue =
      asset.supersededAt === null &&
      (input.problem === 'SENDING_STUCK'
        ? asset.status === 'SENDING' &&
          asset.updatedAt.getTime() <= now.getTime() - STUCK_SENDING_AFTER_MS
        : asset.status === 'DELIVERY_FAILED');
    if (!stillTrue) {
      throw DomainErrors.conflict(
        'وضعیت این کارت تغییر کرده است.',
        `asset ${asset.id} no longer matches ${input.problem} (status ${asset.status})`,
      );
    }

    const type = DELIVERY_PROBLEM_ISSUE_TYPES[input.problem];
    // Once per asset and kind, including after an earlier issue was resolved.
    const earlier = await this.db.reconciliationIssue.findFirst({
      where: { giftCardAssetId: asset.id, type },
      select: { id: true },
    });
    if (earlier !== null) {
      return { reported: false };
    }

    const automaticAttempts = await this.db.deliveryAttempt.count({
      where: { giftCardAssetId: asset.id, initiatedByStaffId: null },
    });

    try {
      await this.db.reconciliationIssue.create({
        data: {
          type,
          severity: 'HIGH',
          orderId: asset.orderId,
          fulfillmentId: asset.fulfillmentId,
          giftCardAssetId: asset.id,
          details: {
            problem: input.problem,
            assetStatus: asset.status,
            since: asset.updatedAt.toISOString(),
            automaticAttempts,
          },
          openDedupeKey: `${asset.id}:${input.problem}`,
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code === 'P2002') {
        // A concurrent report opened it first; that one pages.
        return { reported: false };
      }
      throw error;
    }

    this.alerts?.log({
      severity: 'ERROR',
      source: 'ORDER',
      message:
        input.problem === 'SENDING_STUCK'
          ? `Gift card for order ${asset.order.orderNumber} stuck while sending — check the mail provider before resending`
          : `Gift card for order ${asset.order.orderNumber} not delivered after ${String(
              automaticAttempts,
            )} automatic attempts`,
      context: {
        orderId: asset.orderId,
        assetId: asset.id,
        problem: input.problem,
        automaticAttempts,
      },
      dedupKey: `delivery:${asset.id}:${input.problem}`,
    });

    return { reported: true };
  }
}
