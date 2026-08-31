import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { CreateOrderResponse, GetOrderResponse, ListOrdersResponse } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { IDEMPOTENCY_HEADER } from '../../common/interceptors/idempotency-header.interceptor';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentCustomer, CustomerScoped, RequestMetadata } from '../identity';
import type { IdentityActor } from '../identity';
import {
  createOrderBodySchema,
  listOrdersQuerySchema,
  orderNumberParamSchema,
} from './orders.schemas';
import type { CreateOrderBody, ListOrdersQuery } from './orders.schemas';
import { OrdersService } from './orders.service';

/** What the idempotency interceptor leaves on the request. */
interface IdempotentRequest {
  idempotencyKey?: string;
  headers: Record<string, unknown>;
}

/**
 * Customer-facing order endpoints.
 *
 * `@CustomerScoped()` makes the guard require a customer session, and every
 * query is filtered by `@CurrentCustomer()` — the id from the verified session,
 * never a path or body parameter. That is what makes "customer A cannot read
 * customer B's order" structural.
 */
@Controller('orders')
@CustomerScoped()
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @Body(zodPipe(createOrderBodySchema)) body: CreateOrderBody,
    @CurrentCustomer() customerId: string,
    @RequestMetadata() metadata: IdentityActor,
    @Req() request: IdempotentRequest,
  ): Promise<CreateOrderResponse> {
    return this.orders.createOrder(
      { ...body, idempotencyKey: idempotencyKey(body, request) },
      { customerId, ip: metadata.ip, userAgent: metadata.userAgent },
    );
  }

  @Get()
  listOrders(
    @Query(zodPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
    @CurrentCustomer() customerId: string,
  ): Promise<ListOrdersResponse> {
    return this.orders.listOrdersForCustomer(customerId, query);
  }

  @Get(':orderNumber')
  getOrder(
    @Param(zodPipe(orderNumberParamSchema)) params: { orderNumber: string },
    @CurrentCustomer() customerId: string,
  ): Promise<GetOrderResponse> {
    return this.orders.getOrderForCustomer(params.orderNumber, customerId);
  }
}

/**
 * Reconcile the two places an idempotency key can arrive.
 *
 * The contract carries it in the body; the platform interceptor normalises the
 * `Idempotency-Key` header. Accepting both silently would let a proxy replay a
 * request under a different key, so a disagreement is refused outright.
 */
function idempotencyKey(body: CreateOrderBody, request: IdempotentRequest): string {
  const header = request.idempotencyKey ?? readHeader(request);
  if (header === undefined) {
    throw DomainErrors.validation([
      { path: IDEMPOTENCY_HEADER, message: 'Idempotency-Key header is required' },
    ]);
  }
  if (body.idempotencyKey !== undefined && header !== body.idempotencyKey) {
    throw DomainErrors.idempotencyConflict(
      'Idempotency-Key header does not match the idempotency key in the body',
    );
  }
  return header;
}

function readHeader(request: IdempotentRequest): string | undefined {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : undefined;
}
