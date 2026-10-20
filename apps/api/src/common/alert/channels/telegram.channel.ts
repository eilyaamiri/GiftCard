import { Injectable, Logger } from '@nestjs/common';
import type { AlertChannel, FormattedAlert, AlertSeverity } from '../alert-logger';
import { ALERT_SEVERITY_LEVELS } from '../alert-logger';
import { redactAlertContext } from '../alert-redact';

/**
 * Telegram channel — sends alerts via Telegram bot API.
 *
 * - Sends only ERROR and CRITICAL by default
 * - Rate limits: max 1 message per INCIDENT (dedupKey) per 30 seconds.
 *   Keyed by incident rather than by source: two suppliers failing within the
 *   same half-minute are two pages, while one supplier re-reporting the same
 *   failure is suppressed.
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

  /** Per-incident last-send timestamps for rate limiting. */
  private readonly lastSent = new Map<string, number>();

  constructor(
    env: Readonly<Record<string, string | undefined>> = process.env,
    private readonly transport: typeof fetch = (...args) => fetch(...args),
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    this.botToken = env['ALERT_TELEGRAM_BOT_TOKEN'];
    this.chatId = env['ALERT_TELEGRAM_CHAT_ID'];
    this.rateLimitSeconds = Number(env['ALERT_TELEGRAM_RATE_LIMIT_SECONDS'] ?? '30');
    this.enabled = env['ALERT_TELEGRAM_ENABLED'] === 'true';

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

    // Rate limiting per incident
    const now = Date.now();
    const windowMs = this.rateLimitSeconds * 1000;
    const lastSentTime = this.lastSent.get(alert.dedupKey) ?? 0;
    if (now - lastSentTime < windowMs) {
      this.logger.debug(`Rate limited: ${alert.dedupKey}`);
      return;
    }
    /* Claimed BEFORE the network call: two identical alerts raised in the same
     * tick would otherwise both pass the check while the first is in flight. */
    this.lastSent.set(alert.dedupKey, now);
    this.prune(now, windowMs);

    // Format message for Telegram
    const message = this.formatTelegramMessage(alert);

    // Send with retry
    await this.sendWithRetry(message, 3);
  }

  /**
   * Keys carry order and supplier ids, so the map would grow forever on a long
   * uptime. Anything older than the window can no longer suppress anything.
   */
  private prune(now: number, windowMs: number): void {
    if (this.lastSent.size < 200) return;
    for (const [key, at] of this.lastSent) {
      if (now - at >= windowMs) this.lastSent.delete(key);
    }
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
        const response = await this.transport(url, {
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
          throw new TelegramHttpError(response.status);
        }

        return; // Success
      } catch (err) {
        /* Status or error class only. The request URL embeds the bot token, and
         * a network error's message can echo that URL back. */
        const reason =
          err instanceof TelegramHttpError
            ? `HTTP ${err.status}`
            : err instanceof Error
              ? err.name
              : 'unknown error';
        this.logger.warn(`Telegram send attempt ${attempt}/${maxAttempts} failed: ${reason}`);

        if (attempt < maxAttempts) {
          await this.wait(delays[attempt - 1] ?? 4000);
        }
      }
    }

    this.logger.error(`Telegram send failed after ${maxAttempts} attempts`);
  }
}

class TelegramHttpError extends Error {
  constructor(readonly status: number) {
    super(`Telegram API responded ${status}`);
    this.name = 'TelegramHttpError';
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
