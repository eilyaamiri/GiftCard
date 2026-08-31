/**
 * @barat/payments — provider-neutral rial payment contract and adapters.
 *
 * Domain code injects `RIAL_PAYMENT_PROVIDER`; it does not import a provider
 * implementation path. Concrete exports are available here for the composition
 * root and isolated adapter tests only.
 */
export * from './rial-payment-provider.interface';
export {
  MockRialPaymentProvider,
  type MockCreateOutcome,
  type MockRialPaymentProviderOptions,
  type MockVerifyOutcome,
} from './providers/mock-rial-payment.provider';
export {
  DEFAULT_ZARINPAL_REQUEST_URL,
  DEFAULT_ZARINPAL_STARTPAY_URL,
  DEFAULT_ZARINPAL_TIMEOUT_MS,
  DEFAULT_ZARINPAL_VERIFY_URL,
  FetchPaymentHttpClient,
  normalizeZarinPalFailure,
  toZarinPalAmount,
  ZarinPalPaymentProvider,
  type PaymentHttpClient,
  type PaymentHttpResponse,
  type ZarinPalPaymentProviderConfig,
} from './providers/zarinpal/zarinpal-payment.provider';

/** DI token for the selected provider. */
export const RIAL_PAYMENT_PROVIDER = Symbol.for('BARAT_RIAL_PAYMENT_PROVIDER');
