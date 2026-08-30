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
