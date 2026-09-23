import type { PrismaClient } from '@barat/database';

export const CUSTOMERS_DATABASE = Symbol('CUSTOMERS_DATABASE');

/**
 * Deliberately narrow.
 *
 * `payment`, `order`, `refund`, `product` and `internationalService` are present
 * for READ access only — the customers module never writes to them. Operators
 * may look at a payment but may never change its status, amount or verification
 * result (AGENTS.md section 4; those transitions belong to the payments
 * workstream and are human-gated). `product`/`internationalService` exist only
 * to hydrate a favorited slug with its display title and taxonomy — favoriting
 * never touches catalog data.
 */
export type CustomersDatabase = Pick<
  PrismaClient,
  | 'customer'
  | 'customerProfile'
  | 'customerIdentity'
  | 'customerBankAccount'
  | 'customerNote'
  | 'customerFlag'
  | 'customerFavorite'
  | 'order'
  | 'payment'
  | 'refund'
  | 'product'
  | 'internationalService'
  | 'workItem'
  | 'queue'
  | 'staffUser'
  | 'supportTicket'
  | 'supportMessage'
  | 'supportOwnershipEvent'
  | '$transaction'
>;
