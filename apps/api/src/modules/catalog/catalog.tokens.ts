import type { PrismaClient } from '@barat/database';

/* ============================================================================
 * Database port
 *
 * A narrow slice of the Prisma client: catalog owns products, SKUs, suppliers,
 * offers and international services, and nothing else. Depending on the slice
 * rather than the singleton keeps the service unit-testable and makes it
 * impossible for a catalog method to quietly read an order or a payment.
 * ==========================================================================*/

export const CATALOG_DATABASE = Symbol('CATALOG_DATABASE');

export type CatalogDatabase = Pick<
  PrismaClient,
  | 'product'
  | 'sku'
  | 'supplier'
  | 'supplierOffer'
  | 'internationalService'
  | 'serviceFieldDefinition'
  /* The array form of `$transaction` is used for list + count pairs, so the
   * page and its total always come from one consistent read. */
  | '$transaction'
>;
