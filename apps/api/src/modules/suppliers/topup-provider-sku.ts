/**
 * The provider SKU a top-up offer is known by at its venue.
 *
 * Supplier catalog keys are normally `{category}:{offer}`. FazerCards' Telegram
 * catalog puts both its Stars and Premium families under the `telegram`
 * namespace, so its adapter receives a three-part key instead. Providers
 * continue to receive their own opaque SKU and other game suppliers retain
 * their existing catalog shape.
 *
 * There is exactly one composition, and both sides of the venue boundary use
 * it: the catalogue when it hands a quote the SKU to price, and the
 * availability sync when it matches the venue's catalogue back to our rows. Two
 * copies drifting apart does not throw — the sync would simply stop recognising
 * every offer and delist the whole storefront.
 */
const TOP_UP_SKU_NAMESPACE_BY_SUPPLIER: Readonly<Record<string, string>> = {
  'fazercards-steam': 'steam',
  'fazercards-telegram': 'telegram',
};

export function topUpProviderSku(
  supplierCode: string,
  providerCategoryId: string,
  providerOfferId: string,
): string {
  const namespace = TOP_UP_SKU_NAMESPACE_BY_SUPPLIER[supplierCode];
  return [namespace, providerCategoryId, providerOfferId].filter((part) => part !== undefined).join(':');
}

/**
 * A venue that sells an amount the customer types, rather than a ladder of
 * packages we list. The catalogue holds ONE template offer for it; the amount
 * is bound at quote time and frozen into the quote snapshot, which fulfillment
 * reads — so the provider SKU that is paid for is the SKU that is purchased.
 */
export const STEAM_CUSTOM_AMOUNT_SKU = 'steam:usd:custom';
/** Outer bounds on the typed USD amount, in cents. The venue's own limits are not in its API. */
export const STEAM_CUSTOM_MIN_USD_CENTS = 15n;
export const STEAM_CUSTOM_MAX_USD_CENTS = 100_000n;

export type VariableTopUpAmount =
  | { readonly variable: false }
  | { readonly variable: true; readonly ok: true; readonly providerSku: string; readonly amount: string; readonly currency: 'USD' }
  | { readonly variable: true; readonly ok: false; readonly reason: 'REQUIRED' | 'FORMAT' | 'BELOW_MIN' | 'ABOVE_MAX' };

/**
 * Binds the customer's typed amount to a variable-amount template offer.
 * Fixed offers pass through untouched. Pure integer-cents arithmetic: no float
 * ever touches the amount (AGENTS.md rule 2).
 */
export function bindVariableTopUpAmount(
  templateProviderSku: string,
  requestedAmount: string | undefined,
): VariableTopUpAmount {
  if (templateProviderSku !== STEAM_CUSTOM_AMOUNT_SKU) return { variable: false };
  if (requestedAmount === undefined || requestedAmount.trim() === '') {
    return { variable: true, ok: false, reason: 'REQUIRED' };
  }
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/u.exec(requestedAmount.trim());
  if (match === null) return { variable: true, ok: false, reason: 'FORMAT' };
  const cents = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents < STEAM_CUSTOM_MIN_USD_CENTS) return { variable: true, ok: false, reason: 'BELOW_MIN' };
  if (cents > STEAM_CUSTOM_MAX_USD_CENTS) return { variable: true, ok: false, reason: 'ABOVE_MAX' };
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  const amount = fraction === '' ? whole.toString() : `${whole}.${fraction}`;
  return { variable: true, ok: true, providerSku: `steam:usd:${amount}`, amount, currency: 'USD' };
}
