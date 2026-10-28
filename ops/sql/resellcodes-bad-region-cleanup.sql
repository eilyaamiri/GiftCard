-- Clears ReSellCodes SKUs whose `region` is not a region, so the import can
-- write them again with one that is.
--
-- Why: the venue's `region` field also holds currency codes ("USD", "BRL") and
-- a product's own word ("ROBUX", "CONQUEROR", "MINECOINS"), and the first
-- imports stored whatever letters they found. `Sku.region` is served as 2–8
-- characters, so "CONQUEROR" made the admin catalog and the offers list fail to
-- load. The import now accepts only a country code, GLOBAL or CIS; anything else
-- becomes GLOBAL and holds the product for review (`needsReview`), because a
-- gift card that names no region may still be locked to one.
--
-- What it does, on ReSellCodes rows that were never switched on (`rsc_s_`
-- prefix, inactive) and whose region is not `^(AA|GLOBAL|CIS)$`:
--   1. marks their products `needsReview`, which the re-run will not do for a
--      product that already exists, and
--   2. deletes those SKUs (their offers go with them, by cascade).
-- A SKU something else points at (an order, a quote) is refused by its foreign
-- key and the whole script fails with nothing changed.
--
-- Dry run, which changes nothing — it ends in ROLLBACK:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/resellcodes-bad-region-cleanup.sql
--
-- For real, after reading the counts:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat -v commit=1 < ops/sql/resellcodes-bad-region-cleanup.sql
--
-- Then re-run the import (`import-resellcodes-catalog.ts --fetch`).

BEGIN;

\echo ''
\echo '== Regions that are not a region, with the number of SKUs'
SELECT region, count(*) AS skus
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$'
GROUP BY region
ORDER BY skus DESC;

\echo ''
\echo '== Of those, switched on (kept; expected 0)'
SELECT count(*) AS active_kept
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$' AND "isActive";

UPDATE "Product" SET "needsReview" = true
WHERE id IN (
  SELECT "productId" FROM "Sku"
  WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$' AND NOT "isActive"
);

DELETE FROM "Sku"
WHERE id LIKE 'rsc\_s\_%'
  AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$'
  AND NOT "isActive";

\echo ''
\echo '== After: ReSellCodes SKUs left with a region that is not a region (expected 0)'
SELECT count(*) AS still_bad
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$';

\if :{?commit}
  \echo ''
  \echo 'COMMIT'
  COMMIT;
\else
  \echo ''
  \echo 'DRY RUN - rolled back. Add -v commit=1 to keep this.'
  ROLLBACK;
\endif
