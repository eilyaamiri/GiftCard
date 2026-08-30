import { Module } from '@nestjs/common';
import { MockSupplierProvider, SUPPLIER_PROVIDERS, type SupplierProvider } from '@barat/suppliers';

import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { WorkItemsModule } from '../workitems/workitems.module';
import { PrismaSupplierStore } from './prisma-supplier.store';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SUPPLIER_STORE } from './suppliers.types';

/**
 * `SUPPLIER_PROVIDERS` is bound to an ARRAY, not to a single adapter.
 *
 * The POC ships one provider, but the registry is plural from day one because
 * the providers are not interchangeable — only Tillo returns a raw code, Reloadly
 * e-mails the customer directly — and the selection logic must be able to see all
 * of them at once to pick an offer.
 */
@Module({
  imports: [AuditModule, WorkItemsModule, FulfillmentModule],
  controllers: [SuppliersController],
  providers: [
    { provide: SUPPLIER_STORE, useClass: PrismaSupplierStore },
    {
      provide: SUPPLIER_PROVIDERS,
      useFactory: (): readonly SupplierProvider[] => [new MockSupplierProvider()],
    },
    SuppliersService,
  ],
  exports: [SuppliersService, SUPPLIER_PROVIDERS, SUPPLIER_STORE],
})
export class SuppliersModule {}
