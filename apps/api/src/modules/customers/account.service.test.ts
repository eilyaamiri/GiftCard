import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import type { CustomersDatabase } from './customers.tokens';
import { AccountService } from './account.service';

function orderRow(id: string, customerId: string) {
  return {
    id,
    customerId,
    orderNumber: `BP-${id}`,
    status: 'PAID',
    totalAmountIrr: 100n,
    displayAmountToman: 10n,
    currency: 'IRR',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    paidAt: new Date('2026-01-01T00:01:00.000Z'),
    fulfilledAt: null,
  };
}

describe('AccountService customer scoping', () => {
  it('customer A cannot read customer B order data even when A supplies B order id', async () => {
    const bOrder = orderRow('order-b', 'customer-b');
    const findFirst = vi.fn(async ({ where }: { where: { id: string; customerId: string } }) => {
      /* This is the security invariant: both ownership predicates must reach the
       * database query, rather than loading by id and checking afterward. */
      if (where.id === bOrder.id && where.customerId === bOrder.customerId) {
        return bOrder;
      }
      return null;
    });
    const database = {
      order: { findFirst },
    } as unknown as CustomersDatabase;
    const service = new AccountService(
      database,
      { customerDto: vi.fn() } as never,
      { record: vi.fn() } as never,
      { get: vi.fn(async () => null) } as never,
    );

    await expect(service.getOrder('customer-a', bOrder.id)).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: bOrder.id, customerId: 'customer-a' } }),
    );
  });

  it('returns an owned order and maps BigInt money without floating-point conversion', async () => {
    const aOrder = orderRow('order-a', 'customer-a');
    const findFirst = vi.fn(async () => aOrder);
    const database = { order: { findFirst } } as unknown as CustomersDatabase;
    const service = new AccountService(
      database,
      { customerDto: vi.fn() } as never,
      { record: vi.fn() } as never,
      { get: vi.fn(async () => null) } as never,
    );

    await expect(service.getOrder('customer-a', aOrder.id)).resolves.toEqual({
      id: 'order-a',
      orderNumber: 'BP-order-a',
      status: 'PAID',
      totalAmountIrr: '100',
      displayAmountToman: '10',
      currency: 'IRR',
      createdAt: '2026-01-01T00:00:00.000Z',
      paidAt: '2026-01-01T00:01:00.000Z',
      fulfilledAt: null,
    });
  });

  it('uses a generic not-found error that does not disclose another account', async () => {
    const database = {
      order: { findFirst: vi.fn(async () => null) },
    } as unknown as CustomersDatabase;
    const service = new AccountService(
      database,
      { customerDto: vi.fn() } as never,
      { record: vi.fn() } as never,
      { get: vi.fn(async () => null) } as never,
    );

    const error = await service.getOrder('customer-a', 'order-b').catch((thrown) => thrown);
    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).safeMessage).toBe('مورد درخواستی یافت نشد.');
  });
});

const ACTOR = { ip: '127.0.0.1', userAgent: 'vitest' } as never;

function emailHarness(options: {
  /** The row `type_valueNormalized` resolves to, i.e. who already owns the address. */
  owner?: { customerId: string } | null;
  /** The caller's current e-mail identity, if any. */
  current?: { id: string; valueNormalized: string; isVerified: boolean } | null;
  /** Simulates another request taking the address between the check and the write. */
  createRace?: boolean;
}) {
  const update = vi.fn(async (args: unknown) => args);
  const create = vi.fn(async (args: unknown) => {
    if (options.createRace) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    return args;
  });
  const record = vi.fn(async (entry: unknown) => entry);

  const database = {
    customerIdentity: {
      findUnique: vi.fn(async () => options.owner ?? null),
      findFirst: vi.fn(async () => options.current ?? null),
      update,
      create,
    },
    customerProfile: {
      findUnique: vi.fn(async () => ({
        firstName: 'یکتا',
        lastName: 'کریمی',
        preferredLanguage: 'fa',
        marketingOptIn: false,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      })),
    },
  } as unknown as CustomersDatabase;

  const service = new AccountService(
    database,
    { customerDto: vi.fn(async () => ({ id: 'customer-a' })) } as never,
    { record } as never,
    { get: vi.fn(async () => null) } as never,
  );
  return { service, update, create, record };
}

describe('AccountService.updateEmail', () => {
  it('refuses an address already bound to another account', async () => {
    const { service, update, create } = emailHarness({ owner: { customerId: 'customer-b' } });

    const error = await service
      .updateEmail('customer-a', { email: 'taken@example.com' }, ACTOR)
      .catch((thrown: unknown) => thrown);

    expect((error as BaratDomainException).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves a verified address alone when it is submitted unchanged', async () => {
    /* Re-saving the same value must not silently drop the verified flag. */
    const { service, update, create, record } = emailHarness({
      owner: { customerId: 'customer-a' },
      current: { id: 'identity-1', valueNormalized: 'same@example.com', isVerified: true },
    });

    await service.updateEmail('customer-a', { email: 'Same@Example.com ' }, ACTOR);

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('stores a changed address as unverified, because nothing has proved it yet', async () => {
    const { service, update } = emailHarness({
      owner: null,
      current: { id: 'identity-1', valueNormalized: 'old@example.com', isVerified: true },
    });

    await service.updateEmail('customer-a', { email: 'new@example.com' }, ACTOR);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'identity-1' },
        data: expect.objectContaining({
          valueNormalized: 'new@example.com',
          isVerified: false,
          verifiedAt: null,
        }),
      }),
    );
  });

  it('adds a non-primary identity when the account had no e-mail', async () => {
    /* The mobile signs in; an unverified e-mail must never become primary. */
    const { service, create } = emailHarness({ owner: null, current: null });

    await service.updateEmail('customer-a', { email: 'first@example.com' }, ACTOR);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-a',
          type: 'EMAIL',
          isPrimary: false,
          isVerified: false,
        }),
      }),
    );
  });

  it('writes only the masked address to the audit trail', async () => {
    const { service, record } = emailHarness({
      owner: null,
      current: { id: 'identity-1', valueNormalized: 'old@example.com', isVerified: true },
    });

    await service.updateEmail('customer-a', { email: 'new@example.com' }, ACTOR);

    const entry = JSON.stringify(record.mock.calls[0]?.[0]);
    expect(entry).toContain('CUSTOMER_EMAIL_UPDATED');
    expect(entry).not.toContain('new@example.com');
    expect(entry).not.toContain('old@example.com');
  });

  it('turns a lost uniqueness race into the same conflict as the pre-check', async () => {
    const { service } = emailHarness({ owner: null, current: null, createRace: true });

    const error = await service
      .updateEmail('customer-a', { email: 'racy@example.com' }, ACTOR)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).status).toBe(409);
  });
});
