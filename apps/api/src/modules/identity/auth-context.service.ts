/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Injectable } from '@nestjs/common';

import { DomainErrors } from '../../common/errors/domain.exception';
import type { ActorRequest, IdentityActor, RequestActor } from './identity.tokens';
import { AUTH_COOKIE_NAME, SessionService } from './session.service';
import { StaffAuthService, STAFF_COOKIE_NAME } from './staff-auth.service';

/**
 * Turns an incoming request into an authenticated actor.
 *
 * Guards call this instead of duplicating token extraction, and the resolved
 * actor is memoised on the request so three guards do not verify the same JWT
 * three times.
 */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly sessions: SessionService,
    private readonly staff: StaffAuthService,
  ) {}

  /** `null` when the request carries no credential at all. */
  async resolve(request: ActorRequest): Promise<RequestActor | null> {
    if (request.actor) {
      return request.actor;
    }

    const staffToken = readCookie(request, STAFF_COOKIE_NAME);
    if (staffToken) {
      const actor = await this.staff.authenticate(staffToken);
      request.actor = actor;
      return actor;
    }

    const customerToken =
      readCookie(request, AUTH_COOKIE_NAME) ?? readBearer(request) ?? null;
    if (customerToken) {
      const actor = await this.sessions.authenticate(customerToken);
      request.actor = actor;
      return actor;
    }

    return null;
  }

  async require(request: ActorRequest): Promise<RequestActor> {
    const actor = await this.resolve(request);
    if (!actor) {
      throw DomainErrors.unauthenticated();
    }
    return actor;
  }
}

export function readBearer(request: ActorRequest): string | null {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') {
    return null;
  }
  return value.trim() || null;
}

/**
 * Minimal cookie reader.
 *
 * `cookie-parser` is not registered on this app, and adding express middleware
 * would mean touching Foundation-owned bootstrap code.
 */
export function readCookie(request: ActorRequest, name: string): string | null {
  const header = request.headers['cookie'];
  if (typeof header !== 'string') {
    return null;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return value === '' ? null : decodeURIComponent(value);
  }

  return null;
}

/**
 * IP and user-agent, normalised for audit rows. Never used for authorisation.
 *
 * `request.ip` is taken as-is: bootstrap sets `trust proxy = 1`, so Express has
 * already resolved X-Forwarded-For for us. Reading the raw header here would
 * accept a client-supplied value and poison the audit trail.
 */
export function actorMetadata(request: ActorRequest): IdentityActor {
  const ip = request.ip ?? request.socket?.remoteAddress ?? null;
  const userAgent = request.headers['user-agent'];

  return {
    ip: ip && ip.length <= 64 ? ip : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}
