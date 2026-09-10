import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { WorkItemsModule } from '../workitems/workitems.module';
import { ChecklistService } from './checklist.service';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { InternalFulfillmentController } from './internal-fulfillment.controller';
import { ASSET_DELIVERY_TRANSPORT, FULFILLMENT_STORE } from './fulfillment.types';
import { GiftCardAssetService } from './gift-card-asset.service';
import { PaymentReceiptService } from './payment-receipt.service';
import { PrismaFulfillmentStore } from './prisma-fulfillment.store';
import { EmailAssetDeliveryTransport } from './transports/email-asset-delivery.transport';

/**
 * Both the store and the delivery transport are bound behind tokens rather than
 * concrete classes: the send gate and the checklist logic are the parts that must
 * be provable, and they are provable precisely because they never name a
 * database or an e-mail provider.
 */
/*
 * `WorkItemsModule` is imported for `WORK_ITEM_ESCALATOR` alone — the port that
 * raises a manager review for an out-of-tolerance supplier cost. It does not
 * import this module back, so the pair is acyclic and needs no `forwardRef`.
 */
@Module({
  imports: [AuditModule, IdentityModule, WorkItemsModule],
  controllers: [FulfillmentController, InternalFulfillmentController],
  providers: [
    { provide: FULFILLMENT_STORE, useClass: PrismaFulfillmentStore },
    { provide: ASSET_DELIVERY_TRANSPORT, useClass: EmailAssetDeliveryTransport },
    ChecklistService,
    GiftCardAssetService,
    PaymentReceiptService,
    FulfillmentService,
  ],
  exports: [
    FulfillmentService,
    GiftCardAssetService,
    PaymentReceiptService,
    ChecklistService,
    FULFILLMENT_STORE,
  ],
})
export class FulfillmentModule {}
