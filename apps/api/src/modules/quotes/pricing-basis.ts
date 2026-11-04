/** The snapshot's `pricingBasis` for a quote priced from a toman supplier. */
export const TOMAN_DIRECT_PRICING_BASIS = 'SUPPLIER_TOMAN_DIRECT';

/**
 * Whether a quote's snapshot says its supplier-cost column holds toman — the
 * supplier's own price, taken as cost with no exchange rate — instead of the
 * dollars every other quote stores there.
 */
export function isTomanDirectSnapshot(snapshot: unknown): boolean {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    (snapshot as Record<string, unknown>)['pricingBasis'] === TOMAN_DIRECT_PRICING_BASIS
  );
}
