import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import type { StaffRole } from '@barat/contracts';

import { FulfillmentController } from '../../fulfillment/fulfillment.controller';
import { FxController } from '../../fx/fx.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { requireStaffActor } from '../../fx/fx-staff.guard';
import { requireStaff } from '../../workitems/staff-context';
import { WorkItemsController } from '../../workitems/workitems.controller';
import { ROLES_METADATA_KEY } from './roles.decorator';

/**
 * Regression cover for a bug that made every operator route unusable.
 *
 * Three modules each invented their own name for the authenticated principal —
 * `request.staff`, `request.user`, `request.staffUser` — while the identity
 * layer attaches it as `request.actor`. On top of that the operator controllers
 * carried no `@Roles`, so RolesGuard short-circuited, nothing resolved the
 * session, and the manual `requireStaff` calls failed closed. The result was a
 * 401 on every `/api/operator/*` route and both FX override routes even with a
 * valid ADMIN session.
 *
 * Failing closed was the correct behaviour for the readers; the defect was the
 * wiring. These tests pin both halves of the fix.
 */

function rolesOn(controller: abstract new (...args: never[]) => unknown): readonly StaffRole[] | undefined {
  return Reflect.getMetadata(ROLES_METADATA_KEY, controller) as readonly StaffRole[] | undefined;
}

const STAFF_ACTOR = {
  type: 'STAFF' as const,
  staffId: 'staff_1',
  role: 'OPERATOR' as StaffRole,
  email: 'operator1@barat.demo',
};

const CUSTOMER_ACTOR = {
  type: 'CUSTOMER' as const,
  customerId: 'cust_1',
  sessionId: 'sess_1',
};

describe('staff route wiring', () => {
  describe('@Roles is present on every staff-only controller', () => {
    /* Without the decorator RolesGuard returns early, no actor is attached, and
     * requireStaff rejects the request — the exact failure this pins. */
    it.each([
      ['work items', WorkItemsController],
      ['fulfillment', FulfillmentController],
      ['suppliers', SuppliersController],
    ])('%s controller declares its roles', (_name, controller) => {
      const roles = rolesOn(controller);
      expect(roles, 'controller must carry @Roles or it authenticates nobody').toBeDefined();
      expect(roles).toContain('OPERATOR');
      expect(roles).toContain('ADMIN');
    });

    it('operator controllers exclude roles that do not do fulfilment work', () => {
      for (const controller of [WorkItemsController, FulfillmentController, SuppliersController]) {
        const roles = rolesOn(controller) ?? [];
        expect(roles).not.toContain('VIEWER');
        expect(roles).not.toContain('SUPPORT');
        expect(roles).not.toContain('FINANCE');
      }
    });

    it('the FX override routes declare roles, so the guard receives an actor', () => {
      const post = Reflect.getMetadata(
        ROLES_METADATA_KEY,
        FxController.prototype.setOverride,
      ) as readonly StaffRole[] | undefined;
      const del = Reflect.getMetadata(
        ROLES_METADATA_KEY,
        FxController.prototype.clearOverride,
      ) as readonly StaffRole[] | undefined;

      for (const roles of [post, del]) {
        expect(roles).toBeDefined();
        expect([...(roles ?? [])].sort()).toEqual(['ADMIN', 'FINANCE']);
      }
    });
  });

  describe('the principal readers read what the identity layer actually sets', () => {
    it('requireStaff accepts the actor attached by RolesGuard', () => {
      expect(requireStaff({ actor: STAFF_ACTOR })).toEqual({
        id: 'staff_1',
        role: 'OPERATOR',
      });
    });

    it('requireStaffActor accepts the same actor', () => {
      expect(requireStaffActor({ actor: STAFF_ACTOR })).toEqual({
        id: 'staff_1',
        role: 'OPERATOR',
      });
    });

    it('both refuse a customer session', () => {
      expect(() => requireStaff({ actor: CUSTOMER_ACTOR })).toThrow();
      expect(() => requireStaffActor({ actor: CUSTOMER_ACTOR })).toThrow();
    });

    it('both still fail closed when no actor was resolved', () => {
      expect(() => requireStaff({})).toThrow();
      expect(() => requireStaffActor({})).toThrow();
    });

    it('neither is fooled by an unauthenticated body claiming to be staff', () => {
      /* The request body is attacker-controlled; only the guard's actor counts. */
      expect(() => requireStaff({ body: STAFF_ACTOR })).toThrow();
      expect(() => requireStaffActor({ body: STAFF_ACTOR } as never)).toThrow();
    });
  });
});
