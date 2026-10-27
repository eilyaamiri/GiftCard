import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { JobHandler, JobResult } from './jobs/job-types';
import {
  attachWorkerListeners,
  buildRetryClient,
  createSweepProcessor,
  type SweepLogger,
} from './runtime';
import { SweepLock, type LockStore } from './sweep-lock';

function memoryStore(): LockStore {
  const owners = new Map<string, string>();
  return {
    tryAcquire: async (key, token) => {
      if (owners.has(key)) return false;
      owners.set(key, token);
      return true;
    },
    renew: async (key, token) => owners.get(key) === token,
    release: async (key, token) => {
      if (owners.get(key) === token) owners.delete(key);
    },
  };
}

function captureLogger(): SweepLogger & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (m) => lines.push(m), error: (m) => errors.push(m) };
}

describe('createSweepProcessor', () => {
  it('completes an overlapping run as a no-op without touching the handler', async () => {
    let release!: () => void;
    const slow = new Promise<JobResult>((resolve) => {
      release = () => resolve({ changed: 1, skipped: 0 });
    });
    const handle = vi.fn().mockReturnValueOnce(slow).mockResolvedValue({ changed: 0, skipped: 0 });
    const handler: JobHandler<unknown> = { queueName: 'delivery-dispatch', handle };
    const logger = captureLogger();
    const processor = createSweepProcessor(handler, { lock: new SweepLock(memoryStore()), logger });

    const first = processor({ data: {} });
    const second = await processor({ data: {} });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      changed: 0,
      skipped: 0,
      details: { queue: 'delivery-dispatch', overlapped: true },
    });

    release();
    await expect(first).resolves.toEqual({ changed: 1, skipped: 0 });
  });

  it('logs numeric details (e.g. stillFailing) but never string details', async () => {
    const handler: JobHandler<unknown> = {
      queueName: 'delivery-dispatch',
      handle: async () => ({
        changed: 0,
        skipped: 2,
        details: { queue: 'delivery-dispatch', scannedAt: 'x', stillFailing: 3, exhausted: 2 },
      }),
    };
    const logger = captureLogger();
    await createSweepProcessor(handler, { lock: new SweepLock(memoryStore()), logger })({
      data: undefined,
    });

    expect(logger.lines).toEqual([
      '[delivery-dispatch] changed=0 skipped=2 stillFailing=3 exhausted=2',
    ]);
  });

  it('passes `{}` when the job carries no data', async () => {
    const handle = vi.fn().mockResolvedValue({ changed: 0, skipped: 0 });
    await createSweepProcessor(
      { queueName: 'quote-expiry', handle },
      { lock: new SweepLock(memoryStore()), logger: captureLogger() },
    )({ data: undefined });
    expect(handle).toHaveBeenCalledWith({});
  });
});

describe('createSweepProcessor — heartbeat', () => {
  it('beats after a completed sweep', async () => {
    const beat = vi.fn(async () => undefined);
    const processor = createSweepProcessor(
      { queueName: 'quote-expiry', handle: async () => ({ changed: 0, skipped: 0 }) },
      { lock: new SweepLock(memoryStore()), logger: captureLogger(), heartbeat: { beat } },
    );
    await processor({ data: {} });
    expect(beat).toHaveBeenCalledTimes(1);
  });

  it('does not beat when the sweep throws, so a broken worker goes unhealthy', async () => {
    const beat = vi.fn(async () => undefined);
    const processor = createSweepProcessor(
      {
        queueName: 'quote-expiry',
        handle: async () => {
          throw new Error('database unreachable');
        },
      },
      { lock: new SweepLock(memoryStore()), logger: captureLogger(), heartbeat: { beat } },
    );
    await expect(processor({ data: {} })).rejects.toThrow('database unreachable');
    expect(beat).not.toHaveBeenCalled();
  });

  it('does not fail a sweep because the heartbeat could not be written', async () => {
    const logger = captureLogger();
    const processor = createSweepProcessor(
      { queueName: 'quote-expiry', handle: async () => ({ changed: 1, skipped: 0 }) },
      {
        lock: new SweepLock(memoryStore()),
        logger,
        heartbeat: {
          beat: async () => {
            throw new Error('READONLY');
          },
        },
      },
    );
    await expect(processor({ data: {} })).resolves.toMatchObject({ changed: 1 });
    expect(logger.errors).toEqual(['[heartbeat] not written: READONLY']);
  });
});

describe('buildRetryClient', () => {
  const token = 'x'.repeat(40);

  it('refuses a non-internal API URL before any token is sent', () => {
    expect(() =>
      buildRetryClient({ apiBaseUrl: 'https://www.centohub.com/api', internalServiceToken: token }),
    ).toThrow(/internal host/);
  });

  it('refuses a missing or short token', () => {
    expect(() => buildRetryClient({ apiBaseUrl: 'http://127.0.0.1:4000/api' })).toThrow(
      /INTERNAL_SERVICE_TOKEN/,
    );
  });

  it('builds a client for an internal URL', () => {
    expect(
      buildRetryClient({ apiBaseUrl: 'http://127.0.0.1:4000/api', internalServiceToken: token }),
    ).toBeDefined();
  });
});

describe('attachWorkerListeners', () => {
  it('handles `error` so a Redis hiccup cannot crash the sweep process', () => {
    const emitter = new EventEmitter();
    const logger = captureLogger();
    attachWorkerListeners(emitter as never, 'quote-expiry', logger);

    expect(() => emitter.emit('error', new Error('connect ECONNREFUSED'))).not.toThrow();
    expect(logger.errors).toEqual(['[quote-expiry] worker error: connect ECONNREFUSED']);

    emitter.emit('failed', { id: '7' }, new Error('nope'));
    expect(logger.errors[1]).toBe('[quote-expiry] job 7 failed: nope');
  });
});
