import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from './env.schema';

/**
 * Typed access to the validated environment.
 *
 * Inject this instead of `ConfigService` so that a typo is a compile error and
 * `process.env` is never read directly outside this file.
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key, { infer: true }) as AppEnv[K];
  }

  /* ------------------------------------------------------------------ runtime */

  get nodeEnv(): AppEnv['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.get('PORT');
  }

  /* -------------------------------------------------------------- public URLs */

  get apiPublicUrl(): string {
    return this.get('API_PUBLIC_URL');
  }

  get webPublicUrl(): string {
    return this.get('WEB_PUBLIC_URL');
  }

  get adminPublicUrl(): string {
    return this.get('ADMIN_PUBLIC_URL');
  }

  /** Browser origins allowed to call the API with credentials. */
  get corsOrigins(): string[] {
    return [this.webPublicUrl, this.adminPublicUrl];
  }

  /**
   * Whether a session cookie for this origin may carry the `Secure` attribute.
   *
   * `Secure` means "never send this cookie over plain HTTP". A browser does not
   * merely ignore the attribute on an http:// origin — it refuses to store the
   * cookie at all. So tying `Secure` to NODE_ENV, as this once did, silently
   * breaks every login on any production deployment not yet fronted by TLS: the
   * server answers 201 and sets a cookie the browser immediately discards, which
   * looks exactly like a wrong password.
   *
   * The attribute describes the transport, so it follows the transport. An https
   * origin gets `Secure`; a plain http one cannot have it and still function. A
   * malformed or missing URL is treated as https, so the failure mode of a
   * misconfiguration is a cookie that is too strict rather than one sent in the
   * clear.
   */
  private isHttps(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return true;
    }
  }

  /** `Secure` for the customer cookie, which lives on the storefront origin. */
  get webCookieSecure(): boolean {
    return this.isHttps(this.webPublicUrl);
  }

  /** `Secure` for the staff cookie, which lives on the admin panel origin. */
  get adminCookieSecure(): boolean {
    return this.isHttps(this.adminPublicUrl);
  }

  /* ------------------------------------------------------------------ secrets */

  /**
   * Raw AES-256-GCM key for gift-card assets.
   * Only the encryption service may call this. Never log the result, never put
   * it in an error message, never send it to a provider.
   */
  giftCardEncryptionKey(): Buffer {
    return Buffer.from(this.get('GIFT_CARD_ENCRYPTION_KEY'), 'base64');
  }

  /** Session signing secret. Same handling rules as above. */
  sessionJwtSecret(): string {
    return this.get('SESSION_JWT_SECRET');
  }

  /* ------------------------------------------------------------ file storage */

  get productImageDir(): string {
    return this.get('PRODUCT_IMAGE_DIR');
  }

  /* ---------------------------------------------------------------- OTP policy */

  get otp(): {
    length: number;
    ttlSeconds: number;
    resendSeconds: number;
    maxAttempts: number;
    maxRequestsPerHour: number;
  } {
    return {
      length: this.get('OTP_LENGTH'),
      ttlSeconds: this.get('OTP_TTL_SECONDS'),
      resendSeconds: this.get('OTP_RESEND_SECONDS'),
      maxAttempts: this.get('OTP_MAX_ATTEMPTS'),
      maxRequestsPerHour: this.get('OTP_MAX_REQUESTS_PER_HOUR'),
    };
  }

  /**
   * The fixed login code for a demo deployment with no SMS gateway, or null.
   *
   * See OTP_DEV_FIXED_CODE in env.schema.ts for what this gives up. The schema
   * refuses to boot if it is set alongside a live payment gateway.
   */
  get otpDevFixedCode(): string | null {
    return this.get('OTP_DEV_FIXED_CODE') ?? null;
  }

  /* ------------------------------------------------------------- FX and quotes */

  get fxStaleThresholdSeconds(): number {
    return this.get('FX_STALE_THRESHOLD_SECONDS');
  }

  get quoteTtlSeconds(): number {
    return this.get('QUOTE_TTL_SECONDS');
  }

  /* ----------------------------------------------------------------- ZarinPal */

  get zarinpalEnabled(): boolean {
    return this.get('ZARINPAL_ENABLED');
  }

  /**
   * ZarinPal settings. `null` when the gateway is disabled, so a caller cannot
   * accidentally hit a half-configured provider.
   */
  get zarinpal(): {
    merchantId: string;
    requestUrl: string;
    verifyUrl: string;
    startPayUrl: string;
    callbackUrl: string;
    timeoutMs: number;
    amountUnit: AppEnv['ZARINPAL_AMOUNT_UNIT'];
  } | null {
    if (!this.zarinpalEnabled) {
      return null;
    }

    return {
      merchantId: this.get('ZARINPAL_MERCHANT_ID') ?? '',
      requestUrl: this.get('ZARINPAL_REQUEST_URL') ?? '',
      verifyUrl: this.get('ZARINPAL_VERIFY_URL') ?? '',
      startPayUrl: this.get('ZARINPAL_STARTPAY_URL') ?? '',
      callbackUrl: this.get('ZARINPAL_CALLBACK_URL') ?? '',
      timeoutMs: this.get('ZARINPAL_REQUEST_TIMEOUT_MS'),
      amountUnit: this.get('ZARINPAL_AMOUNT_UNIT'),
    };
  }

  /* ---------------------------------------------------------- infrastructure */

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.get('REDIS_URL');
  }
}
