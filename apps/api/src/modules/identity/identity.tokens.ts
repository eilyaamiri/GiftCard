import type { PrismaClient } from '@barat/database';
import type { StaffRole } from '@barat/contracts';

/**
 * Application-level injection tokens.
 *
 * Domain services depend on a narrow slice of the Prisma client rather than on
 * the singleton, so a unit test can supply a fake without a database and no
 * service can silently reach a table it does not own.
 */
export const IDENTITY_DATABASE = Symbol('IDENTITY_DATABASE');

export type IdentityDatabase = Pick<
  PrismaClient,
  | 'otpChallenge'
  | 'customerIdentity'
  | 'customer'
  | 'customerFlag'
  | 'authSession'
  | 'commerceSession'
  | 'staffUser'
  | 'order'
  | 'payment'
  | 'refund'
>;

export interface IdentityActor {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface AuthenticatedCustomer {
  readonly type: 'CUSTOMER';
  readonly customerId: string;
  readonly sessionId: string;
}

export interface AuthenticatedStaff {
  readonly type: 'STAFF';
  readonly staffId: string;
  readonly role: StaffRole;
  readonly email: string;
}

export type RequestActor = AuthenticatedCustomer | AuthenticatedStaff;

/** Shape the guards attach to the Express request. */
export interface ActorRequest {
  actor?: RequestActor;
  headers: Record<string, unknown>;
  params?: Record<string, string>;
  ip?: string;
  socket?: { remoteAddress?: string };
}
