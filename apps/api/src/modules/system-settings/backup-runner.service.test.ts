import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptArchive } from './backup-archive';
import { BackupRunnerService } from './backup-runner.service';
import { BackupSettingsService } from './backup-settings.service';
import { BackupTransportError, type BackupTarget, type BackupTransport } from './backup-transport';
import { SettingsSecretBox } from './settings-secrets';
import type { SystemSettingsDatabase } from './smtp-transport';
import { generateEd25519SshKey, parseHostKeys } from './ssh-keys';

const ACTOR = {
  staff: { staffId: 'staff-1', role: 'ADMIN' },
  metadata: { ip: '127.0.0.1', userAgent: 'vitest' },
} as never;

const HOST_KEY_LINE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const PASSPHRASE = 'a long archive passphrase 1405';
const DUMP = Buffer.from('PGDMP fake custom-format dump '.repeat(2_000));

/* 04:00 Tehran on 2026-10-22 is 00:30 UTC. */
const AT_0400 = new Date('2026-10-22T00:30:00Z');

interface RunRow {
  id: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  status: 'RUNNING' | 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  scheduledDay: string | null;
  sourceSnapshot: string | null;
  sourceCreatedAt: Date | null;
  remoteFileName: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  errorMessage: string | null;
  requestedByStaffId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

function memoryDatabase() {
  let settings: Record<string, unknown> | null = null;
  const runs: RunRow[] = [];
  let sequence = 0;

  const matches = (row: RunRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      const actual = row[key as keyof RunRow];
      if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
      if (value !== null && typeof value === 'object' && 'lt' in value) {
        return actual instanceof Date && actual < (value as { lt: Date }).lt;
      }
      return actual === value;
    });

  const database = {
    backupSettings: {
      findUnique: vi.fn(async () => settings),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        settings = {
          isEnabled: false,
          host: '',
          port: 22,
          username: '',
          remoteDirectory: '',
          hostKeys: '',
          privateKeyEncrypted: null,
          publicKey: null,
          archivePassphraseEncrypted: null,
          dailyAtMinute: 240,
          retentionCount: 14,
          ...(settings ?? args.create),
          ...args.update,
          updatedAt: new Date(),
        };
        return settings;
      }),
    },
    backupRun: {
      create: vi.fn(async (args: { data: Partial<RunRow> }) => {
        if (args.data.scheduledDay != null && runs.some((run) => run.scheduledDay === args.data.scheduledDay)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row: RunRow = {
          id: `run_${++sequence}`,
          status: 'RUNNING',
          scheduledDay: null,
          sourceSnapshot: null,
          sourceCreatedAt: null,
          remoteFileName: null,
          sizeBytes: null,
          sha256: null,
          errorMessage: null,
          requestedByStaffId: null,
          startedAt: new Date(),
          finishedAt: null,
          trigger: 'MANUAL',
          ...args.data,
        };
        runs.push(row);
        return row;
      }),
      findUnique: vi.fn(async (args: { where: { scheduledDay: string } }) =>
        runs.find((run) => run.scheduledDay === args.where.scheduledDay) ?? null,
      ),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
        [...runs].reverse().find((run) => matches(run, args.where)) ?? null,
      ),
      findMany: vi.fn(async () => [...runs].reverse()),
      count: vi.fn(async (args: { where: Record<string, unknown> }) => runs.filter((run) => matches(run, args.where)).length),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<RunRow> }) => {
        const run = runs.find((candidate) => candidate.id === args.where.id) as RunRow;
        Object.assign(run, args.data);
        return run;
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Partial<RunRow> }) => {
        const hit = runs.filter((run) => matches(run, args.where));
        for (const run of hit) Object.assign(run, args.data);
        return { count: hit.length };
      }),
    },
  } as unknown as SystemSettingsDatabase;

  return { database, runs };
}

/** The backup server: a directory, and a record of every target it was given. */
function memoryTransport(remoteDir: string) {
  const targets: BackupTarget[] = [];
  const transport: BackupTransport = {
    testWrite: vi.fn(async (target: BackupTarget) => {
      targets.push(target);
    }),
    upload: vi.fn(async (target: BackupTarget, localPath: string, remoteName: string) => {
      targets.push(target);
      await copyFile(localPath, join(remoteDir, remoteName));
    }),
    list: vi.fn(async () => {
      const { readdir } = await import('node:fs/promises');
      return readdir(remoteDir);
    }),
    remove: vi.fn(async (_target: BackupTarget, names: readonly string[]) => {
      for (const name of names) await rm(join(remoteDir, name));
    }),
    scanHostKeys: vi.fn(async () => parseHostKeys(HOST_KEY_LINE)),
  };
  return { transport, targets };
}

let root: string;
let sourceDir: string;
let remoteDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'backup-runner-test-'));
  sourceDir = join(root, 'local');
  remoteDir = join(root, 'remote');
  await mkdir(sourceDir);
  await mkdir(remoteDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function localSnapshot(name: string, createdAt: Date): Promise<void> {
  await mkdir(join(sourceDir, name));
  await writeFile(join(sourceDir, name, 'database.dump'), DUMP);
  await utimes(join(sourceDir, name, 'database.dump'), createdAt, createdAt);
}

async function setup(options: { enabled?: boolean; retentionCount?: number } = {}) {
  const { database, runs } = memoryDatabase();
  const { transport, targets } = memoryTransport(remoteDir);
  const secrets = new SettingsSecretBox(Buffer.alloc(32, 3));
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });
  const alerts = { log: vi.fn() };
  const settingsService = new BackupSettingsService(database, { record } as never, secrets, transport, sourceDir);
  const runner = new BackupRunnerService(database, secrets, transport, sourceDir, alerts as never);

  await settingsService.generateKey(ACTOR);
  await settingsService.update(
    {
      isEnabled: options.enabled ?? true,
      host: 'backup.example.com',
      port: 22,
      username: 'barat',
      remoteDirectory: 'backups',
      hostKeys: HOST_KEY_LINE,
      dailyAt: '04:00',
      retentionCount: options.retentionCount ?? 14,
      archivePassphrase: PASSPHRASE,
    },
    ACTOR,
  );
  return { database, runs, transport, targets, runner, settingsService, alerts, record, secrets };
}

describe('BackupRunnerService scheduled runs', () => {
  it('does nothing before the configured Tehran time', async () => {
    const { runner, runs } = await setup();
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    await runner.tick(new Date('2026-10-22T00:29:00Z'));

    expect(runs).toEqual([]);
  });

  it('uploads the newest snapshot encrypted, once per Tehran day', async () => {
    const { runner, runs, targets } = await setup();
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    await runner.tick(AT_0400);
    await runner.tick(new Date(AT_0400.getTime() + 60_000));

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      trigger: 'SCHEDULED',
      status: 'SUCCEEDED',
      scheduledDay: '2026-10-22',
      sourceSnapshot: 'snapshot-AAAA0001',
      remoteFileName: 'barat-db-20261021T235000Z.bkp',
      errorMessage: null,
    });
    expect(targets[0]).toMatchObject({ host: 'backup.example.com', username: 'barat', remoteDirectory: 'backups' });
    expect(targets[0]?.privateKeyPem).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/u);

    const uploaded = join(remoteDir, 'barat-db-20261021T235000Z.bkp');
    expect((await readFile(uploaded)).includes(DUMP.subarray(0, 32))).toBe(false);
    await decryptArchive(uploaded, join(root, 'restored.dump'), PASSPHRASE);
    expect((await readFile(join(root, 'restored.dump'))).equals(DUMP)).toBe(true);
  });

  it('skips a snapshot that is already off the host', async () => {
    const { runner, runs } = await setup();
    /* Manual runs use the real clock. */
    await localSnapshot('snapshot-AAAA0001', new Date(Date.now() - 3_600_000));
    await runner.startManualRun('staff-1');
    await vi.waitFor(() => expect(runner.isRunning).toBe(false));

    await runner.startManualRun('staff-1');
    await vi.waitFor(() => expect(runner.isRunning).toBe(false));

    expect(runs[0]).toMatchObject({ trigger: 'MANUAL', status: 'SUCCEEDED' });
    expect(runs[1]).toMatchObject({ trigger: 'MANUAL', status: 'SKIPPED', requestedByStaffId: 'staff-1' });
    expect(runs[1]?.remoteFileName).toBe(runs[0]?.remoteFileName);
  });

  it('fails and alerts when the host has made no new snapshot for over 26 hours', async () => {
    const { runner, runs, alerts } = await setup();
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));
    await runner.tick(AT_0400);

    /* 27 h after the snapshot; 06:30 Tehran on the next day. */
    await runner.tick(new Date('2026-10-23T03:00:00Z'));

    expect(runs[1]).toMatchObject({ status: 'FAILED', scheduledDay: '2026-10-23' });
    expect(runs[1]?.errorMessage).toContain('۲۶ ساعت');
    expect(alerts.log).toHaveBeenCalledWith(expect.objectContaining({ severity: 'ERROR', source: 'SYSTEM' }));
  });

  it('keeps only the configured number of our own archives', async () => {
    const { runner } = await setup({ retentionCount: 2 });
    for (const name of [
      'barat-db-20261018T235000Z.bkp',
      'barat-db-20261019T235000Z.bkp',
      'barat-db-20261020T235000Z.bkp',
      'somebody-elses-file.tar',
    ]) {
      await writeFile(join(remoteDir, name), 'x');
    }
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    await runner.tick(AT_0400);

    const { readdir } = await import('node:fs/promises');
    expect((await readdir(remoteDir)).sort()).toEqual([
      'barat-db-20261020T235000Z.bkp',
      'barat-db-20261021T235000Z.bkp',
      'somebody-elses-file.tar',
    ]);
  });

  it('records a transport failure in Persian and raises an alert', async () => {
    const { runner, runs, transport, alerts } = await setup();
    vi.mocked(transport.upload).mockRejectedValueOnce(new BackupTransportError('AUTH_FAILED'));
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    await runner.tick(AT_0400);

    expect(runs[0]).toMatchObject({ status: 'FAILED', sourceSnapshot: 'snapshot-AAAA0001' });
    expect(runs[0]?.errorMessage).toContain('authorized_keys');
    expect(alerts.log).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when there is no local snapshot at all', async () => {
    const { runner, runs } = await setup();

    await runner.tick(AT_0400);

    expect(runs[0]).toMatchObject({ status: 'FAILED' });
    expect(runs[0]?.errorMessage).toContain('محلی');
  });

  it('stays idle while switched off', async () => {
    const { runner, runs } = await setup({ enabled: false });
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    await runner.tick(AT_0400);

    expect(runs).toEqual([]);
  });
});

describe('BackupRunnerService manual runs', () => {
  it('refuses a second run while one is in flight', async () => {
    const { runner, transport } = await setup();
    await localSnapshot('snapshot-AAAA0001', new Date(Date.now() - 3_600_000));
    let release: () => void = () => undefined;
    vi.mocked(transport.upload).mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    await runner.startManualRun('staff-1');
    await expect(runner.startManualRun('staff-1')).rejects.toMatchObject({ code: 'CONFLICT' });

    await vi.waitFor(() => expect(transport.upload).toHaveBeenCalled());
    release();
    await vi.waitFor(() => expect(runner.isRunning).toBe(false));
  });

  it('closes runs left RUNNING by a process that died', async () => {
    const { runner, runs, database } = await setup();
    await database.backupRun.create({
      data: { trigger: 'MANUAL', startedAt: new Date('2026-10-22T00:00:00Z') },
    } as never);

    expect(await runner.recoverInterrupted(new Date('2026-10-22T05:00:00Z'))).toBe(1);
    expect(runs[0]).toMatchObject({ status: 'FAILED' });
  });
});

describe('BackupSettingsService', () => {
  it('generates a key pair and exposes only the public half', async () => {
    const { settingsService, record } = await setup();

    const { settings } = await settingsService.get(AT_0400);

    expect(settings.publicKey).toMatch(/^ssh-ed25519 AAAA/u);
    expect(settings.hasPrivateKey).toBe(true);
    expect(settings.hasArchivePassphrase).toBe(true);
    expect(settings.hostKeyFingerprints[0]?.fingerprint).toMatch(/^SHA256:/u);
    expect(JSON.stringify(settings)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(record.mock.calls)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(record.mock.calls)).not.toContain(PASSPHRASE);
  });

  it('accepts a pasted unencrypted OpenSSH key and derives its public line', async () => {
    const { settingsService } = await setup();
    const pasted = generateEd25519SshKey('laptop');

    const { settings } = await settingsService.update(
      {
        isEnabled: true,
        host: 'backup.example.com',
        port: 22,
        username: 'barat',
        remoteDirectory: 'backups',
        hostKeys: HOST_KEY_LINE,
        dailyAt: '03:45',
        retentionCount: 7,
        privateKey: pasted.privateKeyPem,
      },
      ACTOR,
    );

    expect(pasted.publicKeyLine.startsWith(settings.publicKey as string)).toBe(true);
    expect(settings.dailyAt).toBe('03:45');
  });

  it('refuses to switch on without a pinned host key', async () => {
    const { settingsService } = await setup();

    await expect(
      settingsService.update(
        {
          isEnabled: true,
          host: 'backup.example.com',
          port: 22,
          username: 'barat',
          remoteDirectory: 'backups',
          hostKeys: '',
          dailyAt: '04:00',
          retentionCount: 14,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ safeMessage: expect.stringContaining('host key') });
  });

  it('tests the unsaved connection details with the stored key', async () => {
    const { settingsService, targets } = await setup();

    const result = await settingsService.testConnection({
      host: 'other.example.com',
      port: 2222,
      username: 'svc',
      remoteDirectory: 'srv/barat',
      hostKeys: HOST_KEY_LINE,
    });

    expect(result.success).toBe(true);
    expect(targets.at(-1)).toMatchObject({ host: 'other.example.com', port: 2222, remoteDirectory: 'srv/barat' });
  });

  it('reports the local snapshot, or why it cannot be read', async () => {
    const { settingsService } = await setup();
    await localSnapshot('snapshot-AAAA0001', new Date('2026-10-21T23:50:00Z'));

    const found = await settingsService.get(AT_0400);
    expect(found.localSnapshot).toMatchObject({ name: 'snapshot-AAAA0001' });

    await rm(sourceDir, { recursive: true });
    const missing = await settingsService.get(AT_0400);
    expect(missing.localSnapshot).toBeNull();
    expect(missing.localSnapshotError).not.toBeNull();
  });
});
