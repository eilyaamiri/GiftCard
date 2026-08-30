import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { STAFF_ROLE_VALUES, type StaffRole } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import type { FxStaffActor } from './fx.types';

/** Roles permitted to pin or clear an FX rate by hand. */
export const FX_OVERRIDE_ROLES: readonly StaffRole[] = ['ADMIN', 'FINANCE'];

interface RequestWithStaff {
  user?: unknown;
  staffUser?: unknown;
}

function readActor(candidate: unknown): FxStaffActor | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const id = record['id'] ?? record['staffUserId'] ?? record['sub'];
  const role = record['role'];
  if (typeof id !== 'string' || id.trim() === '' || typeof role !== 'string') {
    return null;
  }
  if (!(STAFF_ROLE_VALUES as readonly string[]).includes(role)) {
    return null;
  }
  return { id, role };
}

/**
 * Server-side authorisation for the FX override endpoints.
 *
 * The shared staff session guard is owned by workstream B5 and does not exist
 * yet, so this guard reads the staff principal the session middleware attaches
 * to the request and fails closed when it is absent. When the shared guard
 * lands, this one keeps the role check and drops the principal extraction.
 */
@Injectable()
export class FxOverrideGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    const actor = readActor(request.user) ?? readActor(request.staffUser);

    if (!actor) {
      throw DomainErrors.unauthenticated();
    }
    if (!FX_OVERRIDE_ROLES.includes(actor.role as StaffRole)) {
      throw DomainErrors.forbidden(`role ${actor.role} may not change the FX rate`);
    }
    return true;
  }
}

/** Resolve the authenticated staff actor for auditing. Never trust the body. */
export function requireStaffActor(request: RequestWithStaff): FxStaffActor {
  const actor = readActor(request.user) ?? readActor(request.staffUser);
  if (!actor) {
    throw DomainErrors.unauthenticated();
  }
  return actor;
}
