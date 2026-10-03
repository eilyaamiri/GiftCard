# Legacy redirects (CENTO rebrand)

The registry is `apps/web/src/lib/legacy-redirects.ts`; `apps/web/next.config.ts`
serves it verbatim. This page only explains it.

| Old URL | New URL | Status | Why |
|---|---|---|---|
| `/barat-card` | `/cento-card` | 308 | Route renamed with the brand |
| `/help/:category/what-is-barat` | `/help/:category/what-is-cento` | 308 | KB slug renamed by migration `20261003120000_cento_rebrand_kb` |

Rules, enforced by `legacy-redirects.test.ts`:

- Every entry is permanent and lands on its final URL in one hop — no entry's
  destination is another entry's source.
- No destination contains the old name.
- Internal links never point at a source; they use the new URL directly.

The KB redirect assumes the migration has run. `deploy/deploy.sh` applies
migrations before the web container starts, so production gets both together.

Adding an entry: append to the array, run `pnpm --filter @barat/web test`, and add
a row here.
