import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it } from 'vitest';

import { PrismaClient } from '../generated/client';
import { importInternationalServices, internationalServices } from './import-international-services';

// Opt-in only: CI provides a disposable PostgreSQL service, never production data.
describe.skipIf(process.env['RUN_SERVICE_IMPORT_INTEGRATION'] !== '1')('service import integration', () => {
  it('preserves the existing form and activation on repeated imports', async () => {
    const url = new URL(process.env['DATABASE_URL'] ?? '');
    if (url.hostname !== 'localhost' || url.pathname !== '/migration_replay') {
      throw new Error('This test requires the disposable migration_replay database');
    }
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }), log: [] });
    try {
      const template = await db.internationalService.create({ data: {
        slug: 'saas-subscriptions', name: 'Existing template', nameFa: 'خدمت موجود',
        category: 'saas', currency: 'USD', isActive: true, requiresManualReview: false,
        fields: { create: [{ key: 'invoiceReference', label: 'Invoice', labelFa: 'شماره فاکتور',
          fieldType: 'TEXT', isRequired: true, sortOrder: 10, helpTextFa: 'راهنما', validationRegex: '^INV-' }] },
      }, include: { fields: true } });
      expect(await importInternationalServices(db)).toEqual({ created: 130, preserved: 1 });
      expect(await db.internationalService.count()).toBe(131);
      expect(await db.internationalService.count({ where: { isActive: true } })).toBe(1);
      expect(await db.internationalService.findUnique({ where: { id: template.id }, include: { fields: true } })).toEqual(template);
      const slug = internationalServices.find((entry) => entry.sourceId === 'S0004')?.slug;
      if (!slug) throw new Error('Missing fixture');
      const added = await db.internationalService.findUniqueOrThrow({ where: { slug }, include: { fields: true } });
      expect(added.fields[0]).toMatchObject({ key: 'invoiceReference', isRequired: true, validationRegex: '^INV-', helpTextFa: 'راهنما' });
      await db.internationalService.update({ where: { slug }, data: { isActive: true } });
      expect(await importInternationalServices(db)).toEqual({ created: 0, preserved: 131 });
      expect((await db.internationalService.findUniqueOrThrow({ where: { slug } })).isActive).toBe(true);
      expect(await db.serviceFieldDefinition.count()).toBe(131);
    } finally { await db.$disconnect(); }
  }, 60_000);
});
