import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

/**
 * The payment → fulfillment seam, asserted by actually building the container.
 *
 * A verified payment is only half the transaction: something has to task an
 * operator with delivering the card. Payments declared its own
 * `Symbol('FULFILLMENT_TRIGGER')` and its own one-method interface, while the
 * work-items module provided `Symbol.for('barat.fulfillment-trigger')` and
 * implemented `onOrderPaid`. Nothing failed — the injection was `@Optional()`
 * and fell back to a no-op, so orders reached PAID with no work item behind
 * them and nobody was tasked with delivering anything.
 *
 * Metadata assertions would not have caught that: both sides looked correct in
 * isolation. Only resolving the real token through the real container does, so
 * this test compiles the module and checks that what payments injects IS the
 * work-items service.
 */

vi.mock('@barat/database', () => ({
  prisma: {},
  Prisma: { JsonNull: null, TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));

/* `ConfigModule.forRoot` validates the environment while the module graph is
 * being imported, not when the container is built, so this has to run before
 * the imports below — hence `vi.hoisted`. The values are throwaway; the payment
 * provider they select is the gateway-less mock, which is what production runs
 * until a real gateway is connected. */
vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    API_PUBLIC_URL: 'https://api.example.test',
    WEB_PUBLIC_URL: 'https://example.test',
    ADMIN_PUBLIC_URL: 'https://admin.example.test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_JWT_SECRET: 'x'.repeat(48),
    GIFT_CARD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
});

import { AutoFulfillmentService } from '../suppliers/auto-fulfillment.service';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';

describe('PaymentsModule wiring', () => {
  /* The trigger is now the auto-fulfillment orchestrator rather than the work-
   * items service directly. It still creates the work item — that is its first
   * action and the reason a paid order is always tasked — and then attempts the
   * supplier purchase. The assertion below is what stops the seam regressing to
   * an optional, silently-dropped dependency again. */
  it('injects the auto-fulfillment orchestrator as the fulfillment trigger', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PaymentsModule] }).compile();

    expect(moduleRef.get(PaymentsService)).toBeInstanceOf(PaymentsService);

    /* Asserted on the instance payments actually holds, not on a container-wide
     * lookup of the token: two modules legitimately bind `FULFILLMENT_TRIGGER`
     * now, and a non-strict `get` may return either. What payments injected is
     * the only thing that decides whether a paid order gets bought automatically. */
    const injected = (moduleRef.get(PaymentsService) as unknown as Record<string, unknown>)[
      'fulfillmentTrigger'
    ];
    expect(injected).toBeInstanceOf(AutoFulfillmentService);

    /* And it must be the container's single instance. A second copy would still
     * create work items, but the per-order idempotency guard would no longer be
     * shared. */
    expect(injected).toBe(moduleRef.get(AutoFulfillmentService, { strict: false }));

    await moduleRef.close();
  });

  it('refuses to boot without a fulfillment trigger rather than silently dropping it', async () => {
    /* The regression in one assertion: the dependency is required. If someone
     * removes the module supplying the trigger again, the container fails here
     * instead of at the first paid order that nobody delivers. */
    await expect(
      Test.createTestingModule({
        providers: [PaymentsService],
      }).compile(),
    ).rejects.toThrow();
  });
});
