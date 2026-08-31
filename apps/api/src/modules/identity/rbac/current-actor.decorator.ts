import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { DomainErrors } from '../../../common/errors/domain.exception';
import { actorMetadata } from '../auth-context.service';
import type { ActorRequest, AuthenticatedStaff, IdentityActor } from '../identity.tokens';

/**
 * The authenticated customer id, taken from the verified session only.
 *
 * Handlers must use this rather than a `customerId` body/route parameter; that
 * is what makes "customer A cannot read customer B's order" structural instead
 * of a rule everyone has to remember.
 */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const actor = request.actor;
    if (!actor || actor.type !== 'CUSTOMER') {
      throw DomainErrors.unauthenticated();
    }
    return actor.customerId;
  },
);

export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedStaff => {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const actor = request.actor;
    if (!actor || actor.type !== 'STAFF') {
      throw DomainErrors.unauthenticated();
    }
    return actor;
  },
);

/** IP + user-agent for audit rows. */
export const RequestMetadata = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IdentityActor =>
    actorMetadata(context.switchToHttp().getRequest<ActorRequest>()),
);
