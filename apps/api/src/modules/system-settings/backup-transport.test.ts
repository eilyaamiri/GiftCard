import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BackupTransportError,
  isSafeRemoteDirectory,
  OpenSshBackupTransport,
  type BackupTarget,
} from './backup-transport';
import { generateEd25519SshKey, parseHostKeys } from './ssh-keys';

const HOST_KEYS = parseHostKeys('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl');
const KEY = generateEd25519SshKey('test');

let dir: string;
let out: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backup-transport-test-'));
  out = join(dir, 'out');
  await writeFile(join(dir, '.keep'), '');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A stand-in for OpenSSH's `sftp`: records its arguments, the batch file and
 * the private key's mode, then prints and exits as scripted. The paths are
 * baked in because the transport hands the child nothing but PATH.
 */
async function fakeSftp(behaviour: { stdout?: string; stderr?: string; exit?: number } = {}): Promise<string> {
  const script = join(dir, 'sftp');
  await writeFile(
    script,
    [
      '#!/bin/sh',
      `out="${out}"`,
      'mkdir -p "$out"',
      'printf "%s\\n" "$@" > "$out/args"',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -b) cp "$2" "$out/batch"; shift ;;',
      '    -i) ls -l "$2" | cut -c1-10 > "$out/keymode"; cp "$2" "$out/key"; dirname "$2" > "$out/workdir"; shift ;;',
      '  esac',
      '  shift',
      'done',
      `printf '%s' '${behaviour.stdout ?? ''}'`,
      `printf '%s' '${behaviour.stderr ?? ''}' >&2`,
      `exit ${behaviour.exit ?? 0}`,
      '',
    ].join('\n'),
  );
  await chmod(script, 0o755);
  return script;
}

function target(overrides: Partial<BackupTarget> = {}): BackupTarget {
  return {
    host: 'backup.example.com',
    port: 2222,
    username: 'barat',
    remoteDirectory: 'backups/barat',
    hostKeys: HOST_KEYS,
    privateKeyPem: KEY.privateKeyPem,
    ...overrides,
  };
}

function transport(sftp: string): OpenSshBackupTransport {
  return new OpenSshBackupTransport({ sftp, keyscan: join(dir, 'missing-keyscan') });
}

describe('OpenSshBackupTransport', () => {
  it('uploads under a temporary name and renames, with a pinned host key and key-only auth', async () => {
    await transport(await fakeSftp()).upload(target(), join(dir, '.keep'), 'barat-db-20261021T235000Z.bkp');

    const batch = await readFile(join(out, 'batch'), 'utf8');
    expect(batch.split('\n')).toEqual([
      '-mkdir backups/barat',
      'cd backups/barat',
      '-rm barat-db-20261021T235000Z.bkp.part',
      `put ${join(dir, '.keep')} barat-db-20261021T235000Z.bkp.part`,
      'rename barat-db-20261021T235000Z.bkp.part barat-db-20261021T235000Z.bkp',
      '',
    ]);

    const args = (await readFile(join(out, 'args'), 'utf8')).split('\n');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('PasswordAuthentication=no');
    expect(args).toContain('IdentitiesOnly=yes');
    expect(args.slice(args.indexOf('-P'), args.indexOf('-P') + 2)).toEqual(['-P', '2222']);
    expect(args.at(-2)).toBe('barat@backup.example.com');
    /* The key is never an argument, only a path to a private file. */
    expect(args.join('\n')).not.toContain('PRIVATE KEY');
    expect(await readFile(join(out, 'keymode'), 'utf8')).toMatch(/^-rw-------/u);
    expect(await readFile(join(out, 'key'), 'utf8')).toBe(KEY.privateKeyPem);
  });

  it('removes its temporary key and batch files afterwards', async () => {
    await transport(await fakeSftp()).testWrite(target());
    const workdir = (await readFile(join(out, 'workdir'), 'utf8')).trim();

    await expect(readdir(workdir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lists names from the batch output, skipping the echoed commands', async () => {
    const names = await transport(
      await fakeSftp({ stdout: 'sftp> cd backups/barat\nsftp> ls -1\nbarat-db-20261021T235000Z.bkp\nnotes.txt\n' }),
    ).list(target());

    expect(names).toEqual(['barat-db-20261021T235000Z.bkp', 'notes.txt']);
  });

  it.each([
    ['Host key verification failed.', 'HOST_KEY_MISMATCH'],
    ['barat@backup.example.com: Permission denied (publickey).', 'AUTH_FAILED'],
    ['ssh: connect to host backup.example.com port 2222: Connection refused', 'CONNECT_FAILED'],
    ['ssh: Could not resolve hostname backup.example.com: Name or service not known', 'CONNECT_FAILED'],
  ])('classifies "%s" as %s', async (stderr, failure) => {
    await expect(transport(await fakeSftp({ stderr, exit: 255 })).testWrite(target())).rejects.toMatchObject({
      failure,
    });
  });

  it('passes on a short line from sftp for a remote file error', async () => {
    const error = await transport(
      await fakeSftp({ stderr: 'remote mkdir "/srv/backups": Permission denied\n', exit: 1 }),
    )
      .testWrite(target())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackupTransportError);
    expect((error as BackupTransportError).failure).toBe('REMOTE_ERROR');
    expect((error as BackupTransportError).describe()).toContain('Permission denied');
  });

  it('reports a missing OpenSSH client as such', async () => {
    await expect(transport(join(dir, 'no-such-sftp')).testWrite(target())).rejects.toMatchObject({
      failure: 'SSH_UNAVAILABLE',
    });
  });

  it('refuses to run without a pinned host key', async () => {
    await expect(transport(await fakeSftp()).testWrite(target({ hostKeys: [] }))).rejects.toMatchObject({
      failure: 'HOST_KEY_MISMATCH',
    });
  });

  it.each([
    ['a host that looks like an option', { host: '-oProxyCommand=sh' }],
    ['a remote directory with a line break', { remoteDirectory: 'backups\n!sh' }],
    ['a remote directory that climbs out', { remoteDirectory: 'backups/../../etc' }],
    ['a username with a space', { username: 'bar at' }],
  ])('refuses %s before starting sftp', async (_label, override) => {
    await expect(transport(await fakeSftp()).testWrite(target(override))).rejects.toBeInstanceOf(
      BackupTransportError,
    );
    await expect(readFile(join(out, 'args'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a remote name it did not generate', async () => {
    await expect(
      transport(await fakeSftp()).remove(target(), ['../../etc/passwd']),
    ).rejects.toBeInstanceOf(BackupTransportError);
  });
});

describe('isSafeRemoteDirectory', () => {
  it.each(['backups', 'backups/barat', '/srv/backups/barat', 'b.k_p-1/'])('accepts %s', (value) => {
    expect(isSafeRemoteDirectory(value)).toBe(true);
  });

  it.each(['', '..', 'a/../b', './a', 'a b', 'a;b', '~/backups', 'a\nb', '!ls'])('rejects %j', (value) => {
    expect(isSafeRemoteDirectory(value)).toBe(false);
  });
});
