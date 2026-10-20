import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RedisLockStore,
  SweepLock,
  SWEEP_LOCK_PREFIX,
  type LockRedis,
  type LockStore,
} from './sweep-lock';

/** A single-process stand-in for Redis `SET NX PX` + owner-checked renew/delete. */
class MemoryLockStore implements LockStore {
  readonly owners = new Map<string, string>();

  async tryAcquire(key: string, token: string): Promise<boolean> {
    if (this.owners.has(key)) {
      return false;
    }
    this.owners.set(key, token);
    return true;
  }

  async renew(key: string, token: string): Promise<boolean> {
    return this.owners.get(key) === token;
  }

  async release(key: string, token: string): Promise<void> {
    if (this.owners.get(key) === token) {
      this.owners.delete(key);
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SweepLock', () => {
  it('lets only one of two overlapping runs of the same sweep execute', async () => {
    const store = new MemoryLockStore();
    const lock = new SweepLock(store);
    const gate = deferred();
    const first = vi.fn(async () => {
      await gate.promise;
      return 'first';
    });
    const second = vi.fn(async () => 'second');

    const running = lock.runExclusive('delivery-dispatch', first);
    const overlapped = await lock.runExclusive('delivery-dispatch', second);

    expect(overlapped).toEqual({ acquired: false });
    expect(second).not.toHaveBeenCalled();

    gate.resolve();
    await expect(running).resolves.toEqual({ acquired: true, value: 'first' });
    // Released: the next tick runs normally.
    await expect(lock.runExclusive('delivery-dispatch', second)).resolves.toEqual({
      acquired: true,
      value: 'second',
    });
  });

  it('does not serialise different sweeps against each other', async () => {
    const lock = new SweepLock(new MemoryLockStore());
    const gate = deferred();
    const running = lock.runExclusive('quote-expiry', () => gate.promise);
    await expect(lock.runExclusive('abandonment-scan', async () => 1)).resolves.toEqual({
      acquired: true,
      value: 1,
    });
    gate.resolve();
    await running;
  });

  it('releases the lock when the sweep throws, and rethrows', async () => {
    const store = new MemoryLockStore();
    const lock = new SweepLock(store);
    await expect(
      lock.runExclusive('quote-expiry', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.owners.size).toBe(0);
  });

  it('renews while running and reports a lock that was taken over', async () => {
    vi.useFakeTimers();
    const store = new MemoryLockStore();
    const onLockLost = vi.fn();
    const lock = new SweepLock(store, { ttlMs: 300, renewEveryMs: 100, onLockLost });
    const renew = vi.spyOn(store, 'renew');
    const gate = deferred();

    const running = lock.runExclusive('delivery-dispatch', () => gate.promise);
    await vi.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onLockLost).not.toHaveBeenCalled();

    // Simulate the TTL lapsing and another process taking the key.
    store.owners.set(`${SWEEP_LOCK_PREFIX}delivery-dispatch`, 'someone-else');
    await vi.advanceTimersByTimeAsync(100);
    expect(onLockLost).toHaveBeenCalledWith(`${SWEEP_LOCK_PREFIX}delivery-dispatch`);

    gate.resolve();
    await running;
    // Owner-checked release: the other process's lock survives.
    expect(store.owners.get(`${SWEEP_LOCK_PREFIX}delivery-dispatch`)).toBe('someone-else');
  });

  it('refuses a renewal interval that is not shorter than the TTL', () => {
    expect(() => new SweepLock(new MemoryLockStore(), { ttlMs: 100, renewEveryMs: 100 })).toThrow();
  });
});

describe('RedisLockStore', () => {
  it('acquires with SET NX PX and treats a nil reply as held', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const store = new RedisLockStore({ set, eval: vi.fn() } as unknown as LockRedis);

    await expect(store.tryAcquire('k', 't', 60_000)).resolves.toBe(true);
    await expect(store.tryAcquire('k', 't2', 60_000)).resolves.toBe(false);
    expect(set).toHaveBeenNthCalledWith(1, 'k', 't', 'PX', 60_000, 'NX');
  });

  it('renews and releases through owner-checked Lua scripts', async () => {
    const evalFn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValue(1);
    const store = new RedisLockStore({ set: vi.fn(), eval: evalFn } as unknown as LockRedis);

    await expect(store.renew('k', 't', 500)).resolves.toBe(true);
    await expect(store.renew('k', 't', 500)).resolves.toBe(false);
    await store.release('k', 't');

    const [renewScript, renewKeys, renewKey, renewToken, renewTtl] = evalFn.mock
      .calls[0] as unknown[];
    expect(renewScript).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
    expect(renewScript).toContain('pexpire');
    expect([renewKeys, renewKey, renewToken, renewTtl]).toEqual([1, 'k', 't', '500']);

    const [releaseScript] = evalFn.mock.calls[2] as unknown[];
    expect(releaseScript).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
    expect(releaseScript).toContain('del');
  });
});
