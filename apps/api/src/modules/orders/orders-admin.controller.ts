import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { GetOrderResponse, ListOrdersResponse } from '@barat/contracts';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity';
import { adminListOrdersQuerySchema, orderIdParamSchema } from './orders.schemas';
import type { AdminListOrdersQuery } from './orders.schemas';
import { OrdersService } from './orders.service';

/**
 * Staff order views.
 *
 * Read-only on purpose: an operator advances an order through the fulfillment
 * module's work items, which enforce the checklist and the audit trail. There
 * is deliberately no "set status" endpoint that would bypass the state machine.
 */
@Controller('admin/orders')
@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'FINANCE', 'SUPPORT', 'VIEWER')
export class OrdersAdminController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  listOrders(
    @Query(zodPipe(adminListOrdersQuerySchema)) query: AdminListOrdersQuery,
  ): Promise<ListOrdersResponse> {
    return this.orders.adminListOrders(query);
  }

  @Get(':id')
  getOrder(@Param(zodPipe(orderIdParamSchema)) params: { id: string }): Promise<GetOrderResponse> {
    return this.orders.adminGetOrder(params.id);
  }
}
