import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/* ------------------------------------------------------------------ timing */

/**
 * Iran has kept UTC+03:30 all year since it dropped daylight saving in 2022;
 * the alert formatter relies on the same fixed offset.
 */
const TEHRAN_OFFSET_MINUTES = 210;

function tehranClock(now: Date): Date {
  return new Date(now.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
}

/** The Tehran calendar day, `YYYY-MM-DD`. One scheduled run belongs to each. */
export function tehranDay(now: Date): string {
  return tehranClock(now).toISOString().slice(0, 10);
}

export function tehranMinuteOfDay(now: Date): number {
  const clock = tehranClock(now);
  return clock.getUTCHours() * 60 + clock.getUTCMinutes();
}

/**
 * Due from the configured minute until midnight. A server that was down at the
 * set time catches up as soon as it is back the same day; the unique
 * `scheduledDay` stops it running twice.
 */
export function isScheduledRunDue(now: Date, dailyAtMinute: number): boolean {
  return tehranMinuteOfDay(now) >= dailyAtMinute;
}

export function formatDailyTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function parseDailyTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/* ---------------------------------------------------------- remote archives */

export const REMOTE_ARCHIVE_PATTERN = /^barat-db-\d{8}T\d{6}Z\.bkp$/u;

/** Named after the snapshot's own time, so re-uploading it can never fork a second copy. */
export function remoteArchiveName(snapshotCreatedAt: Date): string {
  const stamp = snapshotCreatedAt.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `barat-db-${stamp}.bkp`;
}

/**
 * Which of our archives on the server fall outside the retention count.
 * Files that do not match our own naming are never candidates, so pointing the
 * backup at a shared directory cannot delete somebody else's files.
 */
export function archivesToPrune(remoteNames: readonly string[], keep: number): string[] {
  const ours = remoteNames.filter((name) => REMOTE_ARCHIVE_PATTERN.test(name)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/* --------------------------------------------------------- local snapshots */

export interface LocalSnapshot {
  /** Directory name, e.g. `snapshot-Ab12Cd34`. */
  readonly name: string;
  readonly dumpPath: string;
  readonly createdAt: Date;
  readonly sizeBytes: number;
}

export class BackupSourceError extends Error {
  constructor() {
    super('Backup source directory is not readable');
    this.name = 'BackupSourceError';
  }
}

const SNAPSHOT_DIRECTORY = /^snapshot-[A-Za-z0-9]{1,32}$/u;
/* The host script publishes `database.dump` with a rename once pg_restore has
 * decoded it, so a file that exists is complete. The age guard is a second
 * line in case a different producer writes in place. */
const MIN_SNAPSHOT_AGE_MS = 60_000;

/**
 * The newest completed `snapshot-*\/database.dump` under `sourceDir`.
 *
 * Symlinks are not followed, at either level: the directory is root-owned and
 * private, and a link inside it pointing elsewhere is not a backup.
 */
export async function findNewestSnapshot(sourceDir: string, now: Date): Promise<LocalSnapshot | null> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    throw new BackupSourceError();
  }

  let newest: LocalSnapshot | null = null;
  for (const entry of entries) {
    if (!entry.isDirectory() || !SNAPSHOT_DIRECTORY.test(entry.name)) continue;
    const dumpPath = join(sourceDir, entry.name, 'database.dump');
    let info;
    try {
      info = await lstat(dumpPath);
    } catch {
      continue;
    }
    if (!info.isFile() || info.size === 0) continue;
    if (now.getTime() - info.mtime.getTime() < MIN_SNAPSHOT_AGE_MS) continue;
    if (newest === null || info.mtime > newest.createdAt) {
      newest = { name: entry.name, dumpPath, createdAt: info.mtime, sizeBytes: info.size };
    }
  }
  return newest;
}
