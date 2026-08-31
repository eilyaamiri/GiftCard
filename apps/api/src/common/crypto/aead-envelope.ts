import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope encryption for a single database column.
 *
 * The envelope is `v1.<iv>.<tag>.<ciphertext>`, all base64 — one opaque string,
 * because a schema column is one value. It is the same shape the gift-card
 * secrets use; that file keeps its own copy on purpose. It is human-gated
 * (AGENTS.md 4.4), has no direct unit test to protect a refactor, and holds the
 * most sensitive column in the product. Migrating it onto this helper is a
 * separate, reviewable change rather than a side effect of a profile feature.
 *
 * `aad` is what keeps one domain's ciphertext out of another's column: a bank
 * IBAN envelope moved into `GiftCardAsset.encryptedCode` fails authentication
 * instead of decrypting into a plausible value.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = 'v1';

export class AeadEnvelopeError extends Error {
  constructor() {
    // Deliberately generic. Key material, ciphertext and plaintext must never
    // reach an error message, a log line or an HTTP response.
    super('Envelope encryption operation failed');
    this.name = 'AeadEnvelopeError';
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new AeadEnvelopeError();
  }
}

/** Decode a base64 key and check its length. Rejects anything that is not 32 bytes. */
export function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    key.fill(0);
    throw new AeadEnvelopeError();
  }
  return key;
}

export function seal(plaintext: string, key: Buffer, aad: string): string {
  if (plaintext.length === 0) {
    throw new AeadEnvelopeError();
  }
  assertKey(key);

  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    try {
      return [
        ENVELOPE_VERSION,
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64'),
      ].join('.');
    } finally {
      ciphertext.fill(0);
      authTag.fill(0);
    }
  } catch {
    throw new AeadEnvelopeError();
  } finally {
    iv.fill(0);
  }
}

export function open(envelope: string, key: Buffer, aad: string): string {
  const parts = envelope.split('.');
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (
    parts.length !== 4 ||
    version !== ENVELOPE_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded
  ) {
    throw new AeadEnvelopeError();
  }
  assertKey(key);

  let iv: Buffer | undefined;
  let authTag: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  try {
    iv = Buffer.from(ivEncoded, 'base64');
    authTag = Buffer.from(tagEncoded, 'base64');
    ciphertext = Buffer.from(ciphertextEncoded, 'base64');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
      throw new AeadEnvelopeError();
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new AeadEnvelopeError();
  } finally {
    iv?.fill(0);
    authTag?.fill(0);
    ciphertext?.fill(0);
  }
}
