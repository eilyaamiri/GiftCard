/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createCustomerNoteRequestSchema,
  customerSearchRequestSchema,
  type CreateCustomerNoteRequest,
  type CustomerSearchRequest,
} from '../identity/identity.schemas';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import { CustomersService } from './customers.service';
import type { Customer360Dto, CustomerSearchHit, PagedResult } from './customers.types';

/**
 * Operator Customer 360 (`/api/customers/*`).
 *
 * Every route carries an explicit `@Roles(...)`; there is no "authenticated staff
 * may do anything" fallback. The roles listed here are the whole authorisation
 * story — the admin UI hiding a menu item is not a control (AGENTS.md section 4).
 *
 * Note what is absent: no route on this controller can change a payment's
 * status, amount or verification result, and none can mark an identity verified.
 * Those are not permission-gated here, they simply do not exist.
 */
@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('search')
  @Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'FINANCE', 'SUPPORT')
  @Throttle({ medium: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Find a customer by name, mobile, e-mail, code, order number or payment ref' })
  @ApiOkResponse({ description: 'Identity matches are exact; name matches are partial; every search is audited' })
  async search(
    @Query(zodPipe(customerSearchRequestSchema)) query: CustomerSearchRequest,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<PagedResult<CustomerSearchHit>> {
    return this.customers.search(query, staff, actor);
  }

  @Get(':customerId')
  @Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'FINANCE', 'SUPPORT')
  @ApiOperation({ summary: 'Full customer view: profile, flags, notes, orders, payments, refunds and tickets' })
  @ApiOkResponse({ description: 'Read-only. Viewing is audited.' })
  async customer360(
    @Param('customerId') customerId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<Customer360Dto> {
    return this.customers.customer360(customerId, staff, actor);
  }

  @Post(':customerId/notes')
  @Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'SUPPORT')
  @ApiOperation({ summary: 'Attach an internal note to an account' })
  async addNote(
    @Param('customerId') customerId: string,
    @Body(zodPipe(createCustomerNoteRequestSchema)) body: CreateCustomerNoteRequest,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<Customer360Dto['notes'][number]> {
    return this.customers.addNote(customerId, body, staff, actor);
  }

  @Delete(':customerId/flags/:key')
  @Roles('ADMIN', 'OPS_MANAGER', 'SUPPORT')
  @ApiOperation({ summary: 'Clear a review flag once support has handled it' })
  @ApiOkResponse({
    description: 'Closes the review marker only; it never merges accounts or verifies an identity',
  })
  async clearFlag(
    @Param('customerId') customerId: string,
    @Param('key') key: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() actor: IdentityActor,
  ): Promise<{ cleared: boolean }> {
    return this.customers.clearFlag(customerId, key, staff, actor);
  }
}
