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
    );

    const error = await service.getOrder('customer-a', 'order-b').catch((thrown) => thrown);
    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).safeMessage).toBe('مورد درخواستی یافت نشد.');
  });
});
