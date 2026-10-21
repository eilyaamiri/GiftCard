import type { CustomerDto } from "@barat/contracts";
import { toPersianDigits } from "@barat/ui";

/** Digits in a national Iranian mobile written the local way: 09xxxxxxxxx. */
const NATIONAL_MOBILE_DIGITS = 11;

/**
 * The API's masked mobile (`+9891***4567`) written the way an Iranian customer
 * reads their own number: `۰۹۱****۴۵۶۷`.
 *
 * The raw form breaks inside RTL text — the bidi algorithm moves the leading
 * «+» to the far end and reverses the digit groups around the stars — and the
 * +98 prefix is not how anyone here writes a mobile. The stars are padded so
 * the result keeps the eleven-character shape of a real 09 number; which digits
 * stay hidden is still decided by the API, never here.
 *
 * Callers must still render the result inside an isolate (`<bdi>`), since the
 * stars are bidi-neutral and would otherwise reorder the two digit groups.
 */
export function formatMaskedMobile(masked: string): string {
  const match = /^\+98(\d*)(\*+)(\d*)$/u.exec(masked.trim());
  if (!match) return masked;
  const [, head = "", stars = "", tail = ""] = match;
  const hidden = Math.max(NATIONAL_MOBILE_DIGITS - 1 - head.length - tail.length, stars.length);
  return toPersianDigits(`0${head}${"*".repeat(hidden)}${tail}`);
}

/** Display name for a customer who may not have completed their profile yet. */
export function customerDisplayName(customer: CustomerDto): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (customer.maskedMobile) return formatMaskedMobile(customer.maskedMobile);
  return customer.maskedEmail || customer.customerCode;
}
