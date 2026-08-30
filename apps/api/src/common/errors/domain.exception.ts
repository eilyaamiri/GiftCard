import { HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@barat/contracts';

/**
 * The base class for every deliberate error the domain raises.
 *
 * It carries two separate messages on purpose:
 *   - `safeMessage` is Persian, customer-facing and safe to render.
 *   - `internalDetail` is for the log only and may contain diagnostic context.
 *     It is never serialised into an HTTP response.
 *
 * Never put a provider payload, a merchant id, an authority, a gift-card code or
 * a stack trace into `safeMessage`.
 */
export class BaratDomainException extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly safeMessage: string;
  readonly internalDetail?: string;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(params: {
    code: ApiErrorCode;
    safeMessage: string;
    status?: number;
    internalDetail?: string;
    details?: Array<{ path: string; message: string }>;
  }) {
    super(params.internalDetail ?? params.safeMessage);
    this.name = 'BaratDomainException';
    this.code = params.code;
    this.safeMessage = params.safeMessage;
    this.status = params.status ?? HttpStatus.BAD_REQUEST;
    if (params.internalDetail !== undefined) {
      this.internalDetail = params.internalDetail;
    }
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

/* ---------------------------------------------------------------------------
 * Ready-made errors for the situations every workstream will hit.
 * Add to this list rather than inventing an ad-hoc HttpException, so the
 * frontend can switch on a stable `code`.
 * ------------------------------------------------------------------------ */

export const DomainErrors = {
  notFound: (what: string): BaratDomainException =>
    new BaratDomainException({
      code: 'NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
      safeMessage: 'مورد درخواستی یافت نشد.',
      internalDetail: `${what} not found`,
    }),

  unauthenticated: (): BaratDomainException =>
    new BaratDomainException({
      code: 'UNAUTHENTICATED',
      status: HttpStatus.UNAUTHORIZED,
      safeMessage: 'برای ادامه باید وارد شوید.',
    }),

  forbidden: (internalDetail?: string): BaratDomainException =>
    new BaratDomainException({
      code: 'FORBIDDEN',
      status: HttpStatus.FORBIDDEN,
      safeMessage: 'دسترسی لازم را ندارید.',
      ...(internalDetail ? { internalDetail } : {}),
    }),

  quoteExpired: (): BaratDomainException =>
    new BaratDomainException({
      code: 'QUOTE_EXPIRED',
      status: HttpStatus.CONFLICT,
      safeMessage: 'مهلت این پیش‌فاکتور تمام شده است. لطفاً قیمت جدید بگیرید.',
    }),

  /**
   * Quote.finalAmountIrr, Order.totalAmountIrr and Payment.amountIrr disagree.
   * This is a security event, not a validation error: log it, stop the flow,
   * never "fix" the amount silently.
   */
  amountMismatch: (internalDetail: string): BaratDomainException =>
    new BaratDomainException({
      code: 'AMOUNT_MISMATCH',
      status: HttpStatus.CONFLICT,
      safeMessage: 'مبلغ این سفارش تغییر کرده است. لطفاً از ابتدا اقدام کنید.',
      internalDetail,
    }),

  fxRateStale: (ageSeconds: number): BaratDomainException =>
    new BaratDomainException({
      code: 'FX_RATE_STALE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      safeMessage: 'نرخ ارز به‌روز نیست. لطفاً چند دقیقهٔ دیگر تلاش کنید.',
      internalDetail: `FX rate age ${ageSeconds}s exceeds the configured threshold`,
    }),

  fxRateUnavailable: (): BaratDomainException =>
    new BaratDomainException({
      code: 'FX_RATE_UNAVAILABLE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      safeMessage: 'در حال حاضر امکان قیمت‌گذاری وجود ندارد. لطفاً بعداً تلاش کنید.',
    }),

  idempotencyConflict: (internalDetail: string): BaratDomainException =>
    new BaratDomainException({
      code: 'IDEMPOTENCY_CONFLICT',
      status: HttpStatus.CONFLICT,
      safeMessage: 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است.',
      internalDetail,
    }),

  featureDisabled: (feature: string): BaratDomainException =>
    new BaratDomainException({
      code: 'FEATURE_DISABLED',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      safeMessage: 'این سرویس در حال حاضر فعال نیست.',
      internalDetail: `feature flag disabled: ${feature}`,
    }),

  paymentProviderUnavailable: (internalDetail: string): BaratDomainException =>
    new BaratDomainException({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      safeMessage: 'ارتباط با درگاه پرداخت برقرار نشد. لطفاً دوباره تلاش کنید.',
      internalDetail,
    }),

  paymentVerificationFailed: (internalDetail: string): BaratDomainException =>
    new BaratDomainException({
      code: 'PAYMENT_VERIFICATION_FAILED',
      status: HttpStatus.BAD_REQUEST,
      safeMessage: 'پرداخت تأیید نشد. اگر مبلغ کسر شده، طی ۷۲ ساعت بازگردانده می‌شود.',
      internalDetail,
    }),

  validation: (details: Array<{ path: string; message: string }>): BaratDomainException =>
    new BaratDomainException({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      safeMessage: 'اطلاعات ارسال‌شده معتبر نیست.',
      details,
    }),

  conflict: (safeMessage: string, internalDetail?: string): BaratDomainException =>
    new BaratDomainException({
      code: 'CONFLICT',
      status: HttpStatus.CONFLICT,
      safeMessage,
      ...(internalDetail ? { internalDetail } : {}),
    }),
} as const;
