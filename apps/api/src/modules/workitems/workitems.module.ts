import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaWorkItemStore } from './prisma-workitem.store';
import { WorkItemsController } from './workitems.controller';
import { WorkItemsService } from './workitems.service';
import { FULFILLMENT_TRIGGER, WORK_ITEM_ESCALATOR, WORK_ITEM_STORE } from './workitems.types';

/**
 * `FULFILLMENT_TRIGGER` is exported so the payments module (B4) can inject the
 * port without importing this service class — orders and payments stay unaware
 * of how a work item is stored.
 */
@Module({
  imports: [AuditModule],
  controllers: [WorkItemsController],
  providers: [
    { provide: WORK_ITEM_STORE, useClass: PrismaWorkItemStore },
    WorkItemsService,
    { provide: FULFILLMENT_TRIGGER, useExisting: WorkItemsService },
    { provide: WORK_ITEM_ESCALATOR, useExisting: WorkItemsService },
  ],
  exports: [WorkItemsService, FULFILLMENT_TRIGGER, WORK_ITEM_ESCALATOR, WORK_ITEM_STORE],
})
export class WorkItemsModule {}
