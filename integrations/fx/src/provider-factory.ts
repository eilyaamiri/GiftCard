import type { FxRateProvider } from './fx-rate-provider.interface';
import { MockFxRateProvider, type MockFxRateProviderOptions } from './providers/mock-fx-rate.provider';
import { NobitexFxRateProvider } from './providers/nobitex-fx-rate.provider';
import { PrimaryFxRateProvider } from './providers/primary-fx-rate.provider';
import { SecondaryFxRateProvider } from './providers/secondary-fx-rate.provider';

export type FxProviderKind = 'http' | 'mock' | 'nobitex';

export interface FxProviderFactoryOptions {
  readonly kind: FxProviderKind;
  /** HTTP endpoint; when omitted the adapter falls back to its env variable. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  /** Only read when `kind` is `mock`. */
  readonly mock?: Omit<MockFxRateProviderOptions, 'name'>;
  /** Only read when `kind` is `nobitex`; the adapter has a working default. */
  readonly nobitexBaseUrl?: string;
}

/**
 * Nobitex reads a public market endpoint and needs no endpoint configuration.
 *
 * The name pairs the position with the venue — `primary-nobitex` — which is the
 * form `FxRate.provider` documents. Health reporting and every persisted row
 * then say both which slot answered and which exchange it read.
 */
function nobitex(options: FxProviderFactoryOptions, position: string): FxRateProvider {
  return new NobitexFxRateProvider({
    name: `${position}-nobitex`,
    ...(options.nobitexBaseUrl === undefined ? {} : { baseUrl: options.nobitexBaseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
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
  if (options.kind === 'nobitex') {
    return nobitex(options, 'primary');
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
  if (options.kind === 'nobitex') {
    return nobitex(options, 'secondary');
  }
  return new SecondaryFxRateProvider({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}
