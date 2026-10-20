import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { AlertLogger } from './alert-logger';
import { ConsoleChannel } from './channels/console.channel';
import { TelegramChannel } from './channels/telegram.channel';

/**
 * AlertModule — centralized operational alerting.
 *
 * Global: injected once at app root, available everywhere without importing.
 *
 * Channels:
 * - ConsoleChannel: always on, logs everything
 * - TelegramChannel: ERROR and CRITICAL only, rate-limited
 */
@Global()
@Module({
  providers: [AlertLogger, ConsoleChannel, TelegramChannel],
  exports: [AlertLogger],
})
export class AlertModule implements OnModuleInit {
  constructor(
    private readonly alertLogger: AlertLogger,
    private readonly telegramChannel: TelegramChannel,
  ) {}

  onModuleInit(): void {
    // Register the Telegram channel if configured
    if (process.env['ALERT_TELEGRAM_ENABLED'] === 'true') {
      this.alertLogger.registerChannel(this.telegramChannel);
    }
    // Console is handled internally by AlertLogger
  }
}
