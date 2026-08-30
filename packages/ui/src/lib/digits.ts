const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;
const LATIN_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Convert every Latin (or Arabic-Indic) digit in `input` to a Persian digit. */
export function toPersianDigits(input: string | number | bigint): string {
  const str = String(input);
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      out += PERSIAN_DIGITS[code - 48];
      continue;
    }
    // Arabic-Indic digits (٠-٩)
    if (code >= 0x0660 && code <= 0x0669) {
      out += PERSIAN_DIGITS[code - 0x0660];
      continue;
    }
    out += ch;
  }
  return out;
}

/** Convert every Persian (or Arabic-Indic) digit in `input` back to a Latin digit. */
export function toLatinDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const persianIndex = PERSIAN_DIGITS.indexOf(ch as (typeof PERSIAN_DIGITS)[number]);
    if (persianIndex !== -1) {
      out += LATIN_DIGITS[persianIndex];
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) {
      out += LATIN_DIGITS[code - 0x0660];
      continue;
    }
    out += ch;
  }
  return out;
}
