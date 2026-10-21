/**
 * Alert redaction — same intent as the request logger, plus alert-specific fields.
 *
 * AGENTS.md rule 10 applies here too: no amount, code, token, credential, or
 * any field that could identify a customer or transaction ever reaches a channel.
 *
 * Keys are compared after normalisation (lower case, separators removed), so
 * `accessToken`, `access_token` and `ACCESS-TOKEN` are the same key. Arrays are
 * walked, so a list of objects is redacted element by element.
 */

/**
 * A key is redacted when its normalised form ENDS with one of these: `token`
 * catches `accessToken` and `refreshToken`, `amount` catches `totalAmount`,
 * `irr` catches `finalAmountIrr`.
 */
export const ALERT_REDACT_SUFFIXES: readonly string[] = [
  /* --- financial ------------------------------------------------ */
  'amount',
  'irr',
  'toman',
  'usd',
  'fee',
  'price',
  'cost',

  /* --- secrets ------------------------------------------------- */
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwordhash',
  'apikey',
  'credential',
  'credentials',
  'privatekey',
  'authorization',
  'cookie',
  'merchantid',
  'authority',
  'callbackurl',
  'otp',
  'otpcode',
  'pin',
  'pincode',
  'giftcardcode',
  'encryptedcode',
  'encryptedpin',
  'vouchercode',
  'redeemcode',
  'redemptioncode',
  'activationcode',
  'cardnumber',
  'pan',
  'cvv',
  'iban',
  'ibanencrypted',
  'cardencrypted',

  /* --- customer identity --------------------------------------- */
  'customerid',
  'phonenumber',
  'mobile',
  'email',
  'nationalid',
];

/**
 * Keys redacted only on an EXACT normalised match. `code` alone is a gift-card
 * code, but `errorCode` and `supplierCode` are what makes an alert useful, so
 * `code` cannot be a suffix. Likewise a bare `rate` is an FX rate while
 * `errorRate` is a health metric.
 */
export const ALERT_REDACT_EXACT: readonly string[] = ['code', 'codes', 'rate'];

const REDACTED = '[REDACTED]';

/**
 * Redact a context object before sending to a channel.
 *
 * Returns a new object with redacted values replaced by '[REDACTED]'.
 * Does not mutate the original.
 */
export function redactAlertContext(
  context: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (context === null || context === undefined) return null;
  return redactObject(context);
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = shouldRedact(key) ? REDACTED : redactValue(entry);
  }
  return result;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function normalise(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

export function shouldRedact(key: string): boolean {
  const normalised = normalise(key);
  if (ALERT_REDACT_EXACT.includes(normalised)) return true;
  return ALERT_REDACT_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}
