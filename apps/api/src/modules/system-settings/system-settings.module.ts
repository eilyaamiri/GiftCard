import { Module } from '@nestjs/common';
import { prisma } from '@barat/database';

import { AppConfigService } from '../../common/config/app-config.service';
import { AuditModule } from '../audit/audit.module';
import {
  AdminBackupSettingsController,
  AdminSmtpSettingsController,
} from './admin-system-settings.controller';
import { BackupRunnerService } from './backup-runner.service';
import { BACKUP_SOURCE_DIR, BACKUP_TRANSPORT, BackupSettingsService } from './backup-settings.service';
import { OpenSshBackupTransport } from './backup-transport';
import { SettingsSecretBox } from './settings-secrets';
import { SmtpSettingsService } from './smtp-settings.service';
import {
  createSmtpTransport,
  SETTINGS_SECRET_BOX,
  SMTP_TRANSPORT_FACTORY,
  SYSTEM_SETTINGS_DATABASE,
} from './smtp-transport';

/**
 * Platform settings an admin manages from the panel: the outbound SMTP account
 * and the off-host backup copy, plus the scheduler that performs that copy.
 *
 * The application's `EMAIL_PROVIDER` reads the SMTP row through
 * `ConfiguredEmailProvider`, which IdentityModule registers; this module only
 * edits the row.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminSmtpSettingsController, AdminBackupSettingsController],
  providers: [
    { provide: SYSTEM_SETTINGS_DATABASE, useValue: prisma },
    {
      provide: SETTINGS_SECRET_BOX,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new SettingsSecretBox(config.settingsEncryptionKey()),
    },
    { provide: SMTP_TRANSPORT_FACTORY, useValue: createSmtpTransport },
    { provide: BACKUP_TRANSPORT, useFactory: () => new OpenSshBackupTransport() },
    {
      provide: BACKUP_SOURCE_DIR,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.backupSourceDir,
    },
    SmtpSettingsService,
    BackupSettingsService,
    BackupRunnerService,
  ],
})
export class SystemSettingsModule {}
