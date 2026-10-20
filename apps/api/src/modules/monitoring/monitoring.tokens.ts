import type { PrismaClient } from '@barat/database';

export const MONITORING_DATABASE = Symbol('MONITORING_DATABASE');

/**
 * Minimal database interface for monitoring queries (read-only).
 *
 * `paymentAttempt` is here for gateway status only; the queries select status,
 * time and provider and never a payload, message or authority.
 */
export type MonitoringDatabase = Pick<PrismaClient, 'order' | 'paymentAttempt'>;
