import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/** Header carrying the caller-supplied idempotency key. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Same shape as `idempotencyKeySchema` in @barat/contracts. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;

/**
 * Methods that mutate state and therefore may carry an idempotency key.
 * The key is only *read* here; enforcing "one effect per key" is each module's
 * job, backed by a unique column in the database (AGENTS.md rule 9).
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A request that has passed through this interceptor. */
export interface IdempotentRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  idempotencyKey?: string;
}

/**
 * Normalises the `Idempotency-Key` header onto the request object.
 *
 * Rejecting a malformed key at the edge means a module can trust
 * `request.idempotencyKey` to be either absent or well-formed, and never has to
 * guard against a key that is empty, enormous, or shaped like a SQL fragment.
 *
 * A missing key is allowed here — the endpoints that *require* one (payment
 * creation, quote acceptance, order creation, fulfillment) declare that
 * themselves, so a read endpoint is not forced to invent a key.
 */
@Injectable()
export class IdempotencyHeaderInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<IdempotentRequest>();

    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    const raw = request.headers[IDEMPOTENCY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (value !== undefined && value !== '') {
      if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'کلید Idempotency معتبر نیست.',
        });
      }
      request.idempotencyKey = value;
    }

    return next.handle();
  }
}
