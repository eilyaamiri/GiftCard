import 'reflect-metadata';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

/* Imported for decorator metadata only; their modules reach the Prisma
 * singleton at import time. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null, Decimal: class {} } }));
/* The config barrel's module validates the whole environment at import time;
 * nothing here boots Nest, so a stand-in class is enough. */
vi.mock('../../../common/config/config.module', () => ({ AppConfigModule: class {} }));

import { CatalogAdminController } from '../../catalog/catalog-admin.controller';
import { CatalogController } from '../../catalog/catalog.controller';
import { AccountController } from '../../customers/account.controller';
import { AdminFaqsController } from '../../customers/admin-faqs.controller';
import { AdminReviewsController } from '../../customers/admin-reviews.controller';
import { AdminSupportChannelsController } from '../../customers/admin-support-channels.controller';
import { CustomersController } from '../../customers/customers.controller';
import { FaqsController } from '../../customers/faqs.controller';
import { ReviewsController } from '../../customers/reviews.controller';
import { SupportChannelsController } from '../../customers/support-channels.controller';
import { SupportController } from '../../customers/support.controller';
import { FinanceController } from '../../finance/finance.controller';
import { FulfillmentController } from '../../fulfillment/fulfillment.controller';
import { InternalFulfillmentController } from '../../fulfillment/internal-fulfillment.controller';
import { FxController } from '../../fx/fx.controller';
import { GiftCardRequestsController } from '../../gift-card-requests/gift-card-requests.controller';
import { HealthController } from '../../health/health.controller';
import { AdminKbController } from '../../kb/admin-kb.controller';
import { KbController } from '../../kb/kb.controller';
import { MonitoringController } from '../../monitoring/monitoring.controller';
import { OrdersAdminController } from '../../orders/orders-admin.controller';
import { OrdersController } from '../../orders/orders.controller';
import { PaymentsController } from '../../payments/payments.controller';
import { RefundsController } from '../../payments/refunds.controller';
import { PricingController } from '../../pricing/pricing.controller';
import { QuotesController } from '../../quotes/quotes.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import {
  AdminBackupSettingsController,
  AdminSmtpSettingsController,
} from '../../system-settings/admin-system-settings.controller';
import { StaffNotificationsController } from '../../workitems/staff-notifications.controller';
import { WorkItemsController } from '../../workitems/workitems.controller';
import { AdminSettingsController } from '../admin-settings.controller';
import { AuthController } from '../auth.controller';
import { StaffAuthController } from '../staff-auth.controller';
import {
  CUSTOMER_SCOPED_METADATA_KEY,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from './roles.decorator';

/**
 * Sweep of every HTTP handler in the API.
 *
 * `RolesGuard` and `CustomerScopedGuard` are global but default-ALLOW: a route
 * that carries none of `@Public`, `@Roles` or `@CustomerScoped` is reachable by
 * anyone, with no session resolved. That is how two separate wiring bugs
 * shipped (see the staff and customer wiring tests). This test makes the
 * classification explicit: every handler must declare one of the three, or be
 * listed below with the reason it is intentionally unauthenticated.
 *
 * A NEW controller must be added to CONTROLLERS. Adding a handler to the
 * allow-list is a security decision and needs a human reviewer (AGENTS.md §4).
 */
type AnyController = abstract new (...args: never[]) => unknown;

const CONTROLLERS: readonly AnyController[] = [
  CatalogAdminController,
  CatalogController,
  AccountController,
  AdminFaqsController,
  AdminReviewsController,
  AdminSupportChannelsController,
  CustomersController,
  FaqsController,
  ReviewsController,
  SupportChannelsController,
  SupportController,
  FinanceController,
  FulfillmentController,
  InternalFulfillmentController,
  FxController,
  GiftCardRequestsController,
  HealthController,
  AdminKbController,
  KbController,
  MonitoringController,
  AdminSmtpSettingsController,
  AdminBackupSettingsController,
  OrdersAdminController,
  OrdersController,
  PaymentsController,
  RefundsController,
  PricingController,
  QuotesController,
  SuppliersController,
  StaffNotificationsController,
  WorkItemsController,
  AdminSettingsController,
  AuthController,
  StaffAuthController,
];

/** `Controller.method` -> why it carries no auth decorator. */
const UNDECORATED_BY_DESIGN: Readonly<Record<string, string>> = {
  'HealthController.ready': 'load-balancer readiness probe',
  'HealthController.live': 'load-balancer liveness probe',
  'InternalFulfillmentController.retryDelivery':
    'machine-to-machine; authenticated in-handler by INTERNAL_SERVICE_TOKEN',
  'InternalFulfillmentController.reportDeliveryProblem':
    'machine-to-machine; authenticated in-handler by INTERNAL_SERVICE_TOKEN',
};

function has(key: string, target: object): boolean {
  return Reflect.getMetadata(key, target) !== undefined;
}

function handlersOf(controller: AnyController): string[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).filter((name) => {
    if (name === 'constructor') return false;
    const member = prototype[name];
    return (
      typeof member === 'function' &&
      Reflect.getMetadata(PATH_METADATA, member) !== undefined &&
      Reflect.getMetadata(METHOD_METADATA, member) !== undefined
    );
  });
}

function classify(controller: AnyController, handler: string): 'public' | 'staff' | 'customer' | null {
  const method = (controller.prototype as Record<string, object>)[handler]!;
  /* Same precedence as the guards: handler metadata overrides class metadata. */
  if (has(PUBLIC_METADATA_KEY, method) || has(PUBLIC_METADATA_KEY, controller)) return 'public';
  if (has(ROLES_METADATA_KEY, method) || has(ROLES_METADATA_KEY, controller)) return 'staff';
  if (has(CUSTOMER_SCOPED_METADATA_KEY, method) || has(CUSTOMER_SCOPED_METADATA_KEY, controller)) {
    return 'customer';
  }
  return null;
}

describe('route guard sweep', () => {
  it('covers every @Controller class in the modules tree', () => {
    const modulesRoot = join(__dirname, '..', '..');
    const declared: string[] = [];
    for (const entry of readdirSync(modulesRoot, { recursive: true }) as string[]) {
      if (!entry.endsWith('.ts') || /\.(test|spec)\.ts$/u.test(entry)) continue;
      const source = readFileSync(join(modulesRoot, entry), 'utf8');
      for (const match of source.matchAll(/@Controller\([^)]*\)[\s\S]*?export class (\w+)/gu)) {
        declared.push(match[1]!);
      }
    }
    const swept = new Set(CONTROLLERS.map((controller) => controller.name));
    /* Guards against the scan silently matching nothing. */
    expect(new Set(declared).size).toBeGreaterThanOrEqual(CONTROLLERS.length);
    expect(declared.filter((name) => !swept.has(name)), 'add these to CONTROLLERS').toEqual([]);
  });

  it('finds handlers on every registered controller', () => {
    for (const controller of CONTROLLERS) {
      expect(handlersOf(controller).length, `${controller.name} exposes no handlers`).toBeGreaterThan(0);
    }
  });

  it('every handler declares @Public, @Roles or @CustomerScoped, or is an explicit exception', () => {
    const undeclared: string[] = [];
    for (const controller of CONTROLLERS) {
      for (const handler of handlersOf(controller)) {
        const name = `${controller.name}.${handler}`;
        if (classify(controller, handler) === null && !(name in UNDECORATED_BY_DESIGN)) {
          undeclared.push(name);
        }
      }
    }
    expect(undeclared, 'these routes are reachable by anyone with no session resolved').toEqual([]);
  });

  it('the exception list carries no stale entries', () => {
    for (const name of Object.keys(UNDECORATED_BY_DESIGN)) {
      const [controllerName, handler] = name.split('.');
      const controller = CONTROLLERS.find((candidate) => candidate.name === controllerName);
      expect(controller, `${name}: controller not registered`).toBeDefined();
      expect(handlersOf(controller!), `${name}: handler gone`).toContain(handler);
      expect(classify(controller!, handler!), `${name}: now decorated, drop it from the list`).toBeNull();
    }
  });

  it('every handler on a customer-data controller in this module is scoped to the session', () => {
    for (const handler of handlersOf(AccountController)) {
      expect(classify(AccountController, handler), `AccountController.${handler}`).toBe('customer');
    }
    for (const handler of handlersOf(CustomersController)) {
      expect(classify(CustomersController, handler), `CustomersController.${handler}`).toBe('staff');
    }
    for (const handler of handlersOf(SupportController)) {
      expect(classify(SupportController, handler), `SupportController.${handler}`).toBe('staff');
    }
  });

  it('no AccountController route takes a customer id from the path', () => {
    for (const handler of handlersOf(AccountController)) {
      const method = (AccountController.prototype as unknown as Record<string, object>)[handler]!;
      const path = String(Reflect.getMetadata(PATH_METADATA, method));
      expect(path, `AccountController.${handler}`).not.toMatch(/customer/iu);
    }
  });
});
