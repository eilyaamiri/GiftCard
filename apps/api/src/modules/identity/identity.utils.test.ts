import { describe, expect, it } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import {
  generateCustomerCode,
  generateOtp,
  maskEmail,
  maskMobile,
  normalizeEmail,
  normalizeMobile,
} from './identity.utils';

describe('normalizeMobile', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['09121234567', '+989121234567'],
    ['989121234567', '+989121234567'],
    ['+989121234567', '+989121234567'],
    ['  09121234567  ', '+989121234567'],
    ['09361234567', '+989361234567'],
  ];

  it.each(accepted)('normalises %s to %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  const rejected: readonly string[] = [
    '00989121234567', // 0098 is not silently guessed
    '9121234567', // missing leading 0
    '0912123456', // too short
    '091212345678', // too long
    '08121234567', // not an Iranian mobile prefix
    '+1989121234567',
    '0912 123 4567',
    '0912-123-4567',
    'not-a-number',
    '',
  ];

  it.each(rejected)('rejects %s', (input) => {
    expect(() => normalizeMobile(input)).toThrow(BaratDomainException);
  });

  it('is idempotent, so re-normalising a stored value cannot drift', () => {
    expect(normalizeMobile(normalizeMobile('09121234567'))).toBe('+989121234567');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ali.Reza@Example.COM ')).toBe('ali.reza@example.com');
  });

  it.each(['no-at-sign', 'a@b', 'a b@example.com', `${'a'.repeat(250)}@example.com`, ''])(
    'rejects %s',
    (input) => {
      expect(() => normalizeEmail(input)).toThrow(BaratDomainException);
    },
  );
});

describe('masking', () => {
  it('never reveals the middle digits of a mobile', () => {
    const masked = maskMobile('09121234567');
    expect(masked).toBe('+9891***4567');
    expect(masked).not.toContain('212345');
  });

  it('reveals only the first character of an e-mail local part', () => {
    expect(maskEmail('ali.reza@example.com')).toBe('a***@example.com');
  });
});

describe('generateCustomerCode', () => {
  it('is CUS- plus six uppercase alphanumerics and is not sequential', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const code = generateCustomerCode();
      expect(code).toMatch(/^CUS-[0-9A-Z]{6}$/u);
      codes.add(code);
    }
    /* Collisions are possible but a sequence would produce ~0 uniques wasted. */
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('generateOtp', () => {
  it('produces exactly the requested number of digits', () => {
    for (const length of [4, 5, 6, 8]) {
      expect(generateOtp(length)).toMatch(new RegExp(`^\\d{${length}}$`, 'u'));
    }
  });

  it('does not repeat the same code across many draws', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      seen.add(generateOtp(6));
    }
    expect(seen.size).toBeGreaterThan(250);
  });
});
