import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { STAFF_ROLE_VALUES, type StaffRole } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import type { FxStaffActor } from './fx.types';

/** Roles permitted to pin or clear an FX rate by hand. */
export const FX_OVERRIDE_ROLES: readonly StaffRole[] = ['ADMIN', 'FINANCE'];

interface RequestWithStaff {
  /** Attached by RolesGuard via AuthContextService. The canonical principal. */
  actor?: unknown;
  /* Names this guard used to look for. Nothing has ever set them; kept only so
   * a future guard that does keeps working. */
  user?: unknown;
  staffUser?: unknown;
}

function readActor(candidate: unknown): FxStaffActor | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  /* A customer session must never reach an FX write. It carries no role, so the
   * check below would reject it anyway; refusing by type states the intent. */
  if ('type' in record && record['type'] !== 'STAFF') {
    return null;
  }
  const id = record['id'] ?? record['staffId'] ?? record['staffUserId'] ?? record['sub'];
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
 * The shared session guard now exists: RolesGuard resolves the session and
 * attaches the principal as `request.actor`. This guard reads that actor and
 * fails closed when it is absent. It runs after RolesGuard, so the route must
 * also carry `@Roles(...)` — without it RolesGuard returns early, no actor is
 * attached, and every override is rejected as unauthenticated.
 */
@Injectable()
export class FxOverrideGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithStaff>();
    const actor = readActor(request.actor) ?? readActor(request.user) ?? readActor(request.staffUser);

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
  const actor = readActor(request.actor) ?? readActor(request.user) ?? readActor(request.staffUser);
  if (!actor) {
    throw DomainErrors.unauthenticated();
  }
  return actor;
}
