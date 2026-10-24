/* eslint-disable @typescript-eslint/consistent-type-imports -- the services are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import { BackupRunnerService } from './backup-runner.service';
import {
  backupConnectionDraftSchema,
  scanHostKeysSchema,
  updateBackupSettingsSchema,
  type BackupConnectionDraftInput,
  type ScanHostKeysInput,
  type UpdateBackupSettingsInput,
} from './backup-settings.schemas';
import { BackupSettingsService } from './backup-settings.service';
import {
  sendTestEmailSchema,
  smtpDraftSchema,
  updateSmtpSettingsSchema,
  type SendTestEmailInput,
  type SmtpDraftInput,
  type UpdateSmtpSettingsInput,
} from './smtp-settings.schemas';
import { SmtpSettingsService } from './smtp-settings.service';

/* The test buttons open outbound connections to an address an admin typed.
 * Admin-only already; the throttle keeps even a stolen admin session from
 * turning them into a scanner. */
const TEST_THROTTLE = { short: { ttl: 60_000, limit: 6 }, medium: { ttl: 3_600_000, limit: 60 } };

@ApiTags('admin-settings')
@Controller('admin/settings/smtp')
@Roles('ADMIN')
export class AdminSmtpSettingsController {
  constructor(private readonly smtp: SmtpSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Outbound e-mail (SMTP) settings, without the password' })
  get() {
    return this.smtp.get();
  }

  @Put()
  @ApiOperation({ summary: 'Save the SMTP settings' })
  update(
    @Body(zodPipe(updateSmtpSettingsSchema)) body: UpdateSmtpSettingsInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.smtp.update(body, { staff, metadata });
  }

  @Post('test-connection')
  @HttpCode(200)
  @Throttle(TEST_THROTTLE)
  @ApiOperation({ summary: 'Connect, negotiate TLS and log in with the unsaved form values' })
  testConnection(@Body(zodPipe(smtpDraftSchema)) body: SmtpDraftInput) {
    return this.smtp.testConnection(body);
  }

  @Post('test-email')
  @HttpCode(200)
  @Throttle(TEST_THROTTLE)
  @ApiOperation({ summary: 'Send one test e-mail with the unsaved form values' })
  sendTestEmail(
    @Body(zodPipe(sendTestEmailSchema)) body: SendTestEmailInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.smtp.sendTestEmail(body, { staff, metadata });
  }
}

@ApiTags('admin-settings')
@Controller('admin/settings/backup')
@Roles('ADMIN')
export class AdminBackupSettingsController {
  constructor(
    private readonly backup: BackupSettingsService,
    private readonly runner: BackupRunnerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Off-host backup settings and the newest local snapshot' })
  get() {
    return this.backup.get();
  }

  @Put()
  @ApiOperation({ summary: 'Save the off-host backup settings' })
  update(
    @Body(zodPipe(updateBackupSettingsSchema)) body: UpdateBackupSettingsInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.backup.update(body, { staff, metadata });
  }

  @Post('ssh-key')
  @ApiOperation({ summary: 'Generate a new SSH key pair; returns only the public key' })
  generateKey(@CurrentStaff() staff: AuthenticatedStaff, @RequestMetadata() metadata: IdentityActor) {
    return this.backup.generateKey({ staff, metadata });
  }

  @Post('scan-host-keys')
  @HttpCode(200)
  @Throttle(TEST_THROTTLE)
  @ApiOperation({ summary: "Fetch the backup server's SSH host keys for confirmation" })
  scanHostKeys(@Body(zodPipe(scanHostKeysSchema)) body: ScanHostKeysInput) {
    return this.backup.scanHostKeys(body);
  }

  @Post('test-connection')
  @HttpCode(200)
  @Throttle(TEST_THROTTLE)
  @ApiOperation({ summary: 'Log in with the stored key and write a probe file' })
  testConnection(@Body(zodPipe(backupConnectionDraftSchema)) body: BackupConnectionDraftInput) {
    return this.backup.testConnection(body);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent off-host backup runs' })
  listRuns() {
    return this.backup.listRuns();
  }

  @Post('runs')
  @Throttle(TEST_THROTTLE)
  @ApiOperation({ summary: 'Copy the newest local snapshot off the host now' })
  runNow(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.runner.startManualRun(staff.staffId);
  }
}
