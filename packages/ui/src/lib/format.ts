import { format as formatJalali } from "date-fns-jalali";
import { faIR } from "date-fns-jalali/locale";
import { toPersianDigits } from "./digits";

/** IRR is stored as an integer number of Iranian Rial. 1 Toman = 10 IRR. */
const IRR_PER_TOMAN = 10n;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a Rial amount (bigint) as Toman for display, with Persian digits
 * and thousand separators. Throws if `irr` is not evenly divisible by 10 —
 * a silent truncation of sub-Toman rial would misrepresent the amount.
 */
export function formatToman(irr: bigint, options?: { readonly withSuffix?: boolean }): string {
  if (typeof irr !== "bigint") {
    throw new TypeError("formatToman: irr must be a bigint");
  }
  const negative = irr < 0n;
  const abs = negative ? -irr : irr;
  if (abs % IRR_PER_TOMAN !== 0n) {
    throw new RangeError(`formatToman: ${irr.toString()} IRR is not an exact number of Toman`);
  }
  const toman = abs / IRR_PER_TOMAN;
  const grouped = groupThousands(toman.toString());
  const withSign = negative ? `-${grouped}` : grouped;
  const persian = toPersianDigits(withSign);
  return options?.withSuffix === false ? persian : `${persian} تومان`;
}

const TOMAN_PER_THOUSAND = 1_000n;
const TOMAN_PER_MILLION = 1_000_000n;
/** The Persian decimal separator (U+066B), e.g. «۲٫۵ میلیون». */
const DECIMAL_SEPARATOR = "٫";

/**
 * Format a Rial amount (bigint) as compact Toman — «۱۰ هزار تومان»,
 * «۲٫۵ میلیون تومان» — the way a price is said out loud on a product card.
 *
 * Compacts ONLY when the amount survives it exactly: millions when the amount
 * is a whole tenth of a million, thousands when it is a whole thousand.
 * Anything else falls back to the full `formatToman` digits, because a price
 * label may never show a rounded amount — «از ۲٫۴ میلیون» for ۲٬۴۵۰٬۰۰۰ would
 * understate what the customer will actually be quoted.
 */
export function formatTomanCompact(irr: bigint): string {
  if (typeof irr !== "bigint") {
    throw new TypeError("formatTomanCompact: irr must be a bigint");
  }
  if (irr < 0n || irr % IRR_PER_TOMAN !== 0n) {
    return formatToman(irr);
  }
  const toman = irr / IRR_PER_TOMAN;
  if (toman >= TOMAN_PER_MILLION && toman % (TOMAN_PER_MILLION / 10n) === 0n) {
    const tenths = toman / (TOMAN_PER_MILLION / 10n);
    const whole = groupThousands((tenths / 10n).toString());
    const fraction = tenths % 10n;
    const digits = fraction === 0n ? whole : `${whole}${DECIMAL_SEPARATOR}${fraction.toString()}`;
    return `${toPersianDigits(digits)} میلیون تومان`;
  }
  /* «هزار» only below a million: «۲,۴۵۰ هزار تومان» is exact but nobody says
   * a price that way — past a million it is either a clean «میلیون» or the
   * full digits. */
  if (toman >= TOMAN_PER_THOUSAND && toman < TOMAN_PER_MILLION && toman % TOMAN_PER_THOUSAND === 0n) {
    const thousands = groupThousands((toman / TOMAN_PER_THOUSAND).toString());
    return `${toPersianDigits(thousands)} هزار تومان`;
  }
  return formatToman(irr);
}

/** Format a Rial amount (bigint) as IRR for display, with Persian digits and separators. */
export function formatIrr(irr: bigint, options?: { readonly withSuffix?: boolean }): string {
  if (typeof irr !== "bigint") {
    throw new TypeError("formatIrr: irr must be a bigint");
  }
  const negative = irr < 0n;
  const abs = negative ? -irr : irr;
  const grouped = groupThousands(abs.toString());
  const withSign = negative ? `-${grouped}` : grouped;
  const persian = toPersianDigits(withSign);
  return options?.withSuffix === false ? persian : `${persian} ریال`;
}

/**
 * Format a USD decimal-string amount for display. Accepts a string (as
 * carried across the wire) to avoid ever routing foreign-currency amounts
 * through a JS float.
 */
export function formatUsd(amount: string | number, options?: { readonly withSuffix?: boolean }): string {
  const str = typeof amount === "number" ? amount.toFixed(2) : amount;
  const negative = str.trim().startsWith("-");
  const clean = negative ? str.trim().slice(1) : str.trim();
  const [wholeRaw, fractionRaw = ""] = clean.split(".");
  const whole = groupThousands(wholeRaw || "0");
  const fraction = fractionRaw.slice(0, 2).padEnd(2, "0");
  const formatted = `${negative ? "-" : ""}${whole}.${fraction}`;
  return options?.withSuffix === false ? formatted : `$${formatted}`;
}

/**
 * Format a date in the Jalali (Solar Hijri) calendar with Persian month
 * names and Persian digits. `pattern` follows date-fns tokens, e.g.
 * `"d MMMM yyyy"` or `"yyyy/MM/dd HH:mm"`.
 */
export function formatJalaliDate(date: Date | number | string, pattern = "yyyy/MM/dd HH:mm"): string {
  const value = date instanceof Date ? date : new Date(date);
  const formatted = formatJalali(value, pattern, { locale: faIR });
  return toPersianDigits(formatted);
}
