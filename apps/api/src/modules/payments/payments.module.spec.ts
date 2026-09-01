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

import { WorkItemsService } from '../workitems/workitems.service';
import { FULFILLMENT_TRIGGER } from '../workitems/workitems.types';
import { PaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';

describe('PaymentsModule wiring', () => {
  it('injects the work-items service as the fulfillment trigger', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PaymentsModule] }).compile();

    const trigger = moduleRef.get(FULFILLMENT_TRIGGER, { strict: false });
    expect(trigger).toBeInstanceOf(WorkItemsService);
    expect(moduleRef.get(PaymentsService)).toBeInstanceOf(PaymentsService);

    /* The payment service must hold that same instance. A second copy would
     * still create work items, but the per-order idempotency guard would no
     * longer be shared. */
    const injected = (moduleRef.get(PaymentsService) as unknown as Record<string, unknown>)[
      'fulfillmentTrigger'
    ];
    expect(injected).toBe(trigger);

    await moduleRef.close();
  });

  it('refuses to boot without a fulfillment trigger rather than silently dropping it', async () => {
    /* The regression in one assertion: the dependency is required. If someone
     * removes the WorkItemsModule import again, the container fails here
     * instead of at the first paid order that nobody delivers. */
    await expect(
      Test.createTestingModule({
        providers: [PaymentsService],
      }).compile(),
    ).rejects.toThrow();
  });
});
