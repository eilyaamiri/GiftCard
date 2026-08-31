import { formatJalaliDate, toPersianDigits } from "@barat/ui";

/** Group thousands with commas — used for foreign-currency decimal strings. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A supplier offer's cost is a foreign-currency decimal string (USD/EUR/GBP),
 * never IRR — `formatUsd`/`formatToman` from @barat/ui assume a fixed
 * currency, so costs here get their own formatter that keeps the currency
 * code explicit instead of guessing a symbol.
 */
export function formatMoneyAmount(amount: string, currency: string): string {
  const negative = amount.trim().startsWith("-");
  const clean = negative ? amount.trim().slice(1) : amount.trim();
  const [wholeRaw, fractionRaw = ""] = clean.split(".");
  const whole = groupThousands(wholeRaw || "0");
  const formatted = fractionRaw ? `${whole}.${fractionRaw}` : whole;
  return `${toPersianDigits(negative ? `-${formatted}` : formatted)} ${currency}`;
}

export function formatBps(bps: number): string {
  return `${toPersianDigits((bps / 100).toString())}٪`;
}

export function formatCount(value: number): string {
  return toPersianDigits(value.toLocaleString("en-US"));
}

export function formatDateTime(value: string): string {
  return formatJalaliDate(value);
}
