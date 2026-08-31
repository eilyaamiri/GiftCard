import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Liveness and readiness probes. Owned by the Foundation workstream.
 *
 * Deliberately has no dependency on any domain module: if `orders` cannot boot,
 * the health endpoint must still answer so the platform can report *why*.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
