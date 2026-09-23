import {
  type CrossRateProvider,
  type RawCrossRate,
} from '../cross-rate-provider.interface';

/**
 * A fixed cross-rate table for development and tests.
 *
 * Deterministic on purpose — a jittering rate would make every pricing
 * assertion time-dependent — and never selected implicitly in production, which
 * `fx.module.ts` enforces: a made-up rate in production is a direct financial
 * loss, not a degraded experience.
 *
 * The values are real quotes from 2026-09-23, rounded the way the upstream
 * publishes them, so a locally computed price is in the right neighbourhood and
 * an obviously wrong one still looks wrong.
 */
const DEFAULT_TABLE: Readonly<Record<string, string>> = {
  AUD: '1.4058',
  CAD: '1.3577',
  CHF: '0.7906',
  CNY: '7.1093',
  EUR: '0.84896',
  GBP: '0.74756',
  HKD: '7.7841',
  INR: '88.079',
  JPY: '157.39',
  NOK: '9.9139',
  NZD: '1.5507',
  PLN: '3.6117',
  SEK: '9.3474',
  SGD: '1.2839',
  TRY: '41.443',
  ZAR: '17.354',
};

const DEFAULT_PUBLISHED_ON = '2026-09-23';

export interface MockCrossRateProviderOptions {
  readonly name?: string;
  /** Replaces the table wholesale; `USD` is never expected in it. */
  readonly table?: Readonly<Record<string, string>>;
  readonly publishedOn?: string;
  readonly clock?: () => Date;
}

export class MockCrossRateProvider implements CrossRateProvider {
  readonly name: string;

  private readonly table: Readonly<Record<string, string>>;
  private readonly publishedOn: string;
  private readonly clock: () => Date;

  constructor(options: MockCrossRateProviderOptions = {}) {
    this.name = options.name ?? 'mock-cross';
    this.table = options.table ?? DEFAULT_TABLE;
    this.publishedOn = options.publishedOn ?? DEFAULT_PUBLISHED_ON;
    this.clock = options.clock ?? (() => new Date());
  }

  getUsdTable(): Promise<readonly RawCrossRate[]> {
    const receivedAt = this.clock();
    return Promise.resolve(
      Object.entries(this.table).map(([currency, unitsPerUsd]) => ({
        currency,
        unitsPerUsd,
        publishedOn: this.publishedOn,
        source: 'MOCK',
        receivedAt: new Date(receivedAt),
      })),
    );
  }
}
