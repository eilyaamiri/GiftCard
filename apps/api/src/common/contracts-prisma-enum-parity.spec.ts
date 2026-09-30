import { describe, expect, it } from 'vitest';

import {
  DELIVERY_ASSET_TYPE_VALUES,
  PRICING_RULE_SCOPE_VALUES,
  SERVICE_FIELD_TYPE_VALUES,
  TOP_UP_EVENT_TYPE_VALUES,
  TOP_UP_STATUS_VALUES,
} from '@barat/contracts';
import {
  DeliveryAssetType,
  PricingRuleScope,
  ServiceFieldType,
  TopUpEventType,
  TopUpStatus,
} from '@barat/database/generated/client';

/**
 * Note the import path: the generated client, not the `@barat/database` barrel.
 *
 * The barrel also exports the `prisma` singleton, which constructs a
 * `PrismaClient` on module load and therefore demands a live `DATABASE_URL` —
 * a connection this test has no business making, and which would make an
 * enum-comparison test fail on a machine with no database. The generated
 * `index` entrypoint is pure enum declarations with no side effects, so
 * importing it directly keeps the test hermetic while still comparing against
 * the values Prisma actually generated rather than a hand-copied stub.
 *
 * Imported statically rather than through `require`, because the same
 * no-side-effects property that makes it safe to load is also what makes a
 * dynamic import unnecessary: there is no database to wait for.
 */

/**
 * Contracts ⇄ Prisma enum parity.
 *
 * `packages/contracts` is the wire vocabulary and `schema.prisma` is the storage
 * vocabulary, and they declare the same enums twice on purpose: contracts must
 * not depend on the database (AGENTS.md §2 — the arrow points one way), so the
 * two declarations cannot be reduced to one. This test is what stops them
 * drifting.
 *
 * The failure it exists to catch: a value added to one side and not the other.
 * That is silent at compile time when the two are structurally compatible, and
 * it shows up in production as a row the API cannot serialise — or worse, an
 * enum member a narrowing branch never handles.
 *
 * The comparison is deliberately exact and ordered. Order matters for the same
 * reason: an enum's declaration order is what Prisma uses when it sorts, and a
 * reviewer scanning the two side by side should see them match line for line.
 */
describe('contracts ⇄ Prisma enum parity', () => {
  const cases: readonly {
    readonly name: string;
    readonly contractValues: readonly string[];
    readonly prismaEnum: Record<string, string>;
  }[] = [
    { name: 'DeliveryAssetType', contractValues: DELIVERY_ASSET_TYPE_VALUES, prismaEnum: DeliveryAssetType },
    { name: 'PricingRuleScope', contractValues: PRICING_RULE_SCOPE_VALUES, prismaEnum: PricingRuleScope },
    { name: 'ServiceFieldType', contractValues: SERVICE_FIELD_TYPE_VALUES, prismaEnum: ServiceFieldType },
    { name: 'TopUpStatus', contractValues: TOP_UP_STATUS_VALUES, prismaEnum: TopUpStatus },
    {
      name: 'TopUpEventType',
      contractValues: TOP_UP_EVENT_TYPE_VALUES,
      prismaEnum: TopUpEventType,
    },
  ];

  it.each(cases)('$name declares the same values on both sides', ({ contractValues, prismaEnum }) => {
    expect(Object.values(prismaEnum)).toEqual([...contractValues]);
  });

  it('keeps the top-up asset type on both sides', () => {
    /*
     * `DIRECT_TOPUP` is the one member whose absence is a live bug rather than a
     * test failure: a top-up purchase returns no asset, so the delivery path
     * has to recognise the type to avoid demanding a code that will never
     * exist. Named explicitly so a rename on either side fails loudly here.
     */
    expect(DELIVERY_ASSET_TYPE_VALUES).toContain('DIRECT_TOPUP');
    expect(DeliveryAssetType.DIRECT_TOPUP).toBe('DIRECT_TOPUP');
  });

  it('keeps TOP_UP_GAME available as a pricing scope on both sides', () => {
    /*
     * The top-up margin rule is data, not a constant: it is administered as a
     * PricingRule on this scope. If the scope disappeared from either side, the
     * admin path would still save a rule the quote engine could never select,
     * and every top-up would silently fall back to the GLOBAL margin.
     */
    expect(PRICING_RULE_SCOPE_VALUES).toContain('TOP_UP_GAME');
    expect(PricingRuleScope.TOP_UP_GAME).toBe('TOP_UP_GAME');
  });
});
