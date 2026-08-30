#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/baratpay}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)

[[ -f .env.production ]] || { printf '%s\n' 'Missing .env.production.' >&2; exit 1; }
install -d -m 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/barat-${STAMP}.dump"

# The dump is custom-format and compressed by pg_dump. Credentials are supplied
# through the container's environment, never exposed as command-line arguments.
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump --format=custom --compress=6 --no-owner --no-privileges --file=- "$POSTGRES_DB"' > "$TARGET"
chmod 600 "$TARGET"
find "$BACKUP_DIR" -type f -name 'barat-*.dump' -mtime "+$RETENTION_DAYS" -delete
printf 'Created %s (retained %s days).\n' "$TARGET" "$RETENTION_DAYS"
