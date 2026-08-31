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
