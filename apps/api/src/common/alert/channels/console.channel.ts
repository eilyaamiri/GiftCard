import { Injectable, Logger } from '@nestjs/common';
import type { AlertChannel, AlertSeverity, FormattedAlert } from '../alert-logger';

/**
 * Console channel — always-on, prints formatted alerts to stdout.
 */
@Injectable()
export class ConsoleChannel implements AlertChannel {
  private readonly logger = new Logger(ConsoleChannel.name);
  readonly name = 'console';
  readonly minSeverity: AlertSeverity = 'INFO'; // Everything goes to console

  async send(alert: FormattedAlert): Promise<void> {
    // Already formatted by AlertLogger.logToConsole, this is a backup
    const prefix = alert.severity === 'CRITICAL' ? '🚨' :
                   alert.severity === 'ERROR' ? '🔴' :
                   alert.severity === 'WARNING' ? '⚠️' : 'ℹ️';
    this.logger.log(`${prefix} [${alert.source}] ${alert.formatted}`);
  }
}
