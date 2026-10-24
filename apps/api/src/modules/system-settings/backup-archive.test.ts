import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ArchiveError, ARCHIVE_MAGIC, decryptArchive, encryptArchive } from './backup-archive';

const PASSPHRASE = 'correct horse battery staple — ۱۴۰۵';
const DECRYPT_SCRIPT = resolve(__dirname, '../../../../../ops/backup-decrypt.mjs');

let dir: string;
let source: string;
let dump: Buffer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backup-archive-test-'));
  source = join(dir, 'database.dump');
  /* Larger than one stream chunk, so the streaming path is exercised. */
  dump = randomBytes(300_000);
  await writeFile(source, dump);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('encryptArchive / decryptArchive', () => {
  it('round-trips the dump and reports the size and hash of what it wrote', async () => {
    const archive = join(dir, 'a.bkp');
    const result = await encryptArchive(source, archive, PASSPHRASE);
    const written = await readFile(archive);

    expect(written.subarray(0, 8).equals(ARCHIVE_MAGIC)).toBe(true);
    expect(result.sizeBytes).toBe(BigInt(written.length));
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(written.includes(dump.subarray(0, 64))).toBe(false);

    await decryptArchive(archive, join(dir, 'out.dump'), PASSPHRASE);
    expect((await readFile(join(dir, 'out.dump'))).equals(dump)).toBe(true);
  });

  it('refuses a wrong passphrase and leaves no output behind', async () => {
    const archive = join(dir, 'a.bkp');
    await encryptArchive(source, archive, PASSPHRASE);

    await expect(decryptArchive(archive, join(dir, 'out.dump'), 'not the passphrase at all')).rejects.toEqual(
      new ArchiveError('AUTHENTICATION'),
    );
    expect(existsSync(join(dir, 'out.dump'))).toBe(false);
    expect(existsSync(join(dir, 'out.dump.partial'))).toBe(false);
  });

  it('detects a flipped byte in the header, which is authenticated too', async () => {
    const archive = join(dir, 'a.bkp');
    await encryptArchive(source, archive, PASSPHRASE);
    const bytes = await readFile(archive);
    bytes[20] = (bytes[20] ?? 0) ^ 1; // inside the salt
    await writeFile(archive, bytes);

    await expect(decryptArchive(archive, join(dir, 'out.dump'), PASSPHRASE)).rejects.toBeInstanceOf(ArchiveError);
  });

  it('never overwrites an existing file', async () => {
    const archive = join(dir, 'a.bkp');
    await writeFile(archive, 'keep me');
    await expect(encryptArchive(source, archive, PASSPHRASE)).rejects.toThrow();
    expect(await readFile(archive, 'utf8')).toBe('keep me');
  });
});

describe('ops/backup-decrypt.mjs', () => {
  it('restores an archive written by the API, with nothing but Node', async () => {
    const archive = join(dir, 'a.bkp');
    await encryptArchive(source, archive, PASSPHRASE);

    await promisify(execFile)(process.execPath, [DECRYPT_SCRIPT, archive, join(dir, 'restored.dump')], {
      env: { BACKUP_PASSPHRASE: PASSPHRASE },
    });

    expect((await readFile(join(dir, 'restored.dump'))).equals(dump)).toBe(true);
  });

  it('exits non-zero on a wrong passphrase and writes nothing', async () => {
    const archive = join(dir, 'a.bkp');
    await encryptArchive(source, archive, PASSPHRASE);

    await expect(
      promisify(execFile)(process.execPath, [DECRYPT_SCRIPT, archive, join(dir, 'restored.dump')], {
        env: { BACKUP_PASSPHRASE: 'wrong passphrase, long enough' },
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect(existsSync(join(dir, 'restored.dump'))).toBe(false);
    expect(existsSync(join(dir, 'restored.dump.partial'))).toBe(false);
  });
});
