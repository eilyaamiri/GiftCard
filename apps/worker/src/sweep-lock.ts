import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

/**
 * Cross-process mutual exclusion for one sweep queue.
 *
 * Why a sweep needs this on top of BullMQ: the scheduler adds one job per tick,
 * but nothing stops a *slow* run from still being in flight when the next tick
 * fires. The worker runs `concurrency` jobs at once, a failed run is retried
 * with backoff while the next tick is already queued, and a second worker
 * process (two replicas, or an old one still draining during a restart)
 * consumes the same queue. Without a lock, two delivery-retry runs read the
 * same `DELIVERY_FAILED` asset; the first run's retry fails and puts it back to
 * `DELIVERY_FAILED`, and the second run — which read it before — re-sends it
 * at once, skipping the cool-down and the attempt cap.
 *
 * The lock is a Redis `SET NX PX` with a random owner token, renewed while the
 * sweep runs and released only by its owner (compare-and-delete in Lua), so a
 * run that outlived its TTL can never delete the lock of the run after it.
 */

export interface LockStore {
  /** `true` when the key was free and is now ours. */
  tryAcquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Extends the TTL only if we still own the key. */
  renew(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Deletes the key only if we still own it. */
  release(key: string, token: string): Promise<void>;
}

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

/** The two ioredis commands the lock needs, so a test can fake them. */
export type LockRedis = Pick<Redis, 'set' | 'eval'>;

export class RedisLockStore implements LockStore {
  constructor(private readonly redis: LockRedis) {}

  async tryAcquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const reply = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return reply === 'OK';
  }

  async renew(key: string, token: string, ttlMs: number): Promise<boolean> {
    const reply = await this.redis.eval(RENEW_SCRIPT, 1, key, token, String(ttlMs));
    return Number(reply) === 1;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
  }
}

export interface SweepLockOptions {
  /** Lock lifetime without renewal. A crashed owner frees the queue after this. */
  readonly ttlMs?: number;
  /** How often a live owner extends the TTL. Must be well under `ttlMs`. */
  readonly renewEveryMs?: number;
  readonly onLockLost?: (key: string) => void;
}

export const SWEEP_LOCK_PREFIX = 'barat:sweep-lock:';
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_RENEW_EVERY_MS = 20_000;

export class SweepLock {
  private readonly ttlMs: number;
  private readonly renewEveryMs: number;

  constructor(
    private readonly store: LockStore,
    private readonly options: SweepLockOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.renewEveryMs = options.renewEveryMs ?? DEFAULT_RENEW_EVERY_MS;
    if (this.renewEveryMs >= this.ttlMs) {
      throw new Error('sweep lock: renewEveryMs must be shorter than ttlMs');
    }
  }

  /**
   * Runs `work` while holding the lock for `name`.
   *
   * Returns `{ acquired: false }` without running `work` when another run holds
   * it. A thrown `work` still releases the lock and the error propagates.
   */
  async runExclusive<T>(
    name: string,
    work: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const key = `${SWEEP_LOCK_PREFIX}${name}`;
    const token = randomUUID();

    if (!(await this.store.tryAcquire(key, token, this.ttlMs))) {
      return { acquired: false };
    }

    let lost = false;
    const timer = setInterval(() => {
      this.store
        .renew(key, token, this.ttlMs)
        .then((stillOurs) => {
          if (!stillOurs && !lost) {
            lost = true;
            this.options.onLockLost?.(key);
          }
        })
        .catch(() => {
          // A transient Redis error: the TTL still has headroom, the next tick
          // retries. Reporting it here would only add noise.
        });
    }, this.renewEveryMs);
    timer.unref();

    try {
      return { acquired: true, value: await work() };
    } finally {
      clearInterval(timer);
      try {
        await this.store.release(key, token);
      } catch {
        // The TTL frees the key anyway; failing the finished sweep would be worse.
      }
    }
  }
}
