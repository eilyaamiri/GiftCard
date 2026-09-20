import { describe, expect, it } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import {
  isExternalSupportChannel,
  normalizeSupportChannelValue,
  supportChannelHref,
  updateSupportChannelSchema,
} from './support-channels.schemas';

describe('normalizeSupportChannelValue', () => {
  it('folds Persian digits and separators in a phone number', () => {
    expect(normalizeSupportChannelValue('PHONE', '۰۲۱ ۹۱۰۰-۱۲۳۴')).toBe('02191001234');
    expect(normalizeSupportChannelValue('PHONE', '+98 (21) 9100 1234')).toBe('+982191001234');
  });

  it('accepts every shape a Telegram handle is copied in', () => {
    for (const input of [
      '@baratpay',
      'baratpay',
      't.me/baratpay',
      'https://t.me/baratpay',
      'https://www.telegram.me/baratpay/',
    ]) {
      expect(normalizeSupportChannelValue('TELEGRAM', input)).toBe('https://t.me/baratpay');
    }
  });

  it('keeps a Telegram invite hash, which is not a username', () => {
    expect(normalizeSupportChannelValue('TELEGRAM', 'https://t.me/+AbCdEf_1234')).toBe(
      'https://t.me/+AbCdEf_1234',
    );
  });

  it('reduces a WhatsApp number to the digits wa.me expects', () => {
    expect(normalizeSupportChannelValue('WHATSAPP', '+98 912 123 4567')).toBe('989121234567');
    expect(normalizeSupportChannelValue('WHATSAPP', 'https://wa.me/989121234567')).toBe('989121234567');
  });

  it('rejects an absolute URL in the ticket route, including the protocol-relative form', () => {
    for (const input of ['https://evil.test/steal', '//evil.test/steal', 'account/support']) {
      expect(() => normalizeSupportChannelValue('TICKET', input)).toThrow(BaratDomainException);
    }
    expect(normalizeSupportChannelValue('TICKET', '/account/support')).toBe('/account/support');
  });

  it('rejects values it cannot recognise rather than guessing at them', () => {
    expect(() => normalizeSupportChannelValue('PHONE', 'call me')).toThrow(BaratDomainException);
    expect(() => normalizeSupportChannelValue('TELEGRAM', '@ab')).toThrow(BaratDomainException);
    expect(() => normalizeSupportChannelValue('WHATSAPP', '0912')).toThrow(BaratDomainException);
  });

  it('lets an empty value through, because that is how a channel stays unconfigured', () => {
    for (const kind of ['PHONE', 'TELEGRAM', 'WHATSAPP', 'TICKET'] as const) {
      expect(normalizeSupportChannelValue(kind, '   ')).toBe('');
    }
  });
});

describe('supportChannelHref', () => {
  it('builds the link the storefront renders', () => {
    expect(supportChannelHref('PHONE', '02191001234')).toBe('tel:02191001234');
    expect(supportChannelHref('TELEGRAM', 'https://t.me/baratpay')).toBe('https://t.me/baratpay');
    expect(supportChannelHref('WHATSAPP', '989121234567')).toBe('https://wa.me/989121234567');
    expect(supportChannelHref('TICKET', '/account/support')).toBe('/account/support');
  });

  it('has no link for an unconfigured channel', () => {
    expect(supportChannelHref('PHONE', '')).toBeNull();
  });

  it('marks only the chat channels as leaving the site', () => {
    expect(isExternalSupportChannel('TELEGRAM')).toBe(true);
    expect(isExternalSupportChannel('WHATSAPP')).toBe(true);
    expect(isExternalSupportChannel('PHONE')).toBe(false);
    expect(isExternalSupportChannel('TICKET')).toBe(false);
  });
});

describe('updateSupportChannelSchema', () => {
  const base = { isEnabled: false, title: 'تماس تلفنی', description: '', value: '', sortOrder: 0 };

  it('refuses to enable a channel with nothing to reach', () => {
    const result = updateSupportChannelSchema.safeParse({ ...base, isEnabled: true });
    expect(result.success).toBe(false);
  });

  it('allows an unconfigured channel to stay switched off', () => {
    expect(updateSupportChannelSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(updateSupportChannelSchema.safeParse({ ...base, kind: 'PHONE' }).success).toBe(false);
  });
});
