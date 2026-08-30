/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type {
  IdentityType,
  OtpPurpose,
  RequestOtpRequest,
  RequestOtpResponse,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@barat/contracts';
import type { EmailProvider, SmsProvider } from '@barat/notifications';
import { EMAIL_PROVIDER, SMS_PROVIDER } from '@barat/notifications';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { CustomerReadService } from './customer-read.service';
import {
  generateCustomerCode,
  generateOtp,
  maskEmail,
  maskMobile,
  normalizeIdentity,
} from './identity.utils';
import { IDENTITY_DATABASE, type IdentityActor, type IdentityDatabase } from './identity.tokens';
import { SessionService } from './session.service';

/**
 * One message for every rejection on the verify path.
 *
 * Distinguishing "wrong code" from "expired" from "no such challenge" would tell
 * an attacker which challenge ids are live and when to stop guessing.
 */
const GENERIC_OTP_FAILURE = 'کد واردشده معتبر نیست یا مهلت آن تمام شده است.';

/** How long a challenge stays locked after the attempt budget is exhausted. */
const LOCKOUT_SECONDS = 60 * 60;

export const IDENTITY_CONFLICT_FLAG = 'IDENTITY_CONFLICT';

export interface OtpRequestContext extends IdentityActor {
  /** Set when the caller already holds a session (adding a second identifier). */
  readonly customerId?: string | null;
}

interface ResolvedCustomer {
  readonly customerId: string;
  readonly isNewCustomer: boolean;
}

/**
 * OTP issuance and verification.
 *
 * The plaintext code exists only as a local variable and as an argument to the
 * notification provider. It is never persisted (only an argon2id hash is), never
 * returned by an endpoint, never audited and never logged — AGENTS.md rule 10.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(IDENTITY_DATABASE) private readonly database: IdentityDatabase,
    private readonly config: AppConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly customers: CustomerReadService,
  ) {}

  /* ------------------------------------------------------------------ request */

  async requestOtp(
    input: RequestOtpRequest,
    context: OtpRequestContext,
  ): Promise<RequestOtpResponse> {
    const normalized = normalizeIdentity(input.identityType, input.identifier);
    const policy = this.config.otp;
    const now = new Date();

    await this.enforceHourlyLimit(input.identityType, normalized, now, policy.maxRequestsPerHour);
    const requestCount = await this.enforceResendCooldown(
      input.identityType,
      normalized,
      now,
      policy.resendSeconds,
    );

    const code = generateOtp(policy.length);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const expiresAt = new Date(now.getTime() + policy.ttlSeconds * 1000);

    const challenge = await this.database.otpChallenge.create({
      data: {
        customerId: context.customerId ?? null,
        identityType: input.identityType,
        identityValueNormalized: normalized,
        purpose: input.purpose,
        codeHash,
        maxAttempts: policy.maxAttempts,
        requestCount,
        expiresAt,
        ip: context.ip,
        userAgent: context.userAgent,
      },
      select: { id: true },
    });

    await this.deliver(input.identityType, normalized, code);

    await this.audit.record({
      actor: context.customerId ?? 'anonymous',
      actorType: context.customerId ? 'CUSTOMER' : 'ANONYMOUS',
      action: 'OTP_REQUESTED',
      entity: 'OtpChallenge',
      entityId: challenge.id,
      /* Deliberately no code, no raw identifier. */
      after: { identityType: input.identityType, purpose: input.purpose, expiresAt },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      challengeId: challenge.id,
      maskedTarget:
        input.identityType === 'MOBILE' ? maskMobile(normalized) : maskEmail(normalized),
      codeLength: policy.length,
      expiresAt: expiresAt.toISOString(),
      resendAvailableInSeconds: policy.resendSeconds,
      attemptsRemaining: policy.maxAttempts,
    };
  }

  private async enforceHourlyLimit(
    identityType: IdentityType,
    normalized: string,
    now: Date,
    maxRequestsPerHour: number,
  ): Promise<void> {
    const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
    const issued = await this.database.otpChallenge.count({
      where: {
        identityType,
        identityValueNormalized: normalized,
        createdAt: { gte: windowStart },
      },
    });

    if (issued >= maxRequestsPerHour) {
      throw DomainErrors.conflict(
        'تعداد درخواست کد بیش از حد مجاز است. لطفاً یک ساعت دیگر تلاش کنید.',
        'OTP hourly request limit reached',
      );
    }
  }

  /** Returns the request counter to store on the new challenge. */
  private async enforceResendCooldown(
    identityType: IdentityType,
    normalized: string,
    now: Date,
    resendSeconds: number,
  ): Promise<number> {
    const latest = await this.database.otpChallenge.findFirst({
      where: { identityType, identityValueNormalized: normalized },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, requestCount: true },
    });

    if (!latest) {
      return 1;
    }

    const readyAt = latest.createdAt.getTime() + resendSeconds * 1000;
    if (readyAt > now.getTime()) {
      const waitSeconds = Math.ceil((readyAt - now.getTime()) / 1000);
      throw DomainErrors.conflict(
        `برای ارسال دوبارهٔ کد ${waitSeconds} ثانیه صبر کنید.`,
        `OTP resend cooldown active for ${waitSeconds}s`,
      );
    }

    return latest.requestCount + 1;
  }

  private async deliver(
    identityType: IdentityType,
    normalized: string,
    code: string,
  ): Promise<void> {
    try {
      if (identityType === 'MOBILE') {
        await this.sms.send({
          to: normalized,
          body: `کد ورود برات‌پی: ${code}`,
          templateId: 'AUTH_OTP',
          templateParams: { code },
        });
      } else {
        await this.email.send({
          to: normalized,
          subject: 'کد ورود برات‌پی',
          text: `کد ورود شما: ${code}`,
          html: `<p style="direction:ltr;unicode-bidi:isolate">${code}</p>`,
          templateId: 'AUTH_OTP',
          templateParams: { code },
        });
      }
    } catch {
      /* The provider error is swallowed on purpose: its message may echo the
       * message body, which contains the code. */
      throw DomainErrors.conflict(
        'ارسال کد تأیید انجام نشد. لطفاً دوباره تلاش کنید.',
        'OTP notification delivery failed',
      );
    }
  }

  /* ------------------------------------------------------------------- verify */

  async verifyOtp(input: VerifyOtpRequest, context: OtpRequestContext): Promise<VerifyOtpResponse> {
    const now = new Date();
    const challenge = await this.database.otpChallenge.findUnique({
      where: { id: input.challengeId },
      select: {
        id: true,
        customerId: true,
        identityType: true,
        identityValueNormalized: true,
        purpose: true,
        codeHash: true,
        attempts: true,
        maxAttempts: true,
        expiresAt: true,
        consumedAt: true,
        lockedUntil: true,
      },
    });

    if (!challenge) {
      throw DomainErrors.conflict(GENERIC_OTP_FAILURE, 'OTP challenge not found');
    }

    const unusable =
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now ||
      (challenge.lockedUntil !== null && challenge.lockedUntil > now) ||
      challenge.attempts >= challenge.maxAttempts;

    if (unusable) {
      throw DomainErrors.conflict(GENERIC_OTP_FAILURE, 'OTP challenge is not usable');
    }

    const matches = await argon2.verify(challenge.codeHash, input.code).catch(() => false);

    if (!matches) {
      await this.registerFailedAttempt(challenge.id, challenge.attempts, challenge.maxAttempts, now);
      throw DomainErrors.conflict(GENERIC_OTP_FAILURE, 'OTP code mismatch');
    }

    /* Single use: consumption is a conditional update, so two concurrent
     * verifications of the same code cannot both succeed. */
    const consumed = await this.database.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: challenge.maxAttempts },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw DomainErrors.conflict(GENERIC_OTP_FAILURE, 'OTP challenge already consumed');
    }

    const actor: IdentityActor = { ip: context.ip, userAgent: context.userAgent };
    const resolved = await this.resolveCustomer(
      challenge.identityType,
      challenge.identityValueNormalized,
      challenge.purpose,
      context.customerId ?? challenge.customerId,
      actor,
    );

    const session = await this.sessions.createSession(resolved.customerId, actor);
    if (input.commerceSessionToken) {
      await this.sessions.linkCommerceSession(input.commerceSessionToken, resolved.customerId);
    }

    await this.audit.record({
      actor: resolved.customerId,
      actorType: 'CUSTOMER',
      action: 'OTP_VERIFIED',
      entity: 'Customer',
      entityId: resolved.customerId,
      after: {
        identityType: challenge.identityType,
        purpose: challenge.purpose,
        isNewCustomer: resolved.isNewCustomer,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      customer: await this.customers.customerDto(resolved.customerId),
      accessToken: session.accessToken,
      expiresAt: session.expiresAt.toISOString(),
      isNewCustomer: resolved.isNewCustomer,
    };
  }

  private async registerFailedAttempt(
    challengeId: string,
    attempts: number,
    maxAttempts: number,
    now: Date,
  ): Promise<void> {
    const exhausted = attempts + 1 >= maxAttempts;
    await this.database.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, attempts: { lt: maxAttempts } },
      data: {
        attempts: { increment: 1 },
        ...(exhausted ? { lockedUntil: new Date(now.getTime() + LOCKOUT_SECONDS * 1000) } : {}),
      },
    });
  }

  /* ---------------------------------------------------------------- customers */

  /**
   * Maps a verified identifier onto a customer.
   *
   * Three cases, and none of them ever merges two customers:
   *   1. The identifier is already known  -> that customer logs in.
   *   2. The caller is authenticated and the identifier is free -> attach it.
   *   3. Nobody owns it and nobody is logged in -> create a customer (LOGIN only).
   *
   * Case 2 with an identifier owned by somebody else raises IDENTITY_CONFLICT and
   * routes to support. It never overwrites, moves or merges an identity.
   */
  private async resolveCustomer(
    identityType: IdentityType,
    normalized: string,
    purpose: OtpPurpose,
    authenticatedCustomerId: string | null,
    actor: IdentityActor,
  ): Promise<ResolvedCustomer> {
    const owner = await this.database.customerIdentity.findUnique({
      where: { type_valueNormalized: { type: identityType, valueNormalized: normalized } },
      select: { id: true, customerId: true, isVerified: true },
    });

    if (owner) {
      if (authenticatedCustomerId && owner.customerId !== authenticatedCustomerId) {
        await this.raiseIdentityConflict(authenticatedCustomerId, identityType, actor);
        throw DomainErrors.conflict(
          'این شناسه به حساب دیگری تعلق دارد. درخواست برای بررسی پشتیبانی ثبت شد.',
          'identity belongs to a different customer',
        );
      }

      await this.assertCustomerUsable(owner.customerId);
      if (!owner.isVerified) {
        await this.database.customerIdentity.update({
          where: { id: owner.id },
          data: { isVerified: true, verifiedAt: new Date() },
        });
      }
      return { customerId: owner.customerId, isNewCustomer: false };
    }

    if (authenticatedCustomerId) {
      await this.assertCustomerUsable(authenticatedCustomerId);
      await this.attachIdentity(authenticatedCustomerId, identityType, normalized, actor);
      return { customerId: authenticatedCustomerId, isNewCustomer: false };
    }

    if (purpose !== 'LOGIN') {
      throw DomainErrors.conflict(
        'برای این عملیات باید ابتدا وارد حساب کاربری شوید.',
        `purpose ${purpose} requires an authenticated customer`,
      );
    }

    return this.createCustomer(identityType, normalized, actor);
  }

  private async assertCustomerUsable(customerId: string): Promise<void> {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId },
      select: { status: true },
    });
    if (!customer) {
      throw DomainErrors.unauthenticated();
    }
    if (customer.status === 'DISABLED') {
      throw DomainErrors.forbidden(`customer ${customerId} is disabled`);
    }
  }

  private async attachIdentity(
    customerId: string,
    identityType: IdentityType,
    normalized: string,
    actor: IdentityActor,
  ): Promise<void> {
    try {
      await this.database.customerIdentity.create({
        data: {
          customerId,
          type: identityType,
          value: normalized,
          valueNormalized: normalized,
          isVerified: true,
          verifiedAt: new Date(),
        },
      });
    } catch {
      /* Lost a race against a concurrent claim. Re-read and treat a foreign
       * owner as a conflict rather than merging. */
      const raced = await this.database.customerIdentity.findUnique({
        where: { type_valueNormalized: { type: identityType, valueNormalized: normalized } },
        select: { customerId: true },
      });
      if (!raced || raced.customerId !== customerId) {
        await this.raiseIdentityConflict(customerId, identityType, actor);
        throw DomainErrors.conflict(
          'این شناسه به حساب دیگری تعلق دارد. درخواست برای بررسی پشتیبانی ثبت شد.',
          'identity claimed concurrently by a different customer',
        );
      }
    }

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'IDENTITY_ADDED',
      entity: 'CustomerIdentity',
      entityId: customerId,
      after: { identityType },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }

  private async createCustomer(
    identityType: IdentityType,
    normalized: string,
    actor: IdentityActor,
  ): Promise<ResolvedCustomer> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await this.database.customer.create({
          data: {
            customerCode: generateCustomerCode(),
            identities: {
              create: {
                type: identityType,
                value: normalized,
                valueNormalized: normalized,
                isPrimary: true,
                isVerified: true,
                verifiedAt: new Date(),
              },
            },
            profile: { create: {} },
          },
          select: { id: true },
        });

        await this.audit.record({
          actor: created.id,
          actorType: 'CUSTOMER',
          action: 'CUSTOMER_CREATED',
          entity: 'Customer',
          entityId: created.id,
          after: { identityType },
          ip: actor.ip,
          userAgent: actor.userAgent,
        });

        return { customerId: created.id, isNewCustomer: true };
      } catch {
        /* Either the generated customerCode collided (retry) or the identity was
         * claimed concurrently (adopt the winner — never a second customer). */
        const raced = await this.database.customerIdentity.findUnique({
          where: { type_valueNormalized: { type: identityType, valueNormalized: normalized } },
          select: { customerId: true },
        });
        if (raced) {
          return { customerId: raced.customerId, isNewCustomer: false };
        }
      }
    }

    throw DomainErrors.conflict(
      'ایجاد حساب کاربری انجام نشد. لطفاً دوباره تلاش کنید.',
      'customer creation failed after retries',
    );
  }

  private async raiseIdentityConflict(
    customerId: string,
    identityType: IdentityType,
    actor: IdentityActor,
  ): Promise<void> {
    await this.database.customerFlag.upsert({
      where: { customerId_key: { customerId, key: IDENTITY_CONFLICT_FLAG } },
      create: {
        customerId,
        key: IDENTITY_CONFLICT_FLAG,
        reason: `A verified ${identityType} identity is already owned by another customer`,
      },
      update: {},
    });

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'IDENTITY_CONFLICT_FLAGGED',
      entity: 'Customer',
      entityId: customerId,
      after: { identityType, flag: IDENTITY_CONFLICT_FLAG },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}
