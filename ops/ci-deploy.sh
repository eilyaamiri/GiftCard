#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key, installed at
# /opt/baratpay/ci-deploy.sh (mode 700). The key's authorized_keys entry pins it
# with command="...", so that key can run this file and nothing else: whatever
# the client asks for is never executed, only read.
#
# The one thing the caller may influence is *which* commit ships, and only
# within what is already on origin/main — see the ancestor check below.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"
cd /opt/baratpay/app

echo "==> requested: ${SSH_ORIGINAL_COMMAND:-<no command>} from ${SSH_CLIENT%% *}"

git fetch --all -q

# Actions sends the SHA that its verification job passed on. Ship exactly that
# revision rather than the branch tip: between "CI is green" and "a human
# approved the release" someone may have merged again, and that later commit has
# not been through this pipeline.
requested="$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | grep -oE '\b[0-9a-f]{40}\b' | head -1 || true)"
target="origin/main"
if [ -n "$requested" ]; then
  if git merge-base --is-ancestor "$requested" origin/main 2>/dev/null; then
    target="$requested"
  else
    # Anything not already merged into main is refused, so a stolen key cannot
    # push a commit and then ask this script to build it.
    echo "==> $requested is not on origin/main; refusing" >&2
    exit 1
  fi
fi

echo "==> checking out $target"
git reset --hard -q "$target"
git log --oneline -1

# deploy.sh lives inside the checkout that was just rewritten. Bash reads a
# script incrementally, so running it in place after a reset can execute a
# spliced mixture of the old and new file; run a copy taken after the reset.
runner="$(mktemp /tmp/barat-deploy.XXXXXX)"
trap 'rm -f "$runner"' EXIT
cp ops/deploy.sh "$runner"
DEPLOY_SKIP_PULL=1 bash "$runner"
