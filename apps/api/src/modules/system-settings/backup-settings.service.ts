import { Inject, Injectable } from '@nestjs/common';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import type {
  BackupConnectionDraftInput,
  ScanHostKeysInput,
  UpdateBackupSettingsInput,
} from './backup-settings.schemas';
import {
  BackupSourceError,
  findNewestSnapshot,
  formatDailyTime,
  parseDailyTime,
} from './backup-schedule';
import { BackupTransportError, type BackupTarget, type BackupTransport } from './backup-transport';
import type { SettingsSecretBox } from './settings-secrets';
import { SETTINGS_SECRET_BOX, SYSTEM_SETTINGS_DATABASE, type SystemSettingsDatabase } from './smtp-transport';
import {
  formatHostKeys,
  generateEd25519SshKey,
  InvalidSshKeyError,
  parseHostKeys,
  publicLineOfPrivateKey,
  type HostKey,
} from './ssh-keys';

export const BACKUP_TRANSPORT = Symbol('BACKUP_TRANSPORT');
export const BACKUP_SOURCE_DIR = Symbol('BACKUP_SOURCE_DIR');
export const BACKUP_SETTINGS_ID = 'default';

export const BACKUP_SETTINGS_AUDIT_ACTION = 'BACKUP_SETTINGS_UPDATED';
export const BACKUP_KEY_AUDIT_ACTION = 'BACKUP_SSH_KEY_GENERATED';

const RUN_HISTORY_LIMIT = 20;

export interface BackupSettingsDto {
  readonly isEnabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly remoteDirectory: string;
  /** Canonical `<type> <base64>` lines, editable in the form. */
  readonly hostKeys: string;
  readonly hostKeyFingerprints: readonly { readonly type: string; readonly fingerprint: string }[];
  readonly hasPrivateKey: boolean;
  /** The line to put in the backup server's authorized_keys. Not secret. */
  readonly publicKey: string | null;
  readonly hasArchivePassphrase: boolean;
  /** `HH:MM`, Asia/Tehran. */
  readonly dailyAt: string;
  readonly retentionCount: number;
  readonly updatedAt: string | null;
  readonly encryptionKeyConfigured: boolean;
  /** Where the host's own backup timer leaves its dumps (environment setting). */
  readonly sourceDirectory: string;
}

export interface LocalSnapshotDto {
  readonly name: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
}

export interface BackupRunDto {
  readonly id: string;
  readonly trigger: 'SCHEDULED' | 'MANUAL';
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  readonly sourceSnapshot: string | null;
  readonly sourceCreatedAt: string | null;
  readonly remoteFileName: string | null;
  /** Decimal string: a BigInt column. */
  readonly sizeBytes: string | null;
  readonly sha256: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface BackupTestResultDto {
  readonly success: boolean;
  readonly message: string;
  readonly durationMs: number;
}

interface SettingsActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

type BackupSettingsRow = NonNullable<Awaited<ReturnType<SystemSettingsDatabase['backupSettings']['findUnique']>>>;

/**
 * Admin control of the off-host backup copy: where it goes, how the API
 * authenticates there, and what the archives are encrypted with.
 *
 * The SSH private key and the archive passphrase are write-only. The panel can
 * generate the key pair so the private half never leaves the server; it only
 * ever sees the public line it has to install on the backup host.
 */
@Injectable()
export class BackupSettingsService {
  constructor(
    @Inject(SYSTEM_SETTINGS_DATABASE) private readonly database: SystemSettingsDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SETTINGS_SECRET_BOX) private readonly secrets: SettingsSecretBox,
    @Inject(BACKUP_TRANSPORT) private readonly transport: BackupTransport,
    @Inject(BACKUP_SOURCE_DIR) private readonly sourceDir: string,
  ) {}

  async get(now: Date = new Date()): Promise<{
    settings: BackupSettingsDto;
    localSnapshot: LocalSnapshotDto | null;
    localSnapshotError: string | null;
  }> {
    const row = await this.find();
    let localSnapshot: LocalSnapshotDto | null = null;
    let localSnapshotError: string | null = null;
    try {
      const snapshot = await findNewestSnapshot(this.sourceDir, now);
      localSnapshot =
        snapshot === null
          ? null
          : { name: snapshot.name, createdAt: snapshot.createdAt.toISOString(), sizeBytes: snapshot.sizeBytes };
    } catch (error) {
      if (!(error instanceof BackupSourceError)) throw error;
      localSnapshotError = 'پوشه‌ی پشتیبان‌های محلی روی سرور خوانده نشد (وجود ندارد یا API به آن دسترسی ندارد).';
    }
    return { settings: this.toDto(row), localSnapshot, localSnapshotError };
  }

  async update(input: UpdateBackupSettingsInput, actor: SettingsActor): Promise<{ settings: BackupSettingsDto }> {
    const current = await this.find();
    const hostKeys = parseHostKeysOrThrow(input.hostKeys);
    const dailyAtMinute = parseDailyTime(input.dailyAt) as number;

    let privateKeyEncrypted = current?.privateKeyEncrypted ?? null;
    let publicKey = current?.publicKey ?? null;
    const pastedKey = (input.privateKey ?? '').trim();
    if (pastedKey !== '') {
      let line: string;
      try {
        line = publicLineOfPrivateKey(pastedKey);
      } catch (error) {
        throw invalid(
          error instanceof InvalidSshKeyError && error.reason === 'ENCRYPTED'
            ? 'کلید خصوصی رمز دارد؛ یک کلید بدون رمز وارد کنید یا از دکمه‌ی «ساخت کلید» استفاده کنید.'
            : 'کلید خصوصی معتبر نیست؛ فقط قالب OpenSSH (BEGIN OPENSSH PRIVATE KEY) پذیرفته می‌شود.',
        );
      }
      privateKeyEncrypted = this.secrets.seal('backupPrivateKey', `${pastedKey}\n`);
      publicKey = line;
    }

    let archivePassphraseEncrypted = current?.archivePassphraseEncrypted ?? null;
    const newPassphrase = input.archivePassphrase ?? '';
    if (newPassphrase !== '') {
      archivePassphraseEncrypted = this.secrets.seal('backupArchivePassphrase', newPassphrase);
    }

    if (input.isEnabled) {
      const missing: string[] = [];
      if (input.host === '') missing.push('نشانی سرور');
      if (input.username === '') missing.push('نام کاربری');
      if (input.remoteDirectory === '') missing.push('مسیر روی سرور');
      if (hostKeys.length === 0) missing.push('کلید سرور (host key)');
      if (privateKeyEncrypted === null) missing.push('کلید SSH');
      if (archivePassphraseEncrypted === null) missing.push('رمز نسخه‌های پشتیبان');
      if (missing.length > 0) {
        throw invalid(`برای فعال‌کردن پشتیبان‌گیری این موارد لازم است: ${missing.join('، ')}.`);
      }
    }

    const data = {
      isEnabled: input.isEnabled,
      host: input.host,
      port: input.port,
      username: input.username,
      remoteDirectory: input.remoteDirectory,
      hostKeys: formatHostKeys(hostKeys),
      privateKeyEncrypted,
      publicKey,
      archivePassphraseEncrypted,
      dailyAtMinute,
      retentionCount: input.retentionCount,
      updatedByStaffId: actor.staff.staffId,
    };
    const updated = await this.database.backupSettings.upsert({
      where: { id: BACKUP_SETTINGS_ID },
      create: { id: BACKUP_SETTINGS_ID, ...data },
      update: data,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: BACKUP_SETTINGS_AUDIT_ACTION,
      entity: 'BackupSettings',
      entityId: BACKUP_SETTINGS_ID,
      before: current === null ? null : auditView(current),
      after: {
        ...auditView(updated),
        clientIdentityChanged: pastedKey !== '',
        archiveProtectionChanged: newPassphrase !== '',
      },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { settings: this.toDto(updated) };
  }

  /**
   * Mint a new Ed25519 key pair, keep the private half sealed, and return the
   * public line. Replaces any previous key, so the old line must be removed
   * from the backup server and the new one installed.
   */
  async generateKey(actor: SettingsActor): Promise<{ settings: BackupSettingsDto }> {
    const current = await this.find();
    const generated = generateEd25519SshKey(`barat-backup-${new Date().toISOString().slice(0, 10)}`);
    const privateKeyEncrypted = this.secrets.seal('backupPrivateKey', generated.privateKeyPem);

    const updated = await this.database.backupSettings.upsert({
      where: { id: BACKUP_SETTINGS_ID },
      create: {
        id: BACKUP_SETTINGS_ID,
        privateKeyEncrypted,
        publicKey: generated.publicKeyLine,
        updatedByStaffId: actor.staff.staffId,
      },
      update: { privateKeyEncrypted, publicKey: generated.publicKeyLine, updatedByStaffId: actor.staff.staffId },
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: BACKUP_KEY_AUDIT_ACTION,
      entity: 'BackupSettings',
      entityId: BACKUP_SETTINGS_ID,
      before: { publicLine: current?.publicKey ?? null },
      after: { publicLine: generated.publicKeyLine },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { settings: this.toDto(updated) };
  }

  /**
   * Ask the server for its host keys (trust on first use). The admin should
   * compare the fingerprints with what the backup host's owner reports before
   * saving them.
   */
  async scanHostKeys(input: ScanHostKeysInput): Promise<{
    keys: readonly { type: string; fingerprint: string; line: string }[];
  }> {
    if (input.host === '') throw invalid('نشانی سرور پشتیبان را وارد کنید.');
    try {
      const keys = await this.transport.scanHostKeys(input.host, input.port);
      return { keys: keys.map((key) => ({ type: key.type, fingerprint: key.fingerprint, line: `${key.type} ${key.key}` })) };
    } catch (error) {
      throw invalid(transportMessage(error));
    }
  }

  /** Log in with the stored key and write, then delete, a probe file. Nothing is saved. */
  async testConnection(draft: BackupConnectionDraftInput): Promise<BackupTestResultDto> {
    const started = Date.now();
    const current = await this.find();
    if (draft.host === '' || draft.username === '' || draft.remoteDirectory === '') {
      throw invalid('نشانی سرور، نام کاربری و مسیر را وارد کنید.');
    }
    const hostKeys = parseHostKeysOrThrow(draft.hostKeys);
    if (hostKeys.length === 0) throw invalid('ابتدا کلید سرور (host key) را دریافت و تأیید کنید.');
    if (current?.privateKeyEncrypted == null) throw invalid('ابتدا کلید SSH بسازید یا وارد و ذخیره کنید.');

    const target: BackupTarget = {
      host: draft.host,
      port: draft.port,
      username: draft.username,
      remoteDirectory: draft.remoteDirectory,
      hostKeys,
      privateKeyPem: this.secrets.open('backupPrivateKey', current.privateKeyEncrypted),
    };
    try {
      await this.transport.testWrite(target);
      return {
        success: true,
        message: 'ورود با کلید SSH موفق بود و نوشتن و حذف یک فایل آزمایشی در مسیر انجام شد.',
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return { success: false, message: transportMessage(error), durationMs: Date.now() - started };
    }
  }

  async listRuns(): Promise<{ items: readonly BackupRunDto[] }> {
    const rows = await this.database.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: RUN_HISTORY_LIMIT,
    });
    return { items: rows.map(toRunDto) };
  }

  /* ----------------------------------------------------------------- helpers */

  private find(): Promise<BackupSettingsRow | null> {
    return this.database.backupSettings.findUnique({ where: { id: BACKUP_SETTINGS_ID } });
  }

  private toDto(row: BackupSettingsRow | null): BackupSettingsDto {
    const hostKeys = row === null ? [] : safeParseHostKeys(row.hostKeys);
    return {
      isEnabled: row?.isEnabled ?? false,
      host: row?.host ?? '',
      port: row?.port ?? 22,
      username: row?.username ?? '',
      remoteDirectory: row?.remoteDirectory ?? '',
      hostKeys: formatHostKeys(hostKeys),
      hostKeyFingerprints: hostKeys.map((key) => ({ type: key.type, fingerprint: key.fingerprint })),
      hasPrivateKey: row?.privateKeyEncrypted != null,
      publicKey: row?.publicKey ?? null,
      hasArchivePassphrase: row?.archivePassphraseEncrypted != null,
      dailyAt: formatDailyTime(row?.dailyAtMinute ?? 240),
      retentionCount: row?.retentionCount ?? 14,
      updatedAt: row === null ? null : row.updatedAt.toISOString(),
      encryptionKeyConfigured: this.secrets.isAvailable,
      sourceDirectory: this.sourceDir,
    };
  }
}

export function toRunDto(row: {
  id: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  status: 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  sourceSnapshot: string | null;
  sourceCreatedAt: Date | null;
  remoteFileName: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): BackupRunDto {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    sourceSnapshot: row.sourceSnapshot,
    sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
    remoteFileName: row.remoteFileName,
    sizeBytes: row.sizeBytes === null ? null : row.sizeBytes.toString(),
    sha256: row.sha256,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function transportMessage(error: unknown): string {
  if (error instanceof BackupTransportError) return error.describe();
  if (error instanceof BaratDomainException) return error.safeMessage;
  return 'ارتباط با سرور پشتیبان ناموفق بود.';
}

function parseHostKeysOrThrow(text: string): HostKey[] {
  try {
    return parseHostKeys(text);
  } catch {
    throw invalid('کلید سرور (host key) معتبر نیست؛ هر خط باید به شکل «ssh-ed25519 AAAA…» باشد.');
  }
}

/* A stored value was validated on the way in; never fail a page load over it. */
function safeParseHostKeys(text: string): HostKey[] {
  try {
    return parseHostKeys(text);
  } catch {
    return [];
  }
}

function auditView(row: BackupSettingsRow): Record<string, unknown> {
  return {
    isEnabled: row.isEnabled,
    host: row.host,
    port: row.port,
    username: row.username,
    remoteDirectory: row.remoteDirectory,
    hostFingerprints: safeParseHostKeys(row.hostKeys).map((key) => key.fingerprint),
    dailyAt: formatDailyTime(row.dailyAtMinute),
    retentionCount: row.retentionCount,
    hasClientIdentity: row.privateKeyEncrypted !== null,
    hasArchiveProtection: row.archivePassphraseEncrypted !== null,
  };
}

function invalid(safeMessage: string): BaratDomainException {
  return new BaratDomainException({ code: 'VALIDATION_ERROR', status: 400, safeMessage });
}
