import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
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
 */
@Module({
  imports: [AuditModule],
  controllers: [OrdersController, OrdersAdminController],
  providers: [
    { provide: ORDERS_DATABASE, useValue: prisma },
    OrderStateMachine,
    OrdersService,
    { provide: ORDER_PAYMENT_BRIDGE, useExisting: OrdersService },
  ],
  exports: [OrdersService, OrderStateMachine, ORDER_PAYMENT_BRIDGE],
})
export class OrdersModule {}
