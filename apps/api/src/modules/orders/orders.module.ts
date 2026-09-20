import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { OrderPaymentWindowService } from './order-payment-window.service';
import { OrderStateMachine } from './order-state-machine';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ORDER_PAYMENT_BRIDGE, ORDERS_DATABASE } from './orders.tokens';

/**
 * Orders.
 *
 * `ORDER_PAYMENT_BRIDGE` is exported so the payments module can advance an
 * order after a server-side verification without importing `OrdersService` —
 * `orders -> payments -> orders` would be a cycle. Payments injects the token
 * and sees only the three methods on `OrderPaymentBridge`.
 *
 * `FulfillmentModule` is imported for `GiftCardAssetService`, the single door to
 * gift-card plaintext, which the customer reveal endpoint goes through. It
 * imports only `AuditModule`, so this edge adds no cycle.
 *
 * `OrderPaymentWindowService` is the timer that closes orders nobody paid for.
 * It lives here rather than in `apps/worker` because no worker service is
 * installed on the production host — see the note on the class itself.
 */
@Module({
  imports: [AuditModule, FulfillmentModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [
    { provide: ORDERS_DATABASE, useValue: prisma },
    OrderStateMachine,
    OrdersService,
    OrderPaymentWindowService,
    { provide: ORDER_PAYMENT_BRIDGE, useExisting: OrdersService },
  ],
  exports: [OrdersService, OrderStateMachine, ORDER_PAYMENT_BRIDGE],
})
export class OrdersModule {}
