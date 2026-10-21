import type { PaymentAmountUnit, PaymentFailureReason } from '@barat/contracts';

import type {
  ConfirmPaymentInput,
  ConfirmPaymentResult,
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

/** BazaarPay API v1. Every URL must end with a slash, per the vendor docs. */
export const DEFAULT_BAZAARPAY_BASE_URL = 'https://api.bazaar-pay.ir/badje/v1';
export const DEFAULT_BAZAARPAY_TIMEOUT_MS = 10_000;
/** The `/checkout/init/` documentation caps the amount here, in the merchant's unit. */
export const BAZAARPAY_MAX_AMOUNT = 1_000_000_000n;
const SERVICE_NAME_MAX = 512;
/** The hosted payment page must live under this domain; anything else is not followed. */
const PAYMENT_HOST_SUFFIX = 'bazaar-pay.ir';
/** HTTP statuses on `/trace/` that are a real verdict on the token. */
const DEFINITE_TRACE_REJECTIONS: ReadonlySet<number> = new Set([400, 404]);
/**
 * Auto-login is a convenience on the way to the payment page, so it gets a
 * short leash of its own: a slow token call must not hold up the checkout.
 */
const AUTO_LOGIN_TIMEOUT_MS = 3_000;
/** Printable ASCII without spaces; anything else is not put into a URL. */
const AUTO_LOGIN_TOKEN_PATTERN = /^[\x21-\x7E]{1,2048}$/u;

export interface BazaarPayPaymentProviderConfig {
  /** The merchant `Authorization: Token ...` value. A secret: never logged, never in an error. */
  readonly apiToken: string;
  /** The merchant unique name BazaarPay assigned (`destination` of init-checkout). */
  readonly destination: string;
  /** Our browser-facing return endpoint, e.g. `https://www.centohub.com/api/payments/bazaarpay/return`. */
  readonly returnUrl: string;
  /** The wire unit. The docs do not state it for checkouts, so it is explicit config. */
  readonly amountUnit?: PaymentAmountUnit;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
  /**
   * Sign the customer straight into the hosted page ("auto login") with a token
   * the merchant requests for the customer's mobile, so someone already signed
   * in on our site is not asked to log in again at BazaarPay. BazaarPay has to
   * enable it for the merchant; until it does, every token request is refused
   * and the customer simply logs in as before. Off unless explicitly `true`.
   */
  readonly autoLogin?: boolean;
}

export interface BazaarPayHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Injectable so tests can never accidentally reach the real gateway. */
export interface BazaarPayHttpClient {
  postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<BazaarPayHttpResponse>;
}

export class FetchBazaarPayHttpClient implements BazaarPayHttpClient {
  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<BazaarPayHttpResponse> {
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
}

/**
 * Converts canonical IRR to the integer BazaarPay is configured to expect.
 * There is deliberately no rounding path, and no float ever carries the amount.
 */
export function toBazaarPayAmount(amountIrr: bigint, unit: PaymentAmountUnit): bigint {
  if (amountIrr <= 0n) {
    throw new RangeError('Payment amount must be a positive IRR integer');
  }
  if (unit === 'IRR') return amountIrr;
  if (amountIrr % 10n !== 0n) {
    throw new RangeError('IRR amount is not exactly representable in toman');
  }
  return amountIrr / 10n;
}

/**
 * The mobile in the `09xxxxxxxxx` form the vendor examples use, or null.
 * Anything that is not plainly an Iranian mobile is not sent at all.
 */
export function toBazaarPayPhone(mobile: string | null | undefined): string | null {
  if (mobile === null || mobile === undefined) return null;
  const value = mobile.trim().replace(/^\+/u, '');
  if (/^09\d{9}$/u.test(value)) return value;
  if (/^989\d{9}$/u.test(value)) return `0${value.slice(2)}`;
  return null;
}

type TraceStatus =
  | 'invalid_token'
  | 'unpaid'
  | 'paid_not_committed'
  | 'paid_not_committed_refunded'
  | 'paid_committed'
  | 'refunded'
  | 'timed_out';

const TRACE_STATUSES: ReadonlySet<string> = new Set<TraceStatus>([
  'invalid_token',
  'unpaid',
  'paid_not_committed',
  'paid_not_committed_refunded',
  'paid_committed',
  'refunded',
  'timed_out',
]);

type Call =
  | { readonly kind: 'ok'; readonly status: number; readonly payload: unknown }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'indeterminate'; readonly failureReason: PaymentFailureReason };

type TraceOutcome =
  | { readonly kind: 'status'; readonly status: TraceStatus }
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'indeterminate'; readonly failureReason: PaymentFailureReason };

/**
 * BazaarPay (bazaar-pay.ir) checkout adapter.
 *
 * The gateway is two-phase: `/checkout/init/` returns a token and a hosted page,
 * the customer pays there, and the merchant must then `/commit/` — otherwise the
 * whole amount goes back to the customer's wallet after a few minutes. So:
 *
 *  - `verifyPayment` only READS (`/trace/`). `paid_not_committed` is VERIFIED and
 *    `paid_committed` is ALREADY_VERIFIED, mirroring ZarinPal's 100 / 101.
 *  - `confirmPayment` is the only place that commits, and the payments service
 *    calls it strictly after PAID is durably stored.
 *
 * Known limits, all from the vendor documentation rather than from this code:
 *  - `/trace/` returns a status and nothing else: no amount, no bank reference,
 *    no card. The amount is therefore bound only by our own server-to-server
 *    init call (the customer cannot change a token's amount), and `providerRefId`
 *    is the checkout token because that is the only identifier BazaarPay offers.
 *  - There is no idempotency key on init. A timed-out init is reported as a
 *    failure and the next attempt creates a new token; an orphan token that was
 *    never paid expires by itself and moves no money.
 *  - `refund` is intentionally NOT_SUPPORTED until the refund flow is designed.
 *
 * Auto-login (`/merchant/create-user-access-token/` + `auto_login_token` on the
 * payment page) was documented by BazaarPay from January 2024 and dropped from
 * the public docs in September 2025; it is kept strictly best effort here, as
 * that documentation itself required. The token signs the customer into their
 * BazaarPay wallet, so it is never logged, stored or quoted in an error, and it
 * is only ever requested for a mobile the caller has verified.
 */
export class BazaarPayPaymentProvider implements RialPaymentProvider {
  readonly name = 'bazaarpay';

  private readonly apiToken: string;
  private readonly destination: string;
  private readonly returnUrl: string;
  private readonly amountUnit: PaymentAmountUnit;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly autoLogin: boolean;

  constructor(
    config: BazaarPayPaymentProviderConfig,
    private readonly httpClient: BazaarPayHttpClient = new FetchBazaarPayHttpClient(),
  ) {
    if (config.apiToken.trim() === '' || /\s/u.test(config.apiToken)) {
      throw new Error('BazaarPay is enabled but its API token is missing or malformed');
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(config.destination)) {
      throw new Error('BazaarPay is enabled but its merchant destination is invalid');
    }
    const amountUnit = config.amountUnit ?? 'IRR';
    if (amountUnit !== 'IRR' && amountUnit !== 'IRT') {
      throw new Error('BazaarPay amount unit must be IRR or IRT');
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_BAZAARPAY_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error('BazaarPay request timeout must be an integer from 1 to 60000 milliseconds');
    }

    this.apiToken = config.apiToken;
    this.destination = config.destination;
    this.returnUrl = validateHttpUrl(config.returnUrl, 'return');
    this.amountUnit = amountUnit;
    this.baseUrl = validateHttpUrl(config.baseUrl ?? DEFAULT_BAZAARPAY_BASE_URL, 'base').replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
    this.userAgent = config.userAgent ?? 'CENTO-payments/1.0';
    this.autoLogin = config.autoLogin === true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerAmount = toBazaarPayAmount(input.amountIrr, this.amountUnit);
    if (providerAmount > BAZAARPAY_MAX_AMOUNT) {
      /* Refused before any call: the gateway would reject it, and a payment we
       * never opened cannot leave a token behind. */
      return { ok: false, providerCode: null, failureReason: 'REQUEST_REJECTED' };
    }

    const phone = toBazaarPayPhone(input.customerMobile);
    /* Both calls are independent, so the login token costs no extra round trip. */
    const [call, autoLoginToken] = await Promise.all([
      this.post('/checkout/init/', {
        amount: Number(providerAmount),
        destination: this.destination,
        service_name: input.description.slice(0, SERVICE_NAME_MAX),
      }),
      this.autoLogin && phone !== null ? this.createAutoLoginToken(phone) : Promise.resolve(null),
    ]);
    if (call.kind !== 'ok') {
      return {
        ok: false,
        providerCode: call.kind === 'rejected' ? call.status : null,
        failureReason: call.kind === 'rejected' ? 'REQUEST_REJECTED' : call.failureReason,
      };
    }

    const token = readString(call.payload, 'checkout_token');
    const paymentUrl = readString(call.payload, 'payment_url');
    if (token === null || !/^[A-Za-z0-9]{1,128}$/u.test(token) || paymentUrl === null) {
      return { ok: false, providerCode: call.status, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }

    const redirectUrl = this.buildRedirectUrl(paymentUrl, token, input.orderNumber, phone, autoLoginToken);
    if (redirectUrl === null) {
      return { ok: false, providerCode: call.status, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }

    return {
      ok: true,
      authority: token,
      redirectUrl,
      providerCode: call.status,
      providerAmount,
      providerAmountUnit: this.amountUnit,
      providerFeeIrr: null,
      providerFeeType: null,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyResult> {
    const providerAmount = toBazaarPayAmount(input.amountIrr, this.amountUnit);
    const trace = await this.trace(input.authority);

    if (trace.kind === 'indeterminate') {
      /* Not knowing is never reported as a failure: the customer may have paid. */
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: trace.failureReason };
    }
    if (trace.kind === 'rejected') {
      return { outcome: 'FAILED', providerCode: trace.status, failureReason: 'INVALID_AUTHORITY' };
    }

    switch (trace.status) {
      case 'paid_not_committed':
        return {
          outcome: 'VERIFIED',
          providerCode: 100,
          authority: input.authority,
          providerAmount,
          providerAmountUnit: this.amountUnit,
          refId: input.authority,
          maskedCard: null,
          cardHash: null,
          providerFeeIrr: null,
          providerFeeType: null,
        };
      case 'paid_committed':
        return {
          outcome: 'ALREADY_VERIFIED',
          providerCode: 101,
          authority: input.authority,
          providerAmount,
          providerAmountUnit: this.amountUnit,
        };
      case 'unpaid':
        /* Back from the hosted page without paying: cancelled or abandoned. If the
         * customer is somehow still paying, nothing is committed from here, so the
         * amount returns to their wallet on its own. */
        return { outcome: 'FAILED', providerCode: null, failureReason: 'CUSTOMER_CANCELLED' };
      case 'invalid_token':
        return { outcome: 'FAILED', providerCode: null, failureReason: 'INVALID_AUTHORITY' };
      case 'paid_not_committed_refunded':
      case 'timed_out':
        return { outcome: 'FAILED', providerCode: null, failureReason: 'VERIFY_FAILED' };
      case 'refunded':
        /* Committed and then refunded. For a payment we do not hold as PAID that is
         * a contradiction a person must look at, not something to settle quietly. */
        return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    const result = await this.verifyPayment(input);
    if (result.outcome === 'VERIFIED') return { status: 'PAID', providerCode: 100 };
    if (result.outcome === 'ALREADY_VERIFIED') return { status: 'ALREADY_VERIFIED', providerCode: 101 };
    return { status: result.outcome, providerCode: result.providerCode, failureReason: result.failureReason };
  }

  async confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
    const call = await this.post('/commit/', { checkout_token: input.authority });
    if (call.kind === 'ok' && call.status === 204) return { confirmed: true };

    /* The commit may have landed with its response lost, or be a replay. The only
     * authority on that is the gateway's own record. */
    const trace = await this.trace(input.authority);
    if (trace.kind === 'status' && trace.status === 'paid_committed') return { confirmed: true };

    return {
      confirmed: false,
      providerCode: call.kind === 'ok' || call.kind === 'rejected' ? call.status : null,
      failureReason: call.kind === 'indeterminate' ? call.failureReason : 'VERIFY_FAILED',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    void input;
    return { outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' };
  }

  private async trace(authority: string): Promise<TraceOutcome> {
    const call = await this.post('/trace/', { checkout_token: authority });
    if (call.kind === 'indeterminate') return call;
    if (call.kind === 'rejected') {
      /* Only "this token is not valid" (400 / 404) is an answer about the
       * payment. A 401/403 (our credentials), 408, 409 or 429 (rate limit) says
       * nothing about whether the customer paid, and reading it as an invalid
       * token closed paid checkouts as FAILED. */
      if (DEFINITE_TRACE_REJECTIONS.has(call.status)) return call;
      return { kind: 'indeterminate', failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }
    const status = readString(call.payload, 'status');
    if (status === null || !TRACE_STATUSES.has(status)) {
      return { kind: 'indeterminate', failureReason: 'UNKNOWN_PROVIDER_RESPONSE' };
    }
    return { kind: 'status', status: status as TraceStatus };
  }

  /**
   * Best effort by design. A refusal (403 while the feature is not enabled for
   * the merchant, or switched off on BazaarPay's side), a timeout or an odd body
   * all mean the same thing: the customer logs in on the hosted page as before.
   */
  private async createAutoLoginToken(phone: string): Promise<string | null> {
    const call = await this.post(
      '/merchant/create-user-access-token/',
      { user_phone_number: phone, scope: 'purchase' },
      Math.min(this.timeoutMs, AUTO_LOGIN_TIMEOUT_MS),
    );
    if (call.kind !== 'ok') return null;
    const token = readString(call.payload, 'access_token');
    return token !== null && AUTO_LOGIN_TOKEN_PATTERN.test(token) ? token : null;
  }

  /** The hosted page, with our own return URL attached as the vendor documents. */
  private buildRedirectUrl(
    paymentUrl: string,
    token: string,
    orderNumber: string,
    phone: string | null,
    autoLoginToken: string | null,
  ): string | null {
    let page: URL;
    try {
      page = new URL(paymentUrl);
    } catch {
      return null;
    }
    const host = page.hostname.toLowerCase();
    if (
      page.protocol !== 'https:' ||
      (host !== PAYMENT_HOST_SUFFIX && !host.endsWith(`.${PAYMENT_HOST_SUFFIX}`))
    ) {
      return null;
    }

    const back = new URL(this.returnUrl);
    back.searchParams.set('token', token);
    back.searchParams.set('order', orderNumber);
    page.searchParams.set('redirect_url', back.toString());
    /* `phone` only pre-fills the login form; the token skips the form. */
    if (phone !== null) page.searchParams.set('phone', phone);
    if (autoLoginToken !== null) page.searchParams.set('auto_login_token', autoLoginToken);
    return page.toString();
  }

  private async post(
    path: string,
    body: Readonly<Record<string, unknown>>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<Call> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.httpClient.postJson(
        `${this.baseUrl}${path}`,
        body,
        {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Token ${this.apiToken}`,
          'user-agent': this.userAgent,
        },
        controller.signal,
      );
      if (response.status >= 500) {
        return { kind: 'indeterminate', failureReason: 'PROVIDER_NETWORK_ERROR' };
      }
      if (!response.ok) return { kind: 'rejected', status: response.status };
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        /* 204 carries no body, which is the documented success shape for commit. */
      }
      return { kind: 'ok', status: response.status, payload };
    } catch {
      return { kind: 'indeterminate', failureReason: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateHttpUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`BazaarPay ${label} URL is invalid`);
  }
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
