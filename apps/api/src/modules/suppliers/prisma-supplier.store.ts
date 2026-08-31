import { Injectable } from '@nestjs/common';
import { prisma, type Prisma } from '@barat/database';
import type { SupplierAvailability } from '@barat/suppliers';

import type { SupplierOfferView, SupplierStore, SupplierView } from './suppliers.types';

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

function toOfferView(row: SelectedOffer): SupplierOfferView {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    supportsRawCode: row.supplier.supportsRawCode,
    skuId: row.skuId,
    // The current schema has no provider-specific SKU column. Supplier adapters
    // receive our stable SKU id until Foundation adds one; this is explicit rather
    // than pretending the database has data it cannot store.
    providerSku: row.skuId,
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

  constructor() {
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
    return rows.map(toOfferView);
  }

  async findOfferById(offerId: string): Promise<SupplierOfferView | null> {
    const row = await this.db.supplierOffer.findUnique({ where: { id: offerId }, select: OFFER_SELECT });
    return row === null ? null : toOfferView(row);
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
}
