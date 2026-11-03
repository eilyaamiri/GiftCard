-- Clears `needsReview` on the ReSellCodes products that are complete, so their
-- buy button works. Run it AFTER resellcodes-brands-and-skus.sql and
-- ops/fix-resellcodes-images.sh.
--
-- `needsReview` is the import's "a person has not looked at this": the storefront
-- lists the product and disables buying. It was set because something was a
-- guess. A product is released here only when each guess is settled:
--   - it is active and under one of the 24 storefront brands;
--   - its picture is one chosen from the gallery (`/api/catalog/products/...`);
--   - its category is a real one, not «سایر» (other);
--   - it has at least one SKU, and EVERY SKU has a real region (country code,
--     GLOBAL or CIS) and a face value that reads as an amount and a currency
--     ("25 USD"), which is what the import writes when the card's name stated
--     it. A label that is only the card's name means the face value was taken
--     from the cost, which is the guess the flag is there for.
-- Anything else keeps the flag, and the counts below say how many and why.
--
-- This is the step that makes cards purchasable. With the `resellcodes`
-- supplier on, a released product's active SKUs can be ordered by customers.
--
-- Dry run, which changes nothing — it ends in ROLLBACK:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/resellcodes-clear-review.sql
--
-- For real, after reading the counts:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat -v commit=1 < ops/sql/resellcodes-clear-review.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE review ON COMMIT DROP AS
SELECT
  p.id,
  b.slug AS brand_slug,
  p."isActive" AS active,
  COALESCE(b.slug IN ('airbnb','amazon','apple','blizzard','fortnite','free-fire','google-play','hotels-com','jawaker','netflix','nike','nintendo','playstation','pubg','razer-gold','roblox','shein','spotify','steam','tinder','twitch','uber','xbox','zara'), false) AS in_24,
  (p."imageUrl" LIKE '/api/catalog/products/%') AS gallery_image,
  (c.slug IS NOT NULL AND c.slug <> 'other') AS real_category,
  (SELECT count(*) FROM "Sku" s WHERE s."productId" = p.id) AS skus,
  (SELECT count(*) FROM "Sku" s WHERE s."productId" = p.id AND s.region !~ '^([A-Z]{2}|GLOBAL|CIS)$') AS bad_regions,
  (SELECT count(*) FROM "Sku" s WHERE s."productId" = p.id AND s."denominationLabel" !~ '^[0-9]+(\.[0-9]+)? [A-Z]{3}$') AS guessed_faces
FROM "Product" p
LEFT JOIN "Brand" b ON b.id = p."brandId"
LEFT JOIN "Category" c ON c.id = p."categoryId"
WHERE p.id LIKE 'rsc\_p\_%' AND p."needsReview";

\echo ''
\echo '== ReSellCodes products still flagged, and what is wrong with them (a product can count in several)'
SELECT
  count(*) AS flagged,
  count(*) FILTER (WHERE NOT active) AS not_active,
  count(*) FILTER (WHERE NOT in_24) AS outside_the_24_brands,
  count(*) FILTER (WHERE NOT gallery_image) AS no_gallery_picture,
  count(*) FILTER (WHERE NOT real_category) AS category_other,
  count(*) FILTER (WHERE skus = 0) AS no_sku,
  count(*) FILTER (WHERE bad_regions > 0) AS has_unreadable_region,
  count(*) FILTER (WHERE guessed_faces > 0) AS has_guessed_face_value
FROM review;

WITH released AS (
  UPDATE "Product" p
  SET "needsReview" = false, "updatedAt" = now()
  FROM review r
  WHERE p.id = r.id
    AND r.active AND r.in_24 AND r.gallery_image AND r.real_category
    AND r.skus > 0 AND r.bad_regions = 0 AND r.guessed_faces = 0
  RETURNING p.id, r.brand_slug
)
SELECT brand_slug, count(*) AS released FROM released GROUP BY ROLLUP (brand_slug) ORDER BY brand_slug NULLS LAST;

\echo ''
\echo '== After: ReSellCodes products still flagged'
SELECT count(*) AS still_flagged FROM "Product" WHERE id LIKE 'rsc\_p\_%' AND "needsReview";

\if :{?commit}
  \echo ''
  \echo 'COMMIT'
  COMMIT;
\else
  \echo ''
  \echo 'DRY RUN - rolled back. Add -v commit=1 to keep this.'
  ROLLBACK;
\endif
