#!/usr/bin/env bash
# External watchdog for the Barat Pay API. Run from cron every minute:
#
#   * * * * * /opt/baratpay/app/ops/healthcheck.sh >/dev/null 2>&1
#
# Why this lives outside the app: a process that has crashed, hung or been
# OOM-killed cannot report itself. This script runs on its own, hits
# /api/health, and talks to Telegram directly.
#
# It pages (Telegram, CRITICAL) on:
#   - the API not answering, or answering non-200, on FAIL_THRESHOLD runs in a
#     row (default 2, i.e. ~2 minutes) — sent once per outage, not every minute;
#   - a restart: uptimeSeconds went DOWN since the last run. That catches a crash
#     that the supervisor restarted before the next check could see it down.
#     A restart within DEPLOY_GRACE_SECONDS of the checkout's HEAD changing is a
#     deploy and does not page. A deploy that leaves the API DOWN still pages.
# And sends one recovery message when the API answers again after an outage.
#
# Secrets come from the same env file the API uses. The bot token is passed to
# curl on stdin, never on the command line, so it does not show in `ps`.
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin"

ENV_FILE="${ENV_FILE:-/opt/baratpay/secrets/.env.api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/health}"
STATE_DIR="${STATE_DIR:-/opt/baratpay/state/healthcheck}"
APP_DIR="${APP_DIR:-/opt/baratpay/app}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-10}"
DEPLOY_GRACE_SECONDS="${DEPLOY_GRACE_SECONDS:-1800}"
# Set to 1 to print alerts instead of sending them (testing).
DRY_RUN="${DRY_RUN:-0}"

if [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi

mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/state"

# One run at a time: a hung curl must not let cron pile runs on top of it.
# Guarded: without flock, `flock -n 9 || exit 0` would exit 0 on "command not
# found" and the watchdog would silently never run.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || exit 0
fi

# --- previous state ---------------------------------------------------------
# status (up|down), consecutive failures, last uptime, last HEAD, when HEAD changed
prev_status="up"; prev_failures=0; prev_uptime=0; prev_head="-"; head_changed_at=0
if [ -f "$STATE_FILE" ]; then
  read -r prev_status prev_failures prev_uptime prev_head head_changed_at < "$STATE_FILE" || true
fi
prev_failures="${prev_failures:-0}"; prev_uptime="${prev_uptime:-0}"
prev_head="${prev_head:--}"; head_changed_at="${head_changed_at:-0}"

# A deploy moves HEAD (git reset) minutes before it restarts the API.
now_epoch="$(date +%s)"
head="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo -)"
if [ "$head" != "$prev_head" ] && [ "$prev_head" != "-" ]; then
  head_changed_at="$now_epoch"
fi
in_deploy_window=0
if [ $((now_epoch - head_changed_at)) -lt "$DEPLOY_GRACE_SECONDS" ]; then
  in_deploy_window=1
fi

now_tehran() { TZ="Asia/Tehran" date '+%Y-%m-%d %H:%M:%S'; }

send_alert() {
  local text="$1"
  if [ "$DRY_RUN" = "1" ]; then
    printf 'ALERT: %s\n' "$text"
    return 0
  fi
  if [ "${ALERT_TELEGRAM_ENABLED:-false}" != "true" ] \
    || [ -z "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    printf 'healthcheck: Telegram not configured; alert not sent: %s\n' "$text" >&2
    return 0
  fi
  # URL (with the token) goes through stdin config, not argv.
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$ALERT_TELEGRAM_BOT_TOKEN" \
    | curl -sS -o /dev/null --max-time 15 --retry 2 -K - \
        --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=${text}" \
    || printf 'healthcheck: Telegram send failed\n' >&2
}

# --- probe ------------------------------------------------------------------
body=""; ok=0
if body="$(curl -sS --fail --max-time "$TIMEOUT_SECONDS" "$HEALTH_URL" 2>/dev/null)"; then
  ok=1
fi

uptime=0
if [ "$ok" = "1" ]; then
  uptime="$(printf '%s' "$body" | grep -o '"uptimeSeconds":[0-9]*' | grep -o '[0-9]*$' || true)"
  uptime="${uptime:-0}"
fi

# --- decide -----------------------------------------------------------------
status="$prev_status"; failures="$prev_failures"

if [ "$ok" = "1" ]; then
  if [ "$prev_status" = "down" ]; then
    send_alert "✅ [RECOVERED] Barat Pay API is answering again
Time: $(now_tehran) (Tehran)
Uptime: ${uptime}s"
  elif [ "$uptime" -lt "$prev_uptime" ] && [ "$in_deploy_window" = "0" ]; then
    send_alert "🚨 [CRITICAL] Barat Pay API restarted
Uptime fell from ${prev_uptime}s to ${uptime}s — the process crashed or was restarted.
Time: $(now_tehran) (Tehran)"
  fi
  status="up"; failures=0
else
  failures=$((prev_failures + 1))
  if [ "$prev_status" = "up" ] && [ "$failures" -ge "$FAIL_THRESHOLD" ]; then
    send_alert "🚨 [CRITICAL] Barat Pay API is DOWN
${HEALTH_URL} has not answered for ${failures} checks in a row.
Time: $(now_tehran) (Tehran)"
    status="down"
  fi
  # Keep the last known uptime while down, so the post-recovery uptime is not
  # misread as a second restart.
  uptime="$prev_uptime"
fi

printf '%s %s %s %s %s\n' "$status" "$failures" "$uptime" "$head" "$head_changed_at" > "$STATE_FILE"
