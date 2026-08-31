import { DomainErrors } from '../../common/errors/domain.exception';

/**
 * Parsing, checksums and masking for a customer's own payout details.
 *
 * Nothing here reaches a bank. An IBAN checksum proves the number was typed
 * correctly, and Luhn proves the same about a card — neither proves whose money
 * it is. Ownership is asserted by the account holder and recorded as such; see
 * `BankDetailsService`.
 */

const IBAN_LENGTH = 26; // 'IR' + 24 digits
const CARD_LENGTH = 16;

/** Persian and Arabic-Indic digits, so a customer may paste either form. */
function toLatinDigits(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) {
      out += String(code - 0x06f0);
      continue;
    }
    if (code >= 0x0660 && code <= 0x0669) {
      out += String(code - 0x0660);
      continue;
    }
    out += character;
  }
  return out;
}

function strip(value: string): string {
  // Separators only. Anything else survives and is rejected by the format check
  // below, rather than being silently deleted into a different number.
  return toLatinDigits(value).replace(/[\s‌-]/gu, '');
}

/**
 * IBAN check: move the four leading characters to the end, turn letters into
 * numbers (A=10) and require mod 97 === 1. Computed digit by digit because a
 * 26-character IBAN is far past `Number.MAX_SAFE_INTEGER`.
 */
function ibanChecksumValid(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const value = /\d/u.test(character)
      ? character
      : String(character.toUpperCase().charCodeAt(0) - 55);
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function luhnValid(card: string): boolean {
  let sum = 0;
  for (let index = 0; index < card.length; index += 1) {
    const digit = Number(card[card.length - 1 - index]);
    if (index % 2 === 0) {
      sum += digit;
      continue;
    }
    const doubled = digit * 2;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** Returns the canonical `IR` + 24 digit form, or throws a field-level error. */
export function normalizeIban(input: string): string {
  const value = strip(input).toUpperCase();
  const canonical = value.startsWith('IR') ? value : `IR${value}`;

  if (canonical.length !== IBAN_LENGTH || !/^IR\d{24}$/u.test(canonical)) {
    throw DomainErrors.validation([
      { path: 'iban', message: 'شماره شبا باید ۲۴ رقم بعد از IR باشد.' },
    ]);
  }
  if (!ibanChecksumValid(canonical)) {
    throw DomainErrors.validation([
      { path: 'iban', message: 'شماره شبا معتبر نیست. لطفاً دوباره بررسی کنید.' },
    ]);
  }
  return canonical;
}

/** Returns the canonical 16 digits, or throws a field-level error. */
export function normalizeCardNumber(input: string): string {
  const value = strip(input);

  if (value.length !== CARD_LENGTH || !/^\d{16}$/u.test(value)) {
    throw DomainErrors.validation([
      { path: 'cardNumber', message: 'شماره کارت باید ۱۶ رقم باشد.' },
    ]);
  }
  if (!luhnValid(value)) {
    throw DomainErrors.validation([
      { path: 'cardNumber', message: 'شماره کارت معتبر نیست. لطفاً دوباره بررسی کنید.' },
    ]);
  }
  return value;
}

/**
 * First six and last four, the only part of a PAN that may be displayed or
 * stored in the clear. Everything between them is gone before this returns.
 */
export function maskCardNumber(card: string): string {
  const bin = card.slice(0, 6);
  const last4 = card.slice(-4);
  return `${bin.slice(0, 4)}-${bin.slice(4)}**-****-${last4}`;
}

/**
 * `IR06017***************0001` — country, check digits, the three-digit bank
 * code and the last four. The bank is named next to it in the UI anyway, so its
 * code reveals nothing new; the account number itself stays hidden.
 */
export function maskIban(iban: string): string {
  return `${iban.slice(0, 7)}${'*'.repeat(IBAN_LENGTH - 11)}${iban.slice(-4)}`;
}

/* ----------------------------------------------------------------- issuers */

/**
 * Issuer lookup for display only. An unknown prefix is not an error: BINs and
 * bank codes change, and a customer must not be blocked from saving a valid
 * card because this table is a month out of date.
 */
const CARD_BINS: ReadonlyMap<string, string> = new Map([
  ['603799', 'بانک ملی ایران'],
  ['589210', 'بانک سپه'],
  ['627648', 'بانک توسعه صادرات'],
  ['627961', 'بانک صنعت و معدن'],
  ['603770', 'بانک کشاورزی'],
  ['628023', 'بانک مسکن'],
  ['627760', 'پست بانک ایران'],
  ['502908', 'بانک توسعه تعاون'],
  ['627412', 'بانک اقتصاد نوین'],
  ['622106', 'بانک پارسیان'],
  ['639194', 'بانک پارسیان'],
  ['502229', 'بانک پاسارگاد'],
  ['639347', 'بانک پاسارگاد'],
  ['627488', 'بانک کارآفرین'],
  ['502910', 'بانک کارآفرین'],
  ['621986', 'بانک سامان'],
  ['639346', 'بانک سینا'],
  ['639607', 'بانک سرمایه'],
  ['502806', 'بانک شهر'],
  ['504706', 'بانک شهر'],
  ['502938', 'بانک دی'],
  ['603769', 'بانک صادرات ایران'],
  ['610433', 'بانک ملت'],
  ['991975', 'بانک ملت'],
  ['627353', 'بانک تجارت'],
  ['585983', 'بانک تجارت'],
  ['589463', 'بانک رفاه کارگران'],
  ['627381', 'بانک انصار'],
  ['505785', 'بانک ایران زمین'],
  ['636214', 'بانک آینده'],
  ['636949', 'بانک حکمت ایرانیان'],
  ['505416', 'بانک گردشگری'],
  ['636795', 'بانک مرکزی'],
  ['639599', 'بانک قوامین'],
  ['504172', 'بانک رسالت'],
  ['606373', 'بانک قرض‌الحسنه مهر ایران'],
  ['628157', 'مؤسسه اعتباری توسعه'],
]);

/** Bank codes are positions 5–7 of an Iranian IBAN (`IR` + 2 check + 3 code). */
const IBAN_BANK_CODES: ReadonlyMap<string, string> = new Map([
  ['010', 'بانک مرکزی'],
  ['011', 'بانک صنعت و معدن'],
  ['012', 'بانک ملت'],
  ['013', 'بانک رفاه کارگران'],
  ['014', 'بانک مسکن'],
  ['015', 'بانک سپه'],
  ['016', 'بانک کشاورزی'],
  ['017', 'بانک ملی ایران'],
  ['018', 'بانک تجارت'],
  ['019', 'بانک صادرات ایران'],
  ['020', 'بانک توسعه صادرات'],
  ['021', 'پست بانک ایران'],
  ['022', 'بانک توسعه تعاون'],
  ['051', 'مؤسسه اعتباری توسعه'],
  ['053', 'بانک کارآفرین'],
  ['054', 'بانک پارسیان'],
  ['055', 'بانک اقتصاد نوین'],
  ['056', 'بانک سامان'],
  ['057', 'بانک پاسارگاد'],
  ['058', 'بانک سرمایه'],
  ['059', 'بانک سینا'],
  ['060', 'بانک قرض‌الحسنه مهر ایران'],
  ['061', 'بانک شهر'],
  ['062', 'بانک آینده'],
  ['063', 'بانک انصار'],
  ['064', 'بانک گردشگری'],
  ['065', 'بانک حکمت ایرانیان'],
  ['066', 'بانک دی'],
  ['069', 'بانک ایران زمین'],
  ['070', 'بانک رسالت'],
  ['073', 'بانک کوثر'],
  ['075', 'بانک مهر اقتصاد'],
  ['078', 'بانک خاورمیانه'],
]);

export function cardBankName(card: string): string | null {
  return CARD_BINS.get(card.slice(0, 6)) ?? null;
}

export function ibanBankName(iban: string): string | null {
  return IBAN_BANK_CODES.get(iban.slice(4, 7)) ?? null;
}

/* -------------------------------------------------------------- holder name */

/** Same normaliser the operator search uses, so both sides read a name alike. */
export function normalizeHolderName(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll('ي', 'ی')
    .replaceAll('ك', 'ک')
    .replace(/[ً-ٰٟ]/gu, '')
    .replace(/‌/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
