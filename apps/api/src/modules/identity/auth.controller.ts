/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type LogoutResponse,
  type MeResponse,
  type RequestOtpRequest,
  type RequestOtpResponse,
  type VerifyOtpRequest,
  type VerifyOtpResponse,
  requestOtpRequestSchema,
  verifyOtpRequestSchema,
} from '@barat/contracts';

import { AppConfigService } from '../../common/config/app-config.service';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthContextService, actorMetadata, readBearer, readCookie } from './auth-context.service';
import { CustomerReadService } from './customer-read.service';
import type { ActorRequest } from './identity.tokens';
import { OtpService } from './otp.service';
import { Public } from './rbac/roles.decorator';
import { AUTH_COOKIE_NAME, AUTH_SESSION_TTL_SECONDS, SessionService } from './session.service';

/** The subset of the Express response we use; avoids a hard express type dep. */
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

/**
 * Passwordless customer authentication.
 *
 * Both endpoints are `@Public()` — they are how a customer becomes authenticated
 * — and both are throttled far harder than the global default, because they are
 * the two places where guessing has value.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly auth: AuthContextService,
    private readonly customers: CustomerReadService,
    private readonly config: AppConfigService,
  ) {}

  @Post('otp/request')
  @Public()
  @Throttle({ short: { ttl: 1_000, limit: 1 }, medium: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Send a one-time code to a mobile number or e-mail' })
  @ApiOkResponse({ description: 'Challenge created; the code itself is never returned' })
  async requestOtp(
    @Body(zodPipe(requestOtpRequestSchema)) body: RequestOtpRequest,
    @Req() request: ActorRequest,
  ): Promise<RequestOtpResponse> {
    const actor = actorMetadata(request);
    /* An existing session means "add / verify a second identifier", which must
     * be tied to that customer rather than creating a new one. */
    const current = await this.auth.resolve(request).catch(() => null);
    const customerId = current?.type === 'CUSTOMER' ? current.customerId : null;

    return this.otp.requestOtp(body, { ...actor, customerId });
  }

  @Post('otp/verify')
  @Public()
  @Throttle({ short: { ttl: 1_000, limit: 1 }, medium: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Verify a one-time code and open a session' })
  @ApiOkResponse({ description: 'Session issued as an HttpOnly cookie and a bearer token' })
  async verifyOtp(
    @Body(zodPipe(verifyOtpRequestSchema)) body: VerifyOtpRequest,
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<VerifyOtpResponse> {
    const actor = actorMetadata(request);
    const current = await this.auth.resolve(request).catch(() => null);
    const customerId = current?.type === 'CUSTOMER' ? current.customerId : null;

    const result = await this.otp.verifyOtp(body, { ...actor, customerId });

    response.cookie(AUTH_COOKIE_NAME, result.accessToken, {
      httpOnly: true,
      secure: this.config.webCookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_SESSION_TTL_SECONDS * 1000,
    });

    return result;
  }

  @Get('me')
  @Public()
  @ApiOperation({ summary: 'The current customer, or null when not signed in' })
  async me(@Req() request: ActorRequest): Promise<MeResponse> {
    const actor = await this.auth.resolve(request).catch(() => null);
    if (!actor || actor.type !== 'CUSTOMER') {
      return { customer: null, isAuthenticated: false };
    }

    return {
      customer: await this.customers.customerDto(actor.customerId),
      isAuthenticated: true,
    };
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<LogoutResponse> {
    const token = readCookie(request, AUTH_COOKIE_NAME) ?? readBearer(request);
    const revoked = token ? await this.sessions.revoke(token, actorMetadata(request)) : false;

    response.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.webCookieSecure,
      sameSite: 'lax',
      path: '/',
    });

    return { loggedOut: revoked };
  }
}
