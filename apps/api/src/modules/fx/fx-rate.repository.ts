import { Injectable } from '@nestjs/common';
import type { FxPair } from '@barat/contracts';
import { prisma } from '@barat/database';

import type {
  FxRateCreateData,
  FxRateRecord,
  FxRateRepository,
} from './fx.types';

/**
 * The only file in the FX module that talks to the database.
 *
 * Keeping Prisma here means the aggregator's selection policy — the part that
 * decides which rate prices a customer's order — is unit-testable with an
 * in-memory double and no live Postgres.
 */
@Injectable()
export class PrismaFxRateRepository implements FxRateRepository {
  /**
   * Every observation is written, including stale ones. The history table is
   * the audit record of what each provider actually reported (AGENTS.md rule 4)
   * and financial history is never hard-deleted.
   */
  async createRate(data: FxRateCreateData): Promise<FxRateRecord> {
    return prisma.fxRate.create({
      data: {
        pair: data.pair,
        buyRate: data.buyRate,
        sellRate: data.sellRate,
        midRate: data.midRate,
        source: data.source,
        provider: data.provider,
        receivedAt: data.receivedAt,
        effectiveAt: data.effectiveAt,
        expiresAt: data.expiresAt,
        isManualOverride: data.isManualOverride,
        overrideReason: data.overrideReason ?? null,
        createdByStaffId: data.createdByStaffId ?? null,
      },
    });
  }

  /** An override without an expiry is not active: a manual rate always ends. */
  async findActiveManualOverride(pair: FxPair, now: Date): Promise<FxRateRecord | null> {
    return prisma.fxRate.findFirst({
      where: { pair, isManualOverride: true, expiresAt: { gt: now } },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findHistory(pair: FxPair, skip: number, take: number): Promise<readonly FxRateRecord[]> {
    return prisma.fxRate.findMany({
      where: { pair },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  async countHistory(pair: FxPair): Promise<number> {
    return prisma.fxRate.count({ where: { pair } });
  }

  /** Expiry is a status change, never a delete (AGENTS.md data rule 6). */
  async expireManualOverrides(pair: FxPair, now: Date): Promise<number> {
    const result = await prisma.fxRate.updateMany({
      where: { pair, isManualOverride: true, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return result.count;
  }
}
