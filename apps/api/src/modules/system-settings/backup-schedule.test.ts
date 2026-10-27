import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archivesToPrune,
  BackupSourceError,
  findNewestSnapshot,
  formatDailyTime,
  isScheduledRunDue,
  parseDailyTime,
  remoteArchiveName,
  tehranDay,
  tehranMinuteOfDay,
} from './backup-schedule';

describe('Tehran clock', () => {
  it('rolls the day over at 20:30 UTC, which is midnight in Tehran', () => {
    expect(tehranDay(new Date('2026-10-21T20:29:59Z'))).toBe('2026-10-21');
    expect(tehranDay(new Date('2026-10-21T20:30:00Z'))).toBe('2026-10-22');
  });

  it('is due from the configured Tehran minute until midnight', () => {
    /* 04:00 Tehran = 00:30 UTC. */
    expect(tehranMinuteOfDay(new Date('2026-10-22T00:30:00Z'))).toBe(240);
    expect(isScheduledRunDue(new Date('2026-10-22T00:29:00Z'), 240)).toBe(false);
    expect(isScheduledRunDue(new Date('2026-10-22T00:30:00Z'), 240)).toBe(true);
    expect(isScheduledRunDue(new Date('2026-10-22T20:29:00Z'), 240)).toBe(true);
  });

  it('parses and formats HH:MM', () => {
    expect(parseDailyTime('04:00')).toBe(240);
    expect(parseDailyTime('23:59')).toBe(1439);
    expect(parseDailyTime('24:00')).toBeNull();
    expect(parseDailyTime('4:00')).toBeNull();
    expect(formatDailyTime(65)).toBe('01:05');
  });
});

describe('remote archives', () => {
  it('names an archive after its snapshot time', () => {
    expect(remoteArchiveName(new Date('2026-10-21T23:52:07.123Z'))).toBe('barat-db-20261021T235207Z.bkp');
  });

  it('prunes only our own archives, oldest first', () => {
    const names = [
      'barat-db-20261019T235000Z.bkp',
      'notes.txt',
      'barat-db-20261021T235000Z.bkp',
      'barat-db-20261020T235000Z.bkp',
      'barat-db-20261018T235000Z.bkp.part',
      'other-db-20261001T000000Z.bkp',
    ];
    expect(archivesToPrune(names, 2)).toEqual(['barat-db-20261019T235000Z.bkp']);
    expect(archivesToPrune(names, 5)).toEqual([]);
  });
});

describe('findNewestSnapshot', () => {
  let dir: string;
  const now = new Date('2026-10-22T01:00:00Z');

  async function snapshot(name: string, mtime: Date, content = 'PGDMP'): Promise<void> {
    await mkdir(join(dir, name));
    await writeFile(join(dir, name, 'database.dump'), content);
    await utimes(join(dir, name, 'database.dump'), mtime, mtime);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshots-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('picks the newest completed dump', async () => {
    await snapshot('snapshot-AAAA1111', new Date('2026-10-20T23:50:00Z'));
    await snapshot('snapshot-BBBB2222', new Date('2026-10-21T23:50:00Z'));

    const found = await findNewestSnapshot(dir, now);

    expect(found).toMatchObject({ name: 'snapshot-BBBB2222', sizeBytes: 5 });
    expect(found?.createdAt.toISOString()).toBe('2026-10-21T23:50:00.000Z');
  });

  it('ignores a dump still being written, an empty one, a partial and foreign directories', async () => {
    await snapshot('snapshot-OLD00001', new Date('2026-10-21T23:50:00Z'));
    await snapshot('snapshot-YOUNG001', new Date(now.getTime() - 10_000));
    await snapshot('snapshot-EMPTY001', new Date('2026-10-21T23:55:00Z'), '');
    await mkdir(join(dir, 'snapshot-PARTIAL1'));
    await writeFile(join(dir, 'snapshot-PARTIAL1', 'database.dump.partial'), 'x');
    await snapshot('manual-copy', new Date('2026-10-21T23:59:00Z'));

    expect((await findNewestSnapshot(dir, now))?.name).toBe('snapshot-OLD00001');
  });

  it('does not follow a symlinked dump', async () => {
    await writeFile(join(dir, 'secret.env'), 'SESSION_JWT_SECRET=…');
    await mkdir(join(dir, 'snapshot-LINK0001'));
    await symlink(join(dir, 'secret.env'), join(dir, 'snapshot-LINK0001', 'database.dump'));

    expect(await findNewestSnapshot(dir, now)).toBeNull();
  });

  it('reports an unreadable source directory distinctly from an empty one', async () => {
    expect(await findNewestSnapshot(dir, now)).toBeNull();
    await expect(findNewestSnapshot(join(dir, 'missing'), now)).rejects.toBeInstanceOf(BackupSourceError);
  });
});
