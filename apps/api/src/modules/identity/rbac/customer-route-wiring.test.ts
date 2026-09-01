import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

/* These controllers are imported for their decorator metadata only. Their
 * modules reach the shared Prisma singleton at import time, which would demand
 * a live DATABASE_URL for a test that never touches a database. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null } }));

import { OrdersController } from '../../orders/orders.controller';
import { PaymentsController } from '../../payments/payments.controller';
import { CUSTOMER_SCOPED_METADATA_KEY, PUBLIC_METADATA_KEY } from './roles.decorator';

/**
 * Regression cover for the customer-side twin of the staff wiring bug.
 *
 * `PaymentsController` read its principal from `request.user.customerId` but
 * carried no `@CustomerScoped()`, so CustomerScopedGuard returned early, no
 * session was ever resolved, and `request.user` stayed undefined. Every
 * `POST /api/payments` answered 401 for a fully logged-in customer: the order
 * was created and then could never be paid.
 *
 * Failing closed was right; the wiring was the defect. These tests pin the fix
 * so the decorator cannot be dropped again — and pin that the gateway callback
 * stays reachable, since the provider calls it with no session cookie.
 */

function isCustomerScoped(controller: abstract new (...args: never[]) => unknown): boolean {
  return Reflect.getMetadata(CUSTOMER_SCOPED_METADATA_KEY, controller) === true;
}

function isPublic(target: object): boolean {
  return Reflect.getMetadata(PUBLIC_METADATA_KEY, target) === true;
}

describe('customer route wiring', () => {
  it.each([
    ['orders', OrdersController],
    ['payments', PaymentsController],
  ])('%s controller declares @CustomerScoped', (_name, controller) => {
    expect(
      isCustomerScoped(controller),
      'without @CustomerScoped no guard resolves the session, so the handler authenticates nobody',
    ).toBe(true);
  });

  it('leaves the gateway callback public so the provider can reach it', () => {
    /* The provider posts back without a cookie. The query parameters it carries
     * are still untrusted — the service re-verifies with the gateway before it
     * settles anything — but the route itself must not require a session. */
    expect(isPublic(PaymentsController.prototype.zarinpalCallback)).toBe(true);
  });

  it('does not make the whole payments controller public', () => {
    expect(isPublic(PaymentsController)).toBe(false);
  });
});
