import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { AeadEnvelopeError, decodeKey, open, seal } from './aead-envelope';

const KEY = randomBytes(32);
const AAD = 'barat-pay:test:v1';

describe('aead envelope', () => {
  it('round-trips a value and never carries the plaintext in the envelope', () => {
    const envelope = seal('IR062960000000100324200001', KEY, AAD);

    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain('IR062960000000100324200001');
    expect(open(envelope, KEY, AAD)).toBe('IR062960000000100324200001');
  });

  it('produces a different envelope every time, so equal values are not linkable', () => {
    expect(seal('6037991234567890', KEY, AAD)).not.toBe(seal('6037991234567890', KEY, AAD));
  });

  it('refuses an envelope opened with a different AAD', () => {
    const envelope = seal('6037991234567890', KEY, AAD);

    /* This is what stops a bank envelope from being pasted into a gift-card
     * column, or the reverse: same key, different domain, no decryption. */
    expect(() => open(envelope, KEY, 'barat-pay:other-domain:v1')).toThrow(AeadEnvelopeError);
  });

  it('refuses an envelope opened with a different key', () => {
    const envelope = seal('6037991234567890', KEY, AAD);

    expect(() => open(envelope, randomBytes(32), AAD)).toThrow(AeadEnvelopeError);
  });

  it('detects a tampered ciphertext rather than returning altered plaintext', () => {
    const [version, iv, tag, ciphertext] = seal('6037991234567890', KEY, AAD).split('.');
    const flipped = Buffer.from(ciphertext!, 'base64');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 0x01, 0);

    expect(() => open([version, iv, tag, flipped.toString('base64')].join('.'), KEY, AAD)).toThrow(
      AeadEnvelopeError,
    );
  });

  it('rejects a malformed envelope, a short key and an empty plaintext', () => {
    expect(() => open('not-an-envelope', KEY, AAD)).toThrow(AeadEnvelopeError);
    expect(() => open('v2.a.b.c', KEY, AAD)).toThrow(AeadEnvelopeError);
    expect(() => seal('6037991234567890', randomBytes(16), AAD)).toThrow(AeadEnvelopeError);
    expect(() => seal('', KEY, AAD)).toThrow(AeadEnvelopeError);
  });

  it('accepts only a 32-byte base64 key', () => {
    expect(decodeKey(KEY.toString('base64'))).toEqual(KEY);
    expect(() => decodeKey(randomBytes(31).toString('base64'))).toThrow(AeadEnvelopeError);
  });
});
