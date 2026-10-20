# Server operations

The deployment at `185.236.37.201` (Ubuntu 24.04, 2 vCPU, 1.9 GiB RAM plus a 3 GiB
swapfile). These files are the source of truth; the copies on the server are
installed from here.

The previous host, `130.185.72.83`, moved here on 2026-10-13. It is switched off
for the application, not deleted: its three `barat-*` units are stopped and
disabled, its nginx only redirects the old `nip.io` names to the new domain, and
its PostgreSQL and Redis containers and `/opt/baratpay` are untouched.

| file | installed to |
|---|---|
| `deploy.sh` | `/opt/baratpay/deploy.sh` |
| `ci-deploy.sh` | `/opt/baratpay/ci-deploy.sh` (mode 700) |
| `nginx-baratpay.conf` | `/etc/nginx/sites-available/baratpay` |

Secrets are **not** here. They live in `/opt/baratpay/secrets/.env.{api,web,admin}`
on the server, mode 600, and are never committed.

## Public addresses

- storefront — `https://www.centohub.com` (`https://centohub.com` redirects to it)
- admin panel — `https://myspace.centohub.com`

DNS for `centohub.com` is served by the registrar's nameservers
(`ns1-3.pegahtech.ir`): one A record each for `@`, `www` and `myspace`, all
pointing at the server. One Let's Encrypt certificate covers the three names and
renews itself through certbot's timer using the webroot authenticator.

## Why HTTPS is not optional here

Two independent failures made the panels unusable over cleartext, and both are
fixed by TLS:

1. A transparent middlebox on the path rewrites any cleartext request whose URL
   contains `/chunks/` into a `302` towards a private address. Every JS and CSS
   bundle Next emits lives under that path, so the pages arrived as unstyled
   HTML. The server was answering `200` the whole time — the response never
   reached the browser. TLS cannot be inspected that way, so the rewrite stops.

2. Session cookies carry `Secure`, which a browser honours by refusing to
   *store* the cookie at all over plain HTTP. Login returned `201` and the
   cookie was discarded before it was ever kept, which is indistinguishable from
   a wrong password. The API now derives `Secure` from the scheme of the public
   URL, so an https origin gets it and the flag is never the thing that breaks a
   login.

## Releasing

A release is a person pressing a button, never a push. Run the **Deploy**
workflow (`.github/workflows/deploy.yml`) from the Actions tab on `main`; it
runs the full CI suite first, then waits for someone to approve the `production`
environment before it touches the server. Both gates are deliberate: production
release is one of the changes that requires human review.

What runs where:

1. `deploy.yml` calls `ci.yml` through `workflow_call`, so no revision can ship
   without lint, typecheck, tests and both Next builds passing on that commit.
2. After approval the runner opens one SSH connection with a key that exists
   only for this. Server-side that key is pinned to `ci-deploy.sh`, so it cannot
   open a shell, read `/opt/baratpay/secrets/`, or forward a port — the string
   Actions sends is a label, not a command.
3. `ci-deploy.sh` fetches, checks that the SHA Actions verified is an ancestor of
   `origin/main`, checks it out, and runs a *copy* of `deploy.sh` with
   `DEPLOY_SKIP_PULL=1`. The copy matters: `deploy.sh` lives in the checkout it
   rewrites, and bash reads a script as it goes.
4. The workflow then curls the three services, including one request that must
   still answer `401`. A panel that answered `200` there would be an open back
   office, and that is worth failing a release over.

Rotating the deploy key means: new keypair on the server, replace the
`command="/opt/baratpay/ci-deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding`
line in `~/.ssh/authorized_keys`, and update the `DEPLOY_SSH_KEY` secret on the
`production` environment. `deploy.sh` still runs by hand on the box when GitHub
is unreachable.

## Notes

- The box has 1.9 GiB of RAM, 2 vCPU and a 3 GiB swapfile (`/swapfile`, in
  `/etc/fstab`). The two Next builds are run one after the other on purpose;
  together they OOM, and without the swap even one build is killed (exit 137).
- `next build --output standalone` does not copy `.next/static` or `public/`
  into the standalone bundle. `deploy.sh` stages them explicitly. Without that
  step the server boots cleanly and 404s every asset.
- The certificate covers all three names and renews itself through certbot's
  timer, using the webroot authenticator. Port 80 must stay reachable for the
  renewal challenge, and nginx must keep serving `/var/www/html` there.
- Product images live in `/var/lib/baratpay/product-images` (`PRODUCT_IMAGE_DIR`),
  outside the database and outside git. Move them with the data when the host
  changes, or every product image answers 404.

## Demo sign-in

`OTP_DEV_FIXED_CODE=123456` is set in `/opt/baratpay/secrets/.env.api`, so every
storefront login code is that value. This exists because no SMS gateway is
connected. It must be removed the moment one is — see the comment on the
variable in `apps/api/src/common/config/env.schema.ts` for what it costs. The
schema refuses to boot if it is still set once ZarinPal is enabled.

The operator queue only has claimable work because the seed leaves the
unfulfilled tail `UNASSIGNED`. Claiming consumes it, so to get the queue back:

    cd /opt/baratpay/app
    set -a; . /opt/baratpay/secrets/.env.api; set +a
    NODE_ENV=development pnpm --filter @barat/database db:seed

`NODE_ENV` is overridden because the seed refuses to run under `production` —
that guard is deliberate and stays. This database holds nothing but demo data.

## Uptime watchdog

`ops/healthcheck.sh` checks `/api/health` from outside the API process and
pages Telegram when the API is down for two checks in a row, when it restarted
outside a deploy (a crash the supervisor recovered), and once when it is back.
A process that has crashed cannot report itself; this is the part that can.

It reads `ALERT_TELEGRAM_ENABLED`, `ALERT_TELEGRAM_BOT_TOKEN` and
`ALERT_TELEGRAM_CHAT_ID` from `/opt/baratpay/secrets/.env.api` — the same values
the API uses — so set those there first. Install once, as the user that owns
`/opt/baratpay`:

    mkdir -p /opt/baratpay/state/healthcheck
    ( crontab -l 2>/dev/null; echo '* * * * * /opt/baratpay/app/ops/healthcheck.sh >/dev/null 2>&1' ) | crontab -

Try it without sending anything:

    DRY_RUN=1 /opt/baratpay/app/ops/healthcheck.sh; cat /opt/baratpay/state/healthcheck/state

A restart within 30 minutes of `HEAD` moving is treated as a deploy and does
not page (`DEPLOY_GRACE_SECONDS`). A deploy that leaves the API down still does.
`HEALTH_URL`, `FAIL_THRESHOLD` and `TIMEOUT_SECONDS` can be overridden in the
crontab line.
