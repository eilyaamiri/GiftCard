import {
  HttpFxRateProvider,
  type HttpFxRateProviderOptions,
} from './http-fx-rate.provider';

/**
 * Provider-neutral primary HTTP placeholder. It is intentionally unusable until
 * `FX_PRIMARY_URL` (or an explicit endpoint) is configured.
 */
export class PrimaryFxRateProvider extends HttpFxRateProvider {
  constructor(options: Omit<HttpFxRateProviderOptions, 'name'> = {}) {
    super({ ...options, name: 'primary' });
  }
}
