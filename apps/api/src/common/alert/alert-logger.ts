import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

/** Severity levels for operational alerts. */
export const ALERT_SEVERITY_LEVELS = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
} as const;

export type AlertSeverity = keyof typeof ALERT_SEVERITY_LEVELS;

/** Sources that can emit alerts. */
export type AlertSource =
  | 'FX'
  | 'SUPPLIER'
  | 'PAYMENT'
  | 'ORDER'
  | 'SYSTEM'
  | 'UPTIME';

/** Input for logging an alert. */
export interface AlertInput {
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  context?: Record<string, unknown>;
  at?: Date;
}

/** A formatted alert ready to send to channels. */
export interface FormattedAlert {
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  context: Record<string, unknown> | null;
  at: Date;
  formatted: string;
}

/**
 * Operational alert logger.
 *
 * Fire-and-forget: alerting never blocks the main flow. If Telegram is down,
 * the alert is logged to console and the main flow continues.
 *
 * Severity filtering: channels opt in to only receive ERROR and above by default.
 */
@Injectable()
export class AlertLogger implements OnModuleInit {
  private readonly logger = new Logger(AlertLogger.name);
  private readonly channels: AlertChannel[] = [];

  /**
   * Register a channel. Call from module setup.
   */
  registerChannel(channel: AlertChannel): void {
    this.channels.push(channel);
  }

  /**
   * Log an alert and dispatch to all registered channels.
   */
  log(input: AlertInput): void {
    const at = input.at ?? new Date();
    const context = input.context ?? null;

    const formatted: FormattedAlert = {
      severity: input.severity,
      source: input.source,
      message: input.message,
      context,
      at,
      formatted: this.format(input, at),
    };

    // Always log to NestJS logger
    this.logToConsole(formatted);

    // Dispatch to registered channels (fire-and-forget)
    for (const channel of this.channels) {
      channel.send(formatted).catch((err) => {
        this.logger.warn(`Alert channel ${channel.name} failed: ${err.message}`);
      });
    }
  }

  private logToConsole(alert: FormattedAlert): void {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const level = SEVERITY_LOG_LEVEL[alert.severity];
    const prefix = `${emoji} [${alert.source}] ${alert.message}`;

    switch (level) {
      case 'error':
        this.logger.error(prefix);
        break;
      case 'warn':
        this.logger.warn(prefix);
        break;
      case 'log':
        this.logger.log(prefix);
        break;
      default:
        this.logger.debug(prefix);
    }

    // Also log context if present (already redacted)
    if (alert.context && Object.keys(alert.context).length > 0) {
      this.logger.debug(`  Context: ${JSON.stringify(alert.context)}`);
    }
  }

  private format(input: AlertInput, at: Date): string {
    const time = new Date(at.getTime() + 210 * 60_000) // Tehran UTC+03:30
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    return `[${input.source}] [${input.severity}] ${time} — ${input.message}`;
  }

  onModuleInit(): void {
    this.logger.log('AlertLogger initialized');
  }
}

/** Severity emoji for console output. */
const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  INFO: 'ℹ️',
  WARNING: '⚠️',
  ERROR: '🔴',
  CRITICAL: '🚨',
};

/** Map severity to NestJS logger level. */
const SEVERITY_LOG_LEVEL: Record<AlertSeverity, 'error' | 'warn' | 'log' | 'debug'> = {
  INFO: 'log',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
};

/** Interface for alert channel implementations. */
export interface AlertChannel {
  name: string;
  /** Minimum severity to send (inclusive). */
  minSeverity: AlertSeverity;
  send(alert: FormattedAlert): Promise<void>;
}
