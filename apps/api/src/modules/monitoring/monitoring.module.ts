import { Module } from '@nestjs/common';
import { PrismaClient } from '@barat/database';

import { FxModule } from '../fx/fx.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { MONITORING_DATABASE } from './monitoring.tokens';

/**
 * API and server monitoring.
 *
 * Provides live status of all integrated APIs, server health metrics, and
 * stuck order detection. Auto-extends as adapters are added via
 * SUPPLIER_PROVIDERS injection.
 *
 * **Note:** This module depends on FxModule and SuppliersModule. It must
 * NOT be hosted in HealthModule, which deliberately has no domain
 * dependencies so it can still answer when a domain module fails to boot.
 */
@Module({
  imports: [FxModule, SuppliersModule],
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    {
      provide: MONITORING_DATABASE,
      useFactory: () => new PrismaClient(),
    },
  ],
  exports: [MonitoringService],
})
export class MonitoringModule {}
