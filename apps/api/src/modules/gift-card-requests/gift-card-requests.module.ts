import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';
import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { GiftCardRequestsController } from './gift-card-requests.controller';
import { GiftCardRequestsService } from './gift-card-requests.service';
import { GIFT_CARD_REQUESTS_DATABASE } from './gift-card-requests.types';

/**
 * `SuppliersModule` is here for the supplier-first path: an operator asking an
 * admin for a code triggers a purchase attempt first, and only an empty float —
 * or any other failure — sends the request on to the admin queue.
 */
@Module({
  imports: [AuditModule, FulfillmentModule, SuppliersModule],
  controllers: [GiftCardRequestsController],
  providers: [
    { provide: GIFT_CARD_REQUESTS_DATABASE, useValue: prisma },
    GiftCardRequestsService,
  ],
  exports: [GiftCardRequestsService],
})
export class GiftCardRequestsModule {}
