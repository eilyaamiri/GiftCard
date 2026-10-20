import { describe, expect, it } from 'vitest';

import { AlertLogger, ALERT_SEVERITY_LEVELS, type AlertChannel, type FormattedAlert } from './alert-logger';
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
});
