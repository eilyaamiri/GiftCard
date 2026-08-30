/**
 * @barat/database — the only module that talks to PostgreSQL.
 *
 * Re-exports the generated Prisma types plus the shared client singleton, so no
 * other package ever imports from `generated/` or constructs a PrismaClient.
 *
 * The schema (`prisma/schema.prisma`) is FROZEN — Foundation-owned.
 */

export * from '../generated/client';
export { prisma, createPrismaClient, disconnectPrisma } from './client';
