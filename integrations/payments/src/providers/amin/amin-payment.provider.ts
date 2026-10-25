import { createHash } from 'node:crypto';

import type { PaymentFailureReason } from '@barat/contracts';

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  GetPaymentStatusInput,
  GetPaymentStatusResult,
  RefundInput,
  RefundResult,
  RialPaymentProvider,
  VerifyPaymentInput,
  VerifyResult,
} from '../../rial-payment-provider.interface';
import {
  FetchPaymentHttpClient,
  type PaymentHttpClient,
} from '../zarinpal/zarinpal-payment.provider';

/** Amin (aminremit.com) payment-gateway API v2.0. */
export const DEFAULT_AMIN_BASE_URL = 'https://api.aminremit.com';
export const DEFAULT_AMIN_TIMEOUT_MS = 10_000;
/** The vendor documentation's limits, in rial, which is the only unit the API speaks. */
export const AMIN_MIN_AMOUNT_IRR = 50_000n;
export const AMIN_MAX_AMOUNT_IRR = 1_000_000_000n;

const DESCRIPTION_MAX = 255;
/** What we accept back from the gateway as an identifier before it reaches a URL or a column. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
/** `authority` is our own `order_id`; the return endpoint validates against the same shape. */
export const AMIN_ORDER_ID_PATTERN = /^[A-Za-z0-9-]{1,80}$/u;

/**
 * Verify statuses that are the gateway's own verdict that this payment did not
 * succeed. Every other non-success status is about the REQUEST (a wrong
 * reference, bad parameters, a disabled gateway) and says nothing about whether
 * the customer paid, so it is `UNKNOWN`, never `FAILED`.
 */
const DEFINITE_FAILURE_STATUSES: ReadonlySet<string> = new Set([
  'TRX_FAILED',
  'INVALID_CARD',
  'AMOUNT_LIMIT_EXCEEDED',
]);

export interface AminPaymentProviderConfig {
  /** The gateway identifier from the Amin user profile (`شناسه یکتا`). Never logged, never in an error. */
  readonly merchantId: string;
  /**
   * Our browser-facing return endpoint, e.g. `https://api.centohub.com/api/payments/amin/return`.
   * Its host must match the site address registered in the Amin panel.
   */
  readonly returnUrl: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

type Call =
  | { readonly kind: 'ok'; readonly status: number; readonly payload: unknown }
  | { readonly kind: 'rejected'; readonly status: number; readonly payload: unknown }
  | { readonly kind: 'indeterminate'; readonly failureReason: PaymentFailureReason };

/**
 * Amin checkout adapter.
 *
 * The gateway is single-phase like ZarinPal: `/api/v1/verify/` is the commit, so
 * there is no `confirmPayment`.
 *
 * Shape of the flow, all from the vendor documentation:
 *  - `/api/v1/withdraw/` takes OUR `order_id` and returns a redirect `token` and
 *    a `ref_num`. The customer is sent to `/pgw/pay/{token}`.
 *  - The gateway then calls our `callback_url` with `order_id`, `ref_num`,
 *    `tracking_code`, `card_no` and `status`.
 *  - `/api/v1/verify/` needs `order_id`, `amount`, `tracking_code` AND `ref_num`.
 *
 * Consequences this adapter is built around:
 *  - The stored `authority` is our own `order_id`, because it is the only
 *    identifier the callback gives back that we generated ourselves. It is
 *    derived from the idempotency key, so it is unguessable and unique per
 *    payment, and an existing order number alone cannot be used to find a payment.
 *  - `ref_num` and `tracking_code` exist only on the callback, so a verify
 *    without them (the customer's manual re-check before any callback) is
 *    `UNKNOWN`: the gateway cannot be asked, and asking with guesses would only
 *    manufacture errors. The caller supplies them as `evidence`.
 *  - There is no idempotency key on `withdraw`; the vendor documents only that
 *    `order_id` must be unique per request, which our derivation guarantees.
 *  - No refund API is documented, so `refund` reports `NOT_SUPPORTED`.
 */
export class AminPaymentProvider implements RialPaymentProvider {
  readonly name = 'amin';

  private readonly merchantId: string;
  private readonly returnUrl: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    config: AminPaymentProviderConfig,
    private readonly httpClient: PaymentHttpClient = new FetchPaymentHttpClient(),
  ) {
    if (!/^[A-Za-z0-9_-]{4,128}$/u.test(config.merchantId)) {
      throw new Error('Amin is enabled but its merchant identifier is invalid');
    }
    this.merchantId = config.merchantId;
    this.returnUrl = validateHttpUrl(config.returnUrl, 'return');
    this.baseUrl = validateHttpUrl(config.baseUrl ?? DEFAULT_AMIN_BASE_URL, 'base').replace(/\/+$/u, '');
    const timeoutMs = config.timeoutMs ?? DEFAULT_AMIN_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error('Amin request timeout must be an integer from 1 to 60000 milliseconds');
    }
    this.timeoutMs = timeoutMs;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.amountIrr < AMIN_MIN_AMOUNT_IRR || input.amountIrr > AMIN_MAX_AMOUNT_IRR) {
      /* The gateway would refuse it; saying so here keeps the customer from a
       * round trip and gives the failure a stable, honest reason. */
      return { ok: false, providerCode: null, failureReason: 'REQUEST_REJECTED' };
    }

    const orderId = buildAminOrderId(input.orderNumber, input.idempotencyKey);
    const body: Record<string, unknown> = {
      merchant_id: this.merchantId,
      order_id: orderId,
      amount: input.amountIrr.toString(),
      callback_url: this.returnUrl,
      callback_method: 'GET',
      description: input.description.slice(0, DESCRIPTION_MAX),
    };
    const mobile = toAminMobile(input.customerMobile);
    if (mobile !== null) body.mobile = mobile;
    if (input.customerEmail) body.email = input.customerEmail;

    const call = await this.post('/api/v1/withdraw/', body);
    if (call.kind === 'indeterminate') {
      return { ok: false, providerCode: null, failureReason: call.failureReason };
    }
    if (call.kind === 'rejected') {
      return { ok: false, providerCode: call.status, failureReason: 'REQUEST_REJECTED' };
    }

    const token = readString(call.payload, 'token');
    if (token === null || !TOKEN_PATTERN.test(token)) {
      return { ok: false, providerCode: call.status, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }

    return {
      ok: true,
      authority: orderId,
      redirectUrl: `${this.baseUrl}/pgw/pay/${encodeURIComponent(token)}`,
      providerCode: call.status,
      providerAmount: input.amountIrr,
      providerAmountUnit: 'IRR',
      providerFeeIrr: null,
      providerFeeType: null,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyResult> {
    const refNum = input.evidence?.ref_num;
    const trackingCode = input.evidence?.tracking_code;
    if (
      !AMIN_ORDER_ID_PATTERN.test(input.authority) ||
      refNum === undefined ||
      trackingCode === undefined ||
      !REFERENCE_PATTERN.test(refNum) ||
      !REFERENCE_PATTERN.test(trackingCode)
    ) {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }

    const call = await this.post('/api/v1/verify/', {
      merchant_id: this.merchantId,
      order_id: input.authority,
      amount: input.amountIrr.toString(),
      tracking_code: trackingCode,
      ref_num: refNum,
    });

    /* A transport error or a 5xx says nothing about whether the customer paid. */
    if (call.kind === 'indeterminate') {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: call.failureReason };
    }

    /* The gateway reports the verdict in `status`, on a 400 as well as on a 200. */
    const status = readString(call.payload, 'status');
    if (status === null) {
      return { outcome: 'UNKNOWN', providerCode: call.status, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }

    if (call.kind === 'ok' && status === 'ALREADY_PAYED') {
      return {
        outcome: 'ALREADY_VERIFIED',
        providerCode: 101,
        authority: input.authority,
        providerAmount: input.amountIrr,
        providerAmountUnit: 'IRR',
      };
    }

    if (call.kind === 'ok' && status === 'CONFIRMED') {
      const data = readObject(call.payload, 'data');
      const reported = readAmount(data, 'amount');
      if (reported === null) {
        /* A confirmation we cannot check against our own amount is not one we act on. */
        return { outcome: 'UNKNOWN', providerCode: 100, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
      }
      if (reported !== input.amountIrr) {
        return { outcome: 'FAILED', providerCode: 100, failureReason: 'AMOUNT_MISMATCH' };
      }
      const echoedRef = readString(data, 'ref_num');
      if (echoedRef !== null && echoedRef !== refNum) {
        return { outcome: 'UNKNOWN', providerCode: 100, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
      }
      return {
        outcome: 'VERIFIED',
        providerCode: 100,
        authority: input.authority,
        providerAmount: reported,
        providerAmountUnit: 'IRR',
        refId: trackingCode,
        maskedCard: maskCard(readString(data, 'card_number')),
        cardHash: null,
        providerFeeIrr: null,
        providerFeeType: null,
      };
    }

    if (DEFINITE_FAILURE_STATUSES.has(status)) {
      return { outcome: 'FAILED', providerCode: call.status, failureReason: 'VERIFY_FAILED' };
    }
    return { outcome: 'UNKNOWN', providerCode: call.status, failureReason: 'VERIFY_FAILED' };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    const result = await this.verifyPayment(input);
    if (result.outcome === 'VERIFIED') return { status: 'PAID', providerCode: 100 };
    if (result.outcome === 'ALREADY_VERIFIED') return { status: 'ALREADY_VERIFIED', providerCode: 101 };
    return { status: result.outcome, providerCode: result.providerCode, failureReason: result.failureReason };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    void input;
    return { outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' };
  }

  private async post(path: string, body: Readonly<Record<string, unknown>>): Promise<Call> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.httpClient.postJson(`${this.baseUrl}${path}`, body, controller.signal);
      if (response.status >= 500) {
        return { kind: 'indeterminate', failureReason: 'PROVIDER_NETWORK_ERROR' };
      }
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        if (response.ok) {
          return { kind: 'indeterminate', failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
        }
      }
      if (!response.ok) return { kind: 'rejected', status: response.status, payload };
      return { kind: 'ok', status: response.status, payload };
    } catch {
      return {
        kind: 'indeterminate',
        failureReason: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The gateway-facing `order_id`: our order number plus a digest of the
 * idempotency key. Unique per payment (a retry after a failure carries a new
 * key), stable for one key, and not derivable from the order number alone.
 */
export function buildAminOrderId(orderNumber: string, idempotencyKey: string): string {
  const prefix = orderNumber.replace(/[^A-Za-z0-9-]/gu, '').slice(0, 40);
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24);
  return prefix === '' ? digest : `${prefix}-${digest}`;
}

/**
 * Amin accepts a mobile only as 11 digits, `09123456789`. Our canonical form is
 * `+989123456789`, which Amin refuses with a 400 ("at most 11 characters") — a
 * rejected payment for exactly the customers who have a verified number. The
 * field is optional, so anything that is not an Iranian mobile is left out
 * rather than allowed to fail the payment.
 */
export function toAminMobile(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const match = /^(?:\+98|98|0)(9\d{9})$/u.exec(value.trim());
  return match === null ? null : `0${match[1] as string}`;
}

function validateHttpUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`Amin ${label} URL is invalid`);
  }
}

function readObject(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return null;
  return (value as Record<string, unknown>)[key] ?? null;
}

function readString(value: unknown, key: string): string | null {
  const candidate = readObject(value, key);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/** An integer rial amount, as a JSON number or a string such as `"100000"` / `"100000.00"`. */
function readAmount(value: unknown, key: string): bigint | null {
  const candidate = readObject(value, key);
  if (typeof candidate === 'number') {
    return Number.isSafeInteger(candidate) && candidate >= 0 ? BigInt(candidate) : null;
  }
  if (typeof candidate === 'string') {
    const match = /^(\d{1,15})(?:\.0{1,6})?$/u.exec(candidate);
    return match === null ? null : BigInt(match[1] as string);
  }
  return null;
}

function maskCard(card: string | null): string | null {
  if (card === null) return null;
  const digits = card.replace(/\D/gu, '');
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}********${digits.slice(-4)}`;
}
