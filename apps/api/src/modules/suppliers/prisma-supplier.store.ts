import { Inject, Injectable } from '@nestjs/common';
import { prisma, type Prisma } from '@barat/database';
import type { SupplierAvailability } from '@barat/suppliers';

import { providerSkuKey, type ProviderSkuMap } from './suppliers.env';
import { PROVIDER_SKU_MAP } from './suppliers.types';
import type {
  AutoFulfillmentTarget,
  SupplierOfferView,
  SupplierPurchaseAttemptRecord,
  SupplierPurchaseAttemptStatus,
  SupplierStore,
  SupplierView,
} from './suppliers.types';

const SUPPLIER_SELECT = {
  id: true,
  code: true,
  name: true,
  integrationMode: true,
  supportsRawCode: true,
  defaultCurrency: true,
  isActive: true,
} satisfies Prisma.SupplierSelect;

type SelectedSupplier = Prisma.SupplierGetPayload<{ select: typeof SUPPLIER_SELECT }>;

function toSupplierView(row: SelectedSupplier): Omit<SupplierView, 'hasProvider'> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    integrationMode: row.integrationMode as 'MANUAL' | 'API',
    supportsRawCode: row.supportsRawCode,
    defaultCurrency: row.defaultCurrency,
    isActive: row.isActive,
  };
}

const OFFER_SELECT = {
  id: true,
  supplierId: true,
  skuId: true,
  costCurrency: true,
  costAmount: true,
  discountBps: true,
  availability: true,
  priority: true,
  isActive: true,
  lastCheckedAt: true,
  supplier: {
    select: {
      code: true,
      name: true,
      supportsRawCode: true,
    },
  },
} satisfies Prisma.SupplierOfferSelect;

type SelectedOffer = Prisma.SupplierOfferGetPayload<{ select: typeof OFFER_SELECT }>;

function toOfferView(row: SelectedOffer, providerSkus: ProviderSkuMap): SupplierOfferView {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    supportsRawCode: row.supplier.supportsRawCode,
    skuId: row.skuId,
    // The current schema has no provider-specific SKU column, so the translation
    // is configured rather than stored — see the gap note in `suppliers.env.ts`.
    // Unmapped offers keep falling back to our own SKU id: that is a value no
    // external supplier recognises, and an adapter given one refuses it outright
    // instead of guessing which product to buy.
    providerSku: providerSkus.get(providerSkuKey(row.supplier.code, row.skuId)) ?? row.skuId,
    costCurrency: row.costCurrency,
    costAmount: row.costAmount.toString(),
    discountBps: row.discountBps,
    availability: row.availability,
    priority: row.priority,
    isActive: row.isActive,
    lastCheckedAt: row.lastCheckedAt,
  };
}

@Injectable()
export class PrismaSupplierStore implements SupplierStore {
  private readonly db: typeof prisma;

  constructor(@Inject(PROVIDER_SKU_MAP) private readonly providerSkus: ProviderSkuMap) {
    this.db = prisma;
  }

  async listSuppliers(): Promise<readonly Omit<SupplierView, 'hasProvider'>[]> {
    const rows = await this.db.supplier.findMany({
      orderBy: { name: 'asc' },
      select: SUPPLIER_SELECT,
    });
    return rows.map(toSupplierView);
  }

  async findSupplierByCode(code: string): Promise<Omit<SupplierView, 'hasProvider'> | null> {
    const row = await this.db.supplier.findUnique({ where: { code }, select: SUPPLIER_SELECT });
    return row === null ? null : toSupplierView(row);
  }

  async findOffersForSku(skuId: string): Promise<readonly SupplierOfferView[]> {
    const rows = await this.db.supplierOffer.findMany({
      where: { skuId, isActive: true, supplier: { isActive: true } },
      orderBy: [{ costAmount: 'asc' }, { priority: 'asc' }],
      select: OFFER_SELECT,
    });
    return rows.map((row) => toOfferView(row, this.providerSkus));
  }

  async findOfferById(offerId: string): Promise<SupplierOfferView | null> {
    const row = await this.db.supplierOffer.findUnique({ where: { id: offerId }, select: OFFER_SELECT });
    return row === null ? null : toOfferView(row, this.providerSkus);
  }

  /**
   * Resolves a work item into the purchase it stands for.
   *
   * The read crosses into `WorkItem` and `Order` deliberately: the orchestrator
   * must decide on state it read itself, in one query, rather than on a summary
   * another module handed it. `assetCount` in particular is the guard against
   * buying a second card for an order that already has one, so it is counted
   * here rather than inferred.
   */
  async findAutoFulfillmentTarget(workItemId: string): Promise<AutoFulfillmentTarget | null> {
    const row = await this.db.workItem.findUnique({
      where: { id: workItemId },
      select: {
        id: true,
        type: true,
        status: true,
        assignedToStaffId: true,
        orderId: true,
        customerId: true,
        order: {
          select: {
            status: true,
            quote: { select: { skuId: true, quantity: true } },
            _count: { select: { giftCardAssets: true } },
          },
        },
      },
    });
    if (row === null || row.orderId === null || row.order === null) {
      return null;
    }

    return {
      workItemId: row.id,
      workItemType: row.type,
      workItemStatus: row.status,
      assignedToStaffId: row.assignedToStaffId,
      orderId: row.orderId,
      customerId: row.customerId,
      orderStatus: row.order.status,
      skuId: row.order.quote.skuId,
      quantity: row.order.quote.quantity,
      assetCount: row.order._count.giftCardAssets,
    };
  }

  async hasOpenPurchaseAmbiguity(orderId: string): Promise<boolean> {
    const open = await this.db.workItem.count({
      where: {
        orderId,
        status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
        OR: [{ type: 'UNKNOWN_OUTCOME' }, { code: { startsWith: 'SUPPLIER_PENDING:' } }],
      },
    });
    return open > 0;
  }

  async recordAvailabilityCheck(input: {
    offerId: string;
    availability: SupplierAvailability;
    checkedAt: Date;
  }): Promise<void> {
    await this.db.supplierOffer.update({
      where: { id: input.offerId },
      data: { availability: input.availability, lastCheckedAt: input.checkedAt },
    });
  }

  async latestPurchaseAttempt(orderId: string): Promise<SupplierPurchaseAttemptRecord | null> {
    const row = await this.db.supplierPurchaseAttempt.findFirst({
      where: { orderId },
      orderBy: { generation: 'desc' },
    });
    return row === null ? null : toAttemptRecord(row);
  }

  async openPurchaseAttempt(input: {
    orderId: string;
    supplierId: string;
    offerId: string;
    idempotencyKey: string;
    generation: number;
    requestedByStaffId: string | null;
  }): Promise<SupplierPurchaseAttemptRecord | null> {
    try {
      const row = await this.db.supplierPurchaseAttempt.create({
        data: {
          orderId: input.orderId,
          supplierId: input.supplierId,
          offerId: input.offerId,
          idempotencyKey: input.idempotencyKey,
          generation: input.generation,
          status: 'IN_FLIGHT',
          /* The order's one unsettled-purchase slot; the unique index is the
           * cross-process guarantee. */
          openOrderKey: input.orderId,
          requestedByStaffId: input.requestedByStaffId,
        },
      });
      return toAttemptRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async settlePurchaseAttempt(input: {
    id: string;
    status: SupplierPurchaseAttemptStatus;
    providerReference?: string | null;
    errorCode?: string | null;
  }): Promise<void> {
    const settled = input.status === 'SUCCEEDED' || input.status === 'FAILED';
    await this.db.supplierPurchaseAttempt.update({
      where: { id: input.id },
      data: {
        status: input.status,
        ...(input.providerReference === undefined ? {} : { providerReference: input.providerReference }),
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        ...(settled ? { openOrderKey: null, settledAt: new Date() } : {}),
      },
    });
  }
}

function toAttemptRecord(row: {
  id: string;
  orderId: string;
  supplierId: string;
  offerId: string | null;
  idempotencyKey: string;
  generation: number;
  status: string;
  providerReference: string | null;
  errorCode: string | null;
  requestedByStaffId: string | null;
  startedAt: Date;
  settledAt: Date | null;
}): SupplierPurchaseAttemptRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    supplierId: row.supplierId,
    offerId: row.offerId,
    idempotencyKey: row.idempotencyKey,
    generation: row.generation,
    status: row.status as SupplierPurchaseAttemptStatus,
    providerReference: row.providerReference,
    errorCode: row.errorCode,
    requestedByStaffId: row.requestedByStaffId,
    startedAt: row.startedAt,
    settledAt: row.settledAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
