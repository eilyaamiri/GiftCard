import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { CustomersService } from './customers.service';
import type { CustomersDatabase } from './customers.tokens';

const staff: AuthenticatedStaff = {
  type: 'STAFF',
  staffId: 'staff-1',
  role: 'SUPPORT',
  email: 'support@barat.test',
};
const actor = { ip: '203.0.113.4', userAgent: 'vitest' };

interface Rig {
  readonly service: CustomersService;
  readonly audits: Array<Record<string, unknown>>;
  readonly identityLookups: Array<Record<string, unknown>>;
}

function buildRig(
  seed: {
    identity?: { type: string; valueNormalized: string; customerId: string };
    customerCode?: { code: string; id: string };
  } = {},
): Rig {
  const audits: Array<Record<string, unknown>> = [];
  const identityLookups: Array<Record<string, unknown>> = [];

  const database = {
    customerIdentity: {
      findUnique: vi.fn(async ({ where }: any) => {
        identityLookups.push(where.type_valueNormalized);
        const wanted = where.type_valueNormalized;
        if (
          seed.identity &&
          seed.identity.type === wanted.type &&
          seed.identity.valueNormalized === wanted.valueNormalized
        ) {
          return { customerId: seed.identity.customerId };
        }
        return null;
      }),
    },
    customer: {
      findUnique: vi.fn(async ({ where }: any) =>
        seed.customerCode && where.customerCode === seed.customerCode.code
          ? { id: seed.customerCode.id }
          : null,
      ),
      findMany: vi.fn(async () => [
        {
          id: 'customer-1',
          customerCode: 'CUS-ABC123',
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          profile: { firstName: 'Ali', lastName: 'Rezaei' },
          identities: [
            { type: 'MOBILE', valueNormalized: '+989121234567' },
            { type: 'EMAIL', valueNormalized: 'ali@example.com' },
          ],
          _count: { orders: 3 },
        },
      ]),
    },
    order: { findUnique: vi.fn(async () => null) },
    payment: { findMany: vi.fn(async () => []) },
  } as unknown as CustomersDatabase;

  const audit = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      audits.push(input);
    }),
  };

  const service = new CustomersService(
    database,
    { customerDto: vi.fn() } as never,
    audit as never,
  );

  return { service, audits, identityLookups };
}

describe('CustomersService.search', () => {
  it('finds a customer by mobile in any accepted written form', async () => {
    const rig = buildRig({
      identity: { type: 'MOBILE', valueNormalized: '+989121234567', customerId: 'customer-1' },
    });

    const result = await rig.service.search(
      { query: '09121234567', page: 1, pageSize: 20 } as never,
      staff,
      actor,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.matchedOn).toBe('MOBILE');
    expect(rig.identityLookups).toContainEqual({
      type: 'MOBILE',
      valueNormalized: '+989121234567',
    });
  });

  it('does not fail when the term is an e-mail rather than a mobile', async () => {
    const rig = buildRig({
      identity: { type: 'EMAIL', valueNormalized: 'ali@example.com', customerId: 'customer-1' },
    });

    const result = await rig.service.search(
      { query: 'Ali@Example.com', page: 1, pageSize: 20 } as never,
      staff,
      actor,
    );

    expect(result.items[0]!.matchedOn).toBe('EMAIL');
  });

  it('does not fail when the term is a customer code', async () => {
    const rig = buildRig({ customerCode: { code: 'CUS-ABC123', id: 'customer-1' } });

    const result = await rig.service.search(
      { query: 'cus-abc123', page: 1, pageSize: 20 } as never,
      staff,
      actor,
    );

    expect(result.items[0]!.matchedOn).toBe('CUSTOMER_CODE');
  });

  it('returns nothing rather than everything when there is no match', async () => {
    const rig = buildRig();

    const result = await rig.service.search(
      { query: 'unknown-term', page: 1, pageSize: 20 } as never,
      staff,
      actor,
    );

    expect(result.items).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('masks identity values in the search results and in the audit row', async () => {
    const rig = buildRig({
      identity: { type: 'MOBILE', valueNormalized: '+989121234567', customerId: 'customer-1' },
    });

    const result = await rig.service.search(
      { query: '09121234567', page: 1, pageSize: 20 } as never,
      staff,
      actor,
    );

    expect(result.items[0]!.maskedMobile).toBe('+9891***4567');
    expect(result.items[0]!.maskedEmail).toBe('a***@example.com');
    expect(JSON.stringify(result)).not.toContain('+989121234567');

    const [audited] = rig.audits;
    expect(audited!['action']).toBe('CUSTOMER_SEARCH');
    expect(audited!['actorRole']).toBe('SUPPORT');
    expect(JSON.stringify(audited)).not.toContain('+989121234567');
  });

  it('audits every search, including the ones that find nothing', async () => {
    const rig = buildRig();

    await rig.service.search({ query: 'nobody@example.com', page: 1, pageSize: 20 } as never, staff, actor);

    expect(rig.audits).toHaveLength(1);
    expect(rig.audits[0]!['action']).toBe('CUSTOMER_SEARCH');
  });
});

describe('operator write surface', () => {
  /**
   * "Operators may view but never change payment status, amount, verification
   * result or a verified identity." The strongest possible form of that rule is
   * that no such method exists, so this test pins the public surface.
   */
  it('exposes no method that could mutate a payment, an order or an identity', () => {
    const methods = Object.getOwnPropertyNames(CustomersService.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(methods.sort()).toEqual(['addNote', 'clearFlag', 'customer360', 'lifetimeTotals', 'search']);

    const mutators = methods.filter((name) => /payment|refund|verify|amount|status|identity/iu.test(name));
    expect(mutators).toEqual([]);
  });
});
