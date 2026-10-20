import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@barat/database';

import { HttpDeliveryRetryClient, type DeliveryRetryClient } from './clients/delivery-retry.client';
import { AbandonmentScanHandler } from './jobs/abandonment-scan.handler';
import { DeliveryRetryHandler } from './jobs/delivery-retry.handler';
import type { JobHandler, JobResult } from './jobs/job-types';
import { QuoteExpiryHandler } from './jobs/quote-expiry.handler';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, REPEAT_SCHEDULES } from './queues';
import { RedisLockStore, SweepLock } from './sweep-lock';

/**
 * Wiring for the three sweeps this workstream owns.
 *
 * GAP NOTE: `apps/worker/src/main.ts` is Foundation-owned and currently only
 * *creates* the queues — nothing consumes them. Registering the processors from
 * inside it would mean editing a file this agent does not own, so the wiring is
 * exported as a function instead. Foundation adds one line to `bootstrap()`:
 *
 *     const sweeps = await startSweepWorkers({ connection, prisma, ... });
 *     // and, in shutdown(): await sweeps.close();
 *
 * Until that line exists, `src/sweeps.entry.ts` runs the same wiring as its own
 * process, so the sweeps are operable today.
 */

export interface SweepLogger {
  log(message: string): void;
  error(message: string): void;
}

export interface StartSweepWorkersOptions {
  readonly connection: Redis;
  readonly prisma: PrismaClient;
  readonly concurrency?: number;
  readonly logger?: SweepLogger;
  /** Overridable so a test can drive the handlers without an API process. */
  readonly deliveryRetryClient?: DeliveryRetryClient;
  /** Base URL of the API, e.g. `http://api:3000`. */
  readonly apiBaseUrl?: string;
  readonly internalServiceToken?: string;
  /** Register the repeatable schedules. Off in tests. */
  readonly scheduleRepeats?: boolean;
  /** Overridable for tests; defaults to a Redis lock on `connection`. */
  readonly sweepLock?: SweepLock;
}

export interface SweepWorkers {
  readonly workers: readonly Worker[];
  readonly queues: readonly Queue[];
  close(): Promise<void>;
}

type AnyJobHandler = JobHandler<unknown>;

const consoleLogger: SweepLogger = {
  log: (message) => process.stdout.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

export async function startSweepWorkers(options: StartSweepWorkersOptions): Promise<SweepWorkers> {
  const logger = options.logger ?? consoleLogger;
  const concurrency = options.concurrency ?? 5;

  const retryClient = options.deliveryRetryClient ?? buildRetryClient(options);

  /* Method parameters are bivariant in TypeScript, so a concretely-typed handler
   * satisfies this without a cast. The payloads are all-optional by design, which
   * is what makes `{}` a valid job body for every sweep. */
  const handlers: readonly AnyJobHandler[] = [
    new QuoteExpiryHandler(options.prisma),
    new AbandonmentScanHandler(options.prisma),
    new DeliveryRetryHandler(options.prisma, retryClient),
  ];

  /* One lock per queue, shared by every process consuming it, so a slow run, a
   * BullMQ retry and the next tick — or two worker processes — never sweep the
   * same rows at the same time. */
  const lock =
    options.sweepLock ??
    new SweepLock(new RedisLockStore(options.connection), {
      onLockLost: (key) => logger.error(`[sweep-lock] lost ${key} while a sweep was still running`),
    });

  const workers: Worker[] = handlers.map(
    (handler) =>
      new Worker(handler.queueName, createSweepProcessor(handler, { lock, logger }), {
        connection: options.connection,
        concurrency,
      }),
  );

  for (const worker of workers) {
    attachWorkerListeners(worker, worker.name, logger);
  }

  const queues: Queue[] = [];

  if (options.scheduleRepeats !== false) {
    for (const [queueName, schedule] of Object.entries(REPEAT_SCHEDULES)) {
      const queue = new Queue(queueName, {
        connection: options.connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      queue.on('error', (error: Error) => {
        logger.error(`[${queueName}] queue error: ${error.message}`);
      });
      /* `upsertJobScheduler` is keyed by the scheduler id, so restarting the
       * process replaces the schedule instead of stacking a second copy of it —
       * which would run every sweep twice per tick. */
      await queue.upsertJobScheduler(
        `sweep:${queueName}`,
        { every: schedule.every },
        { name: `${queueName}:sweep`, data: {}, opts: DEFAULT_JOB_OPTIONS },
      );
      queues.push(queue);
    }
  }

  logger.log(`Sweep workers started — queues=${workers.map((w) => w.name).join(',')}`);

  return {
    workers,
    queues,
    close: async (): Promise<void> => {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(queues.map((queue) => queue.close()));
    },
  };
}

/**
 * The BullMQ processor for one sweep: lock, run, log counts.
 *
 * A run that finds the lock held completes as a no-op instead of failing, so an
 * overlap does not trigger BullMQ's retry backoff and pile up even more runs.
 */
export function createSweepProcessor(
  handler: AnyJobHandler,
  deps: { readonly lock: SweepLock; readonly logger: SweepLogger },
): (job: Pick<Job, 'data'>) => Promise<JobResult> {
  return async (job) => {
    const run = await deps.lock.runExclusive(handler.queueName, () =>
      handler.handle(job.data ?? {}),
    );
    if (!run.acquired) {
      deps.logger.log(`[${handler.queueName}] previous sweep still running; skipped`);
      return { changed: 0, skipped: 0, details: { queue: handler.queueName, overlapped: true } };
    }
    const result = run.value;
    // Counts only. Job payloads for these sweeps carry no customer data, and the
    // results are ids-free by construction; only numeric details are printed.
    deps.logger.log(
      `[${handler.queueName}] changed=${String(result.changed)} skipped=${String(
        result.skipped,
      )}${formatNumericDetails(result.details)}`,
    );
    return result;
  };
}

/**
 * `failed` for visibility, and `error` because BullMQ emits it on connection
 * and lock-renewal problems: an EventEmitter with no `error` listener throws,
 * which would take the whole sweep process down.
 */
export function attachWorkerListeners(
  emitter: Pick<Worker, 'on'>,
  name: string,
  logger: SweepLogger,
): void {
  emitter.on('failed', (job, error) => {
    logger.error(`[${name}] job ${job?.id ?? 'unknown'} failed: ${error.message}`);
  });
  emitter.on('error', (error) => {
    // Message only: a Redis error can carry the connection URL's credentials.
    logger.error(`[${name}] worker error: ${error.message}`);
  });
}

function formatNumericDetails(details: JobResult['details']): string {
  if (details === undefined) {
    return '';
  }
  return Object.entries(details)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([key, value]) => ` ${key}=${String(value)}`)
    .join('');
}

function buildRetryClient(options: StartSweepWorkersOptions): DeliveryRetryClient {
  const baseUrl = options.apiBaseUrl ?? process.env['INTERNAL_API_URL'];
  const token = options.internalServiceToken ?? process.env['INTERNAL_SERVICE_TOKEN'];

  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('INTERNAL_API_URL is required to run the delivery-retry sweep');
  }
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('INTERNAL_SERVICE_TOKEN is required and must be at least 32 characters');
  }

  return new HttpDeliveryRetryClient({ baseUrl, token });
}

export { QUEUE_NAMES };
