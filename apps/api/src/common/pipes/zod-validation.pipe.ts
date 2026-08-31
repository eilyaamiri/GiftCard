import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { DomainErrors } from '../errors/domain.exception';

/**
 * Validates a handler argument against a Zod schema from @barat/contracts.
 *
 * Applied per-route rather than globally, because the schema has to be named:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createQuoteRequestSchema)) body: CreateQuoteRequest) {}
 *
 * Using the contract schema as the runtime validator is what keeps the API and
 * the two front-ends honest — there is exactly one definition of the payload,
 * and it is the one the web app also compiles against.
 *
 * On failure it raises a domain validation error, so the response body is the
 * same `ApiError` shape as everything else and the raw Zod issue tree (which can
 * echo submitted values) never reaches the client.
 */
@Injectable()
export class ZodValidationPipe<TOut = unknown> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): TOut {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw DomainErrors.validation(
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }

    return result.data;
  }
}

/** Convenience factory: `@Body(zodPipe(createOrderRequestSchema))`. */
export function zodPipe<TOut>(schema: ZodType<TOut>): ZodValidationPipe<TOut> {
  return new ZodValidationPipe(schema);
}
