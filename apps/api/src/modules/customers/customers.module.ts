import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
import { AccountController } from './account.controller';
import { AdminFaqsController } from './admin-faqs.controller';
import { AdminSupportChannelsController } from './admin-support-channels.controller';
import { AccountService } from './account.service';
import { BankDetailsService } from './bank-details.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CUSTOMERS_DATABASE } from './customers.tokens';
import { FaqsController } from './faqs.controller';
import { FAQS_DATABASE, FaqsService } from './faqs.service';
import { FavoritesService } from './favorites.service';
import { NotificationsService } from './notifications.service';
import { SupportChannelsController } from './support-channels.controller';
import {
  SUPPORT_CHANNELS_DATABASE,
  SupportChannelsService,
} from './support-channels.service';
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
  controllers: [
    AccountController,
    AdminFaqsController,
    AdminSupportChannelsController,
    CustomersController,
    FaqsController,
    SupportChannelsController,
    SupportController,
  ],
  providers: [
    { provide: CUSTOMERS_DATABASE, useValue: prisma },
    { provide: FAQS_DATABASE, useValue: prisma },
    { provide: SUPPORT_CHANNELS_DATABASE, useValue: prisma },
    AccountService,
    BankDetailsService,
    CustomersService,
    FaqsService,
    FavoritesService,
    NotificationsService,
    SupportChannelsService,
    SupportService,
  ],
  exports: [AccountService, CustomersService, FaqsService, SupportChannelsService, SupportService],
})
export class CustomersModule {}
