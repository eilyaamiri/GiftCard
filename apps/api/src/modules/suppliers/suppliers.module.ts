import { Module } from '@nestjs/common';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';

import { AppConfigModule, AppConfigService } from '../../common/config';
import { AuditModule } from '../audit/audit.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { WorkItemsModule } from '../workitems/workitems.module';
import { FULFILLMENT_TRIGGER } from '../workitems/workitems.types';
import { AutoFulfillmentService } from './auto-fulfillment.service';
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
 *
 * `FULFILLMENT_TRIGGER` is re-bound here, to `AutoFulfillmentService`. The work
 * items module still binds the same token to `WorkItemsService`, and that binding
 * is still correct — creating the task is exactly what the trigger must do first.
 * This one wraps it: create the task, then try to buy the card. The dependency
 * runs one way (suppliers → work items → nothing), so there is no cycle, and a
 * consumer that wants only the task creation can still import `WorkItemsModule`.
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
    AutoFulfillmentService,
    { provide: FULFILLMENT_TRIGGER, useExisting: AutoFulfillmentService },
  ],
  exports: [
    SuppliersService,
    AutoFulfillmentService,
    FULFILLMENT_TRIGGER,
    SUPPLIER_PROVIDERS,
    SUPPLIER_STORE,
  ],
})
export class SuppliersModule {}
