import type { PrismaClient } from '@barat/database';

export type DatabaseClockClient = Pick<PrismaClient, '$queryRaw'>;

/**
 * The database server's current time.
 *
 * A sweep that compares against timestamps the API wrote should not trust this
 * process's clock: the production host once ran 4.5 hours fast, and a worker
 * clock that far ahead expires quotes customers are still allowed to accept.
 * The database clock is the one every process shares.
 */
export async function readDatabaseClock(db: DatabaseClockClient): Promise<Date> {
  const rows = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const value = rows[0]?.now;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('database clock unreadable');
  }
  return value;
}
