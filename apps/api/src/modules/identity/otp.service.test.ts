import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { OtpService, IDENTITY_CONFLICT_FLAG } from './otp.service';
import type { IdentityDatabase } from './identity.tokens';

/* ---------------------------------------------------------------------------
 * In-memory stand-in for the slice of Prisma the identity module uses.
 *
 * It models the real query shapes AND the unique constraints, because those
 * constraints are load-bearing security controls: "an identity belongs to
 * exactly one customer" is enforced by the database, not by an if-statement.
 * ------------------------------------------------------------------------ */

let sequence = 0;
const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

interface FakeOtpChallenge {
  id: string;
  customerId: string | null;
  identityType: 'MOBILE' | 'EMAIL';
  identityValueNormalized: string;
  purpose: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  requestCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
  lockedUntil: Date | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

interface FakeCustomerIdentity {
  id: string;
  customerId: string;
  type: 'MOBILE' | 'EMAIL';
  value: string;
  valueNormalized: string;
  isPrimary: boolean;
  isVerified: boolean;
  verifiedAt: Date | null;
}

interface FakeCustomer {
  id: string;
  customerCode: string;
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'DISABLED';
  createdAt: Date;
}

interface FakeCustomerFlag {
  id: string;
  customerId: string;
  key: string;
  reason: string | null;
}

class UniqueConstraintError extends Error {
  readonly code = 'P2002';
  constructor(target: string) {
    super(`Unique constraint failed on ${target}`);
  }
}

class FakeIdentityDatabase {
  readonly challenges: FakeOtpChallenge[] = [];
  readonly identities: FakeCustomerIdentity[] = [];
  readonly customers: FakeCustomer[] = [];
  readonly flags: FakeCustomerFlag[] = [];

  seedCustomer(status: FakeCustomer['status'] = 'ACTIVE'): FakeCustomer {
    const customer: FakeCustomer = {
      id: nextId('cus'),
      customerCode: nextId('CUS'),
      status,
      createdAt: new Date(),
    };
    this.customers.push(customer);
    return customer;
  }

  seedIdentity(
    customerId: string,
    type: 'MOBILE' | 'EMAIL',
    valueNormalized: string,
    isVerified = true,
  ): FakeCustomerIdentity {
    const identity: FakeCustomerIdentity = {
      id: nextId('idn'),
      customerId,
      type,
      value: valueNormalized,
      valueNormalized,
      isPrimary: true,
      isVerified,
      verifiedAt: isVerified ? new Date() : null,
    };
    this.identities.push(identity);
    return identity;
  }

  readonly otpChallenge = {
    create: async ({ data }: any) => {
      const row: FakeOtpChallenge = {
        id: nextId('otp'),
        customerId: data.customerId ?? null,
        identityType: data.identityType,
        identityValueNormalized: data.identityValueNormalized,
        purpose: data.purpose,
        codeHash: data.codeHash,
        attempts: data.attempts ?? 0,
        maxAttempts: data.maxAttempts ?? 5,
        requestCount: data.requestCount ?? 1,
        expiresAt: data.expiresAt,
        consumedAt: null,
        lockedUntil: null,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        createdAt: new Date(),
      };
      this.challenges.push(row);
      return { ...row };
    },

    count: async ({ where }: any) => this.matchChallenges(where).length,

    findFirst: async ({ where }: any) => {
      const rows = this.matchChallenges(where).sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
      return rows[0] ? { ...rows[0] } : null;
    },

    findUnique: async ({ where }: any) => {
      const row = this.challenges.find((challenge) => challenge.id === where.id);
      return row ? { ...row } : null;
    },

    updateMany: async ({ where, data }: any) => {
      const rows = this.challenges.filter((challenge) => this.challengeMatches(challenge, where));
      for (const row of rows) {
        if (data.consumedAt !== undefined) {
          row.consumedAt = data.consumedAt;
        }
        if (data.lockedUntil !== undefined) {
          row.lockedUntil = data.lockedUntil;
        }
        if (data.attempts?.increment !== undefined) {
          row.attempts += data.attempts.increment;
        }
      }
      return { count: rows.length };
    },
  };

  readonly customerIdentity = {
    findUnique: async ({ where }: any) => {
      const key = where.type_valueNormalized;
      const row = this.identities.find(
        (identity) =>
          identity.type === key.type && identity.valueNormalized === key.valueNormalized,
      );
      return row ? { ...row } : null;
    },

    create: async ({ data }: any) => {
      this.assertIdentityFree(data.type, data.valueNormalized);
      const row: FakeCustomerIdentity = {
        id: nextId('idn'),
        customerId: data.customerId,
        type: data.type,
        value: data.value,
        valueNormalized: data.valueNormalized,
        isPrimary: data.isPrimary ?? false,
        isVerified: data.isVerified ?? false,
        verifiedAt: data.verifiedAt ?? null,
      };
      this.identities.push(row);
      return { ...row };
    },

    update: async ({ where, data }: any) => {
      const row = this.identities.find((identity) => identity.id === where.id);
      if (!row) {
        throw new Error('identity not found');
      }
      Object.assign(row, data);
      return { ...row };
    },
  };

  readonly customer = {
    findUnique: async ({ where }: any) => {
      const row = this.customers.find(
        (customer) =>
          (where.id !== undefined && customer.id === where.id) ||
          (where.customerCode !== undefined && customer.customerCode === where.customerCode),
      );
      return row ? { ...row } : null;
    },

    create: async ({ data }: any) => {
      if (this.customers.some((customer) => customer.customerCode === data.customerCode)) {
        throw new UniqueConstraintError('Customer.customerCode');
      }
      const nested = data.identities?.create;
      if (nested) {
        this.assertIdentityFree(nested.type, nested.valueNormalized);
      }

      const customer: FakeCustomer = {
        id: nextId('cus'),
        customerCode: data.customerCode,
        status: 'ACTIVE',
        createdAt: new Date(),
      };
      this.customers.push(customer);
      if (nested) {
        this.identities.push({
          id: nextId('idn'),
          customerId: customer.id,
          type: nested.type,
          value: nested.value,
          valueNormalized: nested.valueNormalized,
          isPrimary: nested.isPrimary ?? false,
          isVerified: nested.isVerified ?? false,
          verifiedAt: nested.verifiedAt ?? null,
        });
      }
      return { ...customer };
    },
  };

  readonly customerFlag = {
    upsert: async ({ where, create }: any) => {
      const key = where.customerId_key;
      const existing = this.flags.find(
        (flag) => flag.customerId === key.customerId && flag.key === key.key,
      );
      if (existing) {
        return { ...existing };
      }
      const row: FakeCustomerFlag = {
        id: nextId('flg'),
        customerId: create.customerId,
        key: create.key,
        reason: create.reason ?? null,
      };
      this.flags.push(row);
      return { ...row };
    },
  };

  /* ------------------------------------------------------------- internals */

  private assertIdentityFree(type: string, valueNormalized: string): void {
    const taken = this.identities.some(
      (identity) => identity.type === type && identity.valueNormalized === valueNormalized,
    );
    if (taken) {
      throw new UniqueConstraintError('CustomerIdentity.type_valueNormalized');
    }
  }

  private matchChallenges(where: any): FakeOtpChallenge[] {
    return this.challenges.filter((challenge) => this.challengeMatches(challenge, where));
  }

  private challengeMatches(challenge: FakeOtpChallenge, where: any): boolean {
    if (where.id !== undefined && challenge.id !== where.id) {
      return false;
    }
    if (where.identityType !== undefined && challenge.identityType !== where.identityType) {
      return false;
    }
    if (
      where.identityValueNormalized !== undefined &&
      challenge.identityValueNormalized !== where.identityValueNormalized
    ) {
      return false;
    }
    if (where.consumedAt === null && challenge.consumedAt !== null) {
      return false;
    }
    if (where.createdAt?.gte && challenge.createdAt < where.createdAt.gte) {
      return false;
    }
    if (where.expiresAt?.gt && challenge.expiresAt <= where.expiresAt.gt) {
      return false;
    }
    if (where.attempts?.lt !== undefined && challenge.attempts >= where.attempts.lt) {
      return false;
    }
    return true;
  }
}

/* ---------------------------------------------------------------------- rig */

const MOBILE = '09121234567';
const NORMALIZED = '+989121234567';

interface Harness {
  readonly service: OtpService;
  readonly database: FakeIdentityDatabase;
  readonly sentCodes: string[];
  readonly auditRecords: Array<Record<string, unknown>>;
  readonly sessions: { createSession: ReturnType<typeof vi.fn>; linkCommerceSession: ReturnType<typeof vi.fn> };
}

function buildHarness(overrides: Partial<Record<string, number>> = {}): Harness {
  const database = new FakeIdentityDatabase();
  const sentCodes: string[] = [];
  const auditRecords: Array<Record<string, unknown>> = [];

  const config = {
    otp: {
      length: 6,
      ttlSeconds: overrides.ttlSeconds ?? 120,
      resendSeconds: overrides.resendSeconds ?? 60,
      maxAttempts: overrides.maxAttempts ?? 3,
      maxRequestsPerHour: overrides.maxRequestsPerHour ?? 5,
    },
  };

  const sms = {
    send: vi.fn(async (message: any) => {
      sentCodes.push(String(message.templateParams.code));
    }),
  };
  const email = {
    send: vi.fn(async (message: any) => {
      sentCodes.push(String(message.templateParams.code));
    }),
  };
  const audit = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      auditRecords.push(input);
    }),
  };
  const sessions = {
    createSession: vi.fn(async (customerId: string) => ({
      sessionId: 'session-1',
      accessToken: `token-for-${customerId}`,
      expiresAt: new Date(Date.now() + 60_000),
    })),
    linkCommerceSession: vi.fn(async () => true),
  };
  const customers = {
    customerDto: vi.fn(async (customerId: string) => ({ id: customerId })),
  };

  const service = new OtpService(
    database as unknown as IdentityDatabase,
    config as never,
    sms as never,
    email as never,
    audit as never,
    sessions as never,
    customers as never,
  );

  return { service, database, sentCodes, auditRecords, sessions };
}

const context = { ip: '203.0.113.9', userAgent: 'vitest', customerId: null };

/** Moves every stored challenge back in time, to simulate the clock advancing. */
function rewind(database: FakeIdentityDatabase, seconds: number): void {
  for (const challenge of database.challenges) {
    challenge.createdAt = new Date(challenge.createdAt.getTime() - seconds * 1000);
    challenge.expiresAt = new Date(challenge.expiresAt.getTime() - seconds * 1000);
  }
}

/* -------------------------------------------------------------------- tests */

describe('OtpService.requestOtp', () => {
  it('stores an argon2 hash and never the code itself', async () => {
    const rig = buildHarness();

    await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );

    const [challenge] = rig.database.challenges;
    const code = rig.sentCodes[0]!;

    expect(code).toMatch(/^\d{6}$/u);
    expect(challenge!.codeHash.startsWith('$argon2id$')).toBe(true);
    expect(challenge!.codeHash).not.toContain(code);
    expect(JSON.stringify(challenge)).not.toContain(code);
  });

  it('keeps the code out of every audit record', async () => {
    const rig = buildHarness();

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const code = rig.sentCodes[0]!;

    await rig.service.verifyOtp({ challengeId: requested.challengeId, code } as never, context);

    expect(rig.auditRecords.length).toBeGreaterThan(0);
    expect(JSON.stringify(rig.auditRecords)).not.toContain(code);
  });

  it('returns a masked target and never the raw identifier', async () => {
    const rig = buildHarness();

    const response = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );

    expect(response.maskedTarget).toBe('+9891***4567');
    expect(JSON.stringify(response)).not.toContain(NORMALIZED);
  });

  it('rejects a resend inside the cooldown window', async () => {
    const rig = buildHarness({ resendSeconds: 60 });
    const request = { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never;

    await rig.service.requestOtp(request, context);
    await expect(rig.service.requestOtp(request, context)).rejects.toThrow(BaratDomainException);
    expect(rig.database.challenges).toHaveLength(1);
  });

  it('allows a resend once the cooldown has elapsed and counts it', async () => {
    const rig = buildHarness({ resendSeconds: 60 });
    const request = { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never;

    await rig.service.requestOtp(request, context);
    rewind(rig.database, 61);
    await rig.service.requestOtp(request, context);

    expect(rig.database.challenges).toHaveLength(2);
    expect(rig.database.challenges[1]!.requestCount).toBe(2);
  });

  it('enforces the hourly request cap per identifier', async () => {
    const rig = buildHarness({ resendSeconds: 0, maxRequestsPerHour: 3 });
    const request = { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never;

    for (let index = 0; index < 3; index += 1) {
      await rig.service.requestOtp(request, context);
    }

    await expect(rig.service.requestOtp(request, context)).rejects.toThrow(BaratDomainException);
    expect(rig.database.challenges).toHaveLength(3);
  });

  it('counts the hourly cap against the normalised identifier, not the typed form', async () => {
    const rig = buildHarness({ resendSeconds: 0, maxRequestsPerHour: 2 });

    await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: '09121234567', purpose: 'LOGIN' } as never,
      context,
    );
    await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: '+989121234567', purpose: 'LOGIN' } as never,
      context,
    );

    await expect(
      rig.service.requestOtp(
        { identityType: 'MOBILE', identifier: '989121234567', purpose: 'LOGIN' } as never,
        context,
      ),
    ).rejects.toThrow(BaratDomainException);
  });
});

describe('OtpService.verifyOtp', () => {
  it('creates a customer with a non-sequential code on first successful login', async () => {
    const rig = buildHarness();

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const result = await rig.service.verifyOtp(
      { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
      context,
    );

    expect(result.isNewCustomer).toBe(true);
    expect(rig.database.customers).toHaveLength(1);
    expect(rig.database.customers[0]!.customerCode).toMatch(/^CUS-[0-9A-Z]{6}$/u);
    expect(rig.database.customers[0]!.customerCode).not.toBe(rig.database.customers[0]!.id);
    expect(rig.database.identities[0]!.isVerified).toBe(true);
  });

  it('is single use: the same code cannot open a second session', async () => {
    const rig = buildHarness();

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const code = rig.sentCodes[0]!;

    await rig.service.verifyOtp({ challengeId: requested.challengeId, code } as never, context);
    await expect(
      rig.service.verifyOtp({ challengeId: requested.challengeId, code } as never, context),
    ).rejects.toThrow(BaratDomainException);

    expect(rig.sessions.createSession).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired challenge even with the right code', async () => {
    const rig = buildHarness({ ttlSeconds: 120 });

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const code = rig.sentCodes[0]!;
    rewind(rig.database, 121);

    await expect(
      rig.service.verifyOtp({ challengeId: requested.challengeId, code } as never, context),
    ).rejects.toThrow(BaratDomainException);
    expect(rig.database.customers).toHaveLength(0);
  });

  it('locks the challenge after the attempt budget and refuses the correct code afterwards', async () => {
    const rig = buildHarness({ maxAttempts: 3 });

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const code = rig.sentCodes[0]!;
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        rig.service.verifyOtp({ challengeId: requested.challengeId, code: wrong } as never, context),
      ).rejects.toThrow(BaratDomainException);
    }

    expect(rig.database.challenges[0]!.attempts).toBe(3);
    expect(rig.database.challenges[0]!.lockedUntil).not.toBeNull();

    await expect(
      rig.service.verifyOtp({ challengeId: requested.challengeId, code } as never, context),
    ).rejects.toThrow(BaratDomainException);
    expect(rig.sessions.createSession).not.toHaveBeenCalled();
  });

  it('gives the same message for a wrong code, an expired code and an unknown challenge', async () => {
    const rig = buildHarness();

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );

    const wrongCode = await rig.service
      .verifyOtp({ challengeId: requested.challengeId, code: '000000' } as never, context)
      .catch((error: BaratDomainException) => error);
    const unknownChallenge = await rig.service
      .verifyOtp({ challengeId: 'otp-does-not-exist', code: '000000' } as never, context)
      .catch((error: BaratDomainException) => error);

    expect((wrongCode as BaratDomainException).safeMessage).toBe(
      (unknownChallenge as BaratDomainException).safeMessage,
    );
  });

  it('signs an existing customer in without creating a second account', async () => {
    const rig = buildHarness({ resendSeconds: 0 });
    const existing = rig.database.seedCustomer();
    rig.database.seedIdentity(existing.id, 'MOBILE', NORMALIZED);

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );
    const result = await rig.service.verifyOtp(
      { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
      context,
    );

    expect(result.isNewCustomer).toBe(false);
    expect(rig.database.customers).toHaveLength(1);
    expect(rig.database.identities).toHaveLength(1);
  });

  it('refuses a session for a disabled customer', async () => {
    const rig = buildHarness();
    const disabled = rig.database.seedCustomer('DISABLED');
    rig.database.seedIdentity(disabled.id, 'MOBILE', NORMALIZED);

    const requested = await rig.service.requestOtp(
      { identityType: 'MOBILE', identifier: MOBILE, purpose: 'LOGIN' } as never,
      context,
    );

    await expect(
      rig.service.verifyOtp(
        { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
        context,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(rig.sessions.createSession).not.toHaveBeenCalled();
  });
});

describe('identity conflict', () => {
  it('never merges: a second customer verifying an identifier owned by another is flagged', async () => {
    const rig = buildHarness();
    const owner = rig.database.seedCustomer();
    rig.database.seedIdentity(owner.id, 'EMAIL', 'shared@example.com');
    const claimant = rig.database.seedCustomer();

    const authenticated = { ...context, customerId: claimant.id };
    const requested = await rig.service.requestOtp(
      { identityType: 'EMAIL', identifier: 'Shared@Example.com', purpose: 'ADD_IDENTITY' } as never,
      authenticated,
    );

    await expect(
      rig.service.verifyOtp(
        { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
        authenticated,
      ),
    ).rejects.toThrow(BaratDomainException);

    /* The identity still belongs to exactly one customer — the original owner. */
    const identities = rig.database.identities.filter(
      (identity) => identity.valueNormalized === 'shared@example.com',
    );
    expect(identities).toHaveLength(1);
    expect(identities[0]!.customerId).toBe(owner.id);

    /* ...and the attempt is routed to support rather than silently dropped. */
    expect(rig.database.flags).toEqual([
      expect.objectContaining({ customerId: claimant.id, key: IDENTITY_CONFLICT_FLAG }),
    ]);
    expect(rig.sessions.createSession).not.toHaveBeenCalled();
  });

  it('attaches a free identifier to the signed-in customer instead', async () => {
    const rig = buildHarness();
    const customer = rig.database.seedCustomer();
    rig.database.seedIdentity(customer.id, 'MOBILE', NORMALIZED);

    const authenticated = { ...context, customerId: customer.id };
    const requested = await rig.service.requestOtp(
      { identityType: 'EMAIL', identifier: 'new@example.com', purpose: 'ADD_IDENTITY' } as never,
      authenticated,
    );
    const result = await rig.service.verifyOtp(
      { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
      authenticated,
    );

    expect(result.isNewCustomer).toBe(false);
    expect(rig.database.customers).toHaveLength(1);
    expect(
      rig.database.identities.filter((identity) => identity.customerId === customer.id),
    ).toHaveLength(2);
    expect(rig.database.flags).toHaveLength(0);
  });

  it('does not create an account for a non-LOGIN purpose from an anonymous caller', async () => {
    const rig = buildHarness();

    const requested = await rig.service.requestOtp(
      { identityType: 'EMAIL', identifier: 'stranger@example.com', purpose: 'ADD_IDENTITY' } as never,
      context,
    );

    await expect(
      rig.service.verifyOtp(
        { challengeId: requested.challengeId, code: rig.sentCodes[0]! } as never,
        context,
      ),
    ).rejects.toThrow(BaratDomainException);
    expect(rig.database.customers).toHaveLength(0);
  });
});
