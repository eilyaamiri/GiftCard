import { describe, expect, it, vi } from 'vitest';

import { AuditService, type AuditWriter } from './audit.service';
import { deepRedact } from './deep-redactor';

describe('deepRedact', () => {
  it('strips sensitive keys recursively and preserves auditable values', () => {
    const result = deepRedact({
      amountIrr: 12_345n,
      nested: {
        otp: '123456',
        authToken: 'raw-token',
        PASSWORD_hash: 'hash',
        items: [{ pinCode: '0000', safe: true }],
      },
    });

    expect(result).toEqual({
      amountIrr: '12345',
      nested: {
        otp: '[REDACTED]',
        authToken: '[REDACTED]',
        PASSWORD_hash: '[REDACTED]',
        items: [{ pinCode: '[REDACTED]', safe: true }],
      },
    });
  });

  it('strips bank numbers while keeping the masked forms an auditor needs', () => {
    /* The whole point of storing a mask is that it can be read back. If the
     * redactor swallowed `ibanMasked` too, the audit row would say nothing. */
    const result = deepRedact({
      iban: 'IR560170000000000000001234',
      cardNumber: '6037990000000121',
      accountNumber: '0100123456001',
      ibanEncrypted: 'v1.aaa.bbb.ccc',
      cardEncrypted: 'v1.aaa.bbb.ccc',
      ibanMasked: 'IR56017***************1234',
      ibanBankName: 'بانک ملی ایران',
      cardMasked: '6037-99**-****-0121',
      holderName: 'یکتا کریمی',
    });

    expect(result).toEqual({
      iban: '[REDACTED]',
      cardNumber: '[REDACTED]',
      accountNumber: '[REDACTED]',
      ibanEncrypted: '[REDACTED]',
      cardEncrypted: '[REDACTED]',
      ibanMasked: 'IR56017***************1234',
      ibanBankName: 'بانک ملی ایران',
      cardMasked: '6037-99**-****-0121',
      holderName: 'یکتا کریمی',
    });
  });

  it('strips credentials whose names contain none of the original key parts', () => {
    /* `apiKey`, `privateKey`, `Authorization`, `Cookie` and the gateway
     * `authority` all passed through untouched before: none contains
     * code/pin/otp/token/secret/password. */
    const result = deepRedact({
      apiKey: 'fc_live_abc',
      supplier: { privateKey: '-----BEGIN', encryptionKey: 'k' },
      headers: { Authorization: 'Bearer eyJ', Cookie: 'barat_session=eyJ' },
      card: { cvv2: '123' },
      passphrase: 'p',
      encryptedPayload: 'v1.x.y.z',
      authority: 'A000000000000000000000000000abcdef',
      providerAuthority: 'A000000000000000000000000000abcdef',
      jwt: 'eyJ',
    });

    expect(JSON.stringify(result)).not.toMatch(/fc_live_abc|BEGIN|eyJ|123|abcdef|v1\.x/u);
  });

  it('keeps hashed or descriptive neighbours of the exact-match keys readable', () => {
    /* Payments deliberately audits `authorityHash` instead of the token; the
     * exact match must not swallow it. */
    const result = deepRedact({
      authorityHash: 'f00d',
      reason: 'unknown_authority',
      ibanMasked: 'IR56017***************1234',
      status: 'PAID',
    });

    expect(result).toEqual({
      authorityHash: 'f00d',
      reason: 'unknown_authority',
      ibanMasked: 'IR56017***************1234',
      status: 'PAID',
    });
  });
});

describe('AuditService', () => {
  it('never hands an OTP or code to persistence', async () => {
    const append = vi.fn<AuditWriter['append']>().mockResolvedValue(undefined);
    const service = new AuditService({ append } as never);

    await service.record({
      actor: 'customer-1',
      actorType: 'CUSTOMER',
      action: 'OTP_VERIFIED',
      entity: 'OtpChallenge',
      entityId: 'challenge-1',
      before: { otp: '123456' },
      after: { profile: { giftCardCode: 'TOP-SECRET' } },
    });

    const persisted = append.mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain('123456');
    expect(JSON.stringify(persisted)).not.toContain('TOP-SECRET');
  });
});
