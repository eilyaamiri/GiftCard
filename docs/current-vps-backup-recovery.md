# Backup and recovery for the current VPS

This runbook covers the deployment inspected on 2026-09-21: systemd runs the
applications and the existing `barat-postgres` Docker container runs PostgreSQL
17. It does not replace the separate Compose production deployment guide.
Documentation ownership: S7. No application, schema, deployment hook, or schedule
changes are included. Human approval is required before running this on production.

## Verified starting point

- The existing `deploy/backup.sh` expects a root `.env.production` file and the
  production Compose layout. That environment file is absent from the current
  checkout. Do not run that script unchanged on this deployment.
- A custom-format archive dated 2026-08-31 was found. Its catalog and all archive
  entries decode successfully; a database restore has not been tested.
- No application backup schedule was identified in the inspected cron/systemd
  locations. Provider snapshots, off-host copies and retention remain unverified.
- The database was approximately 36 MiB and the backup filesystem had more than
  35 GiB free at inspection time. Recheck capacity before each execution.

## One-time local backup, after approval

Run as root on the existing host during a quiet period. This command uses the
existing container credentials without printing them, opens a consistent logical
snapshot, and does not restart services or alter application data. It adds database
read and disk load; it cannot promise zero latency impact. Avoid concurrent DDL or
deployment. A five-second lock wait timeout makes a blocked dump fail rather than
wait indefinitely; a five-minute statement timeout bounds individual statements.

Do not run with shell tracing. Raw tool diagnostics are deliberately suppressed:
they can include connection details. On failure, investigate privately without
posting unredacted diagnostics. No backup is uploaded or old archive deleted.

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
backup_root=/var/backups/baratpay
[[ -d "$backup_root" && ! -L "$backup_root" ]] || exit 1
[[ "$(stat -c '%u:%a' "$backup_root")" == '0:700' ]] || exit 1
backup_run=$(mktemp -d "$backup_root/snapshot-XXXXXXXX")
backup_complete=false
cleanup() {
  if [[ "$backup_complete" != true ]]; then
    rm -f -- "$backup_run/database.dump.partial"
    rmdir -- "$backup_run" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! docker exec barat-postgres sh -c '
  export PGOPTIONS="-c statement_timeout=300000"
  exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --format=custom --compress=6 --no-owner --no-privileges \
    --lock-wait-timeout=5s
' > "$backup_run/database.dump.partial" 2>/dev/null; then
  printf '%s\n' 'Backup failed; no completed archive published.' >&2
  exit 1
fi

if ! docker exec -i barat-postgres pg_restore --file=/dev/null \
  < "$backup_run/database.dump.partial" >/dev/null 2>&1; then
  printf '%s\n' 'Archive validation failed; no completed archive published.' >&2
  exit 1
fi

mv -- "$backup_run/database.dump.partial" "$backup_run/database.dump"
backup_complete=true
printf 'Archive created and decoded: %s/database.dump\n' "$backup_run"
```

The private directory is created with mode 700 and the archive with mode 600
from the start. A failed dump/decoding attempt removes only its own partial file.
Unique directories avoid overwriting previous backups. An abrupt host failure or
SIGKILL can leave a `.partial` file; it is not a completed backup. Successful
decoding verifies archive readability, not database recovery or application health.

Before and after execution, check the three systemd application services and
storefront, admin login, API health, and unauthenticated protected endpoint. The
expected HTTP statuses are 200, 200, 200 and 401. The current API health endpoint
does not probe database/Redis readiness, so also check container health. Stop
further work and report any regression; never automatically restart production.

## Isolated restore acceptance

Agree on a separate host or isolated disposable environment before copying data.
Keep the archive private and encrypted in transit and in off-host storage. Do not
put archives, connection strings, or diagnostic logs in GitHub or this repository.

Use PostgreSQL 17 tooling and an empty dedicated target with no production volume,
network route, credentials or published database port. Restore with exit-on-error,
no-owner and no-privileges. Never point a restore at `barat-postgres` or the live
database. Do not start the application or workers against restored data: doing so
could send notifications, retry deliveries, or contact payment/supplier systems.

Record exit status, object counts, migration history and aggregate integrity
checks only. Compare against the archived snapshot, not changing live row counts.
Do not display rows, gift-card material, tokens, OTPs or SQL diagnostics. A database
restore does not by itself prove end-to-end application recovery.

Full recovery also needs separately protected encryption keys, configuration,
roles/grants, uploaded files and a decision about Redis queue recovery. The dump
above intentionally does not include cluster roles or privilege grants. Never
copy production secrets into an ordinary developer machine as part of a rehearsal.

## Missing initial migration

The five committed migration files match their stored production checksums.
Production also records `20260831023802_init`, whose SQL file is absent from the
available repository history. The foundation commit contains only a migrations
placeholder, not that initial SQL file. A schema dump is not the original migration
and cannot prove the historical checksum.

Search the original deployment/developer archive for the exact SQL and verify its
SHA-256 against the stored checksum without editing production history. If it
cannot be recovered, Foundation must design and test a baseline reconciliation on
an isolated restored database and an empty database. Do not change
`_prisma_migrations`, run `migrate resolve`, reset, seed, or apply new production
migrations to conceal the discrepancy. Schema ownership remains frozen under
`AGENTS.md`.

## Decisions still required

- Provider backup/snapshot status and evidence of successful recovery.
- Approved off-host destination, access policy and separate encryption-key custody.
- Recovery point/time objectives, schedule, retention and failure notification.
- Isolated restore location and retention/deletion of its sensitive data.

Do not enable automated retention until an off-host copy and restore rehearsal have
been verified. Merging this document enables no schedule and performs no backup.
