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
