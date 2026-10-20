import { describe, expect, it, vi } from 'vitest';

import { AuthContextService, readCookie } from './auth-context.service';
import type { ActorRequest } from './identity.tokens';

function requestWithCookie(cookie: string): ActorRequest {
  return { headers: { cookie } };
}

describe('readCookie', () => {
  it('decodes a well-formed value', () => {
    expect(readCookie(requestWithCookie('a=1; barat_session=x%2Ey'), 'barat_session')).toBe('x.y');
  });

  it('treats a malformed percent-escape as no cookie instead of throwing', () => {
    /* decodeURIComponent('%E0%A4%A') throws URIError; inside a global guard that
     * used to answer 500 on every route for anyone who set such a cookie. */
    expect(() => readCookie(requestWithCookie('barat_session=%E0%A4%A'), 'barat_session')).not.toThrow();
    expect(readCookie(requestWithCookie('barat_session=%E0%A4%A'), 'barat_session')).toBeNull();
  });
});

describe('AuthContextService', () => {
  it('a malformed session cookie resolves to "no credential", never an exception', async () => {
    const sessions = { authenticate: vi.fn() };
    const staff = { authenticate: vi.fn() };
    const service = new AuthContextService(sessions as never, staff as never);

    await expect(
      service.resolve(requestWithCookie('barat_staff_session=%ZZ; barat_session=%E0%A4%A')),
    ).resolves.toBeNull();
    expect(sessions.authenticate).not.toHaveBeenCalled();
    expect(staff.authenticate).not.toHaveBeenCalled();
  });
});
