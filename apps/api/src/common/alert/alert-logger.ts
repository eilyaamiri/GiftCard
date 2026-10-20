import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { redactAlertContext } from './alert-redact';

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
  /**
   * What "the same incident" means for de-duplication. Defaults to source plus
   * message, which already names the supplier or order, so two different
   * suppliers failing together are two incidents, not one.
   */
  dedupKey?: string;
}

/** A formatted alert ready to send to channels. */
export interface FormattedAlert {
  severity: AlertSeverity;
  source: AlertSource;
  message: string;
  /** Always redacted before it reaches a channel, the console or the history. */
  context: Record<string, unknown> | null;
  at: Date;
  formatted: string;
  dedupKey: string;
}

/** How many alerts the in-memory history keeps for the dashboard. */
export const ALERT_HISTORY_SIZE = 100;

/**
 * Operational alert logger.
 *
 * Fire-and-forget: alerting never blocks the main flow. If Telegram is down,
 * the alert is logged to console and the main flow continues.
 *
 * Severity filtering: channels opt in to only receive ERROR and above by default.
 *
 * History is in memory, newest first, and lost on restart. That is deliberate:
 * it answers "what has gone wrong lately" on the dashboard without a table in
 * the frozen schema. The durable record is the log stream.
 */
@Injectable()
export class AlertLogger implements OnModuleInit {
  private readonly logger = new Logger(AlertLogger.name);
  private readonly channels: AlertChannel[] = [];
  private readonly history: FormattedAlert[] = [];

  /**
   * Register a channel. Call from module setup.
   */
  registerChannel(channel: AlertChannel): void {
    this.channels.push(channel);
  }

  /** The most recent alerts, newest first. */
  recent(limit = ALERT_HISTORY_SIZE): readonly FormattedAlert[] {
    return this.history.slice(0, Math.max(0, limit));
  }

  /**
   * Log an alert and dispatch to all registered channels.
   */
  log(input: AlertInput): void {
    const at = input.at ?? new Date();
    /* Redacted once, here, so no sink — console, Telegram, dashboard — can ever
     * see the raw context. pino's own redaction cannot help: the context reaches
     * it as a string. */
    const context = redactAlertContext(input.context);

    const formatted: FormattedAlert = {
      severity: input.severity,
      source: input.source,
      message: input.message,
      context,
      at,
      formatted: this.format(input, at),
      dedupKey: input.dedupKey ?? `${input.source}:${input.message}`,
    };

    this.history.unshift(formatted);
    if (this.history.length > ALERT_HISTORY_SIZE) {
      this.history.length = ALERT_HISTORY_SIZE;
    }

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

    // Context was redacted in log() before this point.
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
