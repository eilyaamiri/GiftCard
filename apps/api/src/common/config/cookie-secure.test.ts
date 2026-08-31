import { describe, expect, it } from 'vitest';

import { AppConfigService } from './app-config.service';
import type { AppEnv } from './env.schema';

/**
 * Regression cover for a bug that made the admin panel impossible to log in to.
 *
 * The session cookies were issued with `secure: isProduction`. On a production
 * deployment served over plain HTTP — which is every deployment before a TLS
 * certificate exists — the browser refuses to STORE a `Secure` cookie at all.
 * The API answered 201 and set a cookie that was discarded before it was ever
 * kept, so the next request arrived anonymous and the panel bounced back to the
 * login page. From the outside that is indistinguishable from a wrong password,
 * which is exactly how it was reported.
 *
 * `Secure` is a statement about the transport, so it has to be derived from the
 * transport rather than from NODE_ENV.
 */

function configFor(env: Partial<AppEnv>): AppConfigService {
  const values = env as Record<string, unknown>;
  const stub = {
    get: (key: string) => values[key],
  };
  return new AppConfigService(stub as never);
}

describe('session cookie Secure attribute', () => {
  it('is set when the origin is https', () => {
    const config = configFor({
      NODE_ENV: 'production',
      WEB_PUBLIC_URL: 'https://baratpay.ir',
      ADMIN_PUBLIC_URL: 'https://admin.baratpay.ir',
    });

    expect(config.webCookieSecure).toBe(true);
    expect(config.adminCookieSecure).toBe(true);
  });

  it('is NOT set on a plain-http origin, even in production', () => {
    /* The exact shape of the deployment that could not be logged into. */
    const config = configFor({
      NODE_ENV: 'production',
      WEB_PUBLIC_URL: 'http://130.185.72.83',
      ADMIN_PUBLIC_URL: 'http://130.185.72.83:8081',
    });

    expect(config.webCookieSecure).toBe(false);
    expect(config.adminCookieSecure).toBe(false);
  });

  it('follows each origin independently', () => {
    /* A storefront already on TLS while the panel is not, or the reverse, must
     * not drag the other origin along with it. */
    const config = configFor({
      NODE_ENV: 'production',
      WEB_PUBLIC_URL: 'https://baratpay.ir',
      ADMIN_PUBLIC_URL: 'http://130.185.72.83:8081',
    });

    expect(config.webCookieSecure).toBe(true);
    expect(config.adminCookieSecure).toBe(false);
  });

  it('fails safe: a malformed origin is treated as https', () => {
    /* If the deployment is misconfigured the cookie should end up too strict —
     * a login that does not work — rather than a session token travelling in
     * the clear. */
    const config = configFor({
      NODE_ENV: 'production',
      WEB_PUBLIC_URL: 'not-a-url',
      ADMIN_PUBLIC_URL: '',
    });

    expect(config.webCookieSecure).toBe(true);
    expect(config.adminCookieSecure).toBe(true);
  });
});
