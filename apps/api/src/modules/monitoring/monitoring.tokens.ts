import type { PrismaClient } from '@barat/database';

export const MONITORING_DATABASE = Symbol('MONITORING_DATABASE');

/** Minimal database interface for monitoring queries (read-only). */
export type MonitoringDatabase = Pick<PrismaClient, 'order'>;
