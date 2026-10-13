/**
 * BazaarPay wiring inputs.
 *
 * GAP: `apps/api/src/common/config/env.schema.ts` is frozen (Foundation-owned)
 * and declares none of the `BAZAARPAY_*` variables. They are read here, in one
 * file, so the Foundation agent can lift them into the validated schema in a
 * single pass.
 *
 * `BAZAARPAY_API_TOKEN` is a secret. It is read into a value object and handed
 * straight to the adapter's constructor; nothing here logs, echoes or re-exports
 * it, and no error message quotes it.
 *
 * Turning the gateway on is a human release gate (AGENTS.md section 4): the
 * adapter is only registered when `BAZAARPAY_ENABLED` is explicitly `true`,
 * never because a token happens to be present.
 */
import type { PaymentAmountUnit } from '@barat/contracts';

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface BazaarPayEnv {
  readonly enabled: boolean;
  readonly apiToken: string;
  readonly destination: string;
  readonly baseUrl: string | undefined;
  readonly amountUnit: PaymentAmountUnit;
  readonly timeoutMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readBazaarPayEnv(env: Env = process.env): BazaarPayEnv {
  const flag = (env['BAZAARPAY_ENABLED'] ?? '').trim().toLowerCase();
  if (flag !== '' && flag !== 'true' && flag !== 'false') {
    throw new Error('BAZAARPAY_ENABLED must be "true" or "false"');
  }
  const enabled = flag === 'true';

  const unit = (env['BAZAARPAY_AMOUNT_UNIT'] ?? 'IRR').trim().toUpperCase();
  if (unit !== 'IRR' && unit !== 'IRT') {
    throw new Error('BAZAARPAY_AMOUNT_UNIT must be IRR or IRT');
  }

  const rawTimeout = (env['BAZAARPAY_TIMEOUT_MS'] ?? '').trim();
  const timeoutMs = rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`BAZAARPAY_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }

  const apiToken = (env['BAZAARPAY_API_TOKEN'] ?? '').trim();
  const destination = (env['BAZAARPAY_DESTINATION'] ?? '').trim();
  if (enabled) {
    if (apiToken === '') throw new Error('BAZAARPAY_API_TOKEN is required when BAZAARPAY_ENABLED is true');
    if (destination === '') throw new Error('BAZAARPAY_DESTINATION is required when BAZAARPAY_ENABLED is true');
  }

  const baseUrl = (env['BAZAARPAY_BASE_URL'] ?? '').trim();
  return {
    enabled,
    apiToken,
    destination,
    baseUrl: baseUrl === '' ? undefined : baseUrl,
    amountUnit: unit,
    timeoutMs,
  };
}
