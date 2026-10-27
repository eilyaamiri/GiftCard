#!/usr/bin/env node
/**
 * Decrypt an off-host backup archive (`barat-db-*.bkp`) back into the
 * PostgreSQL custom-format dump that `pg_restore` reads.
 *
 *   BACKUP_PASSPHRASE='…' node backup-decrypt.mjs barat-db-20261021T235012Z.bkp database.dump
 *
 * Without BACKUP_PASSPHRASE the passphrase is asked for on the terminal and not
 * echoed. Needs nothing but Node 18+; copy this one file to wherever the
 * restore happens.
 *
 * The plaintext is written to `<output>.partial` and renamed only once the
 * authentication tag has verified, so a wrong passphrase or a damaged copy
 * never leaves a plausible-looking dump behind. The format is defined in
 * apps/api/src/modules/system-settings/backup-archive.ts; the two must change
 * together.
 */
import { createDecipheriv, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('BARATBK1', 'latin1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 3 + SALT_BYTES + IV_BYTES;

function fail(message) {
  process.stderr.write(`backup-decrypt: ${message}\n`);
  process.exit(1);
}

async function readPassphrase() {
  const fromEnv = process.env.BACKUP_PASSPHRASE;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (!process.stdin.isTTY) fail('set BACKUP_PASSPHRASE or run in a terminal');

  process.stderr.write('Backup passphrase: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') process.exit(130);
        if (char === '\u007f') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

function deriveKey(passphrase, salt, logN, r, p) {
  return new Promise((resolve, reject) => {
    scrypt(passphrase.normalize('NFC'), salt, 32, { N: 2 ** logN, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (input === undefined || output === undefined) {
    fail('usage: node backup-decrypt.mjs <archive.bkp> <output.dump>');
  }

  const { size } = await stat(input);
  if (size < HEADER_BYTES + TAG_BYTES) fail('not a Barat backup archive');

  const handle = await open(input, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  await handle.read(header, 0, HEADER_BYTES, 0);
  await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  await handle.close();

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail('not a Barat backup archive');
  const [logN, r, p] = header.subarray(MAGIC.length, MAGIC.length + 3);
  if (logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) fail('not a Barat backup archive');
  const saltStart = MAGIC.length + 3;
  const salt = header.subarray(saltStart, saltStart + SALT_BYTES);
  const iv = header.subarray(saltStart + SALT_BYTES, HEADER_BYTES);

  const key = await deriveKey(await readPassphrase(), salt, logN, r, p);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  key.fill(0);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  const partial = `${output}.partial`;
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await rm(partial, { force: true });
    fail('wrong passphrase or damaged archive; nothing was written');
  }
  await rename(partial, output);
  process.stderr.write(`backup-decrypt: wrote ${output}\n`);
}

main().catch(() => fail('could not read the archive'));
