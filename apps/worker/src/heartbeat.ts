import type { Redis } from 'ioredis';

/**
 * Worker liveness, as seen from outside the process.
 *
 * Every completed sweep refreshes one Redis key with a TTL. The key existing
 * means "a sweep finished within the TTL", which is what healthy means for this
 * process: a worker that lost Redis or the database stops completing sweeps,
 * its key expires, and the health check fails — where checking the API, as the
 * container health check used to, would still pass.
 *
 * The quote-expiry sweep runs every minute, so the key is normally refreshed
 * every minute; the TTL leaves room for a few slow or skipped runs.
 */
export const WORKER_HEARTBEAT_KEY = 'barat:worker:heartbeat';
export const WORKER_HEARTBEAT_TTL_MS = 5 * 60_000;

export interface Heartbeat {
  beat(): Promise<void>;
}

export class RedisHeartbeat implements Heartbeat {
  constructor(
    private readonly redis: Pick<Redis, 'set'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async beat(): Promise<void> {
    await this.redis.set(
      WORKER_HEARTBEAT_KEY,
      this.now().toISOString(),
      'PX',
      WORKER_HEARTBEAT_TTL_MS,
    );
  }
}

export interface HeartbeatStatus {
  readonly healthy: boolean;
  /** Seconds since the last completed sweep; null when there is no heartbeat. */
  readonly ageSeconds: number | null;
}

export async function readHeartbeat(
  redis: Pick<Redis, 'get'>,
  now: Date = new Date(),
): Promise<HeartbeatStatus> {
  const value = await redis.get(WORKER_HEARTBEAT_KEY);
  if (value === null) {
    return { healthy: false, ageSeconds: null };
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    return { healthy: false, ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1_000));
  return { healthy: ageSeconds * 1_000 <= WORKER_HEARTBEAT_TTL_MS, ageSeconds };
}
