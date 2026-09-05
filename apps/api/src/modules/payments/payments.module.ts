import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';
import { RIAL_PAYMENT_PROVIDER } from '@barat/payments';

import { AppConfigModule, AppConfigService } from '../../common/config';
import { AuditModule } from '../audit/audit.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PAYMENTS_DATABASE, PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { createRialPaymentProvider } from './rial-payment-provider.factory';

/**
 * Select exactly one adapter at boot; domain code only sees RialPaymentProvider.
 *
 * `SuppliersModule` supplies `FULFILLMENT_TRIGGER`, the port a verified payment
 * uses to queue fulfillment. Its implementation creates the operator task first
 * and then tries to buy the card automatically, so a paid order is tasked either
 * way. Suppliers imports work items and fulfillment, never payments, so this is
 * still a one-way edge and not a cycle.
 */
@Module({
  imports: [AppConfigModule, AuditModule, SuppliersModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: RIAL_PAYMENT_PROVIDER,
      inject: [AppConfigService],
      useFactory: createRialPaymentProvider,
    },
    { provide: PAYMENTS_DATABASE, useValue: prisma },
    PaymentsService,
  ],
  exports: [PaymentsService, RIAL_PAYMENT_PROVIDER],
})
export class PaymentsModule {}
