import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@barat/contracts';

export const ROLES_METADATA_KEY = 'barat:roles';
export const CUSTOMER_SCOPED_METADATA_KEY = 'barat:customer-scoped';
export const PUBLIC_METADATA_KEY = 'barat:public';

/**
 * Restricts a route to the listed staff roles.
 *
 * This is the ONLY authorisation control that counts. A frontend that hides a
 * button is a convenience — AGENTS.md section 4.
 */
export const Roles = (...roles: readonly StaffRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);

/**
 * Marks a route as belonging to the authenticated customer.
 *
 * `CustomerScopedGuard` requires a customer session and stores the customer id
 * on the request; handlers must filter every query by it and never accept a
 * customer id from the client.
 */
export const CustomerScoped = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CUSTOMER_SCOPED_METADATA_KEY, true);

/** Opt a route out of authentication (OTP request/verify, health, callbacks). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_METADATA_KEY, true);
