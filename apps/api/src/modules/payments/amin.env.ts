/**
 * Amin wiring inputs.
 *
 * GAP: `apps/api/src/common/config/env.schema.ts` is frozen (Foundation-owned)
 * and declares none of the `AMIN_*` variables. They are read here, in one file,
 * exactly as `bazaarpay.env.ts` does, so the Foundation agent can lift them into
 * the validated schema in a single pass.
 *
 * `AMIN_MERCHANT_ID` is the gateway identifier from the Amin user profile. It is
 * the only credential the API documents, so it is treated as a secret: read into
 * a value object, handed to the adapter's constructor and nowhere else, and never
 * logged or quoted in an error.
 *
 * Turning the gateway on is a human release gate (AGENTS.md section 4): the
 * adapter is only registered when `AMIN_ENABLED` is explicitly `true`, never
 * because an identifier happens to be present.
 */
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface AminEnv {
  readonly enabled: boolean;
  readonly merchantId: string;
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readAminEnv(env: Env = process.env): AminEnv {
  const flag = (env['AMIN_ENABLED'] ?? '').trim().toLowerCase();
  if (flag !== '' && flag !== 'true' && flag !== 'false') {
    throw new Error('AMIN_ENABLED must be "true" or "false"');
  }
  const enabled = flag === 'true';

  const rawTimeout = (env['AMIN_TIMEOUT_MS'] ?? '').trim();
  const timeoutMs = rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`AMIN_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }

  const merchantId = (env['AMIN_MERCHANT_ID'] ?? '').trim();
  if (enabled && merchantId === '') {
    throw new Error('AMIN_MERCHANT_ID is required when AMIN_ENABLED is true');
  }

  const baseUrl = (env['AMIN_BASE_URL'] ?? '').trim();
  return { enabled, merchantId, baseUrl: baseUrl === '' ? undefined : baseUrl, timeoutMs };
}
