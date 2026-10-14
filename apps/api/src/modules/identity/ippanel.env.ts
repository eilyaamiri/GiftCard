/**
 * IPPanel SMS wiring inputs.
 *
 * GAP: `apps/api/src/common/config/env.schema.ts` is frozen (Foundation-owned)
 * and declares none of the `IPPANEL_*` variables. They are read here, in one
 * file, so the Foundation agent can lift them into the validated schema in a
 * single pass.
 *
 * `IPPANEL_API_KEY` is a secret. It is read into a value object and handed
 * straight to the adapter's constructor; nothing here logs, echoes or re-exports
 * it, and no error message quotes it.
 *
 * Turning this provider on is a human release gate (AGENTS.md section 4, OTP is
 * explicitly listed): the adapter is only registered when `IPPANEL_ENABLED` is
 * explicitly `true`, never because a key happens to be present.
 */
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface IppanelEnv {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly patternCode: string;
  readonly fromNumber: string;
  readonly patternCodeParam: string;
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readIppanelEnv(env: Env = process.env): IppanelEnv {
  const flag = (env['IPPANEL_ENABLED'] ?? '').trim().toLowerCase();
  if (flag !== '' && flag !== 'true' && flag !== 'false') {
    throw new Error('IPPANEL_ENABLED must be "true" or "false"');
  }
  const enabled = flag === 'true';

  const rawTimeout = (env['IPPANEL_TIMEOUT_MS'] ?? '').trim();
  const timeoutMs = rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`IPPANEL_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }

  const apiKey = (env['IPPANEL_API_KEY'] ?? '').trim();
  const patternCode = (env['IPPANEL_PATTERN_CODE'] ?? '').trim();
  const fromNumber = (env['IPPANEL_FROM_NUMBER'] ?? '').trim();
  if (enabled) {
    if (apiKey === '') throw new Error('IPPANEL_API_KEY is required when IPPANEL_ENABLED is true');
    if (patternCode === '') throw new Error('IPPANEL_PATTERN_CODE is required when IPPANEL_ENABLED is true');
    if (fromNumber === '') throw new Error('IPPANEL_FROM_NUMBER is required when IPPANEL_ENABLED is true');
  }

  const patternCodeParam = (env['IPPANEL_PATTERN_CODE_PARAM'] ?? '').trim() || 'code';
  const baseUrl = (env['IPPANEL_BASE_URL'] ?? '').trim();
  return {
    enabled,
    apiKey,
    patternCode,
    fromNumber,
    patternCodeParam,
    baseUrl: baseUrl === '' ? undefined : baseUrl,
    timeoutMs,
  };
}
