import { describe, expect, it } from 'vitest';

import { isStalePurchasingClaim } from './suppliers.types';

describe('isStalePurchasingClaim', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');

  it('does not recover a fresh claim while its provider POST may still run', () => {
    expect(isStalePurchasingClaim(new Date('2026-09-30T11:59:59.999Z'), now)).toBe(false);
  });

  it('recovers a claim older than the provider-request grace period', () => {
    expect(isStalePurchasingClaim(new Date('2026-09-30T11:54:59.999Z'), now)).toBe(true);
  });

  it('does not guess at an unclaimed/legacy row with no start time', () => {
    expect(isStalePurchasingClaim(null, now)).toBe(false);
  });
});
