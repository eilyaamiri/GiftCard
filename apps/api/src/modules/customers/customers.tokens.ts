import type { PrismaClient } from '@barat/database';

export const CUSTOMERS_DATABASE = Symbol('CUSTOMERS_DATABASE');

/**
 * Deliberately narrow.
 *
 * `payment`, `order` and `refund` are present for READ access only — the
 * customers module never writes to them. Operators may look at a payment but may
 * never change its status, amount or verification result (AGENTS.md section 4;
 * those transitions belong to the payments workstream and are human-gated).
 */
export type CustomersDatabase = Pick<
  PrismaClient,
  | 'customer'
  | 'customerProfile'
  | 'customerIdentity'
  | 'customerNote'
  | 'customerFlag'
  | 'order'
  | 'payment'
  | 'refund'
  | 'workItem'
  | 'queue'
>;
