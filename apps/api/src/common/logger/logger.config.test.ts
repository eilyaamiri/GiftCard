import { describe, expect, it } from 'vitest';

import { buildLoggerOptions, redactUrl, resolveRequestId } from './logger.config';

/**
 * AGENTS.md rule 10: a gateway token must never reach a log line. The return
 * URL is where both rial gateways put theirs, so the request serializer and the
 * exception filter both pass the URL through `redactUrl`.
 */
describe('redactUrl', () => {
  it('redacts the BazaarPay return token', () => {
    expect(redactUrl('/api/payments/bazaarpay/return?token=abc123&order=BP-1')).toBe(
      '/api/payments/bazaarpay/return?token=[REDACTED]&order=BP-1',
    );
  });

  it('redacts the ZarinPal Authority whatever its case', () => {
    expect(redactUrl('/api/payments/zarinpal/callback?Authority=A0000123&Status=OK')).toBe(
      '/api/payments/zarinpal/callback?Authority=[REDACTED]&Status=OK',
    );
    expect(redactUrl('/cb?authority=A1')).toBe('/cb?authority=[REDACTED]');
  });

  it('catches separator and prefix variants of a credential name', () => {
    expect(redactUrl('/x?access_token=1&X-Token=2&api-key=3&otpCode=4')).toBe(
      '/x?access_token=[REDACTED]&X-Token=[REDACTED]&api-key=[REDACTED]&otpCode=[REDACTED]',
    );
  });

  it('catches a percent-encoded key', () => {
    expect(redactUrl('/x?%74oken=secret')).toBe('/x?%74oken=[REDACTED]');
  });

  it('leaves ordinary parameters and query-less paths alone', () => {
    expect(redactUrl('/api/orders?page=2&pageSize=20')).toBe('/api/orders?page=2&pageSize=20');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });

  it('drops a fragment rather than reasoning about it', () => {
    expect(redactUrl('/x?token=1#token=2')).toBe('/x?token=[REDACTED]');
  });

  it('still redacts a malformed query', () => {
    expect(redactUrl('/x?token=%E0%A4%A&%ZZ=1')).toBe('/x?token=[REDACTED]&%ZZ=1');
  });
});

describe('resolveRequestId', () => {
  it('reuses a well-formed incoming id', () => {
    expect(resolveRequestId('req-123_abc.def')).toBe('req-123_abc.def');
  });

  it('replaces an id that could forge a log line or a header', () => {
    for (const hostile of ['a\nb', 'a\r\nx-evil: 1', '<script>', 'x'.repeat(65), '', 42, undefined]) {
      const id = resolveRequestId(hostile);
      expect(id).not.toBe(hostile);
      expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    }
  });
});

describe('request serializer', () => {
  const serialize = (): ((req: unknown) => { url: string; headers: Record<string, unknown> }) => {
    const options = buildLoggerOptions({ isProduction: true, isTest: false });
    const pinoHttp = options.pinoHttp as { serializers: { req: (req: unknown) => never } };
    return pinoHttp.serializers.req;
  };

  it('drops credential headers, including the worker service token', () => {
    const line = serialize()({
      id: '1',
      method: 'POST',
      url: '/api/internal/fulfillment/retry-delivery',
      headers: {
        authorization: 'Bearer x',
        cookie: 'sid=1',
        'x-internal-service-token': 't'.repeat(40),
        'user-agent': 'worker',
      },
    });

    expect(line.headers).toEqual({ 'user-agent': 'worker' });
  });

  it('redacts the query of the logged URL', () => {
    const line = serialize()({
      id: '1',
      method: 'GET',
      url: '/api/payments/bazaarpay/return?token=abc',
      headers: {},
    });

    expect(line.url).toBe('/api/payments/bazaarpay/return?token=[REDACTED]');
  });
});
