/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import type { StaffRole } from '@barat/contracts';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import {
  IDENTITY_DATABASE,
  type AuthenticatedStaff,
  type IdentityActor,
  type IdentityDatabase,
} from './identity.tokens';
import { normalizeEmail } from './identity.utils';

export const STAFF_COOKIE_NAME = 'barat_staff_session';
export const STAFF_SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface StaffLoginResult {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly staff: { id: string; email: string; fullName: string; role: StaffRole };
}

/**
 * Staff authentication.
 *
 * Customers are passwordless; operators are not, because a shared OTP inbox is
 * not an acceptable control for a back office that can see order data. Staff
 * passwords are argon2id hashes and are never logged, echoed or audited.
 */
@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(IDENTITY_DATABASE) private readonly database: IdentityDatabase,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(
    emailInput: string,
    password: string,
    actor: IdentityActor,
  ): Promise<StaffLoginResult> {
    const email = normalizeEmail(emailInput);
    const staff = await this.database.staffUser.findUnique({
      where: { email },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, passwordHash: true },
    });

    /* Verify even when the user is unknown, against a decoy hash, so response
     * time does not reveal which addresses exist. */
    const hash = staff?.passwordHash ?? (await decoyHash());
    const matches = await argon2.verify(hash, password).catch(() => false);

    if (!staff || !staff.isActive || !matches) {
      throw DomainErrors.unauthenticated();
    }

    const expiresAt = new Date(Date.now() + STAFF_SESSION_TTL_SECONDS * 1000);
    const accessToken = await new SignJWT({ typ: 'staff-session', role: staff.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(staff.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret());

    await this.database.staffUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      actor: staff.id,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'STAFF_LOGIN',
      entity: 'StaffUser',
      entityId: staff.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      accessToken,
      expiresAt,
      staff: { id: staff.id, email: staff.email, fullName: staff.fullName, role: staff.role },
    };
  }

  /**
   * The role is re-read from the database on every request, never trusted from
   * the token: a demoted operator must lose access immediately, not in 8 hours.
   */
  async authenticate(token: string): Promise<AuthenticatedStaff> {
    if (!token || token.length > 4096) {
      throw DomainErrors.unauthenticated();
    }

    let subject: string | undefined;
    try {
      const { payload } = await jwtVerify(token, this.secret(), { algorithms: ['HS256'] });
      if (payload['typ'] !== 'staff-session') {
        throw DomainErrors.unauthenticated();
      }
      subject = typeof payload.sub === 'string' ? payload.sub : undefined;
    } catch {
      throw DomainErrors.unauthenticated();
    }

    if (!subject) {
      throw DomainErrors.unauthenticated();
    }

    const staff = await this.database.staffUser.findFirst({
      where: { id: subject, isActive: true },
      select: { id: true, email: true, role: true },
    });
    if (!staff) {
      throw DomainErrors.unauthenticated();
    }

    return { type: 'STAFF', staffId: staff.id, role: staff.role, email: staff.email };
  }

  private secret(): Uint8Array {
    return new TextEncoder().encode(this.config.sessionJwtSecret());
  }
}

/**
 * An argon2id hash of a random value nobody knows, computed once per process and
 * used only to keep the unknown-user path as expensive as the success path.
 */
let decoyHashPromise: Promise<string> | null = null;

function decoyHash(): Promise<string> {
  decoyHashPromise ??= argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
  return decoyHashPromise;
}
