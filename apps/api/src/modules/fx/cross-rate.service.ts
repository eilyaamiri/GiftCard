import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FX_CROSS_RATE_PROVIDER, type CrossRateProvider, type RawCrossRate } from '@barat/fx';

import {
  CrossRateUnavailableError,
  FX_CROSS_RATE_CONFIG,
  type CrossRateConfig,
  type CrossRateSnapshot,
} from './cross-rate.types';

const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
/** The base of the table, and the currency the pricing pair is denominated in. */
const BASE_CURRENCY = 'USD';
/**
 * How long to wait between attempts while holding no table at all.
 *
 * Shorter than the refresh interval on purpose: with nothing to serve, every
 * non-dollar quote is failing, so a minute of downtime after the feed recovers
 * would be a minute we chose. Two requests a minute is not a load anyone
 * notices at the other end.
 */
const COLD_RETRY_SECONDS = 30;

/**
 * The USD cross-rate table, held in memory.
 *
 * Not persisted, and that is a decision rather than an omission. The rate a
 * quote was priced at is already durable — it goes into `Quote.snapshot`, which
 * is the immutable artefact rule 4 asks for — so a table row would only be a
 * cache with a migration attached. What is kept here is one table at a time,
 * refreshed on a clock, shared by every quote in the process.
 *
 * The whole table arrives in one request, so the first non-dollar quote after a
 * refresh pays for every currency at once and the rest are free.
 */
@Injectable()
export class CrossRateService implements OnModuleInit {
  private readonly logger = new Logger(CrossRateService.name);
  private readonly now: () => Date;

  private table: ReadonlyMap<string, RawCrossRate> | null = null;
  /** When the table we are serving was fetched. Drives staleness. */
  private fetchedAt: Date | null = null;
  /** When we last *tried*. Paces retries so a dead feed is not hit per quote. */
  private attemptedAt: Date | null = null;
  private inFlight: Promise<void> | null = null;
  private lastErrorAt: Date | null = null;
  private lastErrorName: string | null = null;

  constructor(
    @Inject(FX_CROSS_RATE_PROVIDER) private readonly provider: CrossRateProvider,
    @Inject(FX_CROSS_RATE_CONFIG) private readonly config: CrossRateConfig,
  ) {
    this.now = config.now ?? ((): Date => new Date());
  }

  onModuleInit(): void {
    if (!this.config.warmOnStart) {
      return;
    }
    /* Fire and forget: a reference feed being slow at boot must not hold up the
     * API, and the first quote that needs a rate will wait for this same call. */
    void this.refresh();
  }

  /**
   * What one dollar buys in `currency`, with enough provenance to audit it.
   *
   * `USD` short-circuits: it is the base, its rate is one by definition, and a
   * dollar-priced card must not become dependent on a foreign feed being up.
   * That keeps today's behaviour byte-identical for the catalog's majority.
   */
  async getSnapshot(currency: string): Promise<CrossRateSnapshot> {
    const code = currency.trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(code)) {
      throw new CrossRateUnavailableError(code, 'UNSUPPORTED_CURRENCY');
    }
    if (code === BASE_CURRENCY) {
      const at = this.now();
      return {
        currency: BASE_CURRENCY,
        unitsPerUsd: '1',
        provider: 'identity',
        source: 'IDENTITY',
        publishedOn: null,
        receivedAt: at.toISOString(),
        ageSeconds: 0,
        isStale: false,
        isIdentity: true,
      };
    }

    await this.ensureTable();
    const entry = this.table?.get(code);
    if (!entry || this.fetchedAt === null) {
      throw new CrossRateUnavailableError(code, 'UNSUPPORTED_CURRENCY');
    }

    const ageSeconds = elapsedSeconds(this.fetchedAt, this.now());
    return {
      currency: entry.currency,
      unitsPerUsd: entry.unitsPerUsd,
      provider: this.provider.name,
      source: entry.source,
      publishedOn: entry.publishedOn,
      receivedAt: entry.receivedAt.toISOString(),
      ageSeconds,
      isStale: ageSeconds > this.config.staleThresholdSeconds,
      isIdentity: false,
    };
  }

  /** Forces a fetch regardless of the refresh clock. For operators and tests. */
  async refreshNow(): Promise<void> {
    this.attemptedAt = null;
    await this.ensureTable();
  }

  private async ensureTable(): Promise<void> {
    /*
     * Retries are paced by the clock, never by traffic. Without this a feed
     * that is down turns every incoming quote into another request to it —
     * which is the shape of an outage we would be amplifying, not weathering.
     *
     * Holding nothing at all is the harsher state: there is no price to serve,
     * so recovery matters more than restraint and the wait drops to the cold
     * interval. With a table in hand the normal refresh interval applies, since
     * the existing rate keeps working in the meantime.
     */
    const interval =
      this.table === null
        ? Math.min(COLD_RETRY_SECONDS, this.config.refreshIntervalSeconds)
        : this.config.refreshIntervalSeconds;
    /*
     * A caller with nothing to serve joins a refresh already in flight rather
     * than being turned away by the pacing clock. The first of a burst sets
     * that clock on its way out the door, and without this the rest of the
     * burst would fail while the answer they needed was seconds away.
     */
    const joins = this.table === null && this.inFlight !== null;
    const due =
      joins ||
      this.attemptedAt === null ||
      elapsedSeconds(this.attemptedAt, this.now()) >= interval;
    if (due) {
      await this.refresh();
    }
    if (this.table === null) {
      throw new CrossRateUnavailableError(null, 'PROVIDER_UNAVAILABLE');
    }
  }

  /**
   * Single-flight. Without it a burst of quotes on a cold table would each open
   * their own request to the same endpoint and race to install the answer.
   */
  private refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    this.attemptedAt = this.now();
    try {
      const entries = await this.provider.getUsdTable();
      const next = new Map<string, RawCrossRate>();
      for (const entry of entries) {
        /* The base does not belong in the table: it is answered by identity,
         * and a feed quoting USD against itself at anything but 1 is noise. */
        if (entry.currency !== BASE_CURRENCY) {
          next.set(entry.currency, entry);
        }
      }
      if (next.size === 0) {
        throw new Error('cross-rate table is empty');
      }
      this.table = next;
      this.fetchedAt = this.now();
      this.lastErrorAt = null;
      this.lastErrorName = null;
    } catch (error) {
      /*
       * The last good table is kept rather than dropped. A feed hiccup should
       * not take non-dollar quoting down the instant it happens; the table ages
       * out through the stale threshold instead, which is a decision someone
       * configured rather than an outage's timing.
       *
       * The provider's own error is already credential-free and carries no URL
       * or body, so it is safe to log by name.
       */
      this.lastErrorAt = this.now();
      this.lastErrorName = errorName(error);
      this.logger.warn(
        { provider: this.provider.name, error: this.lastErrorName, servingStale: this.table !== null },
        'Cross-rate refresh failed',
      );
    }
  }

  /** Feed liveness, for the same reason `ProviderHealth` exists. */
  health(): {
    readonly provider: string;
    readonly hasTable: boolean;
    readonly currencies: number;
    readonly fetchedAt: string | null;
    readonly lastErrorAt: string | null;
    readonly lastErrorName: string | null;
  } {
    return {
      provider: this.provider.name,
      hasTable: this.table !== null,
      currencies: this.table?.size ?? 0,
      fetchedAt: this.fetchedAt?.toISOString() ?? null,
      lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
      lastErrorName: this.lastErrorName,
    };
  }
}

function elapsedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1_000));
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    /* `FxProviderError` puts the normalized code in its message and nothing
     * else; a plain Error contributes only its own text, which this module
     * wrote. Neither can contain a credential. */
    return error.message;
  }
  return 'unknown error';
}
