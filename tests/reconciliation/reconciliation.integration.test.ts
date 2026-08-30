import { describe, expect, it } from 'vitest';

import {
  REPORTING_FIXTURE,
  assertReportingFixture,
  reportingFixtureRows,
} from '../../packages/test-utils/src/fixtures';

describe('reconciliation reporting fixture', () => {
  it('contains the exact deterministic funnel totals', () => {
    const rows = reportingFixtureRows();
    assertReportingFixture(rows);
    expect(rows).toHaveLength(REPORTING_FIXTURE.quotes);
    expect(rows.filter((row) => row.checkout)).toHaveLength(REPORTING_FIXTURE.checkouts);
    expect(rows.filter((row) => row.paymentAttempt)).toHaveLength(
      REPORTING_FIXTURE.paymentAttempts,
    );
    expect(rows.filter((row) => row.paid)).toHaveLength(REPORTING_FIXTURE.paid);
    expect(rows.filter((row) => row.fulfilled)).toHaveLength(REPORTING_FIXTURE.fulfilled);
    expect(rows.filter((row) => row.failed)).toHaveLength(REPORTING_FIXTURE.failed);
  });

  it('does not mutate the published fixture constants', () => {
    expect(REPORTING_FIXTURE).toEqual({
      quotes: 100,
      checkouts: 80,
      paymentAttempts: 70,
      paid: 65,
      fulfilled: 60,
      failed: 5,
      paidNotFulfilled: 5,
    });
  });
});
