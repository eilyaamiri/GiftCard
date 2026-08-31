import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CUSTOMERS_DATABASE } from './customers.tokens';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * Customer self-service (`/api/account/*`) and operator Customer 360
 * (`/api/customers/*`).
 *
 * `CustomerReadService` and the guards come from the global `IdentityModule`, so
 * this module never re-implements masking or authentication.
 */
@Module({
  imports: [AuditModule],
  controllers: [AccountController, CustomersController, SupportController],
  providers: [
    { provide: CUSTOMERS_DATABASE, useValue: prisma },
    AccountService,
    CustomersService,
    SupportService,
  ],
  exports: [AccountService, CustomersService, SupportService],
})
export class CustomersModule {}
