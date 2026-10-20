import { Injectable, Logger } from '@nestjs/common';
import type { AlertChannel, FormattedAlert, AlertSeverity } from '../alert-logger';
import { ALERT_SEVERITY_LEVELS } from '../alert-logger';
import { redactAlertContext } from '../alert-redact';

/**
 * Telegram channel — sends alerts via Telegram bot API.
 *
 * - Sends only ERROR and CRITICAL by default
 * - Rate limits: max 1 alert per source per 30 seconds
 * - Retry: 3 attempts with exponential backoff
 * - HTML-escapes all user-controlled text
 */
@Injectable()
export class TelegramChannel implements AlertChannel {
  private readonly logger = new Logger(TelegramChannel.name);
  readonly name = 'telegram';
  readonly minSeverity: AlertSeverity = 'ERROR';

  private readonly botToken: string | undefined;
  private readonly chatId: string | undefined;
  private readonly rateLimitSeconds: number;
  private readonly enabled: boolean;

  /** Per-source last-send timestamps for rate limiting. */
  private readonly lastSent = new Map<string, number>();

  constructor() {
    this.botToken = process.env['ALERT_TELEGRAM_BOT_TOKEN'];
    this.chatId = process.env['ALERT_TELEGRAM_CHAT_ID'];
    this.rateLimitSeconds = Number(process.env['ALERT_TELEGRAM_RATE_LIMIT_SECONDS'] ?? '30');
    this.enabled = process.env['ALERT_TELEGRAM_ENABLED'] === 'true';

    if (this.enabled && (!this.botToken || !this.chatId)) {
      this.logger.warn(
        'ALERT_TELEGRAM_ENABLED=true but ALERT_TELEGRAM_BOT_TOKEN or ALERT_TELEGRAM_CHAT_ID is missing',
      );
    }
  }

  async send(alert: FormattedAlert): Promise<void> {
    // Check if enabled
    if (!this.enabled || !this.botToken || !this.chatId) {
      return;
    }

    // Check severity filter
    if (ALERT_SEVERITY_LEVELS[alert.severity] < ALERT_SEVERITY_LEVELS[this.minSeverity]) {
      return;
    }

    // Rate limiting per source
    const now = Date.now();
    const lastSentTime = this.lastSent.get(alert.source) ?? 0;
    if (now - lastSentTime < this.rateLimitSeconds * 1000) {
      this.logger.debug(`Rate limited: ${alert.source} (last sent ${now - lastSentTime}ms ago)`);
      return;
    }

    // Format message for Telegram
    const message = this.formatTelegramMessage(alert);

    // Send with retry
    await this.sendWithRetry(message, 3);
    this.lastSent.set(alert.source, now);
  }

  private formatTelegramMessage(alert: FormattedAlert): string {
    const emoji = alert.severity === 'CRITICAL' ? '🚨' : '🔴';
    const time = new Date(alert.at.getTime() + 210 * 60_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const lines = [
      `${emoji} <b>[${escapeHtml(alert.severity)}] ${escapeHtml(alert.message)}</b>`,
      '',
      `<b>Source:</b> ${escapeHtml(alert.source)}`,
      `<b>Time:</b> ${escapeHtml(time)} (Tehran)`,
    ];

    // Add redacted context if present
    if (alert.context && Object.keys(alert.context).length > 0) {
      const redacted = redactAlertContext(alert.context);
      if (redacted) {
        lines.push('');
        lines.push(`<b>Context:</b>`);
        for (const [key, value] of Object.entries(redacted)) {
          lines.push(`  ${escapeHtml(key)}: ${escapeHtml(String(value))}`);
        }
      }
    }

    return lines.join('\n');
  }

  private async sendWithRetry(message: string, maxAttempts: number): Promise<void> {
    const delays = [1000, 2000, 4000]; // Exponential backoff

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text: message.slice(0, 4096), // Telegram max message length
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Telegram API error ${response.status}: ${body}`);
        }

        return; // Success
      } catch (err) {
        this.logger.warn(`Telegram send attempt ${attempt}/${maxAttempts} failed: ${err}`);

        if (attempt < maxAttempts) {
          await sleep(delays[attempt - 1] ?? 4000);
        }
      }
    }

    this.logger.error(`Telegram send failed after ${maxAttempts} attempts`);
  }
}

/** HTML-escape for Telegram messages. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
