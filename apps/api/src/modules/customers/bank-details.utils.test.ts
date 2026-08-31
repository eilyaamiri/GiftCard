import { describe, expect, it } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import {
  cardBankName,
  ibanBankName,
  maskCardNumber,
  maskIban,
  normalizeCardNumber,
  normalizeHolderName,
  normalizeIban,
} from './bank-details.utils';

/** Bank code 017 (بانک ملی), mod-97 checksum verified. */
const VALID_IBAN = 'IR560170000000000000001234';
/** BIN 603799 (بانک ملی), passes Luhn. */
const VALID_CARD = '6037990000000121';

function detailsOf(thrown: unknown): Array<{ path: string; message: string }> {
  expect(thrown).toBeInstanceOf(BaratDomainException);
  return (thrown as BaratDomainException).details ?? [];
}

describe('normalizeIban', () => {
  it('accepts the canonical form', () => {
    expect(normalizeIban(VALID_IBAN)).toBe(VALID_IBAN);
  });

  it('accepts the separators a customer copies out of a banking app', () => {
    expect(normalizeIban('IR56 0170 0000 0000 0000 0012 34')).toBe(VALID_IBAN);
    expect(normalizeIban('IR56-0170-0000-0000-0000-0012-34')).toBe(VALID_IBAN);
    expect(normalizeIban('  ir560170000000000000001234  ')).toBe(VALID_IBAN);
  });

  it('adds the IR prefix when the customer typed the 24 digits alone', () => {
    expect(normalizeIban('560170000000000000001234')).toBe(VALID_IBAN);
  });

  it('accepts Persian and Arabic-Indic digits', () => {
    expect(normalizeIban('IR۵۶۰۱۷۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۱۲۳۴')).toBe(VALID_IBAN);
    expect(normalizeIban('IR٥٦٠١٧٠٠٠٠٠٠٠٠٠٠٠٠٠٠٠١٢٣٤')).toBe(VALID_IBAN);
  });

  it('rejects a wrong length as a field error rather than truncating', () => {
    const thrown = (() => {
      try {
        normalizeIban('IR5601700000000000000012');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(detailsOf(thrown)[0]).toEqual({
      path: 'iban',
      message: 'شماره شبا باید ۲۴ رقم بعد از IR باشد.',
    });
  });

  it('rejects a single mistyped digit through the mod-97 checksum', () => {
    /* Same length, same bank, one digit different: only the checksum catches it. */
    const thrown = (() => {
      try {
        normalizeIban('IR560170000000000000001235');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(detailsOf(thrown)[0]?.message).toBe('شماره شبا معتبر نیست. لطفاً دوباره بررسی کنید.');
  });

  it('rejects letters smuggled into the account number', () => {
    expect(() => normalizeIban('IR5601700000000000000012AB')).toThrow(BaratDomainException);
  });
});

describe('normalizeCardNumber', () => {
  it('accepts the canonical form and the usual separators', () => {
    expect(normalizeCardNumber(VALID_CARD)).toBe(VALID_CARD);
    expect(normalizeCardNumber('6037-9900-0000-0121')).toBe(VALID_CARD);
    expect(normalizeCardNumber('6037 9900 0000 0121')).toBe(VALID_CARD);
  });

  it('accepts Persian digits', () => {
    expect(normalizeCardNumber('۶۰۳۷۹۹۰۰۰۰۰۰۰۱۲۱')).toBe(VALID_CARD);
  });

  it('rejects anything that is not sixteen digits', () => {
    const thrown = (() => {
      try {
        normalizeCardNumber('603799000000012');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(detailsOf(thrown)[0]).toEqual({
      path: 'cardNumber',
      message: 'شماره کارت باید ۱۶ رقم باشد.',
    });
  });

  it('rejects a transposed digit through Luhn', () => {
    const thrown = (() => {
      try {
        normalizeCardNumber('6037990000000112');
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(detailsOf(thrown)[0]?.message).toBe('شماره کارت معتبر نیست. لطفاً دوباره بررسی کنید.');
  });
});

describe('masking', () => {
  it('keeps only the BIN and the last four of a card', () => {
    const masked = maskCardNumber(VALID_CARD);
    expect(masked).toBe('6037-99**-****-0121');
    /* The digits between the BIN and the last four are gone, not hidden. */
    expect(masked).not.toContain(VALID_CARD.slice(6, 12));
  });

  it('keeps only the bank code and the last four of an IBAN', () => {
    const masked = maskIban(VALID_IBAN);
    expect(masked).toBe('IR56017***************1234');
    expect(masked).toHaveLength(VALID_IBAN.length);
    expect(masked).not.toContain(VALID_IBAN.slice(7, 22));
  });
});

describe('issuer lookup', () => {
  it('names the bank behind a known BIN and a known IBAN code', () => {
    expect(cardBankName(VALID_CARD)).toBe('بانک ملی ایران');
    expect(ibanBankName(VALID_IBAN)).toBe('بانک ملی ایران');
    expect(cardBankName('6104330000000128')).toBe('بانک ملت');
    expect(ibanBankName('IR220121111111111111111111')).toBe('بانک ملت');
  });

  it('returns null for an unknown issuer instead of rejecting the number', () => {
    /* A stale lookup table must never block a customer from saving a valid card. */
    expect(cardBankName('9999990000000121')).toBeNull();
    expect(ibanBankName('IR790990000000000000009999')).toBeNull();
  });
});

describe('normalizeHolderName', () => {
  it('unifies Arabic yeh and kaf so the stored name matches operator search', () => {
    expect(normalizeHolderName('يكتا كريمي')).toBe('یکتا کریمی');
  });

  it('collapses zero-width non-joiners and repeated spaces', () => {
    expect(normalizeHolderName('  علی‌رضا   محمدی  ')).toBe('علی رضا محمدی');
  });
});
