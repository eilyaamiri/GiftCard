import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';
import { RIAL_PAYMENT_PROVIDER } from '@barat/payments';

import { AppConfigModule, AppConfigService } from '../../common/config';
import { AuditModule } from '../audit/audit.module';
import { PAYMENTS_DATABASE, PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { createRialPaymentProvider } from './rial-payment-provider.factory';

/** Select exactly one adapter at boot; domain code only sees RialPaymentProvider. */
@Module({
  imports: [AppConfigModule, AuditModule],
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
