import { createHash, randomBytes, randomInt } from 'node:crypto';

import { DomainErrors } from '../../common/errors/domain.exception';

const MOBILE_RE = /^(?:09|989|\+989)\d{9}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Convert an Iranian mobile into the one canonical value used by the database
 * and notification providers: +989xxxxxxxxx.
 *
 * Deliberately accepts only the three public forms documented by the API. In
 * particular, 0098 and local numbers without the leading 0 are not silently
 * guessed, because an identity lookup must never target a different account.
 */
export function normalizeMobile(input: string): string {
  const value = input.trim();
  if (!MOBILE_RE.test(value)) {
    throw DomainErrors.validation([{ path: 'identifier', message: 'Enter a valid Iranian mobile number' }]);
  }

  if (value.startsWith('09')) {
    return `+98${value.slice(1)}`;
  }
  if (value.startsWith('+989')) {
    return value;
  }
  return `+${value}`;
}

/** Normalise e-mail identity values without changing their local-part semantics. */
export function normalizeEmail(input: string): string {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !EMAIL_RE.test(value)) {
    throw DomainErrors.validation([{ path: 'identifier', message: 'Enter a valid e-mail address' }]);
  }
  return value;
}

export function normalizeIdentity(type: 'MOBILE' | 'EMAIL', value: string): string {
  return type === 'MOBILE' ? normalizeMobile(value) : normalizeEmail(value);
}

export function maskMobile(value: string): string {
  const canonical = normalizeMobile(value);
  return `${canonical.slice(0, 5)}***${canonical.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const canonical = normalizeEmail(value);
  const at = canonical.lastIndexOf('@');
  const local = canonical.slice(0, at);
  return `${local.slice(0, 1)}***@${canonical.slice(at + 1)}`;
}

/** Cryptographically random decimal OTP; Math.random is not suitable here. */
export function generateOtp(length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += randomInt(0, 10).toString();
  }
  return result;
}

/**
 * Public customer code. It is intentionally independent of the database id and
 * contains no timestamp or sequence that would reveal account volume.
 */
export function generateCustomerCode(): string {
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `CUS-${suffix}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
