export interface ReportingFixture {
  readonly quotes: 100;
  readonly checkouts: 80;
  readonly paymentAttempts: 70;
  readonly paid: 65;
  readonly fulfilled: 60;
  readonly failed: 5;
  readonly paidNotFulfilled: 5;
}

/** Exact dashboard funnel expected from deterministic DEMO DATA. */
export const REPORTING_FIXTURE: ReportingFixture = Object.freeze({
  quotes: 100,
  checkouts: 80,
  paymentAttempts: 70,
  paid: 65,
  fulfilled: 60,
  failed: 5,
  paidNotFulfilled: 5,
});

export interface ReportingFixtureRow {
  readonly index: number;
  readonly quoteId: string;
  readonly checkout: boolean;
  readonly paymentAttempt: boolean;
  readonly paid: boolean;
  readonly fulfilled: boolean;
  readonly failed: boolean;
}

/** Materialise rows for tests that need to assert aggregations, without DB access. */
export function reportingFixtureRows(): readonly ReportingFixtureRow[] {
  return Array.from({ length: REPORTING_FIXTURE.quotes }, (_, offset) => {
    const index = offset + 1;
    const checkout = index <= REPORTING_FIXTURE.checkouts;
    const paymentAttempt = index <= REPORTING_FIXTURE.paymentAttempts;
    const paid = index <= REPORTING_FIXTURE.paid;
    const fulfilled = index <= REPORTING_FIXTURE.fulfilled;
    return {
      index,
      quoteId: `Q-2026-${String(index).padStart(6, '0')}`,
      checkout,
      paymentAttempt,
      paid,
      fulfilled,
      failed: paymentAttempt && !paid,
    };
  });
}

export function assertReportingFixture(rows: readonly ReportingFixtureRow[]): void {
  const actual = {
    quotes: rows.length,
    checkouts: rows.filter((row) => row.checkout).length,
    paymentAttempts: rows.filter((row) => row.paymentAttempt).length,
    paid: rows.filter((row) => row.paid).length,
    fulfilled: rows.filter((row) => row.fulfilled).length,
    failed: rows.filter((row) => row.failed).length,
  };
  if (
    actual.quotes !== REPORTING_FIXTURE.quotes ||
    actual.checkouts !== REPORTING_FIXTURE.checkouts ||
    actual.paymentAttempts !== REPORTING_FIXTURE.paymentAttempts ||
    actual.paid !== REPORTING_FIXTURE.paid ||
    actual.fulfilled !== REPORTING_FIXTURE.fulfilled ||
    actual.failed !== REPORTING_FIXTURE.failed
  ) {
    throw new Error(`Reporting fixture mismatch: ${JSON.stringify(actual)}`);
  }
}
