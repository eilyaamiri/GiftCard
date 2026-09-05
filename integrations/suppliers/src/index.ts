/**
 * @barat/suppliers — provider-neutral supplier integration contract.
 * Domain modules import this barrel and never a concrete provider SDK.
 */

export * from './supplier-provider.interface';
export * from './providers/mock-supplier.provider';
export * from './providers/reloadly-gift-card.provider';
