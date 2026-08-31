/**
 * Public surface of the identity module.
 *
 * Other workstreams should import guards, decorators and the actor types from
 * here rather than reaching into individual files.
 */
export { IdentityModule } from './identity.module';
export { AuthContextService, actorMetadata, readBearer, readCookie } from './auth-context.service';
export { CustomerReadService } from './customer-read.service';
export { SessionService, AUTH_COOKIE_NAME, AUTH_SESSION_TTL_SECONDS } from './session.service';
export { StaffAuthService, STAFF_COOKIE_NAME, STAFF_SESSION_TTL_SECONDS } from './staff-auth.service';
export { OtpService, IDENTITY_CONFLICT_FLAG } from './otp.service';
export {
  IDENTITY_DATABASE,
  type ActorRequest,
  type AuthenticatedCustomer,
  type AuthenticatedStaff,
  type IdentityActor,
  type IdentityDatabase,
  type RequestActor,
} from './identity.tokens';
export {
  CustomerScoped,
  Public,
  Roles,
  CUSTOMER_SCOPED_METADATA_KEY,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from './rbac/roles.decorator';
export { RolesGuard } from './rbac/roles.guard';
export { CustomerScopedGuard } from './rbac/customer-scoped.guard';
export {
  CurrentCustomer,
  CurrentStaff,
  RequestMetadata,
} from './rbac/current-actor.decorator';
export {
  normalizeEmail,
  normalizeIdentity,
  normalizeMobile,
  maskEmail,
  maskMobile,
} from './identity.utils';
