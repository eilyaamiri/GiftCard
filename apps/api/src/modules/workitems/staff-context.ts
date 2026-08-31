import type { StaffRole } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';

/**
 * The authenticated staff member on a request.
 *
 * B5 (identity/RBAC) owns authentication and attaches this object. This module
 * only reads it. It deliberately never falls back to a header or a query
 * parameter: an unauthenticated request must fail, not become an anonymous
 * operator who can claim work and read gift-card codes.
 */
export interface StaffContext {
  readonly id: string;
  readonly role: StaffRole;
}

interface RequestWithStaff {
  /** Set by RolesGuard via AuthContextService. The only trustworthy source. */
  actor?: unknown;
  /* Historic names. Nothing in the identity layer has ever set these, but they
   * are still read so a future guard using either keeps working. */
  staff?: unknown;
  user?: unknown;
}

const STAFF_ROLES: ReadonlySet<string> = new Set<string>([
  'ADMIN',
  'MANAGEMENT',
  'OPS_MANAGER',
  'OPERATOR',
  'FINANCE',
  'SUPPORT',
  'VIEWER',
]);

function parse(candidate: unknown): StaffContext | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  /* A customer session is an actor too. It carries no role, so the role check
   * below would already reject it, but refusing it by type keeps the intent
   * explicit: this is a staff-only door. */
  if ('type' in record && record['type'] !== 'STAFF') {
    return null;
  }
  const id = record['id'] ?? record['staffId'];
  const role = record['role'];
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (typeof role !== 'string' || !STAFF_ROLES.has(role)) {
    return null;
  }
  return { id, role: role as StaffRole };
}

/** Read the staff principal, or reject the request. */
export function requireStaff(request: unknown): StaffContext {
  const typed = request as RequestWithStaff;
  const staff = parse(typed.actor) ?? parse(typed.staff) ?? parse(typed.user);
  if (!staff) {
    throw DomainErrors.unauthenticated();
  }
  return staff;
}
