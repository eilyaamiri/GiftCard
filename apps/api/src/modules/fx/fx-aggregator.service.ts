import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  fxRateStringSchema,
  type DecimalString,
  type FxPair,
  type FxProviderHealth,
  type FxRateSnapshot,
  type GetFxRateResponse,
} from '@barat/contracts';
import {
  FX_PRIMARY_RATE_PROVIDER,
  FX_SECONDARY_RATE_PROVIDER,
  type FxRateProvider,
  type ProviderHealth,
  type RawFxRate,
} from '@barat/fx';

import { BaratDomainException, DomainErrors } from '../../common/errors/domain.exception';
import {
  FX_AGGREGATOR_CONFIG,
  FX_AUDIT_RECORDER,
  FX_CLOCK,
  FX_RATE_REPOSITORY,
  type FxAuditRecorder,
  type FxAggregatorConfig,
  type FxClock,
  type FxHistoryResult,
  type FxOverrideInput,
  type FxRateRecord,
  type FxRateRepository,
  type FxStaffActor,
} from './fx.types';

const MAX_OVERRIDE_TTL_SECONDS = 86_400;
const systemClock: FxClock = { now: () => new Date() };

/**
 * Raised when no provider and no unexpired manual override can supply a
 * trustworthy rate. Quote creation must propagate this — never estimate a rate,
 * never reuse a stale one (execution plan section 5, FX policy step 4).
 */
export class StaleFxRateError extends BaratDomainException {
  readonly ageSeconds: number;

  constructor(ageSeconds: number) {
    const age = Math.max(0, Math.floor(ageSeconds));
    super({
      code: 'FX_RATE_STALE',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      safeMessage: 'نرخ ارز به‌روز نیست. لطفاً چند دقیقهٔ دیگر تلاش کنید.',
      internalDetail: `no usable FX rate: best candidate age ${age}s exceeds the configured threshold`,
    });
    this.name = 'StaleFxRateError';
    this.ageSeconds = age;
  }
}

interface ProviderAttempt {
  readonly snapshot: FxRateSnapshot | null;
  readonly ageSeconds: number | null;
}

const NO_ATTEMPT: ProviderAttempt = { snapshot: null, ageSeconds: null };

/**
 * FX rate selection, in the one order that is financially safe:
 *
 *   1. primary   — healthy AND fresh (age < FX_STALE_THRESHOLD_SECONDS)
 *   2. secondary — when primary is unhealthy, unreachable or stale
 *   3. override  — an admin's manual rate, still within its TTL
 *   4. otherwise — throw StaleFxRateError; the quote is rejected
 *
 * Every observation a provider returns is persisted before it can be used, so
 * the FxRate table answers "which provider said what, when" months later. The
 * returned snapshot names the provider and the row id, which the Quote embeds.
 */
@Injectable()
export class FxAggregatorService {
  private readonly config: FxAggregatorConfig;
  private readonly clock: FxClock;

  constructor(
    @Inject(FX_PRIMARY_RATE_PROVIDER) private readonly primary: FxRateProvider,
    @Inject(FX_SECONDARY_RATE_PROVIDER) private readonly secondary: FxRateProvider,
    @Inject(FX_RATE_REPOSITORY) private readonly repository: FxRateRepository,
    @Inject(FX_AGGREGATOR_CONFIG) config: FxAggregatorConfig,
    @Optional() @Inject(FX_AUDIT_RECORDER) private readonly audit?: FxAuditRecorder,
    @Optional() @Inject(FX_CLOCK) clock?: FxClock,
  ) {
    if (
      !Number.isSafeInteger(config.staleThresholdSeconds) ||
      config.staleThresholdSeconds <= 0
    ) {
      throw new RangeError('FX stale threshold must be a positive safe integer');
    }
    this.config = config;
    this.clock = clock ?? systemClock;
  }

  /**
   * The snapshot a Quote stores. It records which provider and which persisted
   * FxRate row produced the price.
   */
  async getRateSnapshot(pair: FxPair): Promise<FxRateSnapshot> {
    const now = this.clock.now();
    let bestCandidateAge = this.config.staleThresholdSeconds;

    const primaryAttempt = await this.tryProvider(this.primary, pair, now);
    if (primaryAttempt.snapshot && !primaryAttempt.snapshot.isStale) {
      return primaryAttempt.snapshot;
    }
    if (primaryAttempt.ageSeconds !== null) {
      bestCandidateAge = Math.max(bestCandidateAge, primaryAttempt.ageSeconds);
    }

    const secondaryAttempt = await this.tryProvider(this.secondary, pair, now);
    if (secondaryAttempt.snapshot && !secondaryAttempt.snapshot.isStale) {
      return secondaryAttempt.snapshot;
    }
    if (secondaryAttempt.ageSeconds !== null) {
      bestCandidateAge = Math.max(bestCandidateAge, secondaryAttempt.ageSeconds);
    }

    const override = await this.repository.findActiveManualOverride(pair, now);
    if (override) {
      const snapshot = this.toSnapshot(override, now);
      // A repository that ignores the expiry filter must not slip an expired
      // override into a quote: the freshness check is repeated here.
      if (!snapshot.isStale) {
        return snapshot;
      }
      bestCandidateAge = Math.max(bestCandidateAge, snapshot.ageSeconds);
    }

    throw new StaleFxRateError(bestCandidateAge);
  }

  /** `GET /api/fx/current`: the selected rate plus safe health summaries. */
  async getCurrent(pair: FxPair): Promise<GetFxRateResponse> {
    const snapshot = await this.getRateSnapshot(pair);
    const providers = await this.getProviderHealth();
    return {
      snapshot,
      /*
       * The aggregator reports the observed market rate only. Spread and risk
       * buffer belong to the pricing engine (B1) — applying them here would put
       * two implementations of the same formula in the codebase.
       */
      effectiveRate: snapshot.midRate,
      providers: [...providers],
    };
  }

  /** `GET /api/fx/history`: newest first, manual rows included for audit. */
  async getHistory(pair: FxPair, page: number, pageSize: number): Promise<FxHistoryResult> {
    assertPagination(page, pageSize);
    const [records, total] = await Promise.all([
      this.repository.findHistory(pair, (page - 1) * pageSize, pageSize),
      this.repository.countHistory(pair),
    ]);
    const now = this.clock.now();
    return {
      items: records.map((record) => this.toSnapshot(record, now)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  /** Persist a time-bounded manual override and append an audit entry. */
  async setManualOverride(input: FxOverrideInput, actor: FxStaffActor): Promise<FxRateSnapshot> {
    validateOverrideInput(input);
    const now = this.clock.now();
    const reason = input.reason.trim();

    const record = await this.repository.createRate({
      pair: input.pair,
      buyRate: input.buyRate,
      sellRate: input.sellRate,
      midRate: input.midRate,
      source: 'MANUAL',
      provider: 'manual',
      receivedAt: now,
      effectiveAt: now,
      expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000),
      isManualOverride: true,
      overrideReason: reason,
      createdByStaffId: actor.id,
    });

    await this.audit?.record({
      actor: actor.id,
      actorType: 'STAFF',
      actorRole: actor.role,
      action: 'FX_RATE_OVERRIDE_CREATED',
      entity: 'FxRate',
      entityId: record.id,
      after: {
        pair: input.pair,
        provider: 'manual',
        source: 'MANUAL',
        buyRate: input.buyRate,
        sellRate: input.sellRate,
        midRate: input.midRate,
        ttlSeconds: input.ttlSeconds,
        expiresAt: record.expiresAt,
        reason,
      },
    });

    return this.toSnapshot(record, now);
  }

  /** Expire active overrides. A status change, never a delete. */
  async clearManualOverride(pair: FxPair, actor: FxStaffActor): Promise<{ expired: number }> {
    const now = this.clock.now();
    const expired = await this.repository.expireManualOverrides(pair, now);

    await this.audit?.record({
      actor: actor.id,
      actorType: 'STAFF',
      actorRole: actor.role,
      action: 'FX_RATE_OVERRIDE_CLEARED',
      entity: 'FxRate',
      entityId: pair,
      after: { pair, expired, clearedAt: now },
    });

    return { expired };
  }

  /** Health summaries are normalised; a raw provider error never escapes. */
  async getProviderHealth(): Promise<readonly FxProviderHealth[]> {
    return Promise.all([this.safeHealth(this.primary), this.safeHealth(this.secondary)]);
  }

  /**
   * Ask one provider for a rate and persist whatever it returned.
   *
   * A provider that is unhealthy, throws, or returns an unusable payload
   * contributes nothing: the caller moves to the next policy step. A provider
   * that answers with an old observation still gets persisted, and its age is
   * reported so the eventual error message says how stale the market data was.
   */
  private async tryProvider(
    provider: FxRateProvider,
    pair: FxPair,
    now: Date,
  ): Promise<ProviderAttempt> {
    let health: ProviderHealth;
    try {
      health = await provider.getHealth();
    } catch {
      return NO_ATTEMPT;
    }
    if (!health.isHealthy) {
      return NO_ATTEMPT;
    }

    let raw: RawFxRate;
    try {
      raw = await provider.getRate(pair);
    } catch {
      return NO_ATTEMPT;
    }

    if (!isUsableRate(raw, pair)) {
      return NO_ATTEMPT;
    }

    /*
     * Persistence is intentionally NOT inside the catch above. If the database
     * write fails, the error propagates and no unrecorded rate can price an
     * order — an unauditable price is worse than a rejected quote.
     */
    const record = await this.repository.createRate({
      pair: raw.pair,
      buyRate: raw.buyRate,
      sellRate: raw.sellRate,
      midRate: raw.midRate,
      source: raw.source,
      provider: provider.name,
      receivedAt: new Date(raw.receivedAt),
      effectiveAt: new Date(raw.effectiveAt),
      expiresAt: raw.expiresAt === null ? null : new Date(raw.expiresAt),
      isManualOverride: false,
    });

    const snapshot = this.toSnapshot(record, now);
    return { snapshot, ageSeconds: snapshot.ageSeconds };
  }

  private async safeHealth(provider: FxRateProvider): Promise<FxProviderHealth> {
    try {
      const health = await provider.getHealth();
      return {
        provider: health.provider || provider.name,
        isHealthy: health.isHealthy,
        lastSuccessAt: toIsoOrNull(health.lastSuccessAt),
        lastErrorAt: toIsoOrNull(health.lastErrorAt),
        lastErrorCode: health.lastErrorCode,
        consecutiveFailures: Math.max(0, health.consecutiveFailures),
      };
    } catch {
      return {
        provider: provider.name,
        isHealthy: false,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: 'HEALTH_CHECK_FAILED',
        consecutiveFailures: 0,
      };
    }
  }

  /**
   * Freshness rules:
   *   - a provider rate is stale once its age reaches the threshold;
   *   - any rate past its own `expiresAt` is stale;
   *   - a manual override is judged by its TTL alone, since pinning a rate is
   *     an explicit decision to keep using it for a stated period.
   */
  private toSnapshot(record: FxRateRecord, now: Date): FxRateSnapshot {
    const effectiveAt = toValidDate(record.effectiveAt, 'effectiveAt');
    const receivedAt = toValidDate(record.receivedAt, 'receivedAt');
    const expiresAt = record.expiresAt === null ? null : toValidDate(record.expiresAt, 'expiresAt');

    const ageMs = Math.max(0, now.getTime() - effectiveAt.getTime());
    const ageSeconds = Math.floor(ageMs / 1_000);
    const expired = expiresAt !== null && now.getTime() >= expiresAt.getTime();
    const isStale = record.isManualOverride
      ? expiresAt === null || expired
      : expired || ageMs >= this.config.staleThresholdSeconds * 1_000;

    return {
      id: record.id,
      pair: record.pair,
      buyRate: toRateString(record.buyRate, 'buyRate'),
      sellRate: toRateString(record.sellRate, 'sellRate'),
      midRate: toRateString(record.midRate, 'midRate'),
      provider: record.provider,
      source: record.source,
      receivedAt: receivedAt.toISOString(),
      effectiveAt: effectiveAt.toISOString(),
      expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
      isManualOverride: record.isManualOverride,
      overrideReason: record.overrideReason,
      ageSeconds,
      isStale,
    };
  }
}

/** A provider payload we cannot trust is discarded, not repaired. */
function isUsableRate(raw: RawFxRate, pair: FxPair): boolean {
  if (raw.pair !== pair) {
    return false;
  }
  if (typeof raw.source !== 'string' || raw.source.trim() === '') {
    return false;
  }
  if (!isRateString(raw.buyRate) || !isRateString(raw.sellRate) || !isRateString(raw.midRate)) {
    return false;
  }
  if (!isValidDate(raw.receivedAt) || !isValidDate(raw.effectiveAt)) {
    return false;
  }
  if (raw.expiresAt !== null && !isValidDate(raw.expiresAt)) {
    return false;
  }
  return true;
}

function validateOverrideInput(input: FxOverrideInput): void {
  const issues: Array<{ path: string; message: string }> = [];

  for (const field of ['buyRate', 'sellRate', 'midRate'] as const) {
    if (!isRateString(input[field])) {
      issues.push({ path: field, message: 'FX rate must be a positive fixed-point decimal string' });
    }
  }
  if (
    !Number.isSafeInteger(input.ttlSeconds) ||
    input.ttlSeconds < 1 ||
    input.ttlSeconds > MAX_OVERRIDE_TTL_SECONDS
  ) {
    issues.push({
      path: 'ttlSeconds',
      message: `TTL must be an integer between 1 and ${MAX_OVERRIDE_TTL_SECONDS} seconds`,
    });
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3 || reason.length > 500) {
    issues.push({ path: 'reason', message: 'A reason between 3 and 500 characters is required' });
  }

  if (issues.length > 0) {
    throw DomainErrors.validation(issues);
  }
}

function isRateString(value: unknown): value is string {
  return typeof value === 'string' && fxRateStringSchema.safeParse(value).success;
}

/**
 * Prisma hands back a `Decimal` runtime object; its string form is the
 * canonical value. Parsing through the contract schema is what produces the
 * branded `DecimalString`, so an unvalidated string can never reach a Quote.
 */
function toRateString(value: unknown, field: string): DecimalString {
  const candidate = typeof value === 'string' ? value : String(value);
  const parsed = fxRateStringSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Persisted FX ${field} is not a usable positive decimal`);
  }
  return parsed.data;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toValidDate(value: Date, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Persisted FX ${field} is not a valid timestamp`);
  }
  return date;
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : toValidDate(value, 'health timestamp').toISOString();
}

function assertPagination(page: number, pageSize: number): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw DomainErrors.validation([
      { path: 'pagination', message: 'page must be >= 1 and pageSize between 1 and 100' },
    ]);
  }
}
