import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createPaymentRequestSchema,
  paymentCallbackQuerySchema,
  verifyPaymentRequestSchema,
  type CreatePaymentRequest,
  type PaymentCallbackQuery,
  type VerifyPaymentRequest,
} from '@barat/contracts';

import { AppConfigService } from '../../common/config';
import { DomainErrors } from '../../common/errors/domain.exception';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';

type RequestLike = {
  readonly ip?: string;
  readonly user?: { readonly customerId?: unknown };
  get(name: string): string | undefined;
};

/** HTTP adapter. It contains no gateway calls; those live behind the provider interface. */
@Controller('payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Post()
  async create(
    @Body(zodPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
    @Req() request: RequestLike,
  ) {
    const customerId = this.customerId(request);
    // Return paths are for the frontend result page, never for the provider's
    // server callback. The callback is always the configured API endpoint.
    void body.returnPath;
    return this.paymentsService.createPayment(body, customerId, this.callbackUrl());
  }

  /** ZarinPal returns Authority/Status as untrusted query parameters. */
  @Get('zarinpal/callback')
  async zarinpalCallback(
    @Query(zodPipe(paymentCallbackQuerySchema)) query: PaymentCallbackQuery,
    @Req() request: RequestLike,
  ) {
    return this.paymentsService.callback(query, {
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
  }

  @Post(':id/verify')
  async verify(
    @Param('id') paymentId: string,
    @Body(zodPipe(verifyPaymentRequestSchema)) body: VerifyPaymentRequest,
    @Req() request: RequestLike,
  ) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(paymentId)) {
      throw DomainErrors.validation([{ path: 'id', message: 'Invalid payment id' }]);
    }
    const customerId = this.customerId(request);
    return this.paymentsService.verifyPayment(
      { ...body, paymentId },
      customerId,
      { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null },
    );
  }

  private customerId(request: RequestLike): string {
    const value = request.user?.customerId;
    if (typeof value !== 'string' || value.length === 0) throw DomainErrors.unauthenticated();
    return value;
  }

  private callbackUrl(): string {
    const zarinpal = this.config.zarinpal;
    if (zarinpal?.callbackUrl) return zarinpal.callbackUrl;
    return `${this.config.apiPublicUrl}/api/payments/zarinpal/callback`;
  }
}
