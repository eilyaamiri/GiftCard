import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  Optional,
  RequestTimeoutException,
} from '@nestjs/common';
import { type Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/** Default ceiling for a single HTTP request handler, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Optional DI token to override the ceiling (used by tests and by the worker). */
export const REQUEST_TIMEOUT_MS = 'BARAT_REQUEST_TIMEOUT_MS';

/**
 * Caps how long any request may occupy a worker.
 *
 * This is a liveness guard, not a business rule: a payment that is still
 * in-flight when this fires is NOT failed. It ends up in `UNKNOWN` and is
 * resolved by reconciliation. Never map a timeout to "not paid" — the money may
 * well have moved.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs: number;

  constructor(@Optional() @Inject(REQUEST_TIMEOUT_MS) timeoutMs?: number) {
    this.timeoutMs = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException('پردازش درخواست بیش از حد طول کشید.'),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
