import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity/rbac/roles.decorator';
import { requireStaff } from '../workitems/staff-context';
import {
  checkPurchaseStatusBodySchema,
  listOffersQuerySchema,
  purchaseBodySchema,
  type CheckPurchaseStatusBody,
  type ListOffersQuery,
  type PurchaseBody,
} from './suppliers.schemas';
import { SuppliersService } from './suppliers.service';
import type {
  SupplierOfferView,
  SupplierPurchaseOutcome,
  SupplierPurchaseStatusView,
  SupplierView,
} from './suppliers.types';

/**
 * `@Roles` is what authenticates these routes: without it the global RolesGuard
 * returns early, no actor is ever attached, and `requireStaff` rejects everyone.
 */
@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR')
@Controller('operator/suppliers')
export class SuppliersController {
  constructor(@Inject(SuppliersService) private readonly suppliers: SuppliersService) {}

  @Get()
  async list(@Req() request: unknown): Promise<{ suppliers: readonly SupplierView[] }> {
    requireStaff(request);
    return { suppliers: await this.suppliers.listSuppliers() };
  }

  @Get('offers')
  async offers(
    @Query(zodPipe(listOffersQuerySchema)) query: ListOffersQuery,
    @Req() request: unknown,
  ): Promise<{ offers: readonly SupplierOfferView[] }> {
    requireStaff(request);
    return { offers: await this.suppliers.listOffers(query.skuId) };
  }

  @Get('select-offer')
  async selectOffer(
    @Query(zodPipe(listOffersQuerySchema)) query: ListOffersQuery,
    @Req() request: unknown,
  ): Promise<{ offer: SupplierOfferView }> {
    requireStaff(request);
    return { offer: await this.suppliers.selectOffer(query.skuId) };
  }

  @Post('purchase')
  async purchase(
    @Body(zodPipe(purchaseBodySchema)) body: PurchaseBody,
    @Req() request: unknown,
  ): Promise<{ outcome: SupplierPurchaseOutcome }> {
    requireStaff(request);
    const outcome = await this.suppliers.purchase({
      orderId: body.orderId,
      workItemId: body.workItemId,
      offerId: body.offerId,
      quantity: body.quantity,
      idempotencyKey: body.idempotencyKey,
      ...(body.customerId === undefined ? {} : { customerId: body.customerId }),
      ...(body.recipientEmail === undefined ? {} : { recipientEmail: body.recipientEmail }),
    });
    return { outcome };
  }

  /**
   * Explicit status check — deliberately not a purchase retry.
   *
   * Returns the narrowed `SupplierPurchaseStatusView`. The provider's raw result
   * can contain a plaintext code and must never be serialised into a response.
   */
  @Post('purchase-status')
  async purchaseStatus(
    @Body(zodPipe(checkPurchaseStatusBodySchema)) body: CheckPurchaseStatusBody,
    @Req() request: unknown,
  ): Promise<{ result: SupplierPurchaseStatusView }> {
    requireStaff(request);
    return { result: await this.suppliers.checkPurchaseStatus(body) };
  }
}
