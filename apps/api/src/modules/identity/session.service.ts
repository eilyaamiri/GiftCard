/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, sha256 } from './identity.utils';
import {
  IDENTITY_DATABASE,
  type AuthenticatedCustomer,
  type IdentityActor,
  type IdentityDatabase,
} from './identity.tokens';

export const AUTH_COOKIE_NAME = 'barat_session';
export const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly sessionId: string;
}

/**
 * Customer sessions.
 *
 * The JWT is the bearer credential; the database row is the revocation list. We
 * store only a SHA-256 of the token, so a leaked database dump cannot be
 * replayed against the API. Raw tokens are never logged or audited.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(IDENTITY_DATABASE) private readonly database: IdentityDatabase,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async createSession(customerId: string, actor: IdentityActor): Promise<IssuedSession> {
    const sessionId = generateOpaqueToken().slice(0, 32);
    const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_SECONDS * 1000);

    const accessToken = await new SignJWT({ typ: 'customer-session' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(customerId)
      .setJti(sessionId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret());

    await this.database.authSession.create({
      data: {
        id: sessionId,
        customerId,
        tokenHash: sha256(accessToken),
        ip: actor.ip,
        userAgent: actor.userAgent,
        expiresAt,
      },
    });

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'AUTH_SESSION_CREATED',
      entity: 'AuthSession',
      entityId: sessionId,
      after: { expiresAt },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { accessToken, expiresAt, sessionId };
  }

  /** Verifies signature, revocation, expiry and customer status — in that order. */
  async authenticate(token: string): Promise<AuthenticatedCustomer> {
    const payload = await this.verifyJwt(token);
    const customerId = typeof payload.sub === 'string' ? payload.sub : null;
    const sessionId = typeof payload.jti === 'string' ? payload.jti : null;
    if (!customerId || !sessionId || payload['typ'] !== 'customer-session') {
      throw DomainErrors.unauthenticated();
    }

    const session = await this.database.authSession.findFirst({
      where: {
        id: sessionId,
        customerId,
        tokenHash: sha256(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        customer: { status: { not: 'DISABLED' } },
      },
      select: { id: true, customerId: true },
    });
    if (!session) {
      throw DomainErrors.unauthenticated();
    }

    await this.database.authSession.updateMany({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return { type: 'CUSTOMER', customerId: session.customerId, sessionId: session.id };
  }

  async revoke(token: string, actor: IdentityActor): Promise<boolean> {
    if (!token) {
      return false;
    }

    const session = await this.database.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, customerId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) {
      return false;
    }

    await this.database.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      actor: session.customerId,
      actorType: 'CUSTOMER',
      action: 'AUTH_SESSION_REVOKED',
      entity: 'AuthSession',
      entityId: session.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return true;
  }

  /**
   * Attaches an anonymous browsing session to a customer.
   *
   * Only an unclaimed session, or one already owned by the same customer, can be
   * linked. A session that belongs to somebody else is left untouched: funnel
   * history and any cart or quote hanging off it must never change owner, and
   * historical timestamps (`firstSeenAt`, event times) are never rewritten.
   */
  async linkCommerceSession(sessionToken: string, customerId: string): Promise<boolean> {
    if (!sessionToken || sessionToken.length > 128) {
      return false;
    }

    const result = await this.database.commerceSession.updateMany({
      where: { sessionToken, OR: [{ customerId: null }, { customerId }] },
      data: { customerId, lastSeenAt: new Date() },
    });

    return result.count === 1;
  }

  private async verifyJwt(token: string): Promise<JWTPayload> {
    if (!token || token.length > 4096) {
      throw DomainErrors.unauthenticated();
    }
    try {
      const { payload } = await jwtVerify(token, this.secret(), { algorithms: ['HS256'] });
      return payload;
    } catch {
      throw DomainErrors.unauthenticated();
    }
  }

  private secret(): Uint8Array {
    return new TextEncoder().encode(this.config.sessionJwtSecret());
  }
}
