import type { FxPair, FxRateSnapshot } from '@barat/contracts';

/** DI tokens owned by the FX module. */
export const FX_RATE_REPOSITORY = 'BARAT_FX_RATE_REPOSITORY';
export const FX_AGGREGATOR_CONFIG = 'BARAT_FX_AGGREGATOR_CONFIG';
export const FX_CLOCK = 'BARAT_FX_CLOCK';
export const FX_AUDIT_RECORDER = 'BARAT_FX_AUDIT_RECORDER';
export const FX_REFRESH_CONFIG = 'BARAT_FX_REFRESH_CONFIG';

/**
 * The slice of the shared audit service that FX needs.
 *
 * The aggregator depends on this port rather than on `AuditService` directly:
 * that class pulls in the Prisma client at import time, which would drag a live
 * database into every unit test of the rate-selection policy. `fx.module.ts`
 * binds this token to the real `AuditService`.
 */
export interface FxAuditEntry {
  readonly actor: string;
  readonly actorType?: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'ANONYMOUS';
  readonly actorRole?: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface FxAuditRecorder {
  record(input: FxAuditEntry): Promise<void>;
}

export interface FxAggregatorConfig {
  /** Mirrors `FX_STALE_THRESHOLD_SECONDS`; a rate older than this is unusable. */
  readonly staleThresholdSeconds: number;
}

/** Inputs for the background poller that keeps the market rate current. */
export interface FxRefreshConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
  /**
   * The same window the aggregator judges staleness by. Polling slower than
   * this would leave the automatic rate unusable for part of every cycle, so
   * the refresher refuses to start with such a configuration.
   */
  readonly staleThresholdMs: number;
  readonly pairs: readonly FxPair[];
}

/** What one polling cycle achieved; returned so tests can assert on it. */
export interface FxRefreshOutcome {
  readonly refreshed: readonly FxPair[];
  readonly failed: readonly FxPair[];
  /** True when a previous cycle was still running and this one stood down. */
  readonly skipped: boolean;
}

export interface FxRateCreateData {
  readonly pair: FxPair;
  readonly buyRate: string;
  readonly sellRate: string;
  readonly midRate: string;
  readonly source: string;
  readonly provider: string;
  readonly receivedAt: Date;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly isManualOverride: boolean;
  readonly overrideReason?: string | null;
  readonly createdByStaffId?: string | null;
}

/**
 * The persisted row as the aggregator needs it.
 *
 * The rate columns are `unknown` because Prisma returns a `Decimal` runtime
 * object, not a string. Converting it is the aggregator's job and it validates
 * the result before the value can reach a quote.
 */
export interface FxRateRecord {
  readonly id: string;
  readonly pair: FxPair;
  readonly buyRate: unknown;
  readonly sellRate: unknown;
  readonly midRate: unknown;
  readonly source: string;
  readonly provider: string;
  readonly receivedAt: Date;
  readonly effectiveAt: Date;
  readonly expiresAt: Date | null;
  readonly isManualOverride: boolean;
  readonly overrideReason: string | null;
}

/** Domain-shaped persistence port. It keeps Prisma out of the selection policy. */
export interface FxRateRepository {
  createRate(data: FxRateCreateData): Promise<FxRateRecord>;
  findActiveManualOverride(pair: FxPair, now: Date): Promise<FxRateRecord | null>;
  findHistory(pair: FxPair, skip: number, take: number): Promise<readonly FxRateRecord[]>;
  countHistory(pair: FxPair): Promise<number>;
  expireManualOverrides(pair: FxPair, now: Date): Promise<number>;
}

/** Actor information comes from the authenticated session, never the body. */
export interface FxStaffActor {
  readonly id: string;
  readonly role: string;
}

export interface FxOverrideInput {
  readonly pair: FxPair;
  readonly buyRate: string;
  readonly sellRate: string;
  readonly midRate: string;
  readonly reason: string;
  readonly ttlSeconds: number;
}

export interface FxHistoryResult {
  readonly items: readonly FxRateSnapshot[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export interface FxClock {
  now(): Date;
}
