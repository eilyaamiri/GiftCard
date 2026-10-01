import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity/rbac/roles.decorator';
import { requireStaff } from '../workitems/staff-context';
import {
  checkPurchaseStatusBodySchema,
  importTopUpCatalogBodySchema,
  listOffersQuerySchema,
  purchaseBodySchema,
  type CheckPurchaseStatusBody,
  type ImportTopUpCatalogBody,
  type ListOffersQuery,
  type PurchaseBody,
} from './suppliers.schemas';
import { SuppliersService } from './suppliers.service';
import { TopUpCatalogImportService, type TopUpImportResult } from './topup-catalog.import';
import { TopUpCatalogSyncService } from './topup-catalog.sync';
import type {
  SupplierOfferView,
  SupplierPurchaseOutcome,
  SupplierPurchaseStatusView,
  SupplierView,
} from './suppliers.types';
import type { TopUpSyncResult } from './topup-catalog.sync';

/**
 * `@Roles` is what authenticates these routes: without it the global RolesGuard
 * returns early, no actor is ever attached, and `requireStaff` rejects everyone.
 */
@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR')
@Controller('operator/suppliers')
export class SuppliersController {
  constructor(
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(TopUpCatalogSyncService) private readonly topUpSync: TopUpCatalogSyncService,
    @Inject(TopUpCatalogImportService) private readonly topUpImport: TopUpCatalogImportService,
  ) {}

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

  /**
   * Re-reads every enabled top-up venue and applies what it still lists.
   *
   * Operator-triggered rather than scheduled: the catalogue moves in hours, not
   * seconds, and a background job would need its own retry and overlap story in
   * the worker's queue contract for a reconciliation nobody is waiting on. The
   * run is idempotent — it writes availability, never a price and never the
   * operator's `isActive` switch — so pressing it twice is harmless.
   */
  @Roles('ADMIN', 'OPS_MANAGER')
  @Post('topup/sync')
  async syncTopUpCatalog(@Req() request: unknown): Promise<{ result: TopUpSyncResult }> {
    requireStaff(request);
    return { result: await this.topUpSync.sync() };
  }

  /**
   * Imports the venue's game catalogue: new games, their account fields and
   * their offers. Create-only, and nothing it creates is sellable — games and
   * a newly created supplier start inactive, and selling still needs the
   * human-set `FAZERCARDS_TOPUP_ENABLED`. Run with `dryRun: true` first to see
   * what the venue's answer parsed into.
   */
  @Roles('ADMIN', 'OPS_MANAGER')
  @Post('topup/import')
  async importTopUpCatalog(
    @Body(zodPipe(importTopUpCatalogBodySchema)) body: ImportTopUpCatalogBody,
    @Req() request: unknown,
  ): Promise<{ result: TopUpImportResult }> {
    const staff = requireStaff(request);
    return {
      result: await this.topUpImport.import({
        supplierCode: body.supplierCode,
        dryRun: body.dryRun,
        actor: { id: staff.id, role: staff.role },
      }),
    };
  }
}
