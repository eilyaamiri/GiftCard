import 'reflect-metadata';

import { createPrismaClient } from '@barat/database';
import IORedis, { type Redis } from 'ioredis';

import { startSweepWorkers, type SweepWorkers } from './runtime';

/**
 * Standalone entrypoint for the quote-expiry, abandonment and delivery-retry
 * sweeps.
 *
 * This exists because `main.ts` is owned by another workstream and does not yet
 * register any processor (see the GAP NOTE in `runtime.ts`). Running this file
 * gives a working sweep process today; once `main.ts` calls `startSweepWorkers`,
 * this file becomes redundant and should be deleted rather than left to run a
 * second consumer of the same queues.
 *
 * Run with: `node dist/sweeps.entry.js` (or `tsx src/sweeps.entry.ts`).
 */
async function main(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'];
  if (typeof redisUrl !== 'string' || redisUrl.length === 0) {
    throw new Error('REDIS_URL is required');
  }

  // `maxRetriesPerRequest: null` is mandatory for BullMQ's blocking reads.
  const connection: Redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on('error', (error: Error) => {
    // Message only: a Redis URL can carry a password.
    process.stderr.write(`Redis connection error: ${error.message}\n`);
  });
  await connection.ping();

  const prisma = createPrismaClient();
  const sweeps: SweepWorkers = await startSweepWorkers({ connection, prisma });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`Received ${signal} — draining sweeps\n`);
    try {
      // Workers first: let an in-flight sweep finish its write before the
      // database connection disappears underneath it.
      await sweeps.close();
      // Our own client, not the module singleton, so disconnect it directly.
      await prisma.$disconnect();
      await connection.quit();
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `Sweep shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      );
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Sweep worker failed to start: ${message}\n`);
  process.exit(1);
});
