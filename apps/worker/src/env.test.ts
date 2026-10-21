import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const TOKEN = 'a'.repeat(64);
const BASE = { DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://localhost:6379' };

describe('worker environment', () => {
  it('requires the internal token in production', () => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /INTERNAL_SERVICE_TOKEN: INTERNAL_SERVICE_TOKEN is required when NODE_ENV=production/,
    );
  });

  it('treats a blank token as unset', () => {
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production', INTERNAL_SERVICE_TOKEN: '' })).toThrow(
      /INTERNAL_SERVICE_TOKEN/,
    );
    expect(loadEnv({ ...BASE, INTERNAL_SERVICE_TOKEN: '' }).INTERNAL_SERVICE_TOKEN).toBeUndefined();
  });

  it('refuses a short token without echoing it', () => {
    const error = (() => {
      try {
        loadEnv({ ...BASE, INTERNAL_SERVICE_TOKEN: 'short-secret' });
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();
    expect(error?.message).toMatch(/at least 32 characters/);
    expect(error?.message).not.toContain('short-secret');
  });

  it('refuses an INTERNAL_API_URL outside the internal network', () => {
    expect(() =>
      loadEnv({
        ...BASE,
        INTERNAL_SERVICE_TOKEN: TOKEN,
        INTERNAL_API_URL: 'https://www.centohub.com/api',
      }),
    ).toThrow(/INTERNAL_API_URL: INTERNAL_API_URL must be an http\(s\) URL on an internal host/);
  });

  it('defaults INTERNAL_API_URL to the API on this host', () => {
    const env = loadEnv({ ...BASE, NODE_ENV: 'production', INTERNAL_SERVICE_TOKEN: TOKEN });
    expect(env.INTERNAL_API_URL).toBe('http://127.0.0.1:4000/api');
    expect(env.INTERNAL_SERVICE_TOKEN).toBe(TOKEN);
  });

  it('lets local development run without the token', () => {
    expect(loadEnv({ ...BASE }).INTERNAL_SERVICE_TOKEN).toBeUndefined();
  });
});
