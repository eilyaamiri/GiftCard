import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

/* Importing the controller reaches the shared Prisma singleton transitively
 * (via the identity module), which would demand a live DATABASE_URL for a
 * test that never touches a database. Same workaround as customer-route-wiring.test.ts. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null } }));

import { DomainErrors } from '../../common/errors/domain.exception';
import type { AuthContextService } from '../identity';
import { QuotesController } from './quotes.controller';
import type { QuotesService } from './quotes.service';

/**
 * Regression cover for a production incident: a customer with an expired or
 * revoked `barat_session` cookie could not get a quote at all, even though
 * `POST /api/quotes` is `@Public()` precisely so an anonymous visitor can see
 * a price before signing in. `AuthContextService.resolve()` throws on a
 * present-but-invalid credential, and the controller let that exception
 * propagate instead of falling back to anonymous — the same failure mode
 * `AuthController` already guards against with `.catch(() => null)`.
 */
describe('QuotesController — anonymous quoting with a broken session cookie', () => {
  function buildController(resolve: () => Promise<never>) {
    const quotes = {
      resolveCommerceSession: vi.fn().mockResolvedValue('commerce-session-id'),
      createQuote: vi.fn().mockResolvedValue({ quote: {}, breakdown: {}, fx: {} }),
    } as unknown as QuotesService;
    const auth = { resolve } as unknown as AuthContextService;
    return { controller: new QuotesController(quotes, auth), quotes };
  }

  it('treats an invalid session cookie as anonymous instead of failing the quote', async () => {
    const { controller, quotes } = buildController(() =>
      Promise.reject(DomainErrors.unauthenticated()),
    );

    await controller.createQuote(
      { skuId: 'sku_1', quantity: 1, currency: 'USD', commerceSessionToken: 'a'.repeat(32) },
      { headers: {} },
    );

    expect(quotes.resolveCommerceSession).toHaveBeenCalledWith(
      'a'.repeat(32),
      null,
      expect.anything(),
    );
  });

  it('still upgrades to the signed-in customer when the session is valid', async () => {
    const { controller, quotes } = buildController(() =>
      Promise.resolve({ type: 'CUSTOMER', customerId: 'cust_1', sessionId: 's_1' }) as never,
    );

    await controller.createQuote(
      { skuId: 'sku_1', quantity: 1, currency: 'USD' },
      { headers: {} },
    );

    expect(quotes.resolveCommerceSession).toHaveBeenCalledWith(
      undefined,
      'cust_1',
      expect.anything(),
    );
  });
});
