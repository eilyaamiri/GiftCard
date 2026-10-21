import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
   * The customer's browser returning from ZarinPal with Authority/Status as
   * untrusted query parameters.
   *
   * The provider sends the browser here with no session cookie, so it must stay
   * public. The parameters are not trusted: the service re-verifies the payment
   * with the gateway before it moves any money. Like the BazaarPay return, the
   * answer is a 303 to the result page carrying only our own ids (PAY-8): the
   * result page reads the payment through the authenticated API, so a reference
   * number or masked card is never shown to whoever holds the authority.
   */
  @Get('zarinpal/callback')
  @Public()
  @Throttle({ short: { ttl: 1_000, limit: 3 }, medium: { ttl: 60_000, limit: 30 } })
  async zarinpalCallback(
    @Query(zodPipe(paymentCallbackQuerySchema)) query: PaymentCallbackQuery,
    @Req() request: RequestLike,
    @Res() response: { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.paymentsService.handleZarinPalReturn(query, {
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    });
    response.redirect(303, this.resultPageUrl(result));
  }

  /**
   * The customer's browser returning from BazaarPay's hosted page.
   *
   * Public because the browser carries no payment session here, and a GET that
   * only redirects. `token` is untrusted input used to find a payment we stored;
   * the outcome is decided by a server-to-server verify inside `handleReturn`.
   * The redirect carries our own ids and nothing the gateway sent, so a forged
   * query can at worst land a visitor on the result page of a payment that is
   * not theirs — which asks the API, and the API checks the session.
   */
  @Get('bazaarpay/return')
  @Public()
  @Throttle({ short: { ttl: 1_000, limit: 3 }, medium: { ttl: 60_000, limit: 30 } })
  async bazaarpayReturn(
    @Query('token') token: string | undefined,
    @Req() request: RequestLike,
    @Res() response: { redirect(status: number, url: string): void },
  ): Promise<void> {
    const result = await this.paymentsService.handleReturn(
      { token },
      { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null },
    );
    response.redirect(303, this.resultPageUrl(result));
  }

  /**
   * Every call may reach the gateway and writes a PaymentAttempt row, so it is
   * rate limited per caller here (PAY-13) and per payment in the service, which
   * answers a closed payment from its own row between gateway calls.
   */
  @Post(':id/verify')
  @Throttle({ short: { ttl: 1_000, limit: 2 }, medium: { ttl: 60_000, limit: 20 } })
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

  /** The storefront's result page, with our own ids and nothing the gateway sent. */
  private resultPageUrl(result: { readonly paymentId: string | null; readonly orderNumber: string | null }): string {
    const target =
      result.paymentId === null || result.orderNumber === null
        ? '/payment/result'
        : `/payment/result?order=${encodeURIComponent(result.orderNumber)}&payment=${encodeURIComponent(result.paymentId)}`;
    return `${this.config.webPublicUrl}${target}`;
  }
}
