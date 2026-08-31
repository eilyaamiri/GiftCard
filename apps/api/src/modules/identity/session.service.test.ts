import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import type { IdentityDatabase } from './identity.tokens';
import { sha256 } from './identity.utils';
import { SessionService } from './session.service';

const SECRET = 'a-test-secret-that-is-long-enough-for-hs256-usage';
const actor = { ip: '203.0.113.1', userAgent: 'vitest' };

interface SessionRow {
  id: string;
  customerId: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  status: string;
}

interface CommerceRow {
  sessionToken: string;
  customerId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function buildRig(commerce: CommerceRow[] = []) {
  const sessions: SessionRow[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const database = {
    authSession: {
      create: vi.fn(async ({ data }: any) => {
        sessions.push({
          id: data.id,
          customerId: data.customerId,
          tokenHash: data.tokenHash,
          revokedAt: null,
          expiresAt: data.expiresAt,
          status: 'ACTIVE',
        });
        return { id: data.id };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = sessions.find(
          (session) =>
            session.id === where.id &&
            session.customerId === where.customerId &&
            session.tokenHash === where.tokenHash &&
            session.revokedAt === null &&
            session.expiresAt > where.expiresAt.gt &&
            session.status !== 'DISABLED',
        );
        return row ? { id: row.id, customerId: row.customerId } : null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = sessions.find((session) => session.tokenHash === where.tokenHash);
        return row ? { id: row.id, customerId: row.customerId, revokedAt: row.revokedAt } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = sessions.find((session) => session.id === where.id);
        if (row) {
          Object.assign(row, data);
        }
        return row;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    commerceSession: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const matched = commerce.filter((row) => {
          if (row.sessionToken !== where.sessionToken) {
            return false;
          }
          /* Mirrors the OR clause: unclaimed, or already the same customer. */
          return where.OR.some(
            (clause: { customerId: string | null }) => row.customerId === clause.customerId,
          );
        });
        for (const row of matched) {
          row.customerId = data.customerId;
          row.lastSeenAt = data.lastSeenAt;
        }
        return { count: matched.length };
      }),
    },
  } as unknown as IdentityDatabase;

  const audit = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      audits.push(input);
    }),
  };

  const service = new SessionService(
    database,
    { sessionJwtSecret: () => SECRET } as never,
    audit as never,
  );

  return { service, sessions, audits, commerce, database };
}

describe('SessionService', () => {
  it('stores only a hash of the token, never the token itself', async () => {
    const rig = buildRig();

    const issued = await rig.service.createSession('customer-1', actor);

    expect(rig.sessions[0]!.tokenHash).toBe(sha256(issued.accessToken));
    expect(rig.sessions[0]!.tokenHash).not.toBe(issued.accessToken);
    expect(JSON.stringify(rig.sessions)).not.toContain(issued.accessToken);
  });

  it('never puts a raw token into an audit row', async () => {
    const rig = buildRig();

    const issued = await rig.service.createSession('customer-1', actor);
    await rig.service.revoke(issued.accessToken, actor);

    expect(rig.audits).toHaveLength(2);
    expect(JSON.stringify(rig.audits)).not.toContain(issued.accessToken);
  });

  it('authenticates its own token and rejects a revoked one', async () => {
    const rig = buildRig();
    const issued = await rig.service.createSession('customer-1', actor);

    await expect(rig.service.authenticate(issued.accessToken)).resolves.toMatchObject({
      type: 'CUSTOMER',
      customerId: 'customer-1',
    });

    await rig.service.revoke(issued.accessToken, actor);
    await expect(rig.service.authenticate(issued.accessToken)).rejects.toBeInstanceOf(
      BaratDomainException,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const attacker = buildRig();
    const forged = await attacker.service.createSession('customer-1', actor);

    const victim = buildRig();
    const service = new SessionService(
      victim.database,
      { sessionJwtSecret: () => 'a-completely-different-secret-value-here' } as never,
      { record: vi.fn() } as never,
    );

    await expect(service.authenticate(forged.accessToken)).rejects.toBeInstanceOf(
      BaratDomainException,
    );
  });

  it('rejects a garbage or oversized token without touching the database', async () => {
    const rig = buildRig();

    await expect(rig.service.authenticate('not.a.jwt')).rejects.toBeInstanceOf(
      BaratDomainException,
    );
    await expect(rig.service.authenticate('x'.repeat(5000))).rejects.toBeInstanceOf(
      BaratDomainException,
    );
    expect(rig.sessions).toHaveLength(0);
  });
});

describe('SessionService.linkCommerceSession', () => {
  const firstSeen = new Date('2026-01-01T00:00:00.000Z');

  it('claims an anonymous session and preserves its first-seen timestamp', async () => {
    const rig = buildRig([
      { sessionToken: 'anon-1', customerId: null, firstSeenAt: firstSeen, lastSeenAt: firstSeen },
    ]);

    await expect(rig.service.linkCommerceSession('anon-1', 'customer-1')).resolves.toBe(true);

    expect(rig.commerce[0]!.customerId).toBe('customer-1');
    /* Funnel history must not be rewritten when the visitor signs in. */
    expect(rig.commerce[0]!.firstSeenAt).toEqual(firstSeen);
  });

  it('is idempotent for the same customer', async () => {
    const rig = buildRig([
      {
        sessionToken: 'anon-1',
        customerId: 'customer-1',
        firstSeenAt: firstSeen,
        lastSeenAt: firstSeen,
      },
    ]);

    await expect(rig.service.linkCommerceSession('anon-1', 'customer-1')).resolves.toBe(true);
    expect(rig.commerce[0]!.customerId).toBe('customer-1');
  });

  it("never lets a session claim another customer's session", async () => {
    const rig = buildRig([
      {
        sessionToken: 'anon-1',
        customerId: 'customer-b',
        firstSeenAt: firstSeen,
        lastSeenAt: firstSeen,
      },
    ]);

    await expect(rig.service.linkCommerceSession('anon-1', 'customer-a')).resolves.toBe(false);
    /* The row still belongs to B, with its original orders and quotes. */
    expect(rig.commerce[0]!.customerId).toBe('customer-b');
  });

  it('ignores an empty or oversized session token', async () => {
    const rig = buildRig([]);

    await expect(rig.service.linkCommerceSession('', 'customer-1')).resolves.toBe(false);
    await expect(rig.service.linkCommerceSession('x'.repeat(200), 'customer-1')).resolves.toBe(
      false,
    );
  });
});
