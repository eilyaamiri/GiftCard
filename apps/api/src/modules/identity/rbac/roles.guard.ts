/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@barat/contracts';

import { DomainErrors } from '../../../common/errors/domain.exception';
import { AuthContextService } from '../auth-context.service';
import type { ActorRequest } from '../identity.tokens';
import { PUBLIC_METADATA_KEY, ROLES_METADATA_KEY } from './roles.decorator';

/**
 * Server-side RBAC.
 *
 * A route decorated with `@Roles(...)` requires a staff session whose CURRENT
 * database role is in the list. Customer sessions can never satisfy it, and a
 * missing decorator is not treated as "allow all" — the caller still has to be
 * authenticated unless the route is `@Public()`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
      handler,
      controller,
    ]);
    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<readonly StaffRole[]>(ROLES_METADATA_KEY, [
      handler,
      controller,
    ]);
    if (!roles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ActorRequest>();
    const actor = await this.auth.require(request);

    if (actor.type !== 'STAFF') {
      throw DomainErrors.forbidden('customer session cannot access a staff route');
    }
    if (!roles.includes(actor.role)) {
      throw DomainErrors.forbidden(`role ${actor.role} is not permitted on this route`);
    }

    return true;
  }
}
