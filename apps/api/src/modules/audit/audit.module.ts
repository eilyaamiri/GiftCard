import { Module } from '@nestjs/common';

import { AuditService, PrismaAuditWriter } from './audit.service';

@Module({
  providers: [PrismaAuditWriter, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
