import { describe, expect, it } from 'vitest';

import {
  ALERT_HISTORY_SIZE,
  ALERT_SEVERITY_LEVELS,
  AlertLogger,
  type AlertChannel,
  type FormattedAlert,
} from './alert-logger';
import { redactAlertContext } from './alert-redact';

describe('AlertLogger', () => {
  describe('log', () => {
    it('dispatches to registered channels', async () => {
      const logger = new AlertLogger();
      const sent: FormattedAlert[] = [];

      const mockChannel: AlertChannel = {
        name: 'mock',
        minSeverity: 'INFO',
        send: async (alert) => {
          sent.push(alert);
        },
      };

      logger.registerChannel(mockChannel);

      logger.log({
        severity: 'ERROR',
        source: 'FX',
        message: 'Test alert',
        context: { key: 'value' },
      });

      // Give async dispatch time to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sent).toHaveLength(1);
      expect(sent[0]?.severity).toBe('ERROR');
      expect(sent[0]?.source).toBe('FX');
      expect(sent[0]?.message).toBe('Test alert');
      expect(sent[0]?.context).toEqual({ key: 'value' });
    });

    it('handles channel errors without throwing', async () => {
      const logger = new AlertLogger();

      const failingChannel: AlertChannel = {
        name: 'failing',
        minSeverity: 'INFO',
        send: async () => {
          throw new Error('Channel failed');
        },
      };

      logger.registerChannel(failingChannel);

      // Should not throw
      expect(() =>
        logger.log({
          severity: 'ERROR',
          source: 'FX',
          message: 'Test alert',
        }),
      ).not.toThrow();
    });
  });
});

describe('ALERT_SEVERITY_LEVELS', () => {
  it('orders severities correctly', () => {
    expect(ALERT_SEVERITY_LEVELS.INFO).toBeLessThan(ALERT_SEVERITY_LEVELS.WARNING);
    expect(ALERT_SEVERITY_LEVELS.WARNING).toBeLessThan(ALERT_SEVERITY_LEVELS.ERROR);
    expect(ALERT_SEVERITY_LEVELS.ERROR).toBeLessThan(ALERT_SEVERITY_LEVELS.CRITICAL);
  });
});

describe('redactAlertContext', () => {
  it('returns null for null/undefined', () => {
    expect(redactAlertContext(null)).toBeNull();
    expect(redactAlertContext(undefined)).toBeNull();
  });

  it('redacts amount fields', () => {
    const input = { amount: 100, amountIrr: '50000', other: 'value' };
    const result = redactAlertContext(input);

    expect(result).toEqual({
      amount: '[REDACTED]',
      amountIrr: '[REDACTED]',
      other: 'value',
    });
  });

  it('redacts secret fields', () => {
    const input = { code: 'ABC123', token: 'xyz', apiKey: 'secret' };
    const result = redactAlertContext(input);

    expect(result).toEqual({
      code: '[REDACTED]',
      token: '[REDACTED]',
      apiKey: '[REDACTED]',
    });
  });

  it('redacts nested objects', () => {
    const input = {
      provider: 'test',
      nested: { code: 'secret', name: 'visible' },
    };
    const result = redactAlertContext(input);

    expect(result).toEqual({
      provider: 'test',
      nested: { code: '[REDACTED]', name: 'visible' },
    });
  });

  it('leaves safe fields intact', () => {
    const input = { provider: 'reloadly', status: 'FAILED', orderId: 'order-123' };
    const result = redactAlertContext(input);

    expect(result).toEqual(input);
  });

  it('matches credential names whatever their case or separator', () => {
    const result = redactAlertContext({
      accessToken: 'a',
      ACCESS_TOKEN: 'b',
      'refresh-token': 'c',
      otp: '123456',
      Authority: 'A000',
      cardNumber: '6037',
      iban: 'IR00',
      merchant_id: 'm',
    });

    expect(Object.values(result ?? {}).every((value) => value === '[REDACTED]')).toBe(true);
  });

  it('redacts amounts by suffix', () => {
    expect(redactAlertContext({ finalAmountIrr: '1', totalAmount: 2, supplierCostUsd: '3' })).toEqual({
      finalAmountIrr: '[REDACTED]',
      totalAmount: '[REDACTED]',
      supplierCostUsd: '[REDACTED]',
    });
  });

  it('keeps diagnostic codes and rates visible while hiding a bare code or rate', () => {
    expect(
      redactAlertContext({ code: 'GIFT', rate: '1', errorCode: 'TIMEOUT', supplierCode: 'tillo', errorRate: 0.2 }),
    ).toEqual({
      code: '[REDACTED]',
      rate: '[REDACTED]',
      errorCode: 'TIMEOUT',
      supplierCode: 'tillo',
      errorRate: 0.2,
    });
  });

  it('walks arrays, including objects inside them', () => {
    expect(
      redactAlertContext({ items: [{ code: 'X', orderId: 'o1' }, 'plain'], tokens: ['a', 'b'], orderIds: ['o1'] }),
    ).toEqual({
      items: [{ code: '[REDACTED]', orderId: 'o1' }, 'plain'],
      tokens: '[REDACTED]',
      orderIds: ['o1'],
    });
  });
});

describe('AlertLogger history and redaction', () => {
  it('keeps recent alerts newest first, capped', () => {
    const logger = new AlertLogger();
    for (let i = 0; i < ALERT_HISTORY_SIZE + 5; i++) {
      logger.log({ severity: 'WARNING', source: 'SYSTEM', message: `m${i}` });
    }

    const recent = logger.recent();
    expect(recent).toHaveLength(ALERT_HISTORY_SIZE);
    expect(recent[0]?.message).toBe(`m${ALERT_HISTORY_SIZE + 4}`);
    expect(logger.recent(3).map((a) => a.message)).toEqual([
      `m${ALERT_HISTORY_SIZE + 4}`,
      `m${ALERT_HISTORY_SIZE + 3}`,
      `m${ALERT_HISTORY_SIZE + 2}`,
    ]);
  });

  it('redacts context before any channel or the history sees it', async () => {
    const logger = new AlertLogger();
    const sent: FormattedAlert[] = [];
    logger.registerChannel({ name: 'spy', minSeverity: 'INFO', send: async (a) => void sent.push(a) });

    logger.log({
      severity: 'ERROR',
      source: 'SUPPLIER',
      message: 'x',
      context: { orderId: 'o-1', token: 'secret-token', amountIrr: '9000000' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expected = { orderId: 'o-1', token: '[REDACTED]', amountIrr: '[REDACTED]' };
    expect(sent[0]?.context).toEqual(expected);
    expect(logger.recent()[0]?.context).toEqual(expected);
  });

  it('derives a per-incident dedup key from source and message', () => {
    const logger = new AlertLogger();
    logger.log({ severity: 'ERROR', source: 'SUPPLIER', message: 'Supplier tillo down' });
    logger.log({ severity: 'ERROR', source: 'SUPPLIER', message: 'Supplier runa down' });

    const [runa, tillo] = logger.recent();
    expect(tillo?.dedupKey).not.toBe(runa?.dedupKey);
  });
});
