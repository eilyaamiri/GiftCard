import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/**
 * Passphrase encryption for the archives copied off the host.
 *
 * Layout (all integers single bytes):
 *
 *   "BARATBK1" | log2(N) | r | p | salt[16] | iv[12] | ciphertext… | tag[16]
 *
 * AES-256-GCM under a scrypt-derived key, with the whole header as AAD, so a
 * tampered parameter fails authentication rather than silently deriving a
 * different key. `ops/backup-decrypt.mjs` is the standalone reader of the same
 * format for a restore on a machine with nothing but Node installed; the two
 * must change together, and a test runs one against the other.
 */

export const ARCHIVE_MAGIC = Buffer.from('BARATBK1', 'latin1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = ARCHIVE_MAGIC.length + 3 + SALT_BYTES + IV_BYTES;

/* N = 2^15, r = 8: about 32 MiB and a few hundred milliseconds — once per
 * archive, which is the point. */
const DEFAULT_PARAMS = { logN: 15, r: 8, p: 1 } as const;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

export const MIN_ARCHIVE_PASSPHRASE_LENGTH = 16;

export class ArchiveError extends Error {
  constructor(readonly reason: 'FORMAT' | 'AUTHENTICATION') {
    super(reason === 'FORMAT' ? 'Not a Barat backup archive' : 'Wrong passphrase or damaged archive');
    this.name = 'ArchiveError';
  }
}

export interface EncryptedArchive {
  readonly sizeBytes: bigint;
  /** SHA-256 of the encrypted file, hex. Lets a restore confirm the copy is intact. */
  readonly sha256: string;
}

export async function encryptArchive(
  sourcePath: string,
  destinationPath: string,
  passphrase: string,
): Promise<EncryptedArchive> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([
    ARCHIVE_MAGIC,
    Buffer.from([DEFAULT_PARAMS.logN, DEFAULT_PARAMS.r, DEFAULT_PARAMS.p]),
    salt,
    iv,
  ]);
  const key = await deriveKey(passphrase, salt, DEFAULT_PARAMS);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  key.fill(0);

  const hash = createHash('sha256');
  let size = 0n;
  const emit = (chunk: Buffer): Buffer => {
    hash.update(chunk);
    size += BigInt(chunk.length);
    return chunk;
  };

  await pipeline(
    createReadStream(sourcePath),
    async function* (source: AsyncIterable<Buffer>) {
      yield emit(header);
      for await (const chunk of source) yield emit(cipher.update(chunk));
      yield emit(cipher.final());
      yield emit(cipher.getAuthTag());
    },
    createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
  );

  return { sizeBytes: size, sha256: hash.digest('hex') };
}

/**
 * The inverse, used by the tests. Plaintext is written to `<destination>.partial`
 * and only renamed once the tag verifies, so a wrong passphrase never leaves a
 * plausible-looking dump behind.
 */
export async function decryptArchive(
  sourcePath: string,
  destinationPath: string,
  passphrase: string,
): Promise<void> {
  const { size } = await stat(sourcePath);
  if (size < HEADER_BYTES + TAG_BYTES) throw new ArchiveError('FORMAT');

  const handle = await open(sourcePath, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)) throw new ArchiveError('FORMAT');

  let offset = ARCHIVE_MAGIC.length;
  const params = { logN: header[offset++] ?? 0, r: header[offset++] ?? 0, p: header[offset++] ?? 0 };
  if (params.logN < 10 || params.logN > 20 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) {
    throw new ArchiveError('FORMAT');
  }
  const salt = header.subarray(offset, offset + SALT_BYTES);
  const iv = header.subarray(offset + SALT_BYTES, offset + SALT_BYTES + IV_BYTES);

  const key = await deriveKey(passphrase, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  key.fill(0);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  const partial = `${destinationPath}.partial`;
  try {
    await pipeline(
      createReadStream(sourcePath, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    await rm(partial, { force: true });
    throw new ArchiveError('AUTHENTICATION');
  }
  await rename(partial, destinationPath);
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: { readonly logN: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase.normalize('NFC'),
      salt,
      32,
      { N: 2 ** params.logN, r: params.r, p: params.p, maxmem: SCRYPT_MAX_MEMORY },
      (error, key) => (error === null ? resolve(key) : reject(new ArchiveError('FORMAT'))),
    );
  });
}
