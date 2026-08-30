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
import { PrismaFxRateRepository } from './fx-rate.repository';
import { FxController } from './fx.controller';
import { readFxProviderEnv } from './fx.env';
import {
  FX_AGGREGATOR_CONFIG,
  FX_AUDIT_RECORDER,
  FX_RATE_REPOSITORY,
  type FxAggregatorConfig,
} from './fx.types';

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
  forceMock: boolean,
  isProduction: boolean,
): FxProviderKind {
  if (forceMock) {
    if (isProduction) {
      throw new Error('FX_USE_MOCK_PROVIDERS must never be enabled in production');
    }
    return 'mock';
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
          kind: resolveKind(env.primaryUrl, env.forceMock, config.isProduction),
          ...(env.primaryUrl === undefined ? {} : { endpoint: env.primaryUrl }),
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
          kind: resolveKind(env.secondaryUrl, env.forceMock, config.isProduction),
          ...(env.secondaryUrl === undefined ? {} : { endpoint: env.secondaryUrl }),
          timeoutMs: env.timeoutMs,
          /* A different deterministic drift makes a local failover visible. */
          mock: { jitterSequenceBps: [3, 2, 4, 1, 5] },
        });
      },
    },
    { provide: FX_RATE_REPOSITORY, useClass: PrismaFxRateRepository },
    /* The aggregator depends on the narrow port so its tests need no database. */
    { provide: FX_AUDIT_RECORDER, useExisting: AuditService },
    FxAggregatorService,
  ],
  exports: [FxAggregatorService, FX_RATE_REPOSITORY],
})
export class FxModule {}
