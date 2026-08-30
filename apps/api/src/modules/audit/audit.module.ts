import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import {
  AUDIT_DATABASE,
  AUDIT_WRITER,
  AuditService,
  PrismaAuditWriter,
} from './audit.service';

@Module({
  providers: [
    { provide: AUDIT_DATABASE, useValue: prisma },
    PrismaAuditWriter,
    { provide: AUDIT_WRITER, useExisting: PrismaAuditWriter },
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
