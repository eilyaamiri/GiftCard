import type { FxRateProvider } from './fx-rate-provider.interface';
import { MockFxRateProvider, type MockFxRateProviderOptions } from './providers/mock-fx-rate.provider';
import { PrimaryFxRateProvider } from './providers/primary-fx-rate.provider';
import { SecondaryFxRateProvider } from './providers/secondary-fx-rate.provider';

export type FxProviderKind = 'http' | 'mock';

export interface FxProviderFactoryOptions {
  readonly kind: FxProviderKind;
  /** HTTP endpoint; when omitted the adapter falls back to its env variable. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  /** Only read when `kind` is `mock`. */
  readonly mock?: Omit<MockFxRateProviderOptions, 'name'>;
}

/**
 * The composition seam.
 *
 * The API's FX module asks for a *position* (primary or secondary) and a kind,
 * and never names a concrete adapter class. That keeps AGENTS.md rules 5-7
 * intact: the domain depends on the `FxRateProvider` interface only.
 */
export function createPrimaryFxRateProvider(options: FxProviderFactoryOptions): FxRateProvider {
  if (options.kind === 'mock') {
    return new MockFxRateProvider({ ...options.mock, name: 'mock-primary' });
  }
  return new PrimaryFxRateProvider({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

export function createSecondaryFxRateProvider(options: FxProviderFactoryOptions): FxRateProvider {
  if (options.kind === 'mock') {
    return new MockFxRateProvider({ ...options.mock, name: 'mock-secondary' });
  }
  return new SecondaryFxRateProvider({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
