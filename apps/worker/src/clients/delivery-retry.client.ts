/**
 * The worker's link back into the API for delivery retries.
 *
 * Why an HTTP hop instead of doing the send here: `GIFT_CARD_ENCRYPTION_KEY` and
 * the decryption path live in the API process only. Giving the worker the key so
 * it could mail a code itself would double the blast radius of a compromised
 * process for no benefit — the worker's actual job is *deciding when* to retry,
 * not holding the plaintext.
 */

export interface DeliveryRetryOutcome {
  readonly delivered: boolean;
  readonly assetId: string;
  readonly attemptNumber: number;
  readonly failureCode: string | null;
}

export interface DeliveryRetryClient {
  retry(assetId: string): Promise<DeliveryRetryOutcome>;
}

/** Must match `INTERNAL_RETRY_DELIVERY_PATH` in the API's fulfillment module. */
export const INTERNAL_RETRY_DELIVERY_PATH = '/internal/fulfillment/retry-delivery';
export const INTERNAL_SERVICE_TOKEN_HEADER = 'x-internal-service-token';

export class DeliveryRetryClientError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'DeliveryRetryClientError';
  }
}

export interface HttpDeliveryRetryClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpDeliveryRetryClient implements DeliveryRetryClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpDeliveryRetryClientOptions) {
    if (options.token.length < 32) {
      throw new Error('INTERNAL_SERVICE_TOKEN must be at least 32 characters');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async retry(assetId: string): Promise<DeliveryRetryOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${INTERNAL_RETRY_DELIVERY_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_SERVICE_TOKEN_HEADER]: this.token,
        },
        body: JSON.stringify({ assetId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body may echo an internal detail; only the status is surfaced.
        throw new DeliveryRetryClientError(
          `retry-delivery rejected for asset ${assetId}`,
          response.status,
        );
      }

      const payload = (await response.json()) as Partial<DeliveryRetryOutcome>;
      if (typeof payload.delivered !== 'boolean' || typeof payload.assetId !== 'string') {
        throw new DeliveryRetryClientError(`malformed retry-delivery response for asset ${assetId}`, null);
      }

      return {
        delivered: payload.delivered,
        assetId: payload.assetId,
        attemptNumber: typeof payload.attemptNumber === 'number' ? payload.attemptNumber : 0,
        failureCode: typeof payload.failureCode === 'string' ? payload.failureCode : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
