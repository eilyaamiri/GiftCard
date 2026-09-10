import { Controller, Get, Inject, Req } from '@nestjs/common';

import { Roles } from '../identity/rbac/roles.decorator';
import { requireStaff } from './staff-context';
import { StaffNotificationsService, type StaffNotificationFeed } from './staff-notifications.service';

/**
 * `/api/staff/notifications` — the bell in the admin and operator shells.
 *
 * Every staff role is listed because every staff role sees that shell, and the
 * feed is scoped to the caller's own id inside the service, not by role. A
 * `VIEWER` who holds no work gets an empty list; nobody gets someone else's.
 *
 * As in `WorkItemsController`, `@Roles` is what authenticates the route:
 * without it the guard short-circuits and `requireStaff` fails closed.
 */
@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'FINANCE', 'SUPPORT', 'VIEWER')
@Controller('staff/notifications')
export class StaffNotificationsController {
  constructor(
    @Inject(StaffNotificationsService)
    private readonly notifications: StaffNotificationsService,
  ) {}

  @Get()
  async list(@Req() request: unknown): Promise<StaffNotificationFeed> {
    const staff = requireStaff(request);
    return this.notifications.list(staff.id);
  }
}
