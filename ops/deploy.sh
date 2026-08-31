#!/usr/bin/env bash
# Pull, build and restart Barat Pay on this server.
# The box has 1.9G of RAM and 2 vCPU, so the two Next builds are run one after
# the other on purpose: building them together reliably OOMs.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"
cd /opt/baratpay/app

set -a; . /opt/baratpay/secrets/.env.api; set +a
export NODE_OPTIONS="--max-old-space-size=1024"

echo "==> pull"
git fetch --all -q
git reset --hard -q "origin/$(git rev-parse --abbrev-ref HEAD)"

echo "==> install"
pnpm install --no-frozen-lockfile --prefer-offline

echo "==> prisma client"
pnpm --filter @barat/database db:generate

echo "==> migrate"
pnpm --filter @barat/database exec prisma migrate deploy

echo "==> build shared packages + api"
pnpm --filter @barat/api... build

echo "==> build web (alone: memory)"
# API_PUBLIC_URL is blanked deliberately. next.config.ts bakes it into
# NEXT_PUBLIC_API_URL at build time, and a non-empty value makes the browser
# call the API on a foreign origin — which the SameSite=Strict session cookie
# will not follow. Blank means "use my own origin", and nginx mounts /api on
# each host, so the cookie stays same-origin. Server-side rendering does not go
# through nginx at all; it uses API_INTERNAL_URL from the unit's env file.
API_PUBLIC_URL= pnpm --filter @barat/web build

echo "==> build admin (alone: memory)"
API_PUBLIC_URL= pnpm --filter @barat/admin build

echo "==> stage static assets into the standalone output"
# `next build` with output:"standalone" deliberately leaves .next/static and
# public/ out of the traced bundle: the tracer only follows server-side requires,
# and Next expects a CDN or the deployer to place them. Skip this and the server
# boots fine but answers 404 for every CSS and JS chunk, so the page renders as
# unstyled HTML that looks broken rather than failing outright.
for app in web admin; do
  root="/opt/baratpay/app/apps/$app"
  dest="$root/.next/standalone/apps/$app"
  rm -rf "$dest/.next/static" "$dest/public"
  cp -r "$root/.next/static" "$dest/.next/static"
  [ -d "$root/public" ] && cp -r "$root/public" "$dest/public"
  echo "    $app: $(find "$dest/.next/static" -type f | wc -l) static files staged"
done

echo "==> restart"
systemctl restart barat-api
systemctl restart barat-web
systemctl restart barat-admin
sleep 12

for unit in barat-api barat-web barat-admin; do
  printf "%-12s %s\n" "$unit" "$(systemctl is-active $unit)"
done
