/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DomainErrors } from '../../../common/errors/domain.exception';
import { AuthContextService } from '../auth-context.service';
import type { ActorRequest } from '../identity.tokens';
import { CUSTOMER_SCOPED_METADATA_KEY, PUBLIC_METADATA_KEY } from './roles.decorator';

/**
 * Requires a customer session on `@CustomerScoped()` routes.
 *
 * A staff token is rejected here on purpose: operator access to customer data
 * goes through the Customer-360 endpoints, which are role-gated and audited.
 * The handler then reads the customer id from the session via `@CurrentCustomer`
 * — never from a path or query parameter — so customer A cannot request
 * customer B's order by guessing an id.
 */
@Injectable()
export class CustomerScopedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [handler, controller])) {
      return true;
    }

    const scoped = this.reflector.getAllAndOverride<boolean>(CUSTOMER_SCOPED_METADATA_KEY, [
      handler,
      controller,
    ]);
    if (!scoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ActorRequest>();
    const actor = await this.auth.require(request);

    if (actor.type !== 'CUSTOMER') {
      throw DomainErrors.forbidden('staff session cannot use a customer-scoped route');
    }

    return true;
  }
}
