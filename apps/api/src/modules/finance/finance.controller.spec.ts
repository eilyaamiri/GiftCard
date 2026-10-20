import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

/**
 * The finance route, asserted by resolving it out of the real container.
 *
 * `FinanceController` has no module of its own, so it is registered directly on
 * `AppModule`. It was first registered under `providers`, where Nest accepts it
 * without complaint — a controller class is a perfectly valid injectable — and
 * maps no route for it. Nothing failed at boot; `GET /admin/finance/refunds`
 * simply answered 404 in production.
 *
 * A metadata assertion would not have caught that either: the `@Controller` and
 * `@Get` decorators were correct the whole time. What was wrong was the key it
 * was listed under, so the test has to ask the container what it knows.
 */

vi.mock('@barat/database', () => ({
  prisma: { refund: { findMany: vi.fn(async () => []) } },
  Prisma: { JsonNull: null, TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));

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

import { AppModule } from '../../app.module';
import { ROLES_METADATA_KEY } from '../identity/rbac/roles.decorator';
import { FinanceController, refundQuerySchema } from './finance.controller';

describe('FinanceController wiring', () => {
  /**
   * Registering a controller under `providers` instead of `controllers` is the
   * whole bug, and this is the assertion that separates the two. Nest reads
   * these two keys off the `@Module` metadata and only ever maps routes from
   * `controllers`; a class under `providers` is an injectable nobody injects.
   *
   * Read off the decorator metadata rather than a compiled container on
   * purpose: compiling `AppModule` boots every domain module and a database,
   * which is a far heavier thing to keep green than the one fact under test.
   */
  it('is listed under AppModule.controllers, not providers', () => {
    const controllers = (Reflect.getMetadata('controllers', AppModule) ?? []) as unknown[];
    const providers = (Reflect.getMetadata('providers', AppModule) ?? []) as unknown[];

    expect(controllers).toContain(FinanceController);
    expect(providers).not.toContain(FinanceController);
  });

  it('sums refund amounts as BigInt and returns them as strings', async () => {
    const { prisma } = await import('@barat/database');
    const findMany = prisma.refund.findMany as unknown as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce([
      {
        id: 'r1',
        orderId: 'o1',
        amountIrr: 1_500_000n,
        status: 'REQUESTED',
        reason: 'کد معیوب',
        requestedAt: new Date('2026-10-01T10:00:00.000Z'),
        requestedBy: { fullName: 'اپراتور' },
      },
      {
        id: 'r2',
        orderId: 'o2',
        amountIrr: 2_500_000n,
        status: 'COMPLETED',
        reason: 'شارژ انجام نشد',
        requestedAt: new Date('2026-10-02T10:00:00.000Z'),
        requestedBy: null,
      },
    ]);

    const controller = new FinanceController();
    const result = await controller.getRefunds({ from: '2026-10-01', to: '2026-10-31' });

    /* Money never becomes a JS number on the way out: 4,000,000 IRR is summed
     * as BigInt and serialised as a string. */
    expect(result.totalIrr).toBe('4000000');
    expect(result.count).toBe(2);
    expect(result.refunds[0]?.amountIrr).toBe('1500000');
    expect(result.refunds[1]?.requestedBy).toBeNull();
  });

  /**
   * The report's own filters cut the day at Tehran midnight. If this endpoint
   * cut it at UTC midnight instead, a refund recorded between 00:00 and 03:30
   * Tehran would sit in one day's orders and another day's refunds, and the
   * GMV-minus-refunds line would stop reconciling for anyone who looked.
   */
  it('cuts the day at Tehran midnight, matching the report filters', async () => {
    const { prisma } = await import('@barat/database');
    const findMany = prisma.refund.findMany as unknown as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValueOnce([]);

    const controller = new FinanceController();
    await controller.getRefunds({ from: '2026-10-01', to: '2026-10-01' });

    /* The mock is shared across this file, so read the call this test made
     * rather than the first one recorded. */
    const lastCall = findMany.mock.calls.at(-1);
    const where = lastCall?.[0]?.where as { requestedAt: { gte: Date; lt: Date } };

    /* 2026-10-01T00:00 Tehran is 2026-09-30T20:30Z. */
    expect(where.requestedAt.gte.toISOString()).toBe('2026-09-30T20:30:00.000Z');
    /* Half-open: the exclusive end is the next Tehran midnight, so a row
     * stamped in the last microsecond of the day is still counted. */
    expect(where.requestedAt.lt.toISOString()).toBe('2026-10-01T20:30:00.000Z');
  });

  /**
   * FINANCE is the role that exists to read this. The reports page is gated on
   * REPORT_ROLES (ADMIN, MANAGEMENT, FINANCE), so a narrower guard here renders
   * the page for a finance user with a 403 where the refund total should be.
   */
  it('admits exactly the roles that can open the reports page', () => {
    const roles = Reflect.getMetadata(ROLES_METADATA_KEY, FinanceController) as
      | string[]
      | undefined;
    expect(roles).toEqual(expect.arrayContaining(['ADMIN', 'MANAGEMENT', 'FINANCE']));
  });

  /*
   * The bare `\d{4}-\d{2}-\d{2}` pattern let `2026-13-45` through. It became an
   * Invalid Date, reached Prisma, and returned a 500 instead of a 400.
   */
  it('rejects impossible calendar dates before any query runs', () => {
    expect(refundQuerySchema.safeParse({ from: '2026-13-45', to: '2026-10-01' }).success).toBe(false);
    expect(refundQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(refundQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-32' }).success).toBe(false);
  });

  it('rejects a reversed range and accepts a valid one, including a leap day', () => {
    expect(refundQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
    expect(refundQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success).toBe(true);
    expect(refundQuerySchema.safeParse({ from: '2028-02-29', to: '2028-03-01' }).success).toBe(true);
  });
});
