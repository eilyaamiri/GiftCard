import { Module } from '@nestjs/common';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';

import { AppConfigModule, AppConfigService } from '../../common/config';
import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { WorkItemsModule } from '../workitems/workitems.module';
import { PrismaSupplierStore } from './prisma-supplier.store';
import { buildSupplierProviders } from './supplier-providers.factory';
import { readProviderSkuMap } from './suppliers.env';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { PROVIDER_SKU_MAP, SUPPLIER_STORE } from './suppliers.types';

/**
 * `SUPPLIER_PROVIDERS` is bound to an ARRAY, not to a single adapter.
 *
 * The providers are not interchangeable — only Tillo hands back a raw code,
 * while Reloadly issues the card and holds it behind a second call — and the
 * selection logic must be able to see all of them at once to pick an offer.
 */
@Module({
  imports: [AppConfigModule, AuditModule, WorkItemsModule, FulfillmentModule],
  controllers: [SuppliersController],
  providers: [
    { provide: PROVIDER_SKU_MAP, useFactory: readProviderSkuMap },
    { provide: SUPPLIER_STORE, useClass: PrismaSupplierStore },
    {
      provide: SUPPLIER_PROVIDERS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => buildSupplierProviders({ isTest: config.isTest }),
    },
    SuppliersService,
  ],
  exports: [SuppliersService, SUPPLIER_PROVIDERS, SUPPLIER_STORE],
})
export class SuppliersModule {}
