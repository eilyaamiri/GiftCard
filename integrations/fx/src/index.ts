/**
 * @barat/fx — FX provider contracts plus the composition seam.
 *
 * Domain modules consume the `FxRateProvider` interface, the DI tokens and the
 * factory below. Concrete adapters live in `src/providers/` and must never be
 * imported from a domain module (AGENTS.md rules 5-7, enforced by ESLint).
 */

export * from './fx-rate-provider.interface';
export {
  createPrimaryFxRateProvider,
  createSecondaryFxRateProvider,
  type FxProviderFactoryOptions,
  type FxProviderKind,
} from './provider-factory';
export type { HttpFxRateProviderOptions } from './providers/http-fx-rate.provider';
export type { MockFxRateProviderOptions } from './providers/mock-fx-rate.provider';
export type { NobitexFxRateProviderOptions } from './providers/nobitex-fx-rate.provider';
