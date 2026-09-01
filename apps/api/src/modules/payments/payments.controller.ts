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

/* The concrete module, not the barrel: the barrel re-exports ConfigModule,
 * which validates the whole environment at import time. Importing it here would
 * make merely loading this controller require a fully configured process. */
import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentCustomer, CustomerScoped, Public } from '../identity';
import { PaymentsService } from './payments.service';

type RequestLike = {
  readonly ip?: string;
  get(name: string): string | undefined;
};

/**
 * HTTP adapter. It contains no gateway calls; those live behind the provider interface.
 *
 * `@CustomerScoped()` is what authenticates these routes: the global guard
 * resolves the session and the handlers read the id through `@CurrentCustomer()`,
 * never from a body or path parameter. Without the decorator no guard runs, no
 * actor is attached, and every call fails closed with 401 — which is exactly
 * what this controller used to do.
 */
@Controller('payments')
@CustomerScoped()
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Post()
  async create(
    @Body(zodPipe(createPaymentRequestSchema)) body: CreatePaymentRequest,
    @CurrentCustomer() customerId: string,
  ) {
    // Return paths are for the frontend result page, never for the provider's
    // server callback. The callback is always the configured API endpoint.
    void body.returnPath;
    return this.paymentsService.createPayment(body, customerId, this.callbackUrl());
  }

  /**
   * ZarinPal returns Authority/Status as untrusted query parameters.
   *
   * The provider calls this with no session cookie, so it must stay public. The
   * parameters are not trusted: the service re-verifies the payment with the
   * gateway before it moves any money.
   */
  @Get('zarinpal/callback')
  @Public()
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
    @CurrentCustomer() customerId: string,
    @Req() request: RequestLike,
  ) {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(paymentId)) {
      throw DomainErrors.validation([{ path: 'id', message: 'Invalid payment id' }]);
    }
    return this.paymentsService.verifyPayment(
      { ...body, paymentId },
      customerId,
      { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null },
    );
  }

  private callbackUrl(): string {
    const zarinpal = this.config.zarinpal;
    if (zarinpal?.callbackUrl) return zarinpal.callbackUrl;
    return `${this.config.apiPublicUrl}/api/payments/zarinpal/callback`;
  }
}
