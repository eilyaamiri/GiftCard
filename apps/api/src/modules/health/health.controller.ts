import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthService, type HealthReport } from './health.service';

/**
 * Probes are exempt from rate limiting: an orchestrator polling every second
 * must never be throttled into restarting a healthy container.
 */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness report including dependency status' })
  @ApiOkResponse({ description: 'Service and dependency health' })
  async ready(): Promise<HealthReport> {
    return this.health.ready();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process is running' })
  @ApiOkResponse({ description: 'Process is alive' })
  live(): { status: 'ok'; timestamp: string } {
    return this.health.live();
  }
}
