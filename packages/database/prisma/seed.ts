/* eslint-disable no-console */
/**
 * ============================================================================
 * SEED — PLACEHOLDER. Owned by workstream S6 / B10 (QA, E2E & seed data).
 * ============================================================================
 *
 * >>> AGENT B10: IMPLEMENT BELOW THIS MARKER. <<<
 *
 * Requirements the deterministic seed must satisfy:
 *
 *   1. Fully deterministic. Fixed faker seed, fixed clock, fixed ids. Running it
 *      twice on a clean database must produce byte-identical rows so the E2E
 *      dashboard assertions can compare exact numbers.
 *
 *   2. The reference funnel the reporting E2E test asserts against:
 *        100 quotes -> 80 checkouts -> 65 paid -> 60 fulfilled
 *      plus a deliberate handful of reconciliation anomalies (one
 *      `amount_mismatch`, one `paid_not_fulfilled`, one `unknown_payment`).
 *
 *   3. Baseline reference data:
 *        - FeatureFlag rows for all 7 keys
 *        - Queue rows for all 9 QueueKey values
 *        - one GLOBAL PricingRule with the agreed bps values
 *        - one FxRate (USD_IRR, provider `seed`, isManualOverride = false)
 *        - 10-20 gift-card Products with SKUs across regions
 *        - the international services from the product plan
 *        - Suppliers, including one with `supportsRawCode = true` (Tillo-like)
 *          and one with `supportsRawCode = false` (Reloadly-like) so both
 *          delivery models are exercised
 *        - StaffUsers covering every StaffRole
 *
 *   4. Money rules still apply here: BigInt for IRR, Decimal strings for USD,
 *      integer bps for rates. Never a float.
 *
 *   5. Gift-card assets must be seeded through the same encryption helper the
 *      application uses. Never write a plaintext code, not even in a fixture.
 *
 * Until this is implemented the script is a no-op that exits successfully, so
 * `pnpm db:seed` never breaks another agent's pipeline.
 */

import { disconnectPrisma, prisma } from '../src/client';

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // >>> B10: replace this block with the real deterministic seed. <<<
  // ---------------------------------------------------------------------
  const staffCount = await prisma.staffUser.count();
  console.log(
    `[seed] placeholder — nothing was written. Existing StaffUser rows: ${staffCount}. ` +
      'See the marker comment in packages/database/prisma/seed.ts.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
