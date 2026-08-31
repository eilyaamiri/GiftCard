#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)

[[ -f .env.production ]] || { printf '%s\n' 'Missing .env.production; copy the template in deploy/README.md and fill secrets.' >&2; exit 1; }

printf '%s\n' 'Pulling base images (if available)...'
"${COMPOSE[@]}" pull --ignore-buildable
printf '%s\n' 'Building services with one concurrent build to protect RAM...'
"${COMPOSE[@]}" build --parallel 1

printf '%s\n' 'Starting database and Redis...'
"${COMPOSE[@]}" up -d postgres redis
"${COMPOSE[@]}" up -d api
printf '%s\n' 'Applying Prisma migrations...'
# The API image carries the pinned Prisma CLI solely for this migration step.
# Running it through compose keeps it on the private database network.
"${COMPOSE[@]}" run --rm --no-deps api \
  node_modules/.bin/prisma migrate deploy \
  --schema node_modules/@barat/database/prisma/schema.prisma

printf '%s\n' 'Starting/restarting application services...'
"${COMPOSE[@]}" up -d --remove-orphans worker web admin nginx
printf '%s\n' 'Deployment complete. Current service status:'
"${COMPOSE[@]}" ps
