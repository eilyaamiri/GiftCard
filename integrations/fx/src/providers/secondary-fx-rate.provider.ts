import {
  HttpFxRateProvider,
  type HttpFxRateProviderOptions,
} from './http-fx-rate.provider';

/**
 * Provider-neutral secondary HTTP placeholder. It is intentionally unusable
 * until `FX_SECONDARY_URL` (or an explicit endpoint) is configured.
 */
export class SecondaryFxRateProvider extends HttpFxRateProvider {
  constructor(options: Omit<HttpFxRateProviderOptions, 'name'> = {}) {
    super({ ...options, name: 'secondary' });
  }
}
