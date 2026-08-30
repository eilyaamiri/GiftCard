import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../../common/errors/domain.exception';
import type { RequestActor } from '../identity.tokens';
import { CustomerScopedGuard } from './customer-scoped.guard';
import { CurrentCustomer, CurrentStaff } from './current-actor.decorator';
import {
  CUSTOMER_SCOPED_METADATA_KEY,
  PUBLIC_METADATA_KEY,
  ROLES_METADATA_KEY,
} from './roles.decorator';
import { RolesGuard } from './roles.guard';

type Metadata = Partial<Record<string, unknown>>;

function executionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorFor(metadata: Metadata) {
  return {
    getAllAndOverride: vi.fn((key: string) => metadata[key]),
  } as never;
}

function authFor(actor: RequestActor | null) {
  return {
    require: vi.fn(async () => {
      if (!actor) {
        throw new BaratDomainException({ code: 'UNAUTHENTICATED', safeMessage: 'no', status: 401 });
      }
      return actor;
    }),
  } as never;
}

const operator: RequestActor = {
  type: 'STAFF',
  staffId: 'staff-1',
  role: 'OPERATOR',
  email: 'operator@barat.test',
};
const customer: RequestActor = { type: 'CUSTOMER', customerId: 'cus-1', sessionId: 'ses-1' };

describe('RolesGuard', () => {
  it('allows a staff member whose current role is listed', async () => {
    const guard = new RolesGuard(
      reflectorFor({ [ROLES_METADATA_KEY]: ['ADMIN', 'OPERATOR'] }),
      authFor(operator),
    );

    await expect(guard.canActivate(executionContext({}))).resolves.toBe(true);
  });

  it('returns 403 when the staff role is not listed', async () => {
    const guard = new RolesGuard(
      reflectorFor({ [ROLES_METADATA_KEY]: ['ADMIN', 'FINANCE'] }),
      authFor(operator),
    );

    const error = await guard.canActivate(executionContext({})).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).status).toBe(403);
    expect((error as BaratDomainException).code).toBe('FORBIDDEN');
  });

  it('returns 403 for a customer session on a staff route, never 200', async () => {
    const guard = new RolesGuard(
      reflectorFor({ [ROLES_METADATA_KEY]: ['SUPPORT'] }),
      authFor(customer),
    );

    const error = await guard.canActivate(executionContext({})).catch((thrown) => thrown);
    expect((error as BaratDomainException).status).toBe(403);
  });

  it('returns 401 when nobody is signed in', async () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_METADATA_KEY]: ['SUPPORT'] }), authFor(null));

    const error = await guard.canActivate(executionContext({})).catch((thrown) => thrown);
    expect((error as BaratDomainException).status).toBe(401);
  });

  it('does not authenticate an explicitly public route', async () => {
    const auth = authFor(null);
    const guard = new RolesGuard(
      reflectorFor({ [PUBLIC_METADATA_KEY]: true, [ROLES_METADATA_KEY]: ['ADMIN'] }),
      auth,
    );

    await expect(guard.canActivate(executionContext({}))).resolves.toBe(true);
  });
});

describe('CustomerScopedGuard', () => {
  it('admits a customer session', async () => {
    const guard = new CustomerScopedGuard(
      reflectorFor({ [CUSTOMER_SCOPED_METADATA_KEY]: true }),
      authFor(customer),
    );

    await expect(guard.canActivate(executionContext({}))).resolves.toBe(true);
  });

  it('rejects a staff session with 403 so operator access stays on the audited routes', async () => {
    const guard = new CustomerScopedGuard(
      reflectorFor({ [CUSTOMER_SCOPED_METADATA_KEY]: true }),
      authFor(operator),
    );

    const error = await guard.canActivate(executionContext({})).catch((thrown) => thrown);
    expect((error as BaratDomainException).status).toBe(403);
  });

  it('rejects an anonymous caller', async () => {
    const guard = new CustomerScopedGuard(
      reflectorFor({ [CUSTOMER_SCOPED_METADATA_KEY]: true }),
      authFor(null),
    );

    await expect(guard.canActivate(executionContext({}))).rejects.toBeInstanceOf(
      BaratDomainException,
    );
  });
});

/**
 * The param decorators are the other half of the control: even if a route were
 * reachable, the handler still receives the id from the session.
 */
describe('actor param decorators', () => {
  const factoryOf = (decorator: unknown): ((data: unknown, context: ExecutionContext) => unknown) =>
    (decorator as { KEY: string } & Record<string, never>) &&
     
    ((decorator as any).KEY
      ?  
        (Reflect.getMetadata?.('__routeParamFactory', decorator as any) ?? extract(decorator))
      : extract(decorator));

  // Nest stores the factory on the decorator closure; call it through a probe.
  function extract(decorator: unknown): (data: unknown, context: ExecutionContext) => unknown {
    let captured: ((data: unknown, context: ExecutionContext) => unknown) | undefined;
    const target = {};
     
    const applied = (decorator as any)();
    applied(target, 'handler', 0);
     
    const metadata = Reflect.getMetadata('__routeArguments__', (target as any).constructor, 'handler');
    for (const key of Object.keys(metadata ?? {})) {
      captured = metadata[key].factory;
    }
    if (!captured) {
      throw new Error('unable to read the param decorator factory');
    }
    return captured;
  }

  it('CurrentCustomer takes the id from the session and refuses a staff actor', () => {
    const factory = factoryOf(CurrentCustomer);

    expect(factory(undefined, executionContext({ actor: customer }))).toBe('cus-1');
    expect(() => factory(undefined, executionContext({ actor: operator }))).toThrow(
      BaratDomainException,
    );
    /* A customerId in the route or body is ignored entirely. */
    expect(() =>
      factory(undefined, executionContext({ params: { customerId: 'cus-2' } })),
    ).toThrow(BaratDomainException);
  });

  it('CurrentStaff refuses a customer actor', () => {
    const factory = factoryOf(CurrentStaff);

    expect(factory(undefined, executionContext({ actor: operator }))).toEqual(operator);
    expect(() => factory(undefined, executionContext({ actor: customer }))).toThrow(
      BaratDomainException,
    );
  });
});
