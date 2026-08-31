/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import {
  listPageRequestSchema,
  saveBankAccountRequestSchema,
  supportReplySchema,
  supportRequestSchema,
  updateAccountEmailRequestSchema,
  updateProfileRequestSchema,
  type ListPageRequest,
  type SaveBankAccountRequest,
  type SupportReply,
  type SupportRequest,
  type UpdateAccountEmailRequest,
  type UpdateProfileRequest,
} from '../identity/identity.schemas';
import type { IdentityActor } from '../identity/identity.tokens';
import { CurrentCustomer, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { CustomerScoped } from '../identity/rbac/roles.decorator';
import { AccountService } from './account.service';
import { BankDetailsService } from './bank-details.service';
import { SupportService, type SupportTicketDto } from './support.service';
import type {
  AccountOrderDto,
  AccountPaymentDto,
  AccountRefundDto,
  BankAccountDto,
  CustomerProfileDto,
  PagedResult,
} from './customers.types';

/**
 * `/api/account/*` — the signed-in customer's own data.
 *
 * `@CustomerScoped()` on the class makes the guard reject anything that is not a
 * customer session, and every handler takes the customer id from
 * `@CurrentCustomer` (the verified session) rather than from the request. There
 * is no route parameter anywhere in this controller that identifies a customer,
 * which is what makes horizontal access control structural here.
 */
@ApiTags('account')
@Controller('account')
@CustomerScoped()
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly support: SupportService,
    private readonly bankDetails: BankDetailsService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'The signed-in customer profile' })
  @ApiOkResponse({ description: 'Identity values are masked' })
  async profile(@CurrentCustomer() customerId: string): Promise<CustomerProfileDto> {
    return this.account.getProfile(customerId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update name, language and marketing preference' })
  async updateProfile(
    @CurrentCustomer() customerId: string,
    @Body(zodPipe(updateProfileRequestSchema)) body: UpdateProfileRequest,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<CustomerProfileDto> {
    return this.account.updateProfile(customerId, body, actor);
  }

  @Patch('email')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Change the e-mail on the account' })
  @ApiOkResponse({
    description: 'The new address is stored unverified; the response stays masked',
  })
  async updateEmail(
    @CurrentCustomer() customerId: string,
    @Body(zodPipe(updateAccountEmailRequestSchema)) body: UpdateAccountEmailRequest,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<CustomerProfileDto> {
    return this.account.updateEmail(customerId, body, actor);
  }

  @Put('bank-account')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: "The customer's own IBAN and card for refunds" })
  @ApiOkResponse({
    description: 'Stored encrypted; only the masked forms are ever returned',
  })
  async saveBankAccount(
    @CurrentCustomer() customerId: string,
    @Body(zodPipe(saveBankAccountRequestSchema)) body: SaveBankAccountRequest,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<BankAccountDto> {
    return this.bankDetails.save(customerId, body, actor);
  }

  @Delete('bank-account')
  @ApiOperation({ summary: 'Remove the stored payout details' })
  async removeBankAccount(
    @CurrentCustomer() customerId: string,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<{ removed: boolean }> {
    return this.bankDetails.remove(customerId, actor);
  }

  @Get('orders')
  @ApiOperation({ summary: "The customer's own orders" })
  async orders(
    @CurrentCustomer() customerId: string,
    @Query(zodPipe(listPageRequestSchema)) query: ListPageRequest,
  ): Promise<PagedResult<AccountOrderDto>> {
    return this.account.listOrders(customerId, query.page, query.pageSize);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'A single order, if it belongs to the caller' })
  @ApiOkResponse({ description: "Another customer's order id resolves to 404" })
  async order(
    @CurrentCustomer() customerId: string,
    @Param('orderId') orderId: string,
  ): Promise<AccountOrderDto> {
    return this.account.getOrder(customerId, orderId);
  }

  @Get('payments')
  @ApiOperation({ summary: "The customer's own payments" })
  async payments(
    @CurrentCustomer() customerId: string,
    @Query(zodPipe(listPageRequestSchema)) query: ListPageRequest,
  ): Promise<PagedResult<AccountPaymentDto>> {
    return this.account.listPayments(customerId, query.page, query.pageSize);
  }

  @Get('refunds')
  @ApiOperation({ summary: "The customer's own refunds" })
  async refunds(
    @CurrentCustomer() customerId: string,
    @Query(zodPipe(listPageRequestSchema)) query: ListPageRequest,
  ): Promise<PagedResult<AccountRefundDto>> {
    return this.account.listRefunds(customerId, query.page, query.pageSize);
  }

  @Get('support')
  @ApiOperation({ summary: "The customer's own support requests" })
  async supportRequests(
    @CurrentCustomer() customerId: string,
  ): Promise<readonly SupportTicketDto[]> {
    return this.support.list(customerId);
  }

  @Get('support/:ticketId')
  @ApiOperation({ summary: "A customer's support ticket and conversation" })
  async supportRequest(
    @CurrentCustomer() customerId: string,
    @Param('ticketId') ticketId: string,
  ): Promise<SupportTicketDto> {
    return this.support.getForCustomer(customerId, ticketId);
  }

  @Post('support/:ticketId/messages')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Reply to a support ticket' })
  async replyToSupportRequest(
    @CurrentCustomer() customerId: string,
    @Param('ticketId') ticketId: string,
    @Body(zodPipe(supportReplySchema)) body: SupportReply,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<SupportTicketDto> {
    return this.support.replyAsCustomer(customerId, ticketId, body, actor);
  }

  @Post('support')
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Raise a support request, optionally about one order' })
  async createSupportRequest(
    @CurrentCustomer() customerId: string,
    @Body(zodPipe(supportRequestSchema)) body: SupportRequest,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<SupportTicketDto> {
    return this.support.create(customerId, body, actor);
  }
}
