import { describe, expect, it } from 'vitest';

import { derivePaymentGatewayStatus, type PaymentAttemptRow } from './payment-gateway-status';

const NOW = new Date('2026-10-20T12:00:00Z').getTime();

function row(provider: string, status: string, minutesAgo: number): PaymentAttemptRow {
  return { status, createdAt: new Date(NOW - minutesAgo * 60_000), payment: { provider } };
}

describe('derivePaymentGatewayStatus', () => {
  it('lists nothing for a gateway with no traffic — a quiet hour is not an outage', () => {
    expect(derivePaymentGatewayStatus([])).toEqual([]);
  });

  it('is HEALTHY when calls succeed', () => {
    const [gateway] = derivePaymentGatewayStatus([row('zarinpal', 'OK', 5), row('zarinpal', 'OK', 1)]);
    expect(gateway).toMatchObject({ provider: 'zarinpal', status: 'HEALTHY', calls: 2, okCalls: 2 });
  });

  it('does not count a declined payment against the gateway', () => {
    const rows = ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'FAILED'].map((s, i) => row('zarinpal', s, i));
    const [gateway] = derivePaymentGatewayStatus(rows);
    expect(gateway).toMatchObject({ status: 'HEALTHY', declinedCalls: 5, connectionFailures: 0 });
  });

  it('is OFFLINE after three newest calls all timed out or failed to connect', () => {
    const [gateway] = derivePaymentGatewayStatus([
      row('zarinpal', 'OK', 30),
      row('zarinpal', 'TIMEOUT', 3),
      row('zarinpal', 'NETWORK_ERROR', 2),
      row('zarinpal', 'TIMEOUT', 1),
    ]);
    expect(gateway?.status).toBe('OFFLINE');
    expect(gateway?.lastOkAt).toBe(new Date(NOW - 30 * 60_000).toISOString());
  });

  it('is not OFFLINE once a call succeeds after the failures', () => {
    const [gateway] = derivePaymentGatewayStatus([
      row('zarinpal', 'TIMEOUT', 4),
      row('zarinpal', 'TIMEOUT', 3),
      row('zarinpal', 'TIMEOUT', 2),
      row('zarinpal', 'OK', 1),
    ]);
    expect(gateway?.status).not.toBe('OFFLINE');
  });

  it('is DEGRADED at a 20% connection-failure share over at least five calls', () => {
    const rows = [
      row('bazaarpay', 'TIMEOUT', 9),
      row('bazaarpay', 'OK', 8),
      row('bazaarpay', 'OK', 7),
      row('bazaarpay', 'OK', 6),
      row('bazaarpay', 'OK', 5),
    ];
    expect(derivePaymentGatewayStatus(rows)[0]?.status).toBe('DEGRADED');
  });

  it('does not judge a ratio on too few calls', () => {
    const rows = [row('bazaarpay', 'TIMEOUT', 2), row('bazaarpay', 'OK', 1)];
    expect(derivePaymentGatewayStatus(rows)[0]?.status).toBe('HEALTHY');
  });

  it('judges each gateway on its own traffic', () => {
    const result = derivePaymentGatewayStatus([
      row('zarinpal', 'TIMEOUT', 3),
      row('zarinpal', 'TIMEOUT', 2),
      row('zarinpal', 'TIMEOUT', 1),
      row('bazaarpay', 'OK', 1),
    ]);
    expect(result.map((g) => [g.provider, g.status])).toEqual([
      ['bazaarpay', 'HEALTHY'],
      ['zarinpal', 'OFFLINE'],
    ]);
  });
});
