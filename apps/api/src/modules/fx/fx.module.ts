import { Module } from '@nestjs/common';
import {
  createPrimaryFxRateProvider,
  createSecondaryFxRateProvider,
  FX_PRIMARY_RATE_PROVIDER,
  FX_SECONDARY_RATE_PROVIDER,
  type FxProviderKind,
  type FxRateProvider,
} from '@barat/fx';

import { AppConfigModule, AppConfigService } from '../../common/config';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { FxAggregatorService } from './fx-aggregator.service';
import { FxRateRefresherService } from './fx-rate-refresher.service';
import { PrismaFxRateRepository } from './fx-rate.repository';
import { FxController } from './fx.controller';
import { readFxProviderEnv, type FxVenue } from './fx.env';
import {
  FX_AGGREGATOR_CONFIG,
  FX_AUDIT_RECORDER,
  FX_RATE_REPOSITORY,
  FX_REFRESH_CONFIG,
  type FxAggregatorConfig,
  type FxRefreshConfig,
} from './fx.types';

/**
 * The pairs the background refresher keeps current.
 *
 * `packages/contracts` is frozen and defines exactly one pair today, so this
 * list is the whole market. It is written out rather than derived so that
 * adding a pair to the contract does not silently start polling a venue that
 * has no market for it.
 */
const REFRESHED_PAIRS = ['USD_IRR'] as const;

/**
 * Pick the adapter kind for one provider position.
 *
 * The deterministic mock is a development and test convenience and is refused
 * in production even when the environment asks for it: a mocked FX rate in
 * production is a direct financial loss, not a degraded experience.
 *
 * With no endpoint configured in production the HTTP adapter is still used. It
 * reports `NOT_CONFIGURED`, the aggregator finds no fresh rate, and quoting is
 * rejected — which is exactly the intended behaviour.
 */
function resolveKind(
  endpoint: string | undefined,
  venue: FxVenue | undefined,
  forceMock: boolean,
  isProduction: boolean,
): FxProviderKind {
  if (forceMock) {
    if (isProduction) {
      throw new Error('FX_USE_MOCK_PROVIDERS must never be enabled in production');
    }
    return 'mock';
  }
  /* A named venue wins over a bare endpoint: it is the more specific answer. */
  if (venue) {
    return venue;
  }
  if (endpoint) {
    return 'http';
  }
  return isProduction ? 'http' : 'mock';
}

@Module({
  imports: [AppConfigModule, AuditModule],
  controllers: [FxController],
  providers: [
    {
      provide: FX_AGGREGATOR_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FxAggregatorConfig => ({
        staleThresholdSeconds: config.fxStaleThresholdSeconds,
      }),
    },
    {
      provide: FX_PRIMARY_RATE_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FxRateProvider => {
        const env = readFxProviderEnv();
        return createPrimaryFxRateProvider({
          kind: resolveKind(env.primaryUrl, env.primaryVenue, env.forceMock, config.isProduction),
          ...(env.primaryUrl === undefined ? {} : { endpoint: env.primaryUrl }),
          ...(env.nobitexBaseUrl === undefined ? {} : { nobitexBaseUrl: env.nobitexBaseUrl }),
          timeoutMs: env.timeoutMs,
        });
      },
    },
    {
      provide: FX_SECONDARY_RATE_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FxRateProvider => {
        const env = readFxProviderEnv();
        return createSecondaryFxRateProvider({
          kind: resolveKind(env.secondaryUrl, env.secondaryVenue, env.forceMock, config.isProduction),
          ...(env.secondaryUrl === undefined ? {} : { endpoint: env.secondaryUrl }),
          ...(env.nobitexBaseUrl === undefined ? {} : { nobitexBaseUrl: env.nobitexBaseUrl }),
          timeoutMs: env.timeoutMs,
          /* A different deterministic drift makes a local failover visible. */
          mock: { jitterSequenceBps: [3, 2, 4, 1, 5] },
        });
      },
    },
    {
      provide: FX_REFRESH_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FxRefreshConfig => {
        const env = readFxProviderEnv();
        return {
          /*
           * Never under test: a live timer would let one test's HTTP call land
           * in the middle of another's assertions.
           */
          enabled: env.autoRefresh && !config.isTest,
          intervalMs: env.refreshIntervalSeconds * 1_000,
          staleThresholdMs: config.fxStaleThresholdSeconds * 1_000,
          pairs: REFRESHED_PAIRS,
        };
      },
    },
    { provide: FX_RATE_REPOSITORY, useClass: PrismaFxRateRepository },
    /* The aggregator depends on the narrow port so its tests need no database. */
    { provide: FX_AUDIT_RECORDER, useExisting: AuditService },
    FxAggregatorService,
    FxRateRefresherService,
  ],
  exports: [FxAggregatorService, FX_RATE_REPOSITORY],
})
export class FxModule {}
