import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Who may set the client IP through X-Forwarded-For.
 *
 * Every throttler bucket in the API is keyed on `req.ip` (ThrottlerGuard's
 * default tracker). If an arbitrary peer may choose that value, it may choose a
 * new bucket per request, and the OTP / staff-login limits stop existing.
 *
 * This runs the API's own `trust proxy` value through the exact express build
 * `@nestjs/platform-express` loads, so a future edit to main.ts that widens the
 * trust boundary fails here.
 *
 * Run:  apps/api/node_modules/.bin/vitest run --root . tests/platform
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainTs = readFileSync(join(repoRoot, 'apps/api/src/main.ts'), 'utf8');

function trustProxyFromMain(): string {
  const match = /const TRUST_PROXY = '([^']+)';/u.exec(mainTs);
  if (!match?.[1]) throw new Error('TRUST_PROXY constant not found in apps/api/src/main.ts');
  return match[1];
}

/* Resolve express the way the API does: through @nestjs/platform-express. */
const apiRequire = createRequire(join(repoRoot, 'apps/api/package.json'));
const platformRequire = createRequire(apiRequire.resolve('@nestjs/platform-express'));
const express = platformRequire('express') as {
  (): { set(key: string, value: unknown): void; get(key: string): unknown };
  request: object;
};

function ipSeenByApi(peer: string, forwardedFor?: string): string {
  const app = express();
  app.set('trust proxy', trustProxyFromMain());
  const socket = { remoteAddress: peer };
  const req = Object.create(express.request) as Record<string, unknown>;
  req['app'] = app;
  req['socket'] = socket;
  req['connection'] = socket;
  req['headers'] = forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor };
  return req['ip'] as string;
}

describe('API trust proxy boundary', () => {
  it('main.ts applies the TRUST_PROXY constant, not a hop count', () => {
    expect(mainTs).toMatch(/app\.set\('trust proxy', TRUST_PROXY\)/u);
    expect(mainTs).not.toMatch(/app\.set\('trust proxy', \d+\)/u);
  });

  it('host nginx on loopback: the address nginx appended is the client', () => {
    expect(ipSeenByApi('127.0.0.1', '203.0.113.7')).toBe('203.0.113.7');
    expect(ipSeenByApi('::1', '203.0.113.7')).toBe('203.0.113.7');
    expect(ipSeenByApi('::ffff:127.0.0.1', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('a client-supplied X-Forwarded-For in front of nginx is ignored', () => {
    /* nginx uses $proxy_add_x_forwarded_for, so a forged header arrives as
     * "<forged>, <real>". Only the right-most, proxy-written entry counts. */
    expect(ipSeenByApi('127.0.0.1', '198.51.100.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('nginx over a private Docker bridge is still believed', () => {
    expect(ipSeenByApi('172.18.0.5', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('a public peer that reaches the API directly cannot choose its IP', () => {
    /* With `trust proxy = 1` this returned 198.51.100.1 — any value the caller
     * liked, so each request could land in a fresh throttler bucket. */
    expect(ipSeenByApi('203.0.113.99', '198.51.100.1')).toBe('203.0.113.99');
    expect(ipSeenByApi('203.0.113.99', '127.0.0.1')).toBe('203.0.113.99');
  });

  it('a request with no proxy header is keyed on its socket address', () => {
    expect(ipSeenByApi('203.0.113.99')).toBe('203.0.113.99');
  });
});
