import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AuditModule } from '../audit/audit.module';
import { AdminKbController } from './admin-kb.controller';
import { KbController } from './kb.controller';
import { KB_DATABASE, KbService } from './kb.service';

/**
 * The storefront knowledge base (`/api/kb`) and its admin CRUD
 * (`/api/admin/knowledge-base/*`).
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminKbController, KbController],
  providers: [{ provide: KB_DATABASE, useValue: prisma }, KbService],
  exports: [KbService],
})
export class KbModule {}
