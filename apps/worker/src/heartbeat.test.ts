import { describe, expect, it, vi } from 'vitest';

import {
  readHeartbeat,
  RedisHeartbeat,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_MS,
} from './heartbeat';

const NOW = new Date('2026-10-21T10:00:00.000Z');

describe('worker heartbeat', () => {
  it('writes the time of the beat with a TTL, so a stopped worker expires', async () => {
    const set = vi.fn(async () => 'OK');
    await new RedisHeartbeat({ set } as never, () => NOW).beat();
    expect(set).toHaveBeenCalledWith(
      WORKER_HEARTBEAT_KEY,
      NOW.toISOString(),
      'PX',
      WORKER_HEARTBEAT_TTL_MS,
    );
  });

  it('reads a recent beat as healthy', async () => {
    const get = vi.fn(async () => new Date(NOW.getTime() - 70_000).toISOString());
    await expect(readHeartbeat({ get } as never, NOW)).resolves.toEqual({
      healthy: true,
      ageSeconds: 70,
    });
  });

  it('reads a missing, stale or garbled beat as unhealthy', async () => {
    await expect(readHeartbeat({ get: async () => null } as never, NOW)).resolves.toEqual({
      healthy: false,
      ageSeconds: null,
    });
    const stale = new Date(NOW.getTime() - WORKER_HEARTBEAT_TTL_MS - 1_000).toISOString();
    await expect(readHeartbeat({ get: async () => stale } as never, NOW)).resolves.toMatchObject({
      healthy: false,
    });
    await expect(readHeartbeat({ get: async () => 'nope' } as never, NOW)).resolves.toEqual({
      healthy: false,
      ageSeconds: null,
    });
  });
});
