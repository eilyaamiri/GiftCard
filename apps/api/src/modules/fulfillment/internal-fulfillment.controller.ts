import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

import { DomainErrors } from '../../common/errors/domain.exception';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FulfillmentService, type DeliveryOutcome } from './fulfillment.service';
import { internalRetryDeliveryBodySchema, type InternalRetryDeliveryBody } from './fulfillment.schemas';

/** Header the worker presents. */
export const INTERNAL_SERVICE_TOKEN_HEADER = 'x-internal-service-token';

/** Path the delivery-retry worker posts to. Mirrored in `apps/worker`. */
export const INTERNAL_RETRY_DELIVERY_PATH = '/internal/fulfillment/retry-delivery';

interface RequestWithHeaders {
  headers?: Record<string, unknown>;
}

/**
 * Constant-time comparison that does not leak the token length either.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself an oracle, so
 * both sides are hashed to a fixed width first — cheap, and removes the branch.
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison of equal length so the failure path costs the same.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Machine-to-machine surface for the background worker.
 *
 * The worker cannot decrypt a gift-card code — the key and the crypto live only
 * in the API process — so an automatic delivery retry has to come back through
 * here. This endpoint deliberately exposes nothing but "retry the delivery of an
 * asset that already exists": no asset creation, no code in the request, no code
 * in the response.
 *
 * GAP NOTE: `INTERNAL_SERVICE_TOKEN` is read from `process.env` rather than from
 * `common/config/env.schema.ts`, which is owned by another agent and frozen for
 * this task. It should be moved into the validated env schema (required in
 * production, minimum 32 chars). Until then this fails closed: an unset or short
 * token rejects every request rather than allowing them.
 */
@Controller('internal/fulfillment')
export class InternalFulfillmentController {
  constructor(@Inject(FulfillmentService) private readonly fulfillment: FulfillmentService) {}

  @Post('retry-delivery')
  async retryDelivery(
    @Body(zodPipe(internalRetryDeliveryBodySchema)) body: InternalRetryDeliveryBody,
    @Req() request: unknown,
  ): Promise<{ delivered: boolean; assetId: string; attemptNumber: number; failureCode: string | null }> {
    this.assertInternalCaller(request);
    const outcome: DeliveryOutcome = await this.fulfillment.retryDeliveryForAsset(body.assetId);
    // The workspace is intentionally dropped: the worker has no operator context
    // and no business holding checklist or asset detail in its logs.
    return {
      delivered: outcome.delivered,
      assetId: outcome.assetId,
      attemptNumber: outcome.attemptNumber,
      failureCode: outcome.failureCode,
    };
  }

  private assertInternalCaller(request: unknown): void {
    const expected = process.env['INTERNAL_SERVICE_TOKEN'];
    if (typeof expected !== 'string' || expected.length < 32) {
      throw DomainErrors.forbidden(
        'INTERNAL_SERVICE_TOKEN is unset or shorter than 32 characters; internal endpoints are disabled',
      );
    }

    const headers = (request as RequestWithHeaders).headers ?? {};
    const presented = headers[INTERNAL_SERVICE_TOKEN_HEADER];
    if (typeof presented !== 'string' || !tokenMatches(presented, expected)) {
      // The token itself never appears in the message.
      throw DomainErrors.unauthenticated();
    }
  }
}
