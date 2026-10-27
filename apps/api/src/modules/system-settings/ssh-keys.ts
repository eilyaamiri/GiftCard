import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Just enough of the OpenSSH key formats to:
 *   - mint an Ed25519 client key the backup server can trust,
 *   - accept a pasted unencrypted OpenSSH private key and recover its public half,
 *   - pin the backup server's own host keys and show their SHA256 fingerprints.
 *
 * Nothing here logs or throws key material; errors say which rule failed only.
 */

const OPENSSH_MAGIC = Buffer.from('openssh-key-v1\0', 'latin1');
const PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';
const PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----';

/** Host key algorithms we accept for pinning. DSA is long dead. */
export const HOST_KEY_TYPES = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'ssh-rsa',
] as const;
export type HostKeyType = (typeof HOST_KEY_TYPES)[number];

export interface HostKey {
  readonly type: HostKeyType;
  /** The key blob, base64, exactly as in known_hosts. */
  readonly key: string;
  /** `SHA256:…`, as `ssh-keygen -lf` prints it. */
  readonly fingerprint: string;
}

export class InvalidSshKeyError extends Error {
  constructor(readonly reason: 'MALFORMED' | 'ENCRYPTED' | 'UNSUPPORTED') {
    super(`SSH key rejected: ${reason}`);
    this.name = 'InvalidSshKeyError';
  }
}

/* ------------------------------------------------------------- client key */

export interface GeneratedSshKey {
  /** Unencrypted OpenSSH private key. A secret: seal it before storing. */
  readonly privateKeyPem: string;
  /** `ssh-ed25519 AAAA… comment`, for the backup server's authorized_keys. */
  readonly publicKeyLine: string;
}

export function generateEd25519SshKey(comment: string): GeneratedSshKey {
  if (!/^[A-Za-z0-9@._-]{1,64}$/u.test(comment)) throw new InvalidSshKeyError('MALFORMED');

  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  if (typeof jwk.d !== 'string' || typeof jwk.x !== 'string') throw new InvalidSshKeyError('MALFORMED');
  const seed = Buffer.from(jwk.d, 'base64url');
  const publicKey = Buffer.from(jwk.x, 'base64url');

  const publicBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(publicKey)]);
  const check = randomBytes(4);
  const secretPart = Buffer.concat([seed, publicKey]);
  const unpadded = Buffer.concat([
    check,
    check,
    sshString('ssh-ed25519'),
    sshString(publicKey),
    sshString(secretPart),
    sshString(comment),
  ]);
  /* The "none" cipher still pads to an 8-byte block, with bytes 1, 2, 3, … */
  const padding = Buffer.from(
    Array.from({ length: (8 - (unpadded.length % 8)) % 8 }, (_unused, index) => index + 1),
  );
  const privateSection = Buffer.concat([unpadded, padding]);

  const body = Buffer.concat([
    OPENSSH_MAGIC,
    sshString('none'),
    sshString('none'),
    sshString(''),
    uint32(1),
    sshString(publicBlob),
    sshString(privateSection),
  ]);

  try {
    return {
      privateKeyPem: toPem(body),
      publicKeyLine: `ssh-ed25519 ${publicBlob.toString('base64')} ${comment}`,
    };
  } finally {
    seed.fill(0);
    secretPart.fill(0);
    privateSection.fill(0);
    unpadded.fill(0);
    body.fill(0);
  }
}

/**
 * Validate a pasted OpenSSH private key and return its public line.
 *
 * A passphrase-protected key is refused: the backup runs unattended, so it
 * would need its passphrase stored next to it, which protects nothing. The key
 * is encrypted at rest by the settings key instead.
 */
export function publicLineOfPrivateKey(pem: string): string {
  const body = fromPem(pem);
  const reader = new SshReader(body);
  if (!reader.take(OPENSSH_MAGIC.length).equals(OPENSSH_MAGIC)) throw new InvalidSshKeyError('MALFORMED');
  const cipher = reader.string().toString('latin1');
  const kdf = reader.string().toString('latin1');
  reader.string(); // kdf options
  if (cipher !== 'none' || kdf !== 'none') throw new InvalidSshKeyError('ENCRYPTED');
  if (reader.uint32() !== 1) throw new InvalidSshKeyError('UNSUPPORTED');
  const publicBlob = reader.string();
  const privateSection = new SshReader(reader.string());
  if (!privateSection.take(4).equals(privateSection.take(4))) throw new InvalidSshKeyError('MALFORMED');

  const type = new SshReader(publicBlob).string().toString('latin1');
  if (!(HOST_KEY_TYPES as readonly string[]).includes(type)) {
    throw new InvalidSshKeyError('UNSUPPORTED');
  }
  return `${type} ${publicBlob.toString('base64')}`;
}

/* --------------------------------------------------------------- host keys */

/**
 * Parse pinned host keys from what an admin pastes or `ssh-keyscan` prints:
 * one key per line as `<type> <base64>`, optionally preceded by a host field
 * and followed by a comment. Blank lines and `#` comments are ignored.
 */
export function parseHostKeys(text: string): HostKey[] {
  const keys: HostKey[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const fields = line.split(/\s+/u);
    const typeIndex = fields.findIndex((field) => (HOST_KEY_TYPES as readonly string[]).includes(field));
    if (typeIndex === -1 || typeIndex > 1) throw new InvalidSshKeyError('UNSUPPORTED');
    const type = fields[typeIndex] as HostKeyType;
    const key = fields[typeIndex + 1] ?? '';
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(key)) throw new InvalidSshKeyError('MALFORMED');

    const blob = Buffer.from(key, 'base64');
    let embedded: string;
    try {
      embedded = new SshReader(blob).string().toString('latin1');
    } catch {
      throw new InvalidSshKeyError('MALFORMED');
    }
    if (embedded !== type || blob.toString('base64') !== key) throw new InvalidSshKeyError('MALFORMED');
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ type, key, fingerprint: fingerprintOf(blob) });
  }
  return keys;
}

/** Canonical storage form: one `<type> <base64>` per line. */
export function formatHostKeys(keys: readonly HostKey[]): string {
  return keys.map((hostKey) => `${hostKey.type} ${hostKey.key}`).join('\n');
}

export function fingerprintOf(blob: Buffer): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`;
}

/* ----------------------------------------------------------------- helpers */

function sshString(value: string | Buffer): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function toPem(body: Buffer): string {
  const encoded = body.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += 70) lines.push(encoded.slice(index, index + 70));
  return `${PEM_HEADER}\n${lines.join('\n')}\n${PEM_FOOTER}\n`;
}

function fromPem(pem: string): Buffer {
  const trimmed = pem.trim();
  if (!trimmed.startsWith(PEM_HEADER) || !trimmed.endsWith(PEM_FOOTER)) {
    throw new InvalidSshKeyError('MALFORMED');
  }
  const encoded = trimmed.slice(PEM_HEADER.length, -PEM_FOOTER.length).replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new InvalidSshKeyError('MALFORMED');
  return Buffer.from(encoded, 'base64');
}

class SshReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  take(length: number): Buffer {
    if (length < 0 || this.offset + length > this.buffer.length) throw new InvalidSshKeyError('MALFORMED');
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  uint32(): number {
    return this.take(4).readUInt32BE();
  }

  string(): Buffer {
    return this.take(this.uint32());
  }
}
