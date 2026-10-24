import { execFile, type ExecFileException } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatHostKeys, parseHostKeys, type HostKey } from './ssh-keys';

/**
 * The backup server, as the transport needs it. Every field has already been
 * validated by the settings schema; the transport re-checks the ones that end
 * up on a command line or in an sftp batch file anyway.
 */
export interface BackupTarget {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly remoteDirectory: string;
  readonly hostKeys: readonly HostKey[];
  /** Unencrypted OpenSSH private key. Written to a 0600 file for one call, then deleted. */
  readonly privateKeyPem: string;
}

export type BackupTransportFailure =
  | 'SSH_UNAVAILABLE'
  | 'CONNECT_FAILED'
  | 'HOST_KEY_MISMATCH'
  | 'AUTH_FAILED'
  | 'TIMEOUT'
  | 'REMOTE_ERROR';

const FAILURE_MESSAGES: Record<BackupTransportFailure, string> = {
  SSH_UNAVAILABLE: 'ابزار OpenSSH (sftp) روی سرور در دسترس نیست.',
  CONNECT_FAILED: 'اتصال به سرور پشتیبان برقرار نشد (نام سرور، پورت یا فایروال را بررسی کنید).',
  HOST_KEY_MISMATCH: 'کلید سرور پشتیبان با کلید ثبت‌شده یکی نیست؛ اتصال برای امنیت قطع شد.',
  AUTH_FAILED: 'سرور پشتیبان کلید SSH را نپذیرفت؛ کلید عمومی را در authorized_keys کاربر قرار دهید.',
  TIMEOUT: 'سرور پشتیبان در زمان مجاز پاسخ نداد.',
  REMOTE_ERROR: 'سرور پشتیبان عملیات فایل را رد کرد.',
};

export class BackupTransportError extends Error {
  constructor(
    readonly failure: BackupTransportFailure,
    /** A short, sanitised line from sftp itself for REMOTE_ERROR, e.g. a permission error. */
    readonly detail?: string,
  ) {
    super(failure);
    this.name = 'BackupTransportError';
  }

  describe(): string {
    const base = FAILURE_MESSAGES[this.failure];
    return this.detail === undefined ? base : `${base} (${this.detail})`;
  }
}

export interface BackupTransport {
  /** Write and delete a small probe file in the remote directory. */
  testWrite(target: BackupTarget): Promise<void>;
  /** Upload under a temporary name, then rename, so a half-copied file never carries the final name. */
  upload(target: BackupTarget, localPath: string, remoteName: string): Promise<void>;
  list(target: BackupTarget): Promise<string[]>;
  remove(target: BackupTarget, remoteNames: readonly string[]): Promise<void>;
  scanHostKeys(host: string, port: number): Promise<HostKey[]>;
}

export const HOST_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u;
export const USERNAME_PATTERN = /^[A-Za-z_][A-Za-z0-9._-]{0,31}$/u;
/**
 * Relative to the login's home, or absolute. A closed character set and no
 * `..` segment: the value is written into an sftp batch file, where a line
 * break would start a new command and `!` would run a local shell.
 */
export const REMOTE_DIRECTORY_PATTERN = /^\/?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/u;

export function isSafeRemoteDirectory(value: string): boolean {
  return (
    value.length <= 200 &&
    REMOTE_DIRECTORY_PATTERN.test(value) &&
    !value.split('/').some((segment) => segment === '..' || segment === '.')
  );
}

/* known_hosts entries are keyed by this alias rather than the host name, so a
 * changed DNS answer for the same name is still checked against the pin. */
const HOST_KEY_ALIAS = 'barat-backup-target';
const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}$/u;

const TIMEOUTS = { probe: 45_000, upload: 30 * 60_000, scan: 20_000 } as const;

/**
 * Talks to the backup server through the system's OpenSSH `sftp` client in
 * batch mode: key-only, host key pinned, no agent, no user config, no prompts.
 *
 * Never through a shell — `execFile` with an argument vector — and the private
 * key travels only through a private temporary file, never an argument or an
 * environment variable.
 */
export class OpenSshBackupTransport implements BackupTransport {
  constructor(
    private readonly binaries: { readonly sftp: string; readonly keyscan: string } = {
      sftp: 'sftp',
      keyscan: 'ssh-keyscan',
    },
  ) {}

  async testWrite(target: BackupTarget): Promise<void> {
    const probe = `.barat-write-test-${randomBytes(6).toString('hex')}`;
    await this.batch(target, TIMEOUTS.probe, (workdir) => [
      `-mkdir ${target.remoteDirectory}`,
      `cd ${target.remoteDirectory}`,
      `put ${join(workdir, 'probe')} ${probe}`,
      `rm ${probe}`,
    ]);
  }

  async upload(target: BackupTarget, localPath: string, remoteName: string): Promise<void> {
    assertSafeName(remoteName);
    if (!/^[A-Za-z0-9._/-]+$/u.test(localPath)) throw new BackupTransportError('REMOTE_ERROR');
    await this.batch(target, TIMEOUTS.upload, () => [
      `-mkdir ${target.remoteDirectory}`,
      `cd ${target.remoteDirectory}`,
      `-rm ${remoteName}.part`,
      `put ${localPath} ${remoteName}.part`,
      `rename ${remoteName}.part ${remoteName}`,
    ]);
  }

  async list(target: BackupTarget): Promise<string[]> {
    const stdout = await this.batch(target, TIMEOUTS.probe, () => [
      `cd ${target.remoteDirectory}`,
      'ls -1',
    ]);
    return stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('sftp>'))
      .map((line) => line.split('/').pop() ?? line);
  }

  async remove(target: BackupTarget, remoteNames: readonly string[]): Promise<void> {
    if (remoteNames.length === 0) return;
    for (const name of remoteNames) assertSafeName(name);
    await this.batch(target, TIMEOUTS.probe, () => [
      `cd ${target.remoteDirectory}`,
      ...remoteNames.map((name) => `rm ${name}`),
    ]);
  }

  async scanHostKeys(host: string, port: number): Promise<HostKey[]> {
    assertTarget({ host, port, username: 'probe', remoteDirectory: 'probe' });
    const { stdout } = await run(
      this.binaries.keyscan,
      ['-T', '10', '-p', String(port), '-t', 'ed25519,ecdsa,rsa', '--', host],
      TIMEOUTS.scan,
    ).catch((error: unknown) => {
      throw error instanceof BackupTransportError ? error : new BackupTransportError('CONNECT_FAILED');
    });
    const keys = parseHostKeys(stdout);
    if (keys.length === 0) throw new BackupTransportError('CONNECT_FAILED');
    return keys;
  }

  /* ------------------------------------------------------------- internals */

  private async batch(
    target: BackupTarget,
    timeoutMs: number,
    commands: (workdir: string) => readonly string[],
  ): Promise<string> {
    assertTarget(target);
    if (target.hostKeys.length === 0) throw new BackupTransportError('HOST_KEY_MISMATCH');

    const workdir = await mkdtemp(join(tmpdir(), 'barat-backup-'));
    try {
      const keyPath = join(workdir, 'id');
      const knownHostsPath = join(workdir, 'known_hosts');
      const batchPath = join(workdir, 'batch');
      await writeFile(keyPath, target.privateKeyPem, { mode: 0o600 });
      await writeFile(
        knownHostsPath,
        `${formatHostKeys(target.hostKeys)
          .split('\n')
          .map((line) => `${HOST_KEY_ALIAS} ${line}`)
          .join('\n')}\n`,
        { mode: 0o600 },
      );
      await writeFile(join(workdir, 'probe'), 'barat backup write test\n', { mode: 0o600 });

      const lines = commands(workdir);
      if (lines.some((line) => /[\r\n!]/u.test(line))) throw new BackupTransportError('REMOTE_ERROR');
      await writeFile(batchPath, `${lines.join('\n')}\n`, { mode: 0o600 });

      const { stdout } = await run(
        this.binaries.sftp,
        [
          '-b', batchPath,
          '-i', keyPath,
          '-P', String(target.port),
          '-F', '/dev/null',
          '-o', 'BatchMode=yes',
          '-o', 'IdentitiesOnly=yes',
          '-o', 'IdentityAgent=none',
          '-o', 'PasswordAuthentication=no',
          '-o', 'KbdInteractiveAuthentication=no',
          '-o', 'StrictHostKeyChecking=yes',
          '-o', `UserKnownHostsFile=${knownHostsPath}`,
          '-o', 'GlobalKnownHostsFile=/dev/null',
          '-o', `HostKeyAlias=${HOST_KEY_ALIAS}`,
          '-o', 'UpdateHostKeys=no',
          '-o', 'ConnectTimeout=20',
          '-o', 'ServerAliveInterval=15',
          '-o', 'ServerAliveCountMax=4',
          '-o', 'LogLevel=ERROR',
          '--',
          `${target.username}@${target.host}`,
        ],
        timeoutMs,
        workdir,
      );
      return stdout;
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

function assertTarget(target: Pick<BackupTarget, 'host' | 'port' | 'username' | 'remoteDirectory'>): void {
  if (
    !HOST_PATTERN.test(target.host) ||
    !Number.isSafeInteger(target.port) ||
    target.port < 1 ||
    target.port > 65_535 ||
    !USERNAME_PATTERN.test(target.username) ||
    !isSafeRemoteDirectory(target.remoteDirectory)
  ) {
    throw new BackupTransportError('REMOTE_ERROR');
  }
}

function assertSafeName(name: string): void {
  if (!SAFE_NAME.test(name) || name.startsWith('.') || name.startsWith('-')) {
    throw new BackupTransportError('REMOTE_ERROR');
  }
}

interface RunResult {
  readonly stdout: string;
}

function run(file: string, args: readonly string[], timeoutMs: number, scrub?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' } },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout });
          return;
        }
        reject(classify(error, stderr, scrub));
      },
    );
  });
}

/** OpenSSH's own wording is stable across versions, so stderr is classified, never relayed. */
function classify(
  error: ExecFileException,
  stderr: string,
  scrub: string | undefined,
): BackupTransportError {
  if (error.code === 'ENOENT') return new BackupTransportError('SSH_UNAVAILABLE');
  if (error.killed === true || error.signal === 'SIGTERM') return new BackupTransportError('TIMEOUT');
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/iu.test(stderr)) {
    return new BackupTransportError('HOST_KEY_MISMATCH');
  }
  if (/Permission denied \(|Too many authentication failures/iu.test(stderr)) {
    return new BackupTransportError('AUTH_FAILED');
  }
  if (/Could not resolve hostname|Connection refused|Connection timed out|No route to host|Network is unreachable|Connection closed by .* port|kex_exchange_identification/iu.test(stderr)) {
    return new BackupTransportError('CONNECT_FAILED');
  }
  return new BackupTransportError('REMOTE_ERROR', sanitiseDetail(stderr, scrub));
}

function sanitiseDetail(stderr: string, scrub: string | undefined): string | undefined {
  const line = stderr
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== '' && !candidate.startsWith('sftp>'));
  if (line === undefined) return undefined;
  const withoutTemp = scrub === undefined ? line : line.split(scrub).join('…');
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return withoutTemp.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 160);
}
