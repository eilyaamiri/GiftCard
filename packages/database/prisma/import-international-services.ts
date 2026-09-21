import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client';
import catalogue from './international-services.json';

export const internationalServices = catalogue;

/** Create-only import. Existing services, fields, prices and activation are immutable here. */
export async function importInternationalServices(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.internationalService.findUnique({
      where: { slug: 'saas-subscriptions' }, include: { fields: true },
    });
    if (!template || template.fields.length === 0) {
      throw new Error('Existing service form template is required. No services were imported.');
    }
    let created = 0;
    let preserved = 0;
    for (const entry of catalogue) {
      const existing = await tx.internationalService.findUnique({ where: { slug: entry.slug } });
      if (existing) { preserved += 1; continue; }
      await tx.internationalService.create({
        data: {
          id: `content_service_${entry.sourceId.toLowerCase()}`,
          slug: entry.slug, name: entry.name, nameFa: entry.nameFa, category: entry.category,
          currency: template.currency,
          minAmount: template.minAmount, maxAmount: template.maxAmount,
          isActive: false, requiresManualReview: true, sortOrder: 1000 + created,
          fields: { create: template.fields.map((field) => ({
            key: field.key, label: field.label, labelFa: field.labelFa,
            fieldType: field.fieldType, isRequired: field.isRequired,
            validationRegex: field.validationRegex, helpTextFa: field.helpTextFa,
            sortOrder: field.sortOrder,
            options: field.options === null ? Prisma.DbNull : field.options as Prisma.InputJsonValue,
          })) },
        },
      });
      created += 1;
    }
    return { created, preserved };
  }, { timeout: 60_000 });
}

async function main() {
  if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply' && arg !== '--dry-run')) {
    throw new Error('Unsupported argument');
  }
  if (!process.argv.includes('--apply') || process.argv.includes('--dry-run')) {
    console.log(`Plan: ${catalogue.length} content entries; existing services preserved; new services inactive. No database connection.`);
    return;
  }
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }), log: [] });
  try { console.log(JSON.stringify(await importInternationalServices(prisma))); }
  finally { await prisma.$disconnect(); }
}

if (/import-international-services\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch(() => {
    console.error('Service import failed. No raw database diagnostics are printed.');
    process.exitCode = 1;
  });
}
