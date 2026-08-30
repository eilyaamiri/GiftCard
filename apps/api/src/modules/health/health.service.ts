import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../common/config';

/** One dependency's view of the world. */
export interface DependencyHealth {
  readonly name: string;
  readonly status: 'up' | 'down' | 'unknown';
  readonly latencyMs?: number;
  /** Safe, generic reason. Never a connection string or a driver message. */
  readonly detail?: string;
}

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly dependencies: readonly DependencyHealth[];
}

/**
 * Readiness aggregation.
 *
 * The database check is intentionally left as `unknown` here rather than
 * importing PrismaService: this module must stay bootable even when the
 * database package cannot connect, and the Foundation workstream does not own
 * the Prisma provider wiring. The infrastructure workstream registers real
 * probes by extending `checkDependencies`.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(private readonly config: AppConfigService) {}

  /** Cheap process-alive answer. Never touches I/O. */
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Full report used by readiness probes and the ops dashboard. */
  async ready(): Promise<HealthReport> {
    const dependencies = await this.checkDependencies();
    const anyDown = dependencies.some((dependency) => dependency.status === 'down');

    return {
      status: anyDown ? 'degraded' : 'ok',
      service: 'barat-api',
      version: process.env['npm_package_version'] ?? '0.1.0',
      environment: this.config.nodeEnv,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }

  /**
   * Configured-but-unprobed dependencies. Reporting `unknown` is honest;
   * reporting `up` without a probe would make the endpoint useless.
   */
  protected async checkDependencies(): Promise<readonly DependencyHealth[]> {
    return Promise.resolve([
      { name: 'postgres', status: 'unknown', detail: 'configured, not probed' },
      { name: 'redis', status: 'unknown', detail: 'configured, not probed' },
    ]);
  }
}
