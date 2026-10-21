import { describe, expect, it, vi } from 'vitest';

import {
  DeliveryRetryClientError,
  HttpDeliveryRetryClient,
  INTERNAL_SERVICE_TOKEN_HEADER,
} from './delivery-retry.client';

const TOKEN = 'internal-token-that-is-at-least-32-chars-long';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpDeliveryRetryClient', () => {
  it('refuses to follow redirects, so the internal token cannot be forwarded elsewhere', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ delivered: true, assetId: 'a1', attemptNumber: 2, failureCode: null }),
    );
    const client = new HttpDeliveryRetryClient({
      baseUrl: 'http://api:4000/',
      token: TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.retry('a1');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api:4000/internal/fulfillment/retry-delivery');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>)[INTERNAL_SERVICE_TOKEN_HEADER]).toBe(TOKEN);
  });

  it('surfaces the status code on rejection without the token or body in the message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ echoed: TOKEN }, 401));
    const client = new HttpDeliveryRetryClient({
      baseUrl: 'http://api:4000',
      token: TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await client.retry('a1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeliveryRetryClientError);
    expect((error as DeliveryRetryClientError).statusCode).toBe(401);
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('aborts a hung request after the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = new HttpDeliveryRetryClient({
      baseUrl: 'http://api:4000',
      token: TOKEN,
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.retry('a1')).rejects.toThrow('aborted');
  });

  it('reports a delivery problem by id only, on the same guarded transport', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ reported: true }));
    const client = new HttpDeliveryRetryClient({
      baseUrl: 'http://127.0.0.1:4000/api',
      token: TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.reportProblem('a1', 'SENDING_STUCK')).resolves.toEqual({ reported: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:4000/api/internal/fulfillment/report-delivery-problem');
    expect(JSON.parse(init.body as string)).toEqual({ assetId: 'a1', problem: 'SENDING_STUCK' });
    expect(init.redirect).toBe('error');
  });

  it('rejects a malformed problem-report response', async () => {
    const client = new HttpDeliveryRetryClient({
      baseUrl: 'http://api:4000',
      token: TOKEN,
      fetchImpl: vi.fn(async () => jsonResponse({})) as unknown as typeof fetch,
    });
    await expect(client.reportProblem('a1', 'RETRIES_EXHAUSTED')).rejects.toBeInstanceOf(
      DeliveryRetryClientError,
    );
  });
});
