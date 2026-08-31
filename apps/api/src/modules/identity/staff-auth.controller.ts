/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { STAFF_ROLE_VALUES, type StaffRole } from '@barat/contracts';

import { AppConfigService } from '../../common/config/app-config.service';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { actorMetadata } from './auth-context.service';
import type { ActorRequest, AuthenticatedStaff } from './identity.tokens';
import { type StaffLoginRequest, staffLoginRequestSchema } from './identity.schemas';
import { CurrentStaff } from './rbac/current-actor.decorator';
import { Public, Roles } from './rbac/roles.decorator';
import { STAFF_COOKIE_NAME, STAFF_SESSION_TTL_SECONDS, StaffAuthService } from './staff-auth.service';

interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

export interface StaffSessionDto {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly expiresAt: string;
}

/** Back-office authentication. Separate cookie, separate lifetime, separate roles. */
@ApiTags('auth')
@Controller('auth/staff')
export class StaffAuthController {
  constructor(
    private readonly staff: StaffAuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  @Public()
  @Throttle({ short: { ttl: 1_000, limit: 1 }, medium: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Staff sign-in' })
  @ApiOkResponse({ description: 'Session issued as an HttpOnly cookie' })
  async login(
    @Body(zodPipe(staffLoginRequestSchema)) body: StaffLoginRequest,
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<StaffSessionDto> {
    const result = await this.staff.login(body.email, body.password, actorMetadata(request));

    response.cookie(STAFF_COOKIE_NAME, result.accessToken, {
      httpOnly: true,
      secure: this.config.adminCookieSecure,
      /* `strict` for staff: the admin panel is never linked to from a gateway
       * return page, so there is no legitimate cross-site navigation. */
      sameSite: 'strict',
      path: '/',
      maxAge: STAFF_SESSION_TTL_SECONDS * 1000,
    });

    return { ...result.staff, expiresAt: result.expiresAt.toISOString() };
  }

  @Get('me')
  @Roles(...STAFF_ROLE_VALUES)
  @ApiOperation({ summary: 'The current staff user and their server-side role' })
  me(@CurrentStaff() staff: AuthenticatedStaff): {
    id: string;
    email: string;
    role: StaffRole;
  } {
    return { id: staff.staffId, email: staff.email, role: staff.role };
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Clear the staff session cookie' })
  logout(@Res({ passthrough: true }) response: CookieResponse): { loggedOut: boolean } {
    response.clearCookie(STAFF_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.adminCookieSecure,
      sameSite: 'strict',
      path: '/',
    });
    return { loggedOut: true };
  }
}
