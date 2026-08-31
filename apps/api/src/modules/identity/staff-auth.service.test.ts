import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import type { IdentityDatabase } from './identity.tokens';
import { StaffAuthService } from './staff-auth.service';

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-usage';
const actor = { ip: '203.0.113.2', userAgent: 'vitest' };
const PASSWORD = 'correct-horse-battery-staple';

interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  passwordHash: string;
}

async function buildRig(rows: Array<Omit<StaffRow, 'passwordHash'> & { password: string }>) {
  const audits: Array<Record<string, unknown>> = [];
  const staff: StaffRow[] = [];
  for (const row of rows) {
    staff.push({
      ...row,
      passwordHash: await argon2.hash(row.password, { type: argon2.argon2id }),
    });
  }

  const database = {
    staffUser: {
      findUnique: vi.fn(async ({ where }: any) => {
        const row = staff.find((candidate) => candidate.email === where.email);
        return row ? { ...row } : null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = staff.find(
          (candidate) => candidate.id === where.id && candidate.isActive === where.isActive,
        );
        return row ? { id: row.id, email: row.email, role: row.role } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = staff.find((candidate) => candidate.id === where.id);
        if (row) {
          Object.assign(row, data);
        }
        return row;
      }),
    },
  } as unknown as IdentityDatabase;

  const audit = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      audits.push(input);
    }),
  };

  const service = new StaffAuthService(
    database,
    { sessionJwtSecret: () => SECRET } as never,
    audit as never,
  );

  return { service, staff, audits };
}

const OPERATOR = {
  id: 'staff-1',
  email: 'operator@barat.test',
  fullName: 'Operator One',
  role: 'OPERATOR',
  isActive: true,
  password: PASSWORD,
};

describe('StaffAuthService.login', () => {
  it('issues a token for the right password and records the login', async () => {
    const rig = await buildRig([OPERATOR]);

    const result = await rig.service.login('Operator@Barat.Test', PASSWORD, actor);

    expect(result.staff).toMatchObject({ id: 'staff-1', role: 'OPERATOR' });
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(rig.audits[0]!['action']).toBe('STAFF_LOGIN');
  });

  it('never puts the password or the token into an audit row', async () => {
    const rig = await buildRig([OPERATOR]);

    const result = await rig.service.login(OPERATOR.email, PASSWORD, actor);

    const serialised = JSON.stringify(rig.audits);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain(result.accessToken);
  });

  it('rejects a wrong password with the same error as an unknown account', async () => {
    const rig = await buildRig([OPERATOR]);

    const wrongPassword = await rig.service
      .login(OPERATOR.email, 'not-the-password', actor)
      .catch((error: BaratDomainException) => error);
    const unknownAccount = await rig.service
      .login('nobody@barat.test', PASSWORD, actor)
      .catch((error: BaratDomainException) => error);

    expect((wrongPassword as BaratDomainException).status).toBe(401);
    expect((unknownAccount as BaratDomainException).safeMessage).toBe(
      (wrongPassword as BaratDomainException).safeMessage,
    );
    expect(rig.audits).toHaveLength(0);
  });

  it('refuses a deactivated account even with the right password', async () => {
    const rig = await buildRig([{ ...OPERATOR, isActive: false }]);

    await expect(rig.service.login(OPERATOR.email, PASSWORD, actor)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('stores an argon2id hash, never the password', async () => {
    const rig = await buildRig([OPERATOR]);

    expect(rig.staff[0]!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(rig.staff[0]!.passwordHash).not.toContain(PASSWORD);
  });
});

describe('StaffAuthService.authenticate', () => {
  it('re-reads the role from the database rather than trusting the token', async () => {
    const rig = await buildRig([OPERATOR]);
    const { accessToken } = await rig.service.login(OPERATOR.email, PASSWORD, actor);

    /* The token was minted while this user was an OPERATOR. A promotion or a
     * demotion has to take effect on the next request, not in eight hours. */
    rig.staff[0]!.role = 'VIEWER';

    await expect(rig.service.authenticate(accessToken)).resolves.toMatchObject({
      type: 'STAFF',
      role: 'VIEWER',
    });
  });

  it('rejects the token of a deactivated account immediately', async () => {
    const rig = await buildRig([OPERATOR]);
    const { accessToken } = await rig.service.login(OPERATOR.email, PASSWORD, actor);

    rig.staff[0]!.isActive = false;

    await expect(rig.service.authenticate(accessToken)).rejects.toBeInstanceOf(
      BaratDomainException,
    );
  });

  it('rejects a customer-session token presented on the staff path', async () => {
    const rig = await buildRig([OPERATOR]);
    const { SignJWT } = await import('jose');
    const customerToken = await new SignJWT({ typ: 'customer-session' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('staff-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    await expect(rig.service.authenticate(customerToken)).rejects.toBeInstanceOf(
      BaratDomainException,
    );
  });
});
