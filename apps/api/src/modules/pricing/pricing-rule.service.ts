import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { idSchema, pricingRuleSnapshotSchema } from '@barat/contracts';
import {
  Prisma,
  type PricingRule as DatabasePricingRule,
  type PricingRuleScope,
  prisma,
} from '@barat/database';

import type { PricingRule } from './pricing.types';

const pricingRuleValuesSchema = pricingRuleSnapshotSchema.omit({
  id: true,
  version: true,
});

/**
 * PUT is an immutable replacement of one scope/target chain. `expectedVersion`
 * provides optimistic concurrency; omitting it is allowed only for initial setup.
 */
export const putPricingRuleRequestSchema = pricingRuleValuesSchema
  .extend({
    scope: z.enum(['GLOBAL', 'PRODUCT', 'SKU', 'SERVICE']),
    targetId: idSchema.nullable(),
    expectedVersion: z.number().int().min(1).optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.scope === 'GLOBAL' && value.targetId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A GLOBAL pricing rule must have a null targetId',
      });
    }
    if (value.scope !== 'GLOBAL' && value.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A non-global pricing rule must have a targetId',
      });
    }
    const roundingStepIrr = BigInt(value.roundingStepIrr);
    if (roundingStepIrr <= 0n) {
      context.addIssue({
        code: 'custom',
        path: ['roundingStepIrr'],
        message: 'Rounding step must be greater than zero',
      });
    } else if (roundingStepIrr % 10n !== 0n) {
      /*
       * The customer UI displays Toman. Persisting a step with a rial remainder
       * would create an ACTIVE rule that can never produce a displayable quote:
       * the engine's exact `irrToToman` conversion would (correctly) reject it.
       * Catch the operator error at the write boundary instead.
       */
      context.addIssue({
        code: 'custom',
        path: ['roundingStepIrr'],
        message: 'Rounding step must be a whole Toman (a multiple of 10 IRR)',
      });
    }
  });

export type PutPricingRuleRequest = z.infer<typeof putPricingRuleRequestSchema>;

export interface PricingRuleActor {
  readonly staffId: string | null;
  readonly auditActor: string;
  readonly role: string | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface PricingRuleListOptions {
  readonly includeHistory?: boolean;
}

export interface WirePricingRule {
  readonly id: string;
  readonly name: string;
  readonly scope: keyof typeof PricingRuleScope;
  readonly targetId: string | null;
  readonly version: number;
  readonly fxSpreadBps: number;
  readonly fxRiskBufferBps: number;
  readonly serviceFeeBps: number;
  readonly serviceFeeFixedIrr: string;
  readonly operationalFeeIrr: string;
  readonly targetMarginBps: number;
  readonly minimumMarginIrr: string;
  readonly paymentFeeBps: number;
  readonly paymentFeeFixedIrr: string;
  readonly quoteTtlSeconds: number;
  readonly roundingStepIrr: string;
  readonly maxSupplierCostToleranceBps: number;
  readonly isActive: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly createdByStaffId: string | null;
  readonly createdAt: string;
}

/**
 * Versioned PricingRule persistence. Economic fields are never updated on an
 * existing row; replacing or deactivating a rule always inserts a new version.
 */
@Injectable()
export class PricingRuleService {
  async list(options: PricingRuleListOptions = {}): Promise<readonly DatabasePricingRule[]> {
    return prisma.pricingRule.findMany({
      where: options.includeHistory ? undefined : { isActive: true },
      orderBy: [{ scope: 'asc' }, { targetId: 'asc' }, { version: 'desc' }],
    });
  }

  async get(id: string): Promise<DatabasePricingRule> {
    const rule = await prisma.pricingRule.findUnique({ where: { id } });
    if (!rule) {
      throw new NotFoundException('Pricing rule not found');
    }
    return rule;
  }

  async put(
    input: PutPricingRuleRequest,
    actor: PricingRuleActor,
  ): Promise<DatabasePricingRule> {
    const data = requestToData(input);

    return this.withSerializableRetry(async () =>
      prisma.$transaction(
        async (transaction) => {
          const current = await transaction.pricingRule.findFirst({
            where: { scope: input.scope, targetId: input.targetId },
            orderBy: { version: 'desc' },
          });

          enforceExpectedVersion(input.expectedVersion, current);
          const nextVersion = current === null ? 1 : checkedNextVersion(current.version);
          const now = new Date();

          if (current !== null) {
            // Only lifecycle metadata changes. Every economic field on the old
            // version remains immutable and auditable forever.
            await transaction.pricingRule.updateMany({
              where: {
                scope: input.scope,
                targetId: input.targetId,
                isActive: true,
              },
              data: { isActive: false, effectiveTo: now },
            });
          }

          const created = await transaction.pricingRule.create({
            data: {
              ...data,
              scope: input.scope,
              targetId: input.targetId,
              version: nextVersion,
              isActive: input.isActive,
              effectiveFrom: now,
              effectiveTo: input.isActive ? null : now,
              ...(actor.staffId === null ? {} : { createdByStaffId: actor.staffId }),
            },
          });

          await transaction.auditLog.create({
            data: {
              actor: actor.auditActor,
              actorType: 'STAFF',
              actorRole: actor.role,
              action: current === null ? 'PRICING_RULE_CREATED' : 'PRICING_RULE_UPDATED',
              entity: 'PricingRule',
              entityId: created.id,
              before: current === null ? Prisma.JsonNull : auditSnapshot(current),
              after: auditSnapshot(created),
              ip: actor.ip ?? null,
              userAgent: actor.userAgent ?? null,
              requestId: actor.requestId ?? null,
            },
          });

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /** A logical delete: copy the current values into a new inactive version. */
  async deactivate(
    id: string,
    expectedVersion: number,
    actor: PricingRuleActor,
  ): Promise<DatabasePricingRule> {
    const current = await this.get(id);
    if (current.version !== expectedVersion) {
      throw versionConflict(expectedVersion, current.version);
    }

    return this.put(databaseRuleToPutRequest(current, false), actor);
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maximumAttempts = 3;
    let attempt = 1;

    /* `while (true)` is deliberate: every pass either returns, throws, or bumps
     * the attempt counter. It avoids a synthetic "unreachable" throw after a
     * bounded `for` loop — dead code is a poor thing to carry in an audited
     * financial write path merely to appease `noImplicitReturns`. */
    while (true) {
      try {
        return await operation();
      } catch (error: unknown) {
        if (attempt >= maximumAttempts || !isRetryableTransactionError(error)) {
          throw error;
        }
        attempt += 1;
      }
    }
  }
}

export function toEnginePricingRule(rule: DatabasePricingRule): PricingRule {
  return Object.freeze({
    id: rule.id,
    name: rule.name,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: rule.serviceFeeFixedIrr,
    operationalFeeIrr: rule.operationalFeeIrr,
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr,
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: rule.paymentFeeFixedIrr,
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr,
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
  });
}

export function toWirePricingRule(rule: DatabasePricingRule): WirePricingRule {
  return {
    id: rule.id,
    name: rule.name,
    scope: rule.scope,
    targetId: rule.targetId,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: rule.serviceFeeFixedIrr.toString(),
    operationalFeeIrr: rule.operationalFeeIrr.toString(),
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr.toString(),
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: rule.paymentFeeFixedIrr.toString(),
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr.toString(),
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
    isActive: rule.isActive,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    createdByStaffId: rule.createdByStaffId,
    createdAt: rule.createdAt.toISOString(),
  };
}

function requestToData(input: PutPricingRuleRequest): {
  readonly name: string;
  readonly fxSpreadBps: number;
  readonly fxRiskBufferBps: number;
  readonly serviceFeeBps: number;
  readonly serviceFeeFixedIrr: bigint;
  readonly operationalFeeIrr: bigint;
  readonly targetMarginBps: number;
  readonly minimumMarginIrr: bigint;
  readonly paymentFeeBps: number;
  readonly paymentFeeFixedIrr: bigint;
  readonly quoteTtlSeconds: number;
  readonly roundingStepIrr: bigint;
  readonly maxSupplierCostToleranceBps: number;
} {
  return {
    name: input.name,
    fxSpreadBps: input.fxSpreadBps,
    fxRiskBufferBps: input.fxRiskBufferBps,
    serviceFeeBps: input.serviceFeeBps,
    serviceFeeFixedIrr: BigInt(input.serviceFeeFixedIrr),
    operationalFeeIrr: BigInt(input.operationalFeeIrr),
    targetMarginBps: input.targetMarginBps,
    minimumMarginIrr: BigInt(input.minimumMarginIrr),
    paymentFeeBps: input.paymentFeeBps,
    paymentFeeFixedIrr: BigInt(input.paymentFeeFixedIrr),
    quoteTtlSeconds: input.quoteTtlSeconds,
    roundingStepIrr: BigInt(input.roundingStepIrr),
    maxSupplierCostToleranceBps: input.maxSupplierCostToleranceBps,
  };
}

function databaseRuleToPutRequest(
  rule: DatabasePricingRule,
  isActive: boolean,
): PutPricingRuleRequest {
  return putPricingRuleRequestSchema.parse({
    name: rule.name,
    scope: rule.scope,
    targetId: rule.targetId,
    expectedVersion: rule.version,
    isActive,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: rule.serviceFeeFixedIrr.toString(),
    operationalFeeIrr: rule.operationalFeeIrr.toString(),
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr.toString(),
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: rule.paymentFeeFixedIrr.toString(),
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr.toString(),
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
  });
}

function enforceExpectedVersion(
  expectedVersion: number | undefined,
  current: DatabasePricingRule | null,
): void {
  if (current === null && expectedVersion !== undefined) {
    throw new ConflictException('Pricing rule does not exist at the expected version');
  }
  if (current !== null && expectedVersion === undefined) {
    throw new ConflictException('expectedVersion is required when replacing a pricing rule');
  }
  if (current !== null && expectedVersion !== current.version) {
    throw versionConflict(expectedVersion, current.version);
  }
}

function versionConflict(expected: number | undefined, actual: number): ConflictException {
  return new ConflictException(
    `Pricing rule version conflict: expected ${String(expected)}, current ${String(actual)}`,
  );
}

function checkedNextVersion(currentVersion: number): number {
  if (!Number.isSafeInteger(currentVersion) || currentVersion >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Pricing rule version cannot be incremented safely');
  }
  return currentVersion + 1;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = (error as { readonly code?: unknown }).code;
  return code === 'P2034' || code === 'P2002';
}

function auditSnapshot(rule: DatabasePricingRule): Prisma.InputJsonObject {
  return {
    id: rule.id,
    name: rule.name,
    scope: rule.scope,
    targetId: rule.targetId,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: rule.serviceFeeFixedIrr.toString(),
    operationalFeeIrr: rule.operationalFeeIrr.toString(),
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr.toString(),
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: rule.paymentFeeFixedIrr.toString(),
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr.toString(),
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
    isActive: rule.isActive,
    effectiveFrom: rule.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo?.toISOString() ?? null,
  };
}
