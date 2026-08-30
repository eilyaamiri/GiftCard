import type { PrismaClient } from '@barat/database';

/**
 * Reset an isolated PostgreSQL test database and repopulate it in one helper.
 *
 * The database is deliberately supplied by the caller so suites can use a
 * transaction-scoped client or a disposable test database. `TRUNCATE ...
 * CASCADE` handles the schema's foreign-key graph in PostgreSQL and avoids a
 * fragile hand-maintained deletion order. Never point this at production.
 */
export async function resetTestDatabase(
  client: Pick<PrismaClient, '$executeRawUnsafe'>,
  reseed: () => Promise<void> = async () => undefined,
): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('resetTestDatabase is unavailable in production');
  }

  await client.$executeRawUnsafe(`
    DO $$
    DECLARE
      statements text;
    BEGIN
      SELECT string_agg(format('TRUNCATE TABLE %I.%I CASCADE', schemaname, tablename), '; ')
      INTO statements
      FROM pg_tables
      WHERE schemaname = 'public';
      IF statements IS NOT NULL THEN
        EXECUTE statements;
      END IF;
    END $$;
  `);
  await reseed();
}

/** Make a fresh Prisma client available to a suite and always disconnect it. */
export async function withTestDatabase<T>(
  client: PrismaClient,
  callback: (database: PrismaClient) => Promise<T>,
): Promise<T> {
  try {
    return await callback(client);
  } finally {
    await client.$disconnect();
  }
}
