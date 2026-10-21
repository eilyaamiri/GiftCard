import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import {
  idSchema,
  PRICING_RULE_BPS_FIELDS,
  PRICING_RULE_FIXED_IRR_FIELDS,
  PRICING_RULE_LARGE_CHANGE_BPS,
  PRICING_RULE_NEW_RULE_REVIEW_BPS,
  pricingRuleLimitViolations,
  pricingRuleScopeSchema,
  pricingRuleSnapshotSchema,
} from '@barat/contracts';
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
    scope: pricingRuleScopeSchema,
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
    if (value.scope !== 'GLOBAL' && value.scope !== 'TOP_UP_GAME' && value.targetId === null) {
      context.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'A non-global, non-top-up-game pricing rule must have a targetId',
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
    /* ORD-7: hard ceilings. A rule applies to every quote at once, so a typo
     * must be refused here rather than discovered on the next invoice. */
    for (const violation of pricingRuleLimitViolations(value)) {
      context.addIssue({ code: 'custom', path: [violation.path], message: violation.message });
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

const PROPOSAL_ENTITY = 'PricingRuleProposal';
const PROPOSED = 'PRICING_RULE_CHANGE_PROPOSED';
const APPROVED = 'PRICING_RULE_CHANGE_APPROVED';
const REJECTED = 'PRICING_RULE_CHANGE_REJECTED';

/** A proposal older than this must be made again: the market it was judged against has moved. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;

export type PricingRuleSubmission =
  | { readonly kind: 'APPLIED'; readonly rule: DatabasePricingRule }
  | { readonly kind: 'PENDING_APPROVAL'; readonly proposalId: string; readonly reasons: readonly string[] };

export interface PricingRuleProposal {
  readonly proposalId: string;
  readonly proposedByStaffId: string;
  readonly proposedBy: string;
  readonly createdAt: Date;
  readonly reasons: readonly string[];
  readonly request: PutPricingRuleRequest;
}

/**
 * Why a change needs a second approver, or nothing when it does not.
 *
 * Against the active rule: any basis-point field moving by more than
 * `PRICING_RULE_LARGE_CHANGE_BPS`, or a fixed amount changing by more than half
 * (and by more than 100,000 Toman). For a scope with no active rule: any
 * basis-point field above `PRICING_RULE_NEW_RULE_REVIEW_BPS`. Deactivating a
 * rule is lifecycle, not price, and is never held.
 */
export function largeChangeReasons(
  current: DatabasePricingRule | null,
  input: PutPricingRuleRequest,
): string[] {
  if (!input.isActive) return [];
  const reasons: string[] = [];
  for (const field of PRICING_RULE_BPS_FIELDS) {
    if (current === null) {
      if (input[field] > PRICING_RULE_NEW_RULE_REVIEW_BPS) reasons.push(`${field} above ${PRICING_RULE_NEW_RULE_REVIEW_BPS} bps`);
    } else if (Math.abs(input[field] - current[field]) > PRICING_RULE_LARGE_CHANGE_BPS) {
      reasons.push(`${field} ${current[field]} -> ${input[field]} bps`);
    }
  }
  if (current !== null) {
    for (const field of PRICING_RULE_FIXED_IRR_FIELDS) {
      const before = current[field];
      const after = BigInt(input[field]);
      const delta = after > before ? after - before : before - after;
      if (delta * 2n > before && delta > LARGE_FIXED_CHANGE_FLOOR_IRR) {
        reasons.push(`${field} ${before} -> ${after} IRR`);
      }
    }
  }
  return reasons;
}

/** A fixed-amount change smaller than 100,000 Toman never needs a second approver. */
const LARGE_FIXED_CHANGE_FLOOR_IRR = 1_000_000n;

function toProposal(row: { entityId: string; actor: string; createdAt: Date; after: unknown }): PricingRuleProposal {
  const after = (row.after ?? {}) as { request?: unknown; reasons?: unknown; proposedByStaffId?: unknown };
  return {
    proposalId: row.entityId,
    proposedByStaffId: typeof after.proposedByStaffId === 'string' ? after.proposedByStaffId : '',
    proposedBy: row.actor,
    createdAt: row.createdAt,
    reasons: Array.isArray(after.reasons) ? after.reasons.map(String) : [],
    request: putPricingRuleRequestSchema.parse(after.request),
  };
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

  /* ------------------------------------------------- second approval (ORD-7) */

  /**
   * The write path the admin form uses. A change under the review thresholds
   * is applied at once; a larger one is recorded as a proposal and waits for a
   * second FINANCE / ADMIN user, because a mistyped margin reprices every quote
   * from the next second.
   *
   * Proposals live in the audit log (entity `PricingRuleProposal`): the record
   * of who proposed what is the proposal, and the decision is a second row.
   */
  async submit(input: PutPricingRuleRequest, actor: PricingRuleActor): Promise<PricingRuleSubmission> {
    const current = await prisma.pricingRule.findFirst({
      where: { scope: input.scope, targetId: input.targetId },
      orderBy: { version: 'desc' },
    });
    const reasons = largeChangeReasons(current?.isActive === true ? current : null, input);
    if (reasons.length === 0) {
      return { kind: 'APPLIED', rule: await this.put(input, actor) };
    }
    if (actor.staffId === null) {
      throw new ConflictException('A pricing change that needs approval must be proposed by a staff member');
    }

    const proposalId = randomUUID();
    await prisma.auditLog.create({
      data: {
        actor: actor.auditActor,
        actorType: 'STAFF',
        actorRole: actor.role,
        action: PROPOSED,
        entity: PROPOSAL_ENTITY,
        entityId: proposalId,
        before: current === null ? Prisma.JsonNull : auditSnapshot(current),
        after: { request: input as unknown as Prisma.InputJsonObject, reasons, proposedByStaffId: actor.staffId },
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
    });
    return { kind: 'PENDING_APPROVAL', proposalId, reasons };
  }

  /** Proposals still waiting for a decision, newest first. */
  async listProposals(now: Date = new Date()): Promise<PricingRuleProposal[]> {
    const rows = await prisma.auditLog.findMany({
      where: {
        entity: PROPOSAL_ENTITY,
        action: PROPOSED,
        createdAt: { gt: new Date(now.getTime() - PROPOSAL_TTL_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    if (rows.length === 0) return [];
    const decided = await prisma.auditLog.findMany({
      where: {
        entity: PROPOSAL_ENTITY,
        action: { in: [APPROVED, REJECTED] },
        entityId: { in: rows.map((row) => row.entityId) },
      },
      select: { entityId: true },
    });
    const closed = new Set(decided.map((row) => row.entityId));
    return rows.filter((row) => !closed.has(row.entityId)).map(toProposal);
  }

  /**
   * The second pair of eyes. The proposer cannot approve their own change, an
   * old proposal must be made again, and the rule's `expectedVersion` still
   * refuses it if the rule moved in the meantime.
   */
  async approveProposal(
    proposalId: string,
    approver: PricingRuleActor,
    now: Date = new Date(),
  ): Promise<DatabasePricingRule> {
    const proposal = await this.openProposal(proposalId, now);
    if (approver.staffId === null || approver.staffId === proposal.proposedByStaffId) {
      throw new ConflictException('A pricing change must be approved by someone other than its proposer');
    }
    const rule = await this.put(proposal.request, approver);
    await this.recordDecision(proposalId, APPROVED, approver, { ruleId: rule.id, version: rule.version });
    return rule;
  }

  async rejectProposal(proposalId: string, actor: PricingRuleActor, now: Date = new Date()): Promise<void> {
    await this.openProposal(proposalId, now);
    await this.recordDecision(proposalId, REJECTED, actor, {});
  }

  private async openProposal(proposalId: string, now: Date): Promise<PricingRuleProposal> {
    const row = await prisma.auditLog.findFirst({
      where: { entity: PROPOSAL_ENTITY, entityId: proposalId, action: PROPOSED },
    });
    if (!row) {
      throw new NotFoundException('Pricing rule proposal not found');
    }
    const decided = await prisma.auditLog.findFirst({
      where: { entity: PROPOSAL_ENTITY, entityId: proposalId, action: { in: [APPROVED, REJECTED] } },
    });
    if (decided) {
      throw new ConflictException('This pricing rule proposal has already been decided');
    }
    if (now.getTime() - row.createdAt.getTime() > PROPOSAL_TTL_MS) {
      throw new ConflictException('This pricing rule proposal has expired; propose the change again');
    }
    return toProposal(row);
  }

  private async recordDecision(
    proposalId: string,
    action: typeof APPROVED | typeof REJECTED,
    actor: PricingRuleActor,
    after: Prisma.InputJsonObject,
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actor: actor.auditActor,
        actorType: 'STAFF',
        actorRole: actor.role,
        action,
        entity: PROPOSAL_ENTITY,
        entityId: proposalId,
        before: Prisma.JsonNull,
        after: { ...after, decidedByStaffId: actor.staffId },
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
    });
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
