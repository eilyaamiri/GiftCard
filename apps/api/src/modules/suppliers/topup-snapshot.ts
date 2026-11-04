export interface TopUpSnapshot {
  readonly providerSku: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly costAmount: string;
  readonly costCurrency: string;
  readonly accountFields: Record<string, string>;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * What the purchase needs, read back from a top-up quote's frozen snapshot.
 *
 * The quote writes the supplier next to the offer, inside `target`
 * (`quoteTargetSnapshot`). A top-level `supplier` is accepted as a fallback for
 * older rows. Returns null when anything is missing, never a partial target.
 */
export function readTopUpSnapshot(value: unknown): TopUpSnapshot | null {
  const snapshot = readRecord(value);
  const target = readRecord(snapshot?.['target']);
  const topUp = readRecord(target?.['topUp']);
  const supplier = readRecord(target?.['supplier']) ?? readRecord(snapshot?.['supplier']);
  const providerSku = topUp?.['providerSku'];
  const supplierId = supplier?.['id'];
  const supplierCode = supplier?.['code'];
  const costAmount = topUp?.['costAmount'];
  const costCurrency = topUp?.['costCurrency'];
  const accountFields = readRecord(snapshot?.['topUpAccountFields']);
  if (
    typeof providerSku !== 'string' ||
    typeof supplierId !== 'string' ||
    typeof supplierCode !== 'string' ||
    typeof costAmount !== 'string' ||
    typeof costCurrency !== 'string' ||
    accountFields === null
  ) {
    return null;
  }
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(accountFields)) {
    if (typeof entry !== 'string') {
      return null;
    }
    strings[key] = entry;
  }
  return { providerSku, supplierId, supplierCode, costAmount, costCurrency, accountFields: strings };
}
