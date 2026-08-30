import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/client';

/**
 * The single PrismaClient for the whole process.
 *
 * Prisma 7 has no connection string in the schema — the client is constructed
 * with the `pg` driver adapter. `DATABASE_URL` is read once, here, and nowhere
 * else in the codebase.
 *
 * The instance is cached on `globalThis` so that a dev-server hot reload does
 * not open a new pool on every rebuild and exhaust Postgres connections.
 */

const LOG_LEVELS: Prisma.LogLevel[] =
  process.env['NODE_ENV'] === 'production' ? ['warn', 'error'] : ['warn', 'error'];

function readDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and provide a PostgreSQL connection string.',
    );
  }
  return url;
}

export function createPrismaClient(connectionString: string = readDatabaseUrl()): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    // Never enable the `query` log level in production: bound parameters can
    // contain payment identifiers and personal data (AGENTS.md rule 10).
    log: LOG_LEVELS,
  });
}

type PrismaGlobal = typeof globalThis & { __baratPrisma?: PrismaClient };

const globalForPrisma = globalThis as PrismaGlobal;

/** The shared client. Import this everywhere instead of constructing your own. */
export const prisma: PrismaClient = globalForPrisma.__baratPrisma ?? createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.__baratPrisma = prisma;
}

/** Close the pool. Call from a graceful-shutdown hook, never mid-request. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
