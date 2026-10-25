import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { AlertLogger } from '../../common/alert/alert-logger';
import { BaratDomainException } from '../../common/errors/domain.exception';
import { ArchiveError, encryptArchive } from './backup-archive';
import {
  archivesToPrune,
  BackupSourceError,
  findNewestSnapshot,
  isScheduledRunDue,
  remoteArchiveName,
  tehranDay,
} from './backup-schedule';
import {
  BACKUP_SETTINGS_ID,
  BACKUP_SOURCE_DIR,
  BACKUP_TRANSPORT,
  toRunDto,
  transportMessage,
  type BackupRunDto,
} from './backup-settings.service';
import { BackupTransportError, type BackupTarget, type BackupTransport } from './backup-transport';
import type { SettingsSecretBox } from './settings-secrets';
import { SETTINGS_SECRET_BOX, SYSTEM_SETTINGS_DATABASE, type SystemSettingsDatabase } from './smtp-transport';
import { parseHostKeys } from './ssh-keys';

const TICK_INTERVAL_MS = 60_000;
/* The host timer runs once a day; a newest snapshot older than this means it
 * has stopped, which is worth an alert of its own. */
const STALE_SNAPSHOT_MS = 26 * 60 * 60_000;
/* No upload takes this long; a RUNNING row this old belongs to a process that died. */
const INTERRUPTED_AFTER_MS = 3 * 60 * 60_000;

interface RunOutcome {
  readonly status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  readonly sourceSnapshot?: string;
  readonly sourceCreatedAt?: Date;
  readonly remoteFileName?: string;
  readonly sizeBytes?: bigint;
  readonly sha256?: string;
  readonly errorMessage?: string | null;
  /** Succeeded, but something deserves an operator's attention. */
  readonly warning?: string;
}

/** A failure with a message already fit for the panel. */
class BackupRunFailure extends Error {
  constructor(
    readonly panelMessage: string,
    readonly source: Pick<RunOutcome, 'sourceSnapshot' | 'sourceCreatedAt'> = {},
  ) {
    super(panelMessage);
    this.name = 'BackupRunFailure';
  }
}

/**
 * Copies the newest local database snapshot to the backup server, encrypted,
 * once a day at the configured Tehran time and on demand from the panel.
 *
 * It never takes the dump itself. The host's root-owned backup timer already
 * does that (pg_dump inside the Postgres container, decode-checked, published
 * by rename); this service only reads the result, which keeps the API free of
 * database-superuser and Docker access.
 *
 * The database is the source of truth: one row per attempt, never deleted, a
 * unique Tehran day per scheduled run so a restart or a second process cannot
 * double-run it, and stale RUNNING rows are closed on boot.
 */
@Injectable()
export class BackupRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BackupRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    @Inject(SYSTEM_SETTINGS_DATABASE) private readonly database: SystemSettingsDatabase,
    @Inject(SETTINGS_SECRET_BOX) private readonly secrets: SettingsSecretBox,
    @Inject(BACKUP_TRANSPORT) private readonly transport: BackupTransport,
    @Inject(BACKUP_SOURCE_DIR) private readonly sourceDir: string,
    @Inject(AlertLogger) private readonly alerts: AlertLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.recoverInterrupted()
      .catch(() => this.logger.error('Could not close interrupted backup runs'))
      .then(() => this.tickGuarded());
    this.timer = setInterval(() => void this.tickGuarded(), TICK_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.inFlight;
  }

  async recoverInterrupted(now: Date = new Date()): Promise<number> {
    const { count } = await this.database.backupRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - INTERRUPTED_AFTER_MS) } },
      data: {
        status: 'FAILED',
        finishedAt: now,
        errorMessage: 'اجرا ناتمام ماند؛ سرویس API در میانه‌ی کار متوقف شد.',
      },
    });
    return count;
  }

  /** One scheduler pass. Resolves once a due run (if any) has finished. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    let runId: string | null = null;
    try {
      const settings = await this.database.backupSettings.findUnique({ where: { id: BACKUP_SETTINGS_ID } });
      if (settings === null || !settings.isEnabled || !isScheduledRunDue(now, settings.dailyAtMinute)) return;

      const day = tehranDay(now);
      if ((await this.database.backupRun.findUnique({ where: { scheduledDay: day } })) !== null) return;
      runId = (await this.database.backupRun.create({ data: { trigger: 'SCHEDULED', scheduledDay: day } })).id;
    } catch (error) {
      /* Another process claimed today's run between the read and the insert. */
      if ((error as { readonly code?: unknown }).code === 'P2002') return;
      throw error;
    } finally {
      if (runId === null) this.inFlight = false;
    }
    if (runId !== null) await this.execute(runId, now);
  }

  /** Start a run now. Returns at once; the panel polls the run list. */
  async startManualRun(staffId: string): Promise<{ run: BackupRunDto }> {
    const busy = new BaratDomainException({
      code: 'CONFLICT',
      status: 409,
      safeMessage: 'یک پشتیبان‌گیری در حال اجراست؛ پس از پایان آن دوباره تلاش کنید.',
    });
    if (this.inFlight) throw busy;
    /* Claimed before the first await, so two clicks cannot both get through. */
    this.inFlight = true;
    let row;
    try {
      if ((await this.database.backupRun.count({ where: { status: 'RUNNING' } })) > 0) throw busy;
      row = await this.database.backupRun.create({ data: { trigger: 'MANUAL', requestedByStaffId: staffId } });
    } catch (error) {
      this.inFlight = false;
      throw error;
    }
    void this.execute(row.id, new Date());
    return { run: toRunDto(row) };
  }

  /* ---------------------------------------------------------------- the run */

  /** Never rejects; always clears `inFlight`. */
  private async execute(runId: string, now: Date): Promise<void> {
    try {
      let outcome: RunOutcome;
      try {
        outcome = await this.perform(now);
      } catch (error) {
        outcome = {
          status: 'FAILED',
          errorMessage: failureMessage(error),
          ...(error instanceof BackupRunFailure ? error.source : {}),
        };
      }

      const { warning, ...columns } = outcome;
      await this.database.backupRun.update({
        where: { id: runId },
        data: { ...columns, finishedAt: new Date() },
      });

      if (outcome.status === 'FAILED') {
        this.logger.error(`Off-host backup run ${runId} failed`);
        this.alerts.log({
          severity: 'ERROR',
          source: 'SYSTEM',
          message: 'Off-host database backup failed',
          context: { runId },
          dedupKey: 'SYSTEM:backup-failed',
        });
      } else if (warning !== undefined) {
        this.alerts.log({
          severity: 'WARNING',
          source: 'SYSTEM',
          message: warning,
          context: { runId },
          dedupKey: 'SYSTEM:backup-warning',
        });
      }
    } catch {
      this.logger.error(`Could not record the outcome of backup run ${runId}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async perform(now: Date): Promise<RunOutcome> {
    const settings = await this.database.backupSettings.findUnique({ where: { id: BACKUP_SETTINGS_ID } });
    if (settings === null) throw new BackupRunFailure('تنظیمات پشتیبان‌گیری ذخیره نشده است.');
    if (settings.privateKeyEncrypted === null || settings.archivePassphraseEncrypted === null) {
      throw new BackupRunFailure('کلید SSH یا رمز نسخه‌های پشتیبان تنظیم نشده است.');
    }

    let snapshot;
    try {
      snapshot = await findNewestSnapshot(this.sourceDir, now);
    } catch (error) {
      if (error instanceof BackupSourceError) {
        throw new BackupRunFailure('پوشه‌ی پشتیبان‌های محلی روی سرور خوانده نشد.');
      }
      throw error;
    }
    if (snapshot === null) {
      throw new BackupRunFailure('هیچ نسخه‌ی پشتیبان محلی کاملی روی سرور پیدا نشد.');
    }
    const source = { sourceSnapshot: snapshot.name, sourceCreatedAt: snapshot.createdAt };
    const stale = now.getTime() - snapshot.createdAt.getTime() > STALE_SNAPSHOT_MS;

    const previous = await this.database.backupRun.findFirst({
      where: { status: 'SUCCEEDED', sourceSnapshot: snapshot.name, sourceCreatedAt: snapshot.createdAt },
      orderBy: { startedAt: 'desc' },
    });
    if (previous !== null) {
      if (stale) {
        throw new BackupRunFailure(
          'بیش از ۲۶ ساعت است که نسخه‌ی پشتیبان محلی جدیدی ساخته نشده؛ تایمر barat-backup روی سرور را بررسی کنید.',
          source,
        );
      }
      return {
        status: 'SKIPPED',
        ...source,
        ...(previous.remoteFileName === null ? {} : { remoteFileName: previous.remoteFileName }),
        errorMessage: 'این نسخه قبلاً به سرور پشتیبان ارسال شده است.',
      };
    }

    const target: BackupTarget = {
      host: settings.host,
      port: settings.port,
      username: settings.username,
      remoteDirectory: settings.remoteDirectory,
      hostKeys: parseHostKeys(settings.hostKeys),
      privateKeyPem: this.secrets.open('backupPrivateKey', settings.privateKeyEncrypted),
    };
    const passphrase = this.secrets.open('backupArchivePassphrase', settings.archivePassphraseEncrypted);
    const remoteName = remoteArchiveName(snapshot.createdAt);

    const workdir = await mkdtemp(join(tmpdir(), 'barat-archive-'));
    try {
      const archivePath = join(workdir, remoteName);
      let archive;
      try {
        archive = await encryptArchive(snapshot.dumpPath, archivePath, passphrase);
      } catch (error) {
        throw new BackupRunFailure(
          error instanceof ArchiveError ? 'رمزنگاری نسخه‌ی پشتیبان ناموفق بود.' : 'خواندن یا رمزنگاری نسخه‌ی محلی ناموفق بود.',
          source,
        );
      }

      try {
        await this.transport.upload(target, archivePath, remoteName);
      } catch (error) {
        throw new BackupRunFailure(transportMessage(error), source);
      }

      let notes: string[] = [];
      try {
        const names = await this.transport.list(target);
        if (!names.includes(remoteName)) {
          throw new BackupRunFailure('فایل پس از ارسال روی سرور پشتیبان دیده نشد.', source);
        }
        await this.transport.remove(target, archivesToPrune(names, settings.retentionCount));
      } catch (error) {
        if (error instanceof BackupRunFailure) throw error;
        notes = [`ارسال انجام شد اما پاک‌کردن نسخه‌های قدیمی ناموفق بود: ${transportMessage(error)}`];
      }
      if (stale) notes.push('هشدار: آخرین نسخه‌ی محلی بیش از ۲۶ ساعت قدمت دارد.');

      return {
        status: 'SUCCEEDED',
        ...source,
        remoteFileName: remoteName,
        sizeBytes: archive.sizeBytes,
        sha256: archive.sha256,
        errorMessage: notes.length === 0 ? null : notes.join(' '),
        ...(stale ? { warning: 'Off-host backup uploaded a local snapshot older than 26 hours' } : {}),
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async tickGuarded(): Promise<void> {
    try {
      await this.tick();
    } catch {
      /* The next minute retries; the cause is a database read, already logged by Prisma. */
      this.logger.error('Backup scheduler pass failed');
    }
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof BackupRunFailure) return error.panelMessage;
  if (error instanceof BackupTransportError || error instanceof BaratDomainException) {
    return transportMessage(error);
  }
  return 'خطای پیش‌بینی‌نشده در پشتیبان‌گیری؛ گزارش سرور را بررسی کنید.';
}
