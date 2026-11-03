-- Puts every ReSellCodes gift card under the right one of the storefront's 24
-- brands, and switches on the SKUs that are ready to be sold.
--
-- The 24 brands are the ones with cover art (`BRAND_ART` in
-- apps/web/src/lib/brand-art.ts): the slug here is the Brand slug and the file
-- name of the art. A product is matched when the venue's brand or title STARTS with the
-- brand's name (so "Halo Infinite (Xbox)" and "Delta Force Coins (Steam)", which
-- are game currency, are not taken for Xbox or Steam). A product that matches two
-- brands is listed and left alone; one that matches none keeps whatever brand
-- it has. Only ReSellCodes rows (`rsc_` ids) are read or changed.
--
-- What it does, in one transaction:
--   1. creates the Brand rows that are missing (id `brnd_<slug>`, Persian name);
--   2. sets `brandId` and the free-text `brand` of each matched product to that
--      brand, so a re-import does not put it back;
--   3. switches on a matched product's SKU when it is still off, its region is a
--      real one (country code, GLOBAL or CIS) and it has an active offer.
--      A SKU with a region the venue wrote as a word is left off: those
--      products are held for a person to pick the region.
--   4. switches on a matched product that is still off and has at least one
--      active SKU (counting the ones step 3 just switched on), so it is listed
--      on the storefront under its brand.
-- It does NOT switch on the Supplier or the ReSellCodes integration, and does
-- not clear `needsReview`: a product with that flag is listed but cannot be
-- bought, and nothing is orderable while the `resellcodes` supplier is off.
-- Both are separate decisions. Pictures are a separate step
-- (ops/fix-resellcodes-images.sh), which reads the brands this one sets.
--
-- Dry run, which changes nothing — it ends in ROLLBACK:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/resellcodes-brands-and-skus.sql
--
-- For real, after reading the output:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat -v commit=1 < ops/sql/resellcodes-brands-and-skus.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE brand_rule (slug text PRIMARY KEY, name text NOT NULL, name_fa text NOT NULL, pattern text NOT NULL) ON COMMIT DROP;

INSERT INTO brand_rule (slug, name, name_fa, pattern) VALUES
  ('airbnb',      'Airbnb',      'ایربی‌انبی',   '^airbnb'),
  ('amazon',      'Amazon',      'آمازون',        '^amazon'),
  ('apple',       'Apple',       'اپل',           '^(app store|apple|itunes)'),
  ('blizzard',    'Blizzard',    'بلیزارد',       '^(battle\.net|blizzard)'),
  ('fortnite',    'Fortnite',    'فورتنایت',      '^fortnite'),
  ('free-fire',   'Free Fire',   'فری فایر',      '^(garena )?free ?fire'),
  ('google-play', 'Google Play', 'گوگل پلی',      '^google play'),
  ('hotels-com',  'Hotels.com',  'هتلز دات کام',  '^hotels'),
  ('jawaker',     'Jawaker',     'جواکر',         '^jawaker'),
  ('netflix',     'Netflix',     'نتفلیکس',       '^netflix'),
  ('nike',        'Nike',        'نایکی',         '^nike'),
  ('nintendo',    'Nintendo',    'نینتندو',       '^nintendo'),
  ('playstation', 'PlayStation', 'پلی‌استیشن',    '^(playstation|psn)'),
  ('pubg',        'PUBG',        'پابجی',         '^pubg'),
  ('razer-gold',  'Razer Gold',  'ریزر گلد',      '^razer'),
  ('roblox',      'Roblox',      'روبلاکس',       '^roblox'),
  ('shein',       'SHEIN',       'شیین',          '^shein'),
  ('spotify',     'Spotify',     'اسپاتیفای',     '^spotify'),
  ('steam',       'Steam',       'استیم',         '^steam'),
  ('tinder',      'Tinder',      'تیندر',         '^tinder'),
  ('twitch',      'Twitch',      'توییچ',         '^twitch'),
  ('uber',        'Uber',        'اوبر',          '^uber( \(|$| gift)'),
  ('xbox',        'Xbox',        'ایکس‌باکس',     '^xbox'),
  ('zara',        'Zara',        'زارا',          '^zara');

-- Each ReSellCodes product with the brand(s) its venue brand and title read as.
CREATE TEMP TABLE hit ON COMMIT DROP AS
SELECT p.id AS product_id, r.slug
FROM "Product" p
JOIN brand_rule r ON p.title ~* r.pattern OR p.brand ~* r.pattern
WHERE p.id LIKE 'rsc\_p\_%';

CREATE TEMP TABLE ambiguous ON COMMIT DROP AS
SELECT product_id FROM hit GROUP BY product_id HAVING count(*) > 1;

CREATE TEMP TABLE picked ON COMMIT DROP AS
SELECT h.product_id, h.slug FROM hit h WHERE h.product_id NOT IN (SELECT product_id FROM ambiguous);

\echo ''
\echo '== ReSellCodes products in the catalog'
SELECT count(*) AS products,
       count(*) FILTER (WHERE "isActive") AS product_active,
       count(*) FILTER (WHERE "needsReview") AS needs_review
FROM "Product" WHERE id LIKE 'rsc\_p\_%';

\echo ''
\echo '== Matched, by brand: how many products, and what the venue called them'
SELECT k.slug, count(*) AS products, string_agg(DISTINCT p.brand, ' | ' ORDER BY p.brand) AS venue_brand_text
FROM picked k JOIN "Product" p ON p.id = k.product_id
GROUP BY k.slug ORDER BY products DESC;

\echo ''
\echo '== Matched two brands, so left alone (id, venue brand, title)'
SELECT p.id, p.brand, p.title FROM "Product" p WHERE p.id IN (SELECT product_id FROM ambiguous) ORDER BY p.title;

\echo ''
\echo '== Not matched to any of the 24, so unchanged: venue brand, products (for a look)'
SELECT p.brand, count(*) AS products
FROM "Product" p
WHERE p.id LIKE 'rsc\_p\_%' AND p.id NOT IN (SELECT product_id FROM hit)
GROUP BY p.brand ORDER BY products DESC, p.brand;

-- 1. Missing brands.
INSERT INTO "Brand" (id, slug, name, "nameFa", "isActive", "isPopular", "sortOrder", "createdAt", "updatedAt")
SELECT 'brnd_' || r.slug, r.slug, r.name, r.name_fa, true, false, 0, now(), now()
FROM brand_rule r
WHERE r.slug IN (SELECT slug FROM picked)
  AND NOT EXISTS (SELECT 1 FROM "Brand" b WHERE b.slug = r.slug);

\echo ''
\echo '== Brands that exist but are switched off (the storefront will not list them)'
SELECT b.slug, b."isActive" FROM "Brand" b WHERE b.slug IN (SELECT slug FROM picked) AND NOT b."isActive";

-- 2. The brand of each matched product.
WITH changed AS (
  UPDATE "Product" p
  SET "brandId" = b.id, brand = b.name, "updatedAt" = now()
  FROM picked k JOIN "Brand" b ON b.slug = k.slug
  WHERE p.id = k.product_id
    AND (p."brandId" IS DISTINCT FROM b.id OR p.brand IS DISTINCT FROM b.name)
  RETURNING p.id
)
SELECT count(*) AS products_whose_brand_changed FROM changed;

-- 3. SKUs.
\echo ''
\echo '== SKUs of matched products that stay off, and why'
SELECT
  count(*) FILTER (WHERE s.region !~ '^([A-Z]{2}|GLOBAL|CIS)$') AS region_not_a_real_one,
  count(*) FILTER (WHERE s.region ~ '^([A-Z]{2}|GLOBAL|CIS)$'
                   AND NOT EXISTS (SELECT 1 FROM "SupplierOffer" o WHERE o."skuId" = s.id AND o."isActive")) AS no_active_offer
FROM "Sku" s
WHERE s.id LIKE 'rsc\_s\_%' AND NOT s."isActive" AND s."productId" IN (SELECT product_id FROM picked);

WITH switched AS (
  UPDATE "Sku" s
  SET "isActive" = true, "updatedAt" = now()
  WHERE s.id LIKE 'rsc\_s\_%'
    AND NOT s."isActive"
    AND s."productId" IN (SELECT product_id FROM picked)
    AND s.region ~ '^([A-Z]{2}|GLOBAL|CIS)$'
    AND EXISTS (SELECT 1 FROM "SupplierOffer" o WHERE o."skuId" = s.id AND o."isActive")
  RETURNING s.id
)
SELECT count(*) AS skus_switched_on FROM switched;

-- 4. Products.
\echo ''
\echo '== Matched products that stay off: no active SKU'
SELECT count(*) AS no_active_sku
FROM "Product" p
WHERE p.id IN (SELECT product_id FROM picked)
  AND NOT p."isActive"
  AND NOT EXISTS (SELECT 1 FROM "Sku" s WHERE s."productId" = p.id AND s."isActive");

WITH switched AS (
  UPDATE "Product" p
  SET "isActive" = true, "updatedAt" = now()
  WHERE p.id IN (SELECT product_id FROM picked)
    AND NOT p."isActive"
    AND EXISTS (SELECT 1 FROM "Sku" s WHERE s."productId" = p.id AND s."isActive")
  RETURNING p.id, p."needsReview"
)
SELECT count(*) AS products_switched_on,
       count(*) FILTER (WHERE "needsReview") AS of_which_still_needs_review
FROM switched;

\echo ''
\echo '== After: matched products whose brand is not the one matched (expected 0)'
SELECT count(*) AS mismatched
FROM picked k JOIN "Product" p ON p.id = k.product_id JOIN "Brand" b ON b.slug = k.slug
WHERE p."brandId" IS DISTINCT FROM b.id;

\echo ''
\echo '== State the SKUs depend on (a SKU sells only when all three are on)'
SELECT s.code AS supplier, s."isActive" AS supplier_active FROM "Supplier" s WHERE s.code LIKE 'resellcodes%';

\if :{?commit}
  \echo ''
  \echo 'COMMIT'
  COMMIT;
\else
  \echo ''
  \echo 'DRY RUN - rolled back. Add -v commit=1 to keep this.'
  ROLLBACK;
\endif
