import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  formatHostKeys,
  generateEd25519SshKey,
  InvalidSshKeyError,
  parseHostKeys,
  publicLineOfPrivateKey,
} from './ssh-keys';

/* A real host key line, as `ssh-keyscan -t ed25519` prints it. */
const ED25519_BLOB = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

function sshKeygenAvailable(): boolean {
  try {
    execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    return true;
  } catch (error) {
    /* `-?` exits non-zero but proves the binary exists. */
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

const workdir = mkdtempSync(join(tmpdir(), 'ssh-keys-test-'));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('generateEd25519SshKey', () => {
  it('produces an OpenSSH private key whose public half matches the returned line', () => {
    const generated = generateEd25519SshKey('barat-backup-test');

    expect(generated.privateKeyPem).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/u);
    expect(generated.publicKeyLine).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/=]+ barat-backup-test$/u);
    expect(`${publicLineOfPrivateKey(generated.privateKeyPem)} barat-backup-test`).toBe(generated.publicKeyLine);
  });

  it('never returns the same key twice', () => {
    expect(generateEd25519SshKey('a').publicKeyLine).not.toBe(generateEd25519SshKey('a').publicKeyLine);
  });

  it.runIf(sshKeygenAvailable())('is accepted by OpenSSH itself', () => {
    const generated = generateEd25519SshKey('barat-backup-test');
    const keyPath = join(workdir, 'id_ed25519');
    writeFileSync(keyPath, generated.privateKeyPem, { mode: 0o600 });

    const derived = execFileSync('ssh-keygen', ['-y', '-f', keyPath], { encoding: 'utf8' }).trim();

    expect(derived.split(' ').slice(0, 2).join(' ')).toBe(generated.publicKeyLine.split(' ').slice(0, 2).join(' '));
  });

  it('refuses a comment that would break the authorized_keys line', () => {
    expect(() => generateEd25519SshKey('two words')).toThrow(InvalidSshKeyError);
  });
});

describe('publicLineOfPrivateKey', () => {
  it('refuses a passphrase-protected key', () => {
    /* Same container, cipher name swapped: what ssh-keygen -N writes. */
    const generated = generateEd25519SshKey('x');
    const body = Buffer.from(
      generated.privateKeyPem.replace(/-----[A-Z ]+-----/gu, '').replace(/\s+/gu, ''),
      'base64',
    );
    const magic = 'openssh-key-v1\0'.length;
    const encrypted = Buffer.concat([
      body.subarray(0, magic),
      Buffer.from([0, 0, 0, 10]),
      Buffer.from('aes256-ctr', 'latin1'),
      body.subarray(magic + 4 + 4),
    ]);
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${encrypted.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----`;

    expect(() => publicLineOfPrivateKey(pem)).toThrow(expect.objectContaining({ reason: 'ENCRYPTED' }));
  });

  it.each([
    ['a PEM of another kind', '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'],
    ['garbage', 'not a key at all'],
    ['a truncated body', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----'],
  ])('refuses %s', (_label, pem) => {
    expect(() => publicLineOfPrivateKey(pem)).toThrow(InvalidSshKeyError);
  });
});

describe('parseHostKeys', () => {
  it('reads ssh-keyscan output, drops the host field and duplicates, and fingerprints each key', () => {
    const keys = parseHostKeys(
      `# backup.example.com:22 SSH-2.0-OpenSSH_9.6\nbackup.example.com ssh-ed25519 ${ED25519_BLOB}\n\nssh-ed25519 ${ED25519_BLOB} comment\n`,
    );

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ type: 'ssh-ed25519', key: ED25519_BLOB });
    expect(keys[0]?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/u);
    expect(formatHostKeys(keys)).toBe(`ssh-ed25519 ${ED25519_BLOB}`);
  });

  it.runIf(sshKeygenAvailable())('fingerprints exactly as ssh-keygen -lf does', () => {
    const path = join(workdir, 'host.pub');
    writeFileSync(path, `ssh-ed25519 ${ED25519_BLOB}\n`);
    const expected = execFileSync('ssh-keygen', ['-lf', path], { encoding: 'utf8' }).split(' ')[1];

    expect(parseHostKeys(`ssh-ed25519 ${ED25519_BLOB}`)[0]?.fingerprint).toBe(expected);
  });

  it('refuses a key whose blob is of a different type than its label', () => {
    expect(() => parseHostKeys(`ssh-rsa ${ED25519_BLOB}`)).toThrow(InvalidSshKeyError);
  });

  it('refuses DSA and unknown key types', () => {
    expect(() => parseHostKeys('ssh-dss AAAAB3NzaC1kc3MAAACBAP')).toThrow(InvalidSshKeyError);
  });

  it('returns nothing for an empty field', () => {
    expect(parseHostKeys('  \n# only a comment\n')).toEqual([]);
  });
});
