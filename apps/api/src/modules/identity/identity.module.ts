import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { prisma } from '@barat/database';
import {
  EMAIL_PROVIDER,
  MockEmailProvider,
  MockSmsProvider,
  SMS_PROVIDER,
} from '@barat/notifications';

import { AuditModule } from '../audit/audit.module';
import { AuthContextService } from './auth-context.service';
import { AuthController } from './auth.controller';
import { CustomerReadService } from './customer-read.service';
import { IDENTITY_DATABASE } from './identity.tokens';
import { OtpService } from './otp.service';
import { CustomerScopedGuard } from './rbac/customer-scoped.guard';
import { RolesGuard } from './rbac/roles.guard';
import { SessionService } from './session.service';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';

/**
 * Identity, sessions and RBAC.
 *
 * `@Global` because the guards and `AuthContextService` are consumed by every
 * other domain module; registering `RolesGuard` and `CustomerScopedGuard` as
 * APP_GUARDs is what makes authorisation a property of the server rather than
 * something each controller has to remember to opt into.
 *
 * The notification providers are the Mock implementations for the POC. A real
 * SMS/e-mail transport is swapped in here and nowhere else — no service imports
 * a concrete provider (AGENTS.md section 2).
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [AuthController, StaffAuthController],
  providers: [
    { provide: IDENTITY_DATABASE, useValue: prisma },
    { provide: SMS_PROVIDER, useFactory: () => new MockSmsProvider() },
    { provide: EMAIL_PROVIDER, useFactory: () => new MockEmailProvider() },
    SessionService,
    StaffAuthService,
    AuthContextService,
    CustomerReadService,
    OtpService,
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CustomerScopedGuard },
  ],
  exports: [
    IDENTITY_DATABASE,
    SessionService,
    StaffAuthService,
    AuthContextService,
    CustomerReadService,
  ],
})
export class IdentityModule {}
