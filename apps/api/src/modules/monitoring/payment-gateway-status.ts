import type { ProviderStatus } from './monitoring.service';

/**
 * Payment gateway status, derived from our own `PaymentAttempt` rows.
 *
 * Gateways are NEVER probed: a synthetic payment request against a live
 * gateway is a real session with real side effects. Instead this reads what
 * our server already experienced when it called the gateway.
 *
 * Only the calls WE make count — `REQUEST` (open a session) and `VERIFY`
 * (server-side verification). `REDIRECT` and `CALLBACK` are driven by the
 * customer's browser and say nothing about whether the gateway is reachable.
 *
 * Only transport failures count against the gateway — `TIMEOUT` and
 * `NETWORK_ERROR`. A `FAILED` attempt means the gateway answered (a declined
 * card, a cancelled payment): the gateway is up, the payment is not.
 */

/** How far back the status looks. */
export const PAYMENT_WINDOW_MINUTES = 60;

/** Transport failure share at or above which a gateway is DEGRADED. */
const DEGRADED_FAILURE_RATIO = 0.2;
/** Calls needed before a ratio means anything. */
const MIN_CALLS_FOR_RATIO = 5;
/** Consecutive newest transport failures (no success since) that mean OFFLINE. */
const OFFLINE_AFTER_CONSECUTIVE = 3;

export const GATEWAY_ACTIONS = ['REQUEST', 'VERIFY'] as const;
const CONNECTION_FAILURES = new Set(['TIMEOUT', 'NETWORK_ERROR']);

export interface PaymentAttemptRow {
  readonly status: string;
  readonly createdAt: Date;
  readonly payment: { readonly provider: string };
}

export interface PaymentGatewaySnapshot {
  provider: string;
  status: ProviderStatus;
  windowMinutes: number;
  calls: number;
  okCalls: number;
  /** Gateway answered with a refusal. Not an outage. */
  declinedCalls: number;
  /** Timeout or network error: the gateway did not answer. */
  connectionFailures: number;
  lastOkAt: string | null;
  lastConnectionFailureAt: string | null;
}

/**
 * Group attempts by gateway and judge each one.
 *
 * A gateway with no traffic in the window does not appear at all: a quiet
 * night is not an outage, and inventing a status for it would be a guess.
 */
export function derivePaymentGatewayStatus(
  rows: readonly PaymentAttemptRow[],
): PaymentGatewaySnapshot[] {
  const byProvider = new Map<string, PaymentAttemptRow[]>();
  for (const row of rows) {
    const list = byProvider.get(row.payment.provider) ?? [];
    list.push(row);
    byProvider.set(row.payment.provider, list);
  }

  return [...byProvider.entries()]
    .map(([provider, attempts]) => judge(provider, attempts))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function judge(provider: string, attempts: PaymentAttemptRow[]): PaymentGatewaySnapshot {
  const newestFirst = [...attempts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  let okCalls = 0;
  let declinedCalls = 0;
  let connectionFailures = 0;
  let lastOkAt: Date | null = null;
  let lastConnectionFailureAt: Date | null = null;

  for (const attempt of newestFirst) {
    if (CONNECTION_FAILURES.has(attempt.status)) {
      connectionFailures += 1;
      lastConnectionFailureAt ??= attempt.createdAt;
    } else if (attempt.status === 'OK') {
      okCalls += 1;
      lastOkAt ??= attempt.createdAt;
    } else {
      declinedCalls += 1;
    }
  }

  let leadingFailures = 0;
  for (const attempt of newestFirst) {
    if (!CONNECTION_FAILURES.has(attempt.status)) break;
    leadingFailures += 1;
  }

  const calls = newestFirst.length;
  let status: ProviderStatus = 'HEALTHY';
  if (leadingFailures >= OFFLINE_AFTER_CONSECUTIVE) {
    status = 'OFFLINE';
  } else if (calls >= MIN_CALLS_FOR_RATIO && connectionFailures / calls >= DEGRADED_FAILURE_RATIO) {
    status = 'DEGRADED';
  }

  return {
    provider,
    status,
    windowMinutes: PAYMENT_WINDOW_MINUTES,
    calls,
    okCalls,
    declinedCalls,
    connectionFailures,
    lastOkAt: lastOkAt?.toISOString() ?? null,
    lastConnectionFailureAt: lastConnectionFailureAt?.toISOString() ?? null,
  };
}
