import { Inject, Injectable } from '@nestjs/common';
import type { ChecklistItemStatus } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { templateFor } from './checklist-templates';
import {
  assessContextCostVariance,
  computeSendBlockers,
  evaluateChecklist,
  type ChecklistEvaluation,
  type SendBlocker,
} from './checklist-evaluation';
import type { CostVarianceAssessment } from './cost-variance';
import {
  FULFILLMENT_STORE,
  type ChecklistItemRecord,
  type ChecklistRecord,
  type ChecklistView,
  type FulfillmentContext,
  type FulfillmentStore,
} from './fulfillment.types';

export interface ChecklistState {
  readonly view: ChecklistView;
  readonly record: ChecklistRecord;
  readonly evaluation: ChecklistEvaluation;
  readonly variance: CostVarianceAssessment | null;
  readonly isLocked: boolean;
  readonly sendBlockers: readonly SendBlocker[];
}

/** A checklist is locked once it has been completed by a successful send. */
export function isChecklistLocked(record: ChecklistRecord): boolean {
  return record.status === 'COMPLETED' && record.completedAt !== null;
}

function toItemView(item: ChecklistItemRecord, status: ChecklistItemStatus): ChecklistView['items'][number] {
  return {
    id: item.id,
    key: item.key,
    label: item.label,
    labelFa: item.labelFa,
    type: item.type,
    status,
    isBlocking: item.isBlocking,
    sortOrder: item.sortOrder,
    hasValue: item.hasValue,
    verifiedByStaffId: item.verifiedByStaffId,
    verifiedAt: item.verifiedAt,
    note: item.note,
    // Only BOOLEAN and operator-supplied REQUIRED_FIELD items are clickable.
    // SYSTEM_VERIFIED is derived; MANAGER_APPROVAL needs a manager action.
    isOperatorEditable: item.type === 'BOOLEAN' || item.type === 'REQUIRED_FIELD',
  };
}

/**
 * Owns the checklist lifecycle: materialising it from a template, re-deriving the
 * system-verified items on every read, and persisting the derived state so the
 * audit trail and the operator UI agree.
 */
@Injectable()
export class ChecklistService {
  constructor(
    @Inject(FULFILLMENT_STORE) private readonly store: FulfillmentStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Returns the checklist for a work item, creating it from the shipped template
   * the first time the workspace is opened.
   */
  async ensure(context: FulfillmentContext): Promise<ChecklistState> {
    const existing = await this.store.findChecklist(context.workItemId);
    if (existing !== null) {
      return this.refresh(context, existing);
    }

    const template = templateFor(context.workItemType);
    const persisted = await this.store.ensureTemplate({
      workItemType: template.workItemType,
      queueKey: template.queueKey,
      definition: template.definition,
    });

    const created = await this.store.createChecklist({
      workItemId: context.workItemId,
      templateId: persisted.id,
      items: template.definition.map((definition) => ({
        ...definition,
        status: 'PENDING' as ChecklistItemStatus,
        hasValue: false,
      })),
    });

    await this.audit.record({
      actor: 'system',
      actorType: 'SYSTEM',
      action: 'FULFILLMENT_CHECKLIST_CREATED',
      entity: 'FulfillmentChecklist',
      entityId: created.id,
      after: {
        workItemId: context.workItemId,
        templateId: persisted.id,
        itemKeys: template.definition.map((item) => item.key),
      },
    });

    return this.refresh(context, created);
  }

  /**
   * Re-derives every non-human item from current state and persists the diff.
   *
   * This runs on every read, which is the point: a SYSTEM_VERIFIED item can never
   * be stale, and an operator cannot "hold" a passed state that stopped being
   * true (e.g. by unsetting the actual cost).
   */
  async refresh(context: FulfillmentContext, record: ChecklistRecord): Promise<ChecklistState> {
    const isLocked = isChecklistLocked(record);
    const variance = assessContextCostVariance(context);
    const evaluation = evaluateChecklist({ checklist: record, context, variance, isLocked });

    if (!isLocked) {
      for (const item of evaluation.items) {
        if (!item.changed) {
          continue;
        }
        await this.store.updateChecklistItem({
          itemId: item.record.id,
          status: item.status,
          // A derived item is not attributable to a person; clear any stale
          // verifier so the audit trail never credits a human for a machine check.
          ...(item.record.type === 'SYSTEM_VERIFIED' ? { verifiedByStaffId: null, verifiedAt: null } : {}),
        });
      }

      if (
        evaluation.checklistStatus !== record.status ||
        evaluation.blockedReason !== record.blockedReason
      ) {
        await this.store.updateChecklistStatus({
          checklistId: record.id,
          status: evaluation.checklistStatus,
          blockedReason: evaluation.blockedReason,
        });
      }
    }

    const sendBlockers = computeSendBlockers({ context, evaluation, variance, isLocked });

    const view: ChecklistView = {
      id: record.id,
      workItemId: record.workItemId,
      templateId: record.templateId,
      status: isLocked ? record.status : evaluation.checklistStatus,
      blockedReason: isLocked ? record.blockedReason : evaluation.blockedReason,
      completedAt: record.completedAt,
      isLocked,
      items: evaluation.items.map((item) => toItemView(item.record, item.status)),
    };

    return { view, record, evaluation, variance, isLocked, sendBlockers };
  }

  async load(context: FulfillmentContext): Promise<ChecklistState> {
    return this.ensure(context);
  }

  /**
   * Records a human confirmation on a BOOLEAN item.
   *
   * Refuses SYSTEM_VERIFIED and MANAGER_APPROVAL items outright — a tick on those
   * would be a lie about who verified what, and the whole gate rests on that
   * distinction being real rather than a UI convention.
   */
  async confirmBooleanItem(input: {
    context: FulfillmentContext;
    itemKey: string;
    staffId: string;
    checked: boolean;
    note?: string;
  }): Promise<ChecklistState> {
    const state = await this.ensure(input.context);
    if (state.isLocked) {
      throw DomainErrors.conflict(
        'این چک‌لیست پس از ارسال قفل شده است.',
        `checklist ${state.record.id} is locked`,
      );
    }

    const item = state.record.items.find((candidate) => candidate.key === input.itemKey);
    if (item === undefined) {
      throw DomainErrors.notFound(`checklist item ${input.itemKey}`);
    }
    if (item.type !== 'BOOLEAN') {
      throw DomainErrors.forbidden(`checklist item ${item.key} of type ${item.type} is not operator-checkable`);
    }

    const status: ChecklistItemStatus = input.checked ? 'PASSED' : 'PENDING';
    const at = new Date();
    await this.store.updateChecklistItem({
      itemId: item.id,
      status,
      verifiedByStaffId: input.checked ? input.staffId : null,
      verifiedAt: input.checked ? at : null,
      ...(input.note === undefined ? {} : { note: input.note }),
    });

    await this.audit.record({
      actor: input.staffId,
      actorType: 'STAFF',
      action: 'FULFILLMENT_CHECKLIST_ITEM_CHECKED',
      entity: 'FulfillmentChecklistItem',
      entityId: item.id,
      before: { status: item.status },
      after: { status, key: item.key, checkedBy: input.staffId, checkedAt: at.toISOString() },
    });

    return this.reload(input.context);
  }

  /**
   * Stores the value of an operator-supplied REQUIRED_FIELD item. The item passes
   * automatically the moment a non-empty value exists — no separate tick.
   */
  async setRequiredFieldItem(input: {
    context: FulfillmentContext;
    itemKey: string;
    staffId: string;
    value: string;
  }): Promise<ChecklistState> {
    const state = await this.ensure(input.context);
    if (state.isLocked) {
      throw DomainErrors.conflict(
        'این چک‌لیست پس از ارسال قفل شده است.',
        `checklist ${state.record.id} is locked`,
      );
    }

    const item = state.record.items.find((candidate) => candidate.key === input.itemKey);
    if (item === undefined) {
      throw DomainErrors.notFound(`checklist item ${input.itemKey}`);
    }
    if (item.type !== 'REQUIRED_FIELD') {
      throw DomainErrors.forbidden(`checklist item ${item.key} of type ${item.type} does not accept a value`);
    }

    const at = new Date();
    await this.store.setChecklistItemValue({
      itemId: item.id,
      value: { text: input.value },
      status: 'PASSED',
      verifiedByStaffId: input.staffId,
      verifiedAt: at,
    });

    await this.audit.record({
      actor: input.staffId,
      actorType: 'STAFF',
      action: 'FULFILLMENT_CHECKLIST_FIELD_SET',
      entity: 'FulfillmentChecklistItem',
      entityId: item.id,
      // The value itself is not audited: a REQUIRED_FIELD may hold a customer
      // account reference. Only the fact that it was set is recorded.
      after: { key: item.key, hasValue: true, setBy: input.staffId, setAt: at.toISOString() },
    });

    return this.reload(input.context);
  }

  /** Freezes the checklist. Called only after a delivery has actually succeeded. */
  async lock(checklistId: string, at: Date): Promise<void> {
    await this.store.updateChecklistStatus({
      checklistId,
      status: 'COMPLETED',
      blockedReason: null,
      completedAt: at,
    });
  }

  /** Unfreezes a locked checklist. The caller must have checked the manager role. */
  async unlock(checklistId: string): Promise<void> {
    await this.store.updateChecklistStatus({
      checklistId,
      status: 'INCOMPLETE',
      blockedReason: null,
      completedAt: null,
    });
  }

  private async reload(context: FulfillmentContext): Promise<ChecklistState> {
    const fresh = await this.store.findChecklist(context.workItemId);
    if (fresh === null) {
      throw DomainErrors.notFound(`checklist for work item ${context.workItemId}`);
    }
    return this.refresh(context, fresh);
  }
}
