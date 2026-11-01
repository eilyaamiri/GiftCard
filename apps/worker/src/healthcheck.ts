import IORedis from 'ioredis';

import { readHeartbeat } from './heartbeat';

/**
 * Health check for the worker: exits 0 when a sweep completed recently, 1 when
 * not, 2 when it cannot tell (no REDIS_URL, Redis unreachable).
 *
 * Used by the container health check and by `ops/healthcheck.sh`, which pages
 * Telegram on failure. Prints one line and never the Redis URL, which can carry
 * a password.
 *
 * Run with: `node dist/healthcheck.js`.
 */
async function main(): Promise<number> {
  const redisUrl = process.env['REDIS_URL'];
  if (typeof redisUrl !== 'string' || redisUrl.length === 0) {
    process.stdout.write('worker health unknown: REDIS_URL is not set\n');
    return 2;
  }

  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  // Without a listener an unreachable Redis throws from the emitter instead.
  redis.on('error', () => undefined);

  try {
    await redis.connect();
    const status = await readHeartbeat(redis);
    if (status.ageSeconds === null) {
      process.stdout.write('worker unhealthy: no heartbeat\n');
      return 1;
    }
    process.stdout.write(
      `worker ${status.healthy ? 'healthy' : 'unhealthy'}: last sweep ${String(
        status.ageSeconds,
      )}s ago\n`,
    );
    return status.healthy ? 0 : 1;
  } catch {
    process.stdout.write('worker health unknown: Redis unreachable\n');
    return 2;
  } finally {
    redis.disconnect();
  }
}

void main().then((code) => process.exit(code));
