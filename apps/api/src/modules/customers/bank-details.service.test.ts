import { describe, expect, it, vi } from 'vitest';

import { open } from '../../common/crypto/aead-envelope';
import { BaratDomainException } from '../../common/errors/domain.exception';
import { saveBankAccountRequestSchema } from '../identity/identity.schemas';
import { BankDetailsService } from './bank-details.service';
import type { CustomersDatabase } from './customers.tokens';

const VALID_IBAN = 'IR560170000000000000001234';
const VALID_CARD = '6037990000000121';
const ACTOR = { ip: '127.0.0.1', userAgent: 'vitest' } as never;

/**
 * The AAD strings are pinned here on purpose. They are part of every stored
 * envelope: changing one makes existing ciphertext undecryptable, so it has to
 * break a test rather than a production read.
 */
const IBAN_AAD = 'barat-pay:customer-bank-iban:v1';
const CARD_AAD = 'barat-pay:customer-bank-card:v1';

const KEY = Buffer.alloc(32, 7);

function harness(
  options: {
    profile?: { firstName: string | null; lastName: string | null } | null;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const created = vi.fn((args: unknown) => args);
  const deleted = vi.fn((args: unknown) => args);
  const record = vi.fn(async (entry: unknown) => entry);
  let stored: Record<string, unknown> | null = options.existing ?? null;

  const database = {
    customerProfile: {
      findUnique: vi.fn(async () => options.profile ?? { firstName: 'یکتا', lastName: 'کریمی' }),
    },
    customerBankAccount: {
      findUnique: vi.fn(async (args: unknown) => {
        void args;
        return stored;
      }),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        created(args);
        /* The real upsert takes one branch or the other, and the difference
         * matters here: `update` only carries the columns the service chose to
         * write, so an untouched number has to survive it. */
        stored =
          stored === null
            ? {
                /* The nullable columns start as NULL in the database, so a row
                 * built here has to start the same way rather than leaving them
                 * off the object entirely. */
                ibanBankName: null,
                cardBankName: null,
                ...args.create,
                updatedAt: new Date('2026-09-01T00:00:00.000Z'),
              }
            : { ...stored, ...args.update, updatedAt: new Date('2026-09-02T00:00:00.000Z') };
        return stored;
      }),
      delete: vi.fn(async (args: unknown) => {
        deleted(args);
        stored = null;
        return {};
      }),
    },
  } as unknown as CustomersDatabase;

  const config = {
    /* A fresh buffer per call, like the real config: the service zeroes the key
     * it is handed the moment the envelopes exist. */
    bankDetailsEncryptionKey: () => Buffer.from(KEY),
  } as never;

  const service = new BankDetailsService(database, config, { record } as never);
  return { service, database, created, deleted, record, row: () => stored };
}

describe('saveBankAccountRequestSchema', () => {
  it('reads a blank field as a number the customer did not provide', () => {
    /* The form submits both boxes whichever one was filled in, so an empty
     * string must not travel on as a number to validate. */
    const parsed = saveBankAccountRequestSchema.parse({
      iban: VALID_IBAN,
      cardNumber: '   ',
      ownershipConfirmed: true,
    });

    expect(parsed.iban).toBe(VALID_IBAN);
    expect(parsed.cardNumber).toBeUndefined();
  });

  it('accepts a payload that names only one of the two', () => {
    expect(
      saveBankAccountRequestSchema.parse({ cardNumber: VALID_CARD, ownershipConfirmed: true }),
    ).toMatchObject({ cardNumber: VALID_CARD });
  });
});

describe('BankDetailsService.save', () => {
  it('refuses to store details the customer has not claimed as their own', async () => {
    const { service, created } = harness();

    const error = await service
      .save(
        'customer-a',
        { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: false },
        ACTOR,
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).details?.[0]?.path).toBe('ownershipConfirmed');
    expect(created).not.toHaveBeenCalled();
  });

  it('refuses to store details for a profile with no name to hold them under', async () => {
    /* "In the account holder's own name" is unenforceable without a name on
     * file, so the precondition is checked rather than assumed. */
    const { service, created } = harness({ profile: { firstName: 'یکتا', lastName: null } });

    const error = await service
      .save(
        'customer-a',
        { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
        ACTOR,
      )
      .catch((thrown: unknown) => thrown);

    expect((error as BaratDomainException).details?.[0]?.path).toBe('holderName');
    expect(created).not.toHaveBeenCalled();
  });

  it('takes the holder name from the profile, normalised the same way search reads it', async () => {
    const { service, row } = harness({ profile: { firstName: ' يكتا ', lastName: 'كريمي' } });

    await service.save(
      'customer-a',
      { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(row()?.holderName).toBe('یکتا کریمی');
  });

  it('writes no readable IBAN or card anywhere in the row', async () => {
    const { service, row } = harness();

    await service.save(
      'customer-a',
      { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    const serialised = JSON.stringify(row());
    expect(serialised).not.toContain(VALID_IBAN);
    expect(serialised).not.toContain(VALID_CARD);
    /* Not the middle of either number, under any formatting. */
    expect(serialised).not.toContain(VALID_IBAN.slice(7, 22));
    expect(serialised).not.toContain(VALID_CARD.slice(6, 12));
    expect(row()?.ibanMasked).toBe('IR56017***************1234');
    expect(row()?.cardMasked).toBe('6037-99**-****-0121');
  });

  it('seals each number under its own AAD so the two columns are not interchangeable', async () => {
    const { service, row } = harness();
    await service.save(
      'customer-a',
      { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(open(String(row()?.ibanEncrypted), KEY, IBAN_AAD)).toBe(VALID_IBAN);
    expect(open(String(row()?.cardEncrypted), KEY, CARD_AAD)).toBe(VALID_CARD);
    /* An IBAN envelope moved into the card column fails authentication. */
    expect(() => open(String(row()?.ibanEncrypted), KEY, CARD_AAD)).toThrow();
  });

  it('records the change in the audit trail with masked values only', async () => {
    const { service, record } = harness();

    await service.save(
      'customer-a',
      { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(record).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(record.mock.calls[0]?.[0]);
    expect(entry).toContain('CUSTOMER_BANK_ACCOUNT_SAVED');
    expect(entry).not.toContain(VALID_IBAN);
    expect(entry).not.toContain(VALID_CARD);
    expect(entry).not.toContain('ibanEncrypted');
    expect(entry).not.toContain('cardEncrypted');
  });

  it('stores an IBAN on its own, with nothing readable standing in for the card', async () => {
    const { service, row } = harness();

    const saved = await service.save(
      'customer-a',
      { iban: VALID_IBAN, ownershipConfirmed: true },
      ACTOR,
    );

    expect(saved.maskedIban).toBe('IR56017***************1234');
    /* Absent, not "an empty card number": the column the frozen schema insists
     * on is blank and never reaches the customer as a value. */
    expect(saved.maskedCardNumber).toBeNull();
    expect(saved.cardBankName).toBeNull();
    expect(row()?.cardEncrypted).toBe('');
    expect(row()?.cardMasked).toBe('');
  });

  it('stores a card on its own', async () => {
    const { service, row } = harness();

    const saved = await service.save(
      'customer-a',
      { cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(saved.maskedCardNumber).toBe('6037-99**-****-0121');
    expect(saved.maskedIban).toBeNull();
    expect(saved.ibanBankName).toBeNull();
    expect(open(String(row()?.cardEncrypted), KEY, CARD_AAD)).toBe(VALID_CARD);
    expect(row()?.ibanEncrypted).toBe('');
  });

  it('refuses a declaration that names no account at all', async () => {
    const { service, created } = harness();

    const error = await service
      .save('customer-a', { ownershipConfirmed: true }, ACTOR)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).details?.[0]?.path).toBe('iban');
    expect(created).not.toHaveBeenCalled();
  });

  it('leaves the number already on file alone when only the other one is re-declared', async () => {
    const { service } = harness();
    await service.save('customer-a', { iban: VALID_IBAN, ownershipConfirmed: true }, ACTOR);

    const saved = await service.save(
      'customer-a',
      { cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(saved.maskedCardNumber).toBe('6037-99**-****-0121');
    expect(saved.maskedIban).toBe('IR56017***************1234');
  });

  it('reports the resulting account in the audit trail, not just the half that changed', async () => {
    const { service, record } = harness();
    await service.save('customer-a', { iban: VALID_IBAN, ownershipConfirmed: true }, ACTOR);
    await service.save('customer-a', { cardNumber: VALID_CARD, ownershipConfirmed: true }, ACTOR);

    expect(record.mock.calls[1]?.[0]).toMatchObject({
      after: {
        ibanMasked: 'IR56017***************1234',
        cardMasked: '6037-99**-****-0121',
      },
    });
  });

  it('clears an earlier verification when the numbers are re-declared', async () => {
    const { service, row } = harness({
      existing: {
        holderName: 'یکتا کریمی',
        ibanMasked: 'IR56017***************9999',
        cardMasked: '6037-99**-****-9999',
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await service.save(
      'customer-a',
      { iban: VALID_IBAN, cardNumber: VALID_CARD, ownershipConfirmed: true },
      ACTOR,
    );

    expect(row()?.verifiedAt).toBeNull();
  });
});

describe('BankDetailsService.get', () => {
  it('returns nothing when the customer has stored nothing', async () => {
    const { service } = harness({ existing: null });
    await expect(service.get('customer-a')).resolves.toBeNull();
  });

  it('reports self-declared details as unverified', async () => {
    const { service } = harness({
      existing: {
        holderName: 'یکتا کریمی',
        ibanMasked: 'IR56017***************1234',
        ibanBankName: 'بانک ملی ایران',
        cardMasked: '6037-99**-****-0121',
        cardBankName: 'بانک ملی ایران',
        ownershipAttestedAt: new Date('2026-09-01T00:00:00.000Z'),
        verifiedAt: null,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    await expect(service.get('customer-a')).resolves.toMatchObject({
      holderName: 'یکتا کریمی',
      maskedIban: 'IR56017***************1234',
      maskedCardNumber: '6037-99**-****-0121',
      isVerified: false,
    });
  });

  it('reads a blank column back as a number that was never declared', async () => {
    const { service } = harness({
      existing: {
        holderName: 'یکتا کریمی',
        ibanMasked: 'IR56017***************1234',
        ibanBankName: 'بانک ملی ایران',
        cardMasked: '',
        cardBankName: null,
        ownershipAttestedAt: new Date('2026-09-01T00:00:00.000Z'),
        verifiedAt: null,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    await expect(service.get('customer-a')).resolves.toMatchObject({
      maskedIban: 'IR56017***************1234',
      maskedCardNumber: null,
    });
  });

  it('scopes the lookup to the caller', async () => {
    const { service, database } = harness({ existing: null });
    await service.get('customer-a');
    expect(database.customerBankAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-a' } }),
    );
  });
});

describe('BankDetailsService.remove', () => {
  it('is a no-op with no audit entry when there is nothing to remove', async () => {
    const { service, deleted, record } = harness({ existing: null });

    await expect(service.remove('customer-a', ACTOR)).resolves.toEqual({ removed: false });
    expect(deleted).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('deletes the stored details for the caller and audits it', async () => {
    const { service, deleted, record } = harness({
      existing: { holderName: 'یکتا کریمی', ibanMasked: 'x', cardMasked: 'y' },
    });

    await expect(service.remove('customer-a', ACTOR)).resolves.toEqual({ removed: true });
    expect(deleted).toHaveBeenCalledWith({ where: { customerId: 'customer-a' } });
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: 'CUSTOMER_BANK_ACCOUNT_REMOVED',
      actor: 'customer-a',
    });
  });
});
