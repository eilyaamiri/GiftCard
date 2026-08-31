# Server operations

The deployment at `130.185.72.83`. These files are the source of truth; the
copies on the server are installed from here.

| file | installed to |
|---|---|
| `deploy.sh` | `/opt/baratpay/deploy.sh` |
| `nginx-baratpay.conf` | `/etc/nginx/sites-available/baratpay` |

Secrets are **not** here. They live in `/opt/baratpay/secrets/.env.{api,web,admin}`
on the server, mode 600, and are never committed.

## Public addresses

- storefront — `https://130-185-72-83.nip.io`
- admin panel — `https://admin.130-185-72-83.nip.io`

`nip.io` resolves any `<dashed-ip>.nip.io` name to that IP, which is what makes a
real Let's Encrypt certificate possible without owning a domain. Replace both
names with the real domain once there is one; nothing else in the config depends
on them.

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

## Notes

- The box has 1.9 GiB of RAM and 2 vCPU. The two Next builds are run one after
  the other on purpose; together they OOM.
- `next build --output standalone` does not copy `.next/static` or `public/`
  into the standalone bundle. `deploy.sh` stages them explicitly. Without that
  step the server boots cleanly and 404s every asset.
- The certificate covers both names and renews itself through certbot's timer.
  Port 80 must stay reachable for the renewal challenge.

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
