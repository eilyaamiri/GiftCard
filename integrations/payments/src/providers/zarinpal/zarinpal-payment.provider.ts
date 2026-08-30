import type { PaymentAmountUnit, PaymentFailureReason } from '@barat/contracts';

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

export const DEFAULT_ZARINPAL_REQUEST_URL =
  'https://api.zarinpal.com/pg/v4/payment/request.json';
export const DEFAULT_ZARINPAL_VERIFY_URL =
  'https://api.zarinpal.com/pg/v4/payment/verify.json';
export const DEFAULT_ZARINPAL_STARTPAY_URL = 'https://www.zarinpal.com/pg/StartPay';
export const DEFAULT_ZARINPAL_TIMEOUT_MS = 10_000;

export interface ZarinPalPaymentProviderConfig {
  readonly merchantId: string;
  readonly callbackUrl: string;
  readonly amountUnit: PaymentAmountUnit;
  readonly requestUrl?: string;
  readonly verifyUrl?: string;
  readonly startPayUrl?: string;
  readonly timeoutMs?: number;
}

export interface PaymentHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Injectable so tests can never accidentally reach the real gateway. */
export interface PaymentHttpClient {
  postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<PaymentHttpResponse>;
}

export class FetchPaymentHttpClient implements PaymentHttpClient {
  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<PaymentHttpResponse> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: stringifyJsonWithBigInt(body),
      signal,
    });
  }
}

/**
 * Converts canonical IRR to the exact integer expected by the merchant contract.
 * There is deliberately no rounding path.
 */
export function toZarinPalAmount(amountIrr: bigint, unit: PaymentAmountUnit): bigint {
  if (amountIrr <= 0n) {
    throw new RangeError('Payment amount must be a positive IRR integer');
  }
  if (unit === 'IRR') {
    return amountIrr;
  }
  if (amountIrr % 10n !== 0n) {
    throw new RangeError('IRR amount is not exactly representable in toman');
  }
  return amountIrr / 10n;
}

export class ZarinPalPaymentProvider implements RialPaymentProvider {
  readonly name = 'zarinpal';

  private readonly merchantId: string;
  private readonly callbackUrl: string;
  private readonly amountUnit: PaymentAmountUnit;
  private readonly requestUrl: string;
  private readonly verifyUrl: string;
  private readonly startPayUrl: string;
  private readonly timeoutMs: number;

  constructor(
    config: ZarinPalPaymentProviderConfig,
    private readonly httpClient: PaymentHttpClient = new FetchPaymentHttpClient(),
  ) {
    const validated = validateConfig(config);
    this.merchantId = validated.merchantId;
    this.callbackUrl = validated.callbackUrl;
    this.amountUnit = validated.amountUnit;
    this.requestUrl = validated.requestUrl;
    this.verifyUrl = validated.verifyUrl;
    this.startPayUrl = validated.startPayUrl;
    this.timeoutMs = validated.timeoutMs;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const providerAmount = toZarinPalAmount(input.amountIrr, this.amountUnit);
    const metadata: Record<string, string> = {};
    if (input.customerMobile) metadata.mobile = input.customerMobile;
    if (input.customerEmail) metadata.email = input.customerEmail;

    const response = await this.post(this.requestUrl, {
      merchant_id: this.merchantId,
      amount: providerAmount,
      callback_url: this.callbackUrl || input.callbackUrl,
      description: input.description,
      metadata,
    });

    if (!response.ok) {
      return {
        ok: false,
        providerCode: response.providerCode,
        failureReason: response.failureReason,
      };
    }

    const code = readInteger(response.payload, ['data', 'code']);
    const authority = readString(response.payload, ['data', 'authority']);
    if (code !== 100 || authority === null || authority.length > 128) {
      return {
        ok: false,
        providerCode: code,
        failureReason: normalizeZarinPalFailure(code, 'request'),
      };
    }

    const feeInProviderUnit = readBigInt(response.payload, ['data', 'fee']);
    return {
      ok: true,
      authority,
      redirectUrl: `${this.startPayUrl}/${encodeURIComponent(authority)}`,
      providerCode: 100,
      providerAmount,
      providerAmountUnit: this.amountUnit,
      providerFeeIrr:
        feeInProviderUnit === null ? null : fromProviderAmount(feeInProviderUnit, this.amountUnit),
      providerFeeType: boundedString(response.payload, ['data', 'fee_type'], 64),
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyResult> {
    const providerAmount = toZarinPalAmount(input.amountIrr, this.amountUnit);
    const response = await this.post(this.verifyUrl, {
      merchant_id: this.merchantId,
      amount: providerAmount,
      authority: input.authority,
    });

    if (!response.ok) {
      return {
        outcome: response.failureReason === 'PROVIDER_TIMEOUT' ? 'UNKNOWN' : 'FAILED',
        providerCode: response.providerCode,
        failureReason: response.failureReason,
      };
    }

    const code = readInteger(response.payload, ['data', 'code']);
    if (code === 101) {
      return {
        outcome: 'ALREADY_VERIFIED',
        providerCode: 101,
        authority: input.authority,
        providerAmount,
        providerAmountUnit: this.amountUnit,
      };
    }

    if (code !== 100) {
      return {
        outcome: isIndeterminateCode(code) ? 'UNKNOWN' : 'FAILED',
        providerCode: code,
        failureReason: normalizeZarinPalFailure(code, 'verify'),
      };
    }

    const refId = readReference(response.payload, ['data', 'ref_id']);
    if (refId === null) {
      return {
        outcome: 'UNKNOWN',
        providerCode: 100,
        failureReason: 'UNKNOWN_PROVIDER_RESPONSE',
      };
    }

    const feeInProviderUnit = readBigInt(response.payload, ['data', 'fee']);
    return {
      outcome: 'VERIFIED',
      providerCode: 100,
      authority: input.authority,
      providerAmount,
      providerAmountUnit: this.amountUnit,
      refId,
      maskedCard: maskCard(readString(response.payload, ['data', 'card_pan'])),
      cardHash: boundedString(response.payload, ['data', 'card_hash'], 256),
      providerFeeIrr:
        feeInProviderUnit === null ? null : fromProviderAmount(feeInProviderUnit, this.amountUnit),
      providerFeeType: boundedString(response.payload, ['data', 'fee_type'], 64),
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusResult> {
    const result = await this.verifyPayment(input);
    if (result.outcome === 'VERIFIED') return { status: 'PAID', providerCode: 100 };
    if (result.outcome === 'ALREADY_VERIFIED') {
      return { status: 'ALREADY_VERIFIED', providerCode: 101 };
    }
    return {
      status: result.outcome,
      providerCode: result.providerCode,
      failureReason: result.failureReason,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    void input;
    return { outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' };
  }

  private async post(
    url: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<
    | { readonly ok: true; readonly payload: unknown }
    | {
        readonly ok: false;
        readonly providerCode: number | null;
        readonly failureReason: PaymentFailureReason;
      }
  > {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.httpClient.postJson(url, body, controller.signal);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          providerCode: null,
          failureReason: 'UNKNOWN_PROVIDER_RESPONSE',
        };
      }

      const code =
        readInteger(payload, ['data', 'code']) ?? readInteger(payload, ['errors', 'code']);
      if (!response.ok) {
        return {
          ok: false,
          providerCode: code,
          failureReason:
            response.status >= 500
              ? 'PROVIDER_NETWORK_ERROR'
              : normalizeZarinPalFailure(code, 'request'),
        };
      }
      return { ok: true, payload };
    } catch {
      return {
        ok: false,
        providerCode: null,
        failureReason: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function normalizeZarinPalFailure(
  code: number | null,
  phase: 'request' | 'verify',
): PaymentFailureReason {
  if (code === -50) return 'AMOUNT_MISMATCH';
  if (code === -54) return 'INVALID_AUTHORITY';
  if (code === -51) return 'VERIFY_FAILED';
  if (code === null || code === -52 || code === -53) return 'UNKNOWN_PROVIDER_RESPONSE';
  return phase === 'request' ? 'REQUEST_REJECTED' : 'VERIFY_FAILED';
}

function isIndeterminateCode(code: number | null): boolean {
  return code === null || code === -52 || code === -53;
}

function fromProviderAmount(amount: bigint, unit: PaymentAmountUnit): bigint {
  return unit === 'IRR' ? amount : amount * 10n;
}

function validateConfig(config: ZarinPalPaymentProviderConfig): {
  merchantId: string;
  callbackUrl: string;
  amountUnit: PaymentAmountUnit;
  requestUrl: string;
  verifyUrl: string;
  startPayUrl: string;
  timeoutMs: number;
} {
  if (!/^[0-9a-fA-F-]{36}$/u.test(config.merchantId)) {
    throw new Error('ZarinPal is enabled but its merchant identifier is invalid');
  }
  if (config.amountUnit !== 'IRR' && config.amountUnit !== 'IRT') {
    throw new Error('ZarinPal amount unit must be IRR or IRT');
  }

  const requestUrl = validateHttpUrl(config.requestUrl ?? DEFAULT_ZARINPAL_REQUEST_URL, 'request');
  const verifyUrl = validateHttpUrl(config.verifyUrl ?? DEFAULT_ZARINPAL_VERIFY_URL, 'verify');
  const startPayUrl = validateHttpUrl(
    config.startPayUrl ?? DEFAULT_ZARINPAL_STARTPAY_URL,
    'start-pay',
  ).replace(/\/+$/u, '');
  const callbackUrl = validateHttpUrl(config.callbackUrl, 'callback');
  const timeoutMs = config.timeoutMs ?? DEFAULT_ZARINPAL_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error('ZarinPal request timeout must be an integer from 1 to 60000 milliseconds');
  }

  return {
    merchantId: config.merchantId,
    callbackUrl,
    amountUnit: config.amountUnit,
    requestUrl,
    verifyUrl,
    startPayUrl,
    timeoutMs,
  };
}

function validateHttpUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`ZarinPal ${label} URL is invalid`);
  }
}

function stringifyJsonWithBigInt(value: Readonly<Record<string, unknown>>): string {
  const marker = '__BARAT_BIGINT__';
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? `${marker}${item.toString()}` : item,
  ).replace(new RegExp(`"${marker}(-?\\d+)"`, 'gu'), '$1');
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !(segment in current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readInteger(value: unknown, path: readonly string[]): number | null {
  const candidate = readPath(value, path);
  if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) return candidate;
  if (typeof candidate === 'string' && /^-?\d+$/u.test(candidate)) {
    const parsed = Number(candidate);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function readBigInt(value: unknown, path: readonly string[]): bigint | null {
  const candidate = readPath(value, path);
  if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) return BigInt(candidate);
  if (typeof candidate === 'string' && /^\d+$/u.test(candidate)) return BigInt(candidate);
  return null;
}

function readString(value: unknown, path: readonly string[]): string | null {
  const candidate = readPath(value, path);
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function boundedString(value: unknown, path: readonly string[], max: number): string | null {
  const result = readString(value, path);
  return result !== null && result.length <= max ? result : null;
}

function readReference(value: unknown, path: readonly string[]): string | null {
  const candidate = readPath(value, path);
  if (typeof candidate === 'string' && /^\d{1,64}$/u.test(candidate)) return candidate;
  if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) {
    return candidate.toString();
  }
  return null;
}

function maskCard(card: string | null): string | null {
  if (card === null) return null;
  const digits = card.replace(/\D/gu, '');
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}********${digits.slice(-4)}`;
}
