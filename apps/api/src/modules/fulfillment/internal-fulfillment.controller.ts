import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

/* The concrete module, not the barrel: the barrel's ConfigModule validates the
 * whole environment at import time. */
import { AppConfigService } from '../../common/config/app-config.service';
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
 * both sides are hashed to a fixed 32-byte width first and the digests are
 * compared — one code path, whatever the presented value's length.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
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
 * The token comes from the validated environment (`INTERNAL_SERVICE_TOKEN`,
 * at least 32 characters). This fails closed: with no token configured every
 * request is rejected rather than allowed.
 */
@Controller('internal/fulfillment')
export class InternalFulfillmentController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

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
    const expected = this.config.internalServiceToken();
    if (expected === null || expected.length < 32) {
      throw DomainErrors.forbidden(
        'INTERNAL_SERVICE_TOKEN is unset; internal endpoints are disabled',
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
