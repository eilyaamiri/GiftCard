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
# DEPLOY_SKIP_PULL is for callers that have already put the checkout on the exact
# revision they want — the CI wrapper does, so it can ship the commit that passed
# verification rather than whatever origin/main happens to be a minute later.
# Those callers must also run a *copy* of this file: resetting the checkout
# rewrites the script bash is still reading line by line.
if [ -n "${DEPLOY_SKIP_PULL:-}" ]; then
  echo "    skipped, already on $(git rev-parse --short HEAD)"
else
  git fetch --all -q
  git reset --hard -q "origin/$(git rev-parse --abbrev-ref HEAD)"
fi

echo "==> install"
# Frozen: production installs exactly the lockfile CI verified (ci.yml runs
# `pnpm install --frozen-lockfile` on this same commit). With
# --no-frozen-lockfile a lockfile that no longer satisfied package.json was
# silently re-resolved on the server — under `resolution-mode=highest` — into a
# dependency tree no test had seen, with these secrets in the environment of
# every install script. A drifted lockfile now stops the deploy instead.
pnpm install --frozen-lockfile --prefer-offline

echo "==> prisma client"
pnpm --filter @barat/database db:generate

echo "==> migrate"
pnpm --filter @barat/database exec prisma migrate deploy

echo "==> build shared packages + api + worker"
pnpm --filter @barat/api... --filter @barat/worker... build

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
units="barat-api barat-web barat-admin"
# The worker joins once its unit is installed and enabled (ops/README.md,
# "Background worker"); until then a deploy leaves it alone.
if systemctl is-enabled --quiet barat-worker 2>/dev/null; then
  units="$units barat-worker"
fi
for unit in $units; do
  systemctl restart "$unit"
done
sleep 12

for unit in $units; do
  printf "%-13s %s\n" "$unit" "$(systemctl is-active "$unit")"
done
