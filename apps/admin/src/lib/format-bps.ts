import { formatIrr, formatToman, toLatinDigits, toPersianDigits } from "@barat/ui";

const PERSIAN_DECIMAL_SEPARATOR = "٫";

/**
 * Basis points are integers on the wire and must stay integers here. Every
 * conversion below goes through BigInt: `bps / 100` in floating point turns
 * 472 bps into 4.720000000000001 and a re-parse turns it into a different fee.
 */
function bpsToPercentParts(bps: number): { sign: string; whole: bigint; fraction: bigint } {
  const value = BigInt(Math.trunc(bps));
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return { sign: negative ? "-" : "", whole: absolute / 100n, fraction: absolute % 100n };
}

/** Latin percent text for an input field, e.g. 150 -> "1.5", 472 -> "4.72", 5 -> "0.05". */
export function bpsToPercentText(bps: number): string {
  const { sign, whole, fraction } = bpsToPercentParts(bps);
  if (fraction === 0n) return `${sign}${whole.toString()}`;
  const fractionText = fraction.toString().padStart(2, "0").replace(/0$/u, "");
  return `${sign}${whole.toString()}.${fractionText}`;
}

/** Renders integer basis points as a percentage string, e.g. 150 -> "۱٫۵٪". Never use a float for the bps value itself. */
export function formatBps(bps: number): string {
  return `${toPersianDigits(bpsToPercentText(bps).replace(".", PERSIAN_DECIMAL_SEPARATOR))}٪`;
}

/** Same as `formatBps` but keeps an explicit "+" on gains, for before/after deltas. */
export function formatSignedBps(bps: number): string {
  return bps > 0 ? `+${formatBps(bps)}` : formatBps(bps);
}

/** "۱۵۰ bps (۱٫۵٪)" — both units together, so an operator never has to convert in their head. */
export function formatBpsWithPercent(bps: number): string {
  return `${toPersianDigits(bps)} bps (${formatBps(bps)})`;
}

const BPS_MAX = 1_000_000;

/**
 * Parses an operator-typed basis-point value. Returns null for anything that is
 * not a whole number in range — a partially typed field must block the submit,
 * not silently become 0.
 */
export function parseBpsText(raw: string): number | null {
  const trimmed = toLatinDigits(raw).trim();
  if (!/^\d{1,7}$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= BPS_MAX ? value : null;
}

/**
 * Parses a percent value back into integer basis points using string
 * arithmetic. "1.5" -> 150. More than two fractional digits is rejected rather
 * than rounded: 1.234% is not expressible in bps and guessing would move money.
 */
export function parsePercentText(raw: string): number | null {
  const trimmed = toLatinDigits(raw).trim().replace(PERSIAN_DECIMAL_SEPARATOR, ".");
  const match = /^(\d{1,5})(?:\.(\d{1,2}))?$/u.exec(trimmed);
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const bps = whole * 100n + fraction;
  return bps <= BigInt(BPS_MAX) ? Number(bps) : null;
}

/**
 * Parses an operator-typed IRR amount into the digit string the wire expects.
 * The value never becomes a JS number, so a 25-digit rial amount survives.
 */
export function parseIrrText(raw: string): string | null {
  const trimmed = toLatinDigits(raw).trim().replace(/[,\s]/gu, "");
  if (!/^\d{1,25}$/u.test(trimmed)) return null;
  return BigInt(trimmed).toString();
}

/** Parses a plain non-negative integer field (quantity, TTL seconds, page size). */
export function parseIntegerText(raw: string, min: number, max: number): number | null {
  const trimmed = toLatinDigits(raw).trim();
  if (!/^\d{1,10}$/u.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/**
 * Formats an IRR wire string as Toman. Falls back to rial when the amount is
 * not a whole Toman, because truncating the remainder would misstate money.
 */
export function formatIrrStringAsToman(irr: string, options?: { readonly withSuffix?: boolean }): string {
  const value = BigInt(irr);
  const absolute = value < 0n ? -value : value;
  if (absolute % 10n !== 0n) return formatIrr(value, options);
  return formatToman(value, options);
}

/** Formats an IRR wire string as rial, for fields whose stored unit is rial. */
export function formatIrrString(irr: string, options?: { readonly withSuffix?: boolean }): string {
  return formatIrr(BigInt(irr), options);
}

/** Signed difference between two IRR wire strings, formatted as Toman with an explicit sign. */
export function formatIrrDelta(fromIrr: string, toIrr: string): string {
  const delta = BigInt(toIrr) - BigInt(fromIrr);
  if (delta === 0n) return `${toPersianDigits(0)} تومان`;
  const formatted = formatIrrStringAsToman(delta.toString());
  return delta > 0n ? `+${formatted}` : formatted;
}

/** Decimal FX rate string (up to 6 fractional digits) with Persian digits. */
export function formatDecimalString(value: string): string {
  const [whole = "0", fraction] = value.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const joined = fraction ? `${grouped}.${fraction}` : grouped;
  return toPersianDigits(`${negative ? "-" : ""}${joined}`).replace(".", PERSIAN_DECIMAL_SEPARATOR);
}

/** Validates an FX rate the operator typed, against `fxRateStringSchema`'s Decimal(18,6) shape. */
export function parseDecimalText(raw: string): string | null {
  const trimmed = toLatinDigits(raw).trim().replace(PERSIAN_DECIMAL_SEPARATOR, ".").replace(/[,\s]/gu, "");
  if (!/^\d{1,12}(\.\d{1,6})?$/u.test(trimmed)) return null;
  return /[1-9]/u.test(trimmed) ? trimmed : null;
}

/** Rate age in Persian, chosen unit first: seconds, then minutes, then hours, then days. */
export function formatAgeSeconds(seconds: number): string {
  if (seconds < 60) return `${toPersianDigits(seconds)} ثانیه`;
  if (seconds < 3_600) return `${toPersianDigits(Math.floor(seconds / 60))} دقیقه`;
  if (seconds < 86_400) return `${toPersianDigits(Math.floor(seconds / 3_600))} ساعت`;
  return `${toPersianDigits(Math.floor(seconds / 86_400))} روز`;
}
