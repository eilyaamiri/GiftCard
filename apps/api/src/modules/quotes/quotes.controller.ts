import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  createQuoteRequestSchema,
  type AcceptQuoteResponse,
  type CreateQuoteRequest,
  type CreateQuoteResponse,
  type GetQuoteResponse,
} from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { IDEMPOTENCY_HEADER } from '../../common/interceptors/idempotency-header.interceptor';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { ActorRequest } from '../identity';
import { actorMetadata, AuthContextService, Public } from '../identity';
import { acceptQuoteBodySchema, quoteIdParamSchema } from './quotes.schemas';
import type { AcceptQuoteBody, QuoteIdParam } from './quotes.schemas';
import { QuotesService, type QuoteActor } from './quotes.service';

/** The idempotency interceptor leaves the normalised header here. */
interface IdempotentActorRequest extends ActorRequest {
  idempotencyKey?: string;
}

/**
 * Quote endpoints.
 *
 * `@Public()` because a customer must see a price before signing in — quoting
 * is the top of the funnel. Ownership is still enforced: an anonymous caller is
 * identified by `commerceSessionToken`, and `QuotesService` refuses to read or
 * accept a quote that belongs to someone else.
 */
@Controller('quotes')
@Public()
export class QuotesController {
  constructor(
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(AuthContextService) private readonly auth: AuthContextService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createQuote(
    @Body(zodPipe(createQuoteRequestSchema)) body: CreateQuoteRequest,
    @Req() request: ActorRequest,
  ): Promise<CreateQuoteResponse> {
    const actor = await this.actor(request, body.commerceSessionToken);
    return this.quotes.createQuote(body, actor);
  }

  @Get(':id')
  async getQuote(
    @Param(zodPipe(quoteIdParamSchema)) params: QuoteIdParam,
    @Req() request: ActorRequest,
  ): Promise<GetQuoteResponse> {
    const actor = await this.actor(request, sessionTokenHeader(request));
    return this.quotes.getQuote(params.id, actor);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptQuote(
    @Param(zodPipe(quoteIdParamSchema)) params: QuoteIdParam,
    @Body(zodPipe(acceptQuoteBodySchema)) body: AcceptQuoteBody,
    @Req() request: IdempotentActorRequest,
  ): Promise<AcceptQuoteResponse> {
    const actor = await this.actor(request, body.commerceSessionToken);
    return this.quotes.acceptQuote(
      {
        /* The route id is authoritative; the body never carries a second copy. */
        quoteId: params.id,
        idempotencyKey: idempotencyKey(body, request),
        acknowledgedAmountIrr: body.acknowledgedAmountIrr,
        ...(body.commerceSessionToken === undefined
          ? {}
          : { commerceSessionToken: body.commerceSessionToken }),
      },
      actor,
    );
  }

  /**
   * A customer session wins over a commerce-session token: once signed in, the
   * customer id is the identity, and the anonymous token merely follows along.
   */
  private async actor(request: ActorRequest, token: string | undefined): Promise<QuoteActor> {
    /* The route is `@Public()`, so no guard has resolved the actor. Resolving it
     * here upgrades a signed-in caller from anonymous to their customer id; a
     * credential that is present but invalid still fails loudly. */
    const sessionActor = await this.auth.resolve(request);
    const customerId = sessionActor?.type === 'CUSTOMER' ? sessionActor.customerId : null;
    const metadata = actorMetadata(request);
    const commerceSessionId = await this.quotes.resolveCommerceSession(token, customerId, metadata);
    return { customerId, commerceSessionId };
  }
}

/**
 * The contract carries the idempotency key in the body while the platform
 * interceptor normalises the `Idempotency-Key` header. A disagreement is
 * refused rather than silently resolved, so a proxy cannot replay one request
 * under a different key.
 */
function idempotencyKey(body: AcceptQuoteBody, request: IdempotentActorRequest): string {
  const header = request.idempotencyKey ?? readHeader(request);
  if (header !== undefined && header !== body.idempotencyKey) {
    throw DomainErrors.idempotencyConflict(
      'Idempotency-Key header does not match the idempotency key in the body',
    );
  }
  return body.idempotencyKey;
}

function readHeader(request: ActorRequest): string | undefined {
  return headerValue(request, IDEMPOTENCY_HEADER);
}

/** `GET` has no body, so an anonymous reader identifies itself by header. */
function sessionTokenHeader(request: ActorRequest): string | undefined {
  const value = headerValue(request, 'x-commerce-session');
  return value !== undefined && value.length >= 16 && value.length <= 128 ? value : undefined;
}

function headerValue(request: ActorRequest, name: string): string | undefined {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : undefined;
}
