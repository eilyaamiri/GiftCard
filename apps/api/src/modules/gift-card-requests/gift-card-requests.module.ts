import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';
import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { GiftCardRequestsController } from './gift-card-requests.controller';
import { GiftCardRequestsService } from './gift-card-requests.service';
import { GIFT_CARD_REQUESTS_DATABASE } from './gift-card-requests.types';

@Module({
  imports: [AuditModule, FulfillmentModule],
  controllers: [GiftCardRequestsController],
  providers: [
    { provide: GIFT_CARD_REQUESTS_DATABASE, useValue: prisma },
    GiftCardRequestsService,
  ],
  exports: [GiftCardRequestsService],
})
export class GiftCardRequestsModule {}
