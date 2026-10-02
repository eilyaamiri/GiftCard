/**
 * Structural checks that belong to no catalogue: shapes the engine can judge
 * from the text alone. Anything the venue or the API defines (account-field
 * patterns, usernames) goes through `AssistantServices.validate` instead.
 */

const DECIMAL = /^\d+(\.\d{1,6})?$/u;

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/gu, ".");
}

/** Exact comparison of foreign-currency decimals (6 places) without a float. */
function scaled(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

export type Checked = { readonly value: string } | { readonly error: string };

export function checkSearch(raw: string): Checked {
  const value = raw.trim().replace(/\s+/gu, " ");
  if (value.length < 2) return { error: "حداقل ۲ حرف وارد کنید." };
  if (value.length > 80) return { error: "عبارت جستجو خیلی طولانی است." };
  return { value };
}

export function checkText(raw: string, min: number, max: number, label: string): Checked {
  const value = raw.trim();
  if (value.length < min) return { error: `${label} باید حداقل ${min.toLocaleString("fa-IR")} نویسه باشد.` };
  if (value.length > max) return { error: `${label} نباید بیشتر از ${max.toLocaleString("fa-IR")} نویسه باشد.` };
  return { value };
}

export function checkUrl(raw: string): Checked {
  const value = raw.trim();
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return { value };
  } catch {
    /* falls through */
  }
  return { error: "آدرس را کامل و با https:// وارد کنید." };
}

export function checkAmount(
  raw: string,
  bounds: { readonly min?: string | null; readonly max?: string | null; readonly currency: string },
): Checked {
  const value = toAsciiDigits(raw.trim());
  if (!DECIMAL.test(value) || scaled(value) <= 0n) return { error: "مبلغ را به‌صورت عدد وارد کنید." };
  if (bounds.min !== null && bounds.min !== undefined && scaled(value) < scaled(bounds.min)) {
    return { error: `حداقل مبلغ ${bounds.min} ${bounds.currency} است.` };
  }
  if (bounds.max !== null && bounds.max !== undefined && scaled(value) > scaled(bounds.max)) {
    return { error: `حداکثر مبلغ ${bounds.max} ${bounds.currency} است.` };
  }
  return { value };
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/u.test(value);
}

/**
 * A field that asks for a secret is never collected in a conversation, whatever
 * the venue or an admin called it. The assistant declines to run such a flow and
 * points the person to the site's own form instead.
 */
const CREDENTIAL_KEY = /pass(word|wd)?|otp|passcode|login[-_ ]?code|verification|secret|cvv|pin(?![a-z])/iu;

export function isCredentialField(field: { readonly key: string; readonly label?: string; readonly kind?: string }): boolean {
  if (field.kind === "password") return true;
  return CREDENTIAL_KEY.test(field.key) || CREDENTIAL_KEY.test(field.label ?? "") || /رمز|گذرواژه|پسورد|کد ورود|کد تأیید|کد تایید/u.test(field.label ?? "");
}
