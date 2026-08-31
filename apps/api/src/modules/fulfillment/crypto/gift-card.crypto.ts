import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = 'v1';
const AAD = Buffer.from('barat-pay:gift-card-secret:v1', 'utf8');

export class GiftCardCryptoError extends Error {
  constructor() {
    // Deliberately generic: ciphertext, keys, and plaintext never enter an error.
    super('Gift-card secret encryption operation failed');
    this.name = 'GiftCardCryptoError';
  }
}

function strictBase64Decode(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new GiftCardCryptoError();
  }

  const decoded = Buffer.from(trimmed, 'base64');
  const canonicalInput = trimmed.replace(/=+$/u, '');
  const canonicalDecoded = decoded.toString('base64').replace(/=+$/u, '');
  const inputBytes = Buffer.from(canonicalInput);
  const decodedBytes = Buffer.from(canonicalDecoded);
  const equalLength = inputBytes.length === decodedBytes.length;
  const isCanonical = equalLength && timingSafeEqual(inputBytes, decodedBytes);
  inputBytes.fill(0);
  decodedBytes.fill(0);

  if (!isCanonical) {
    decoded.fill(0);
    throw new GiftCardCryptoError();
  }

  return decoded;
}

/** Decode and validate the required 32-byte base64 application key. */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = strictBase64Decode(base64Key);
  if (key.length !== KEY_BYTES) {
    key.fill(0);
    throw new GiftCardCryptoError();
  }
  return key;
}

function loadKey(base64Key?: string): Buffer {
  const configured = base64Key ?? process.env['GIFT_CARD_ENCRYPTION_KEY'];
  if (!configured) {
    throw new GiftCardCryptoError();
  }
  return decodeEncryptionKey(configured);
}

/**
 * Encrypt a code or PIN using AES-256-GCM and a fresh 96-bit IV.
 *
 * The schema has one ciphertext column, so the version, IV, authentication tag,
 * and ciphertext are stored in one opaque envelope:
 * `v1.<iv-base64>.<tag-base64>.<ciphertext-base64>`.
 */
export function encryptSecret(plaintext: string, base64Key?: string): string {
  if (plaintext.length === 0) {
    throw new GiftCardCryptoError();
  }

  const key = loadKey(base64Key);
  const iv = randomBytes(IV_BYTES);

  try {
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(AAD);
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
    throw new GiftCardCryptoError();
  } finally {
    key.fill(0);
    iv.fill(0);
  }
}

/** Authenticate and decrypt an envelope produced by {@link encryptSecret}. */
export function decryptSecret(envelope: string, base64Key?: string): string {
  const parts = envelope.split('.');
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (
    parts.length !== 4 ||
    version !== ENVELOPE_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded
  ) {
    throw new GiftCardCryptoError();
  }

  const key = loadKey(base64Key);
  let iv: Buffer | undefined;
  let authTag: Buffer | undefined;
  let ciphertext: Buffer | undefined;

  try {
    iv = strictBase64Decode(ivEncoded);
    authTag = strictBase64Decode(tagEncoded);
    ciphertext = strictBase64Decode(ciphertextEncoded);
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
      throw new GiftCardCryptoError();
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new GiftCardCryptoError();
  } finally {
    key.fill(0);
    iv?.fill(0);
    authTag?.fill(0);
    ciphertext?.fill(0);
  }
}
