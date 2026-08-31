import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ChecklistService } from './checklist.service';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { InternalFulfillmentController } from './internal-fulfillment.controller';
import { ASSET_DELIVERY_TRANSPORT, FULFILLMENT_STORE } from './fulfillment.types';
import { GiftCardAssetService } from './gift-card-asset.service';
import { PrismaFulfillmentStore } from './prisma-fulfillment.store';
import { MockAssetDeliveryTransport } from './transports/mock-asset-delivery.transport';

/**
 * Both the store and the delivery transport are bound behind tokens rather than
 * concrete classes: the send gate and the checklist logic are the parts that must
 * be provable, and they are provable precisely because they never name a
 * database or an e-mail provider.
 */
@Module({
  imports: [AuditModule],
  controllers: [FulfillmentController, InternalFulfillmentController],
  providers: [
    { provide: FULFILLMENT_STORE, useClass: PrismaFulfillmentStore },
    { provide: ASSET_DELIVERY_TRANSPORT, useClass: MockAssetDeliveryTransport },
    ChecklistService,
    GiftCardAssetService,
    FulfillmentService,
  ],
  exports: [FulfillmentService, GiftCardAssetService, ChecklistService, FULFILLMENT_STORE],
})
export class FulfillmentModule {}
