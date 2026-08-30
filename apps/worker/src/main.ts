import 'reflect-metadata';

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { z } from 'zod';

/* ============================================================================
 * Environment
 *
 * The worker validates its own environment and fails fast, exactly like the API.
 * It needs strictly less than the API does — no gateway credentials, because a
 * background job never talks to a payment gateway on a customer's behalf.
 * ==========================================================================*/

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  /** How many jobs one worker process handles at once. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function loadEnv(): WorkerEnv {
  const result = workerEnvSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Names only, never values — an env dump is a secret leak.
    throw new Error(`Invalid worker environment. Refusing to start.\n${problems}`);
  }

  return result.data;
}

/* ============================================================================
 * Queue registry
 *
 * The canonical list of BullMQ queues. Job processors are added by the owning
 * workstreams; this registry exists so two agents cannot invent two spellings
 * of the same queue and silently process nothing.
 * ==========================================================================*/

export const QUEUE_NAMES = {
  /** Poll FX providers and persist fresh rates. */
  FX_REFRESH: 'fx-refresh',
  /** Re-verify payments that were left in PENDING or UNKNOWN. */
  PAYMENT_RECONCILE: 'payment-reconcile',
  /** Send a gift card to the customer, with retry. */
  DELIVERY_DISPATCH: 'delivery-dispatch',
  /** Expire quotes whose TTL has elapsed. */
  QUOTE_EXPIRY: 'quote-expiry',
  /** Detect abandoned carts, quotes and checkouts. */
  ABANDONMENT_SCAN: 'abandonment-scan',
  /** Nightly reconciliation sweep across the 14 mismatch classes. */
  RECONCILIATION_SWEEP: 'reconciliation-sweep',
  /** Outbound SMS and e-mail. */
  NOTIFICATION_SEND: 'notification-send',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Retry policy shared by every queue.
 *
 * Exponential backoff with a bounded attempt count. Completed jobs are trimmed;
 * failed ones are kept far longer, because a failed delivery or a failed
 * verification is evidence that reconciliation will need.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
} as const;

/* ============================================================================
 * Root module
 *
 * Domain workstreams register their processors by importing their own modules
 * here. Kept deliberately empty so the worker boots before they exist.
 * ==========================================================================*/

@Module({})
export class WorkerModule {}

/* ============================================================================
 * Bootstrap
 * ==========================================================================*/

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  /*
   * `maxRetriesPerRequest: null` is required by BullMQ: a blocking queue read is
   * a long-lived command and ioredis must not abandon it.
   */
  const connection: Redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  connection.on('error', (error: Error) => {
    // Message only — a Redis URL can carry a password.
    logger.error(`Redis connection error: ${error.message}`);
  });

  await connection.ping();
  logger.log('Connected to Redis');

  /* Instantiating the queues creates their metadata keys, so an operator can see
   * every queue in a dashboard from the first boot, not only after a first job. */
  const queues = Object.values(QUEUE_NAMES).map(
    (name) => new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  );

  logger.log(
    `Barat Pay worker started — environment=${env.NODE_ENV} concurrency=${String(
      env.WORKER_CONCURRENCY,
    )} queues=${queues.length}`,
  );

  /* ---- graceful shutdown -------------------------------------------------
   * Close the queues before the Redis connection, and only then exit, so an
   * in-flight job is not abandoned mid-write.
   * --------------------------------------------------------------------- */
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log(`Received ${signal} — draining queues`);

    try {
      await Promise.all(queues.map((queue) => queue.close()));
      await connection.quit();
      await app.close();
      logger.log('Worker stopped cleanly');
      process.exit(0);
    } catch (error) {
      logger.error(`Shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  // Nest's logger may not exist yet at this point.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Worker failed to start: ${message}\n`);
  process.exit(1);
});
