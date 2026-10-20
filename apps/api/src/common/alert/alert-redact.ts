/**
 * Alert redaction — same paths as the request logger, plus alert-specific fields.
 *
 * AGENTS.md rule 10 applies here too: no amount, code, token, credential, or
 * any field that could identify a customer or transaction ever reaches a channel.
 */

export const ALERT_REDACT_PATHS: string[] = [
  /* --- financial ------------------------------------------------ */
  'amount',
  'amountIrr',
  'amountToman',
  'totalAmountIrr',
  'fee',
  'price',
  'cost',
  'rate',

  /* --- secrets ------------------------------------------------- */
  'code',
  'pin',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'password',
  'credential',
  'merchantId',
  'merchant_id',
  'authority',
  'callbackUrl',

  /* --- customer identity --------------------------------------- */
  'customerId',
  'phoneNumber',
  'email',
  'nationalId',

  /* --- nested -------------------------------------------------- */
  '*.amount',
  '*.amountIrr',
  '*.code',
  '*.pin',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.merchantId',
  '*.customerId',
];

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

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    if (shouldRedact(key)) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactAlertContext(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function shouldRedact(key: string): boolean {
  return ALERT_REDACT_PATHS.some((path) => {
    if (path.startsWith('*.')) {
      return key.endsWith(path.slice(1));
    }
    return key === path;
  });
}
