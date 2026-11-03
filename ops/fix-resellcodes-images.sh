#!/usr/bin/env bash
# Gives each ReSellCodes gift card the gallery picture of its brand.
#
# Run it AFTER ops/sql/resellcodes-brands-and-skus.sql, which sets the brands:
# this reads them. A product gets the gallery copy of its brand's cover art
# (`gallery-<slug>-<8 hex>.webp`, put there by import-brand-art-to-gallery.sh)
# as its own picture — the same thing "choose from the gallery" does in the
# panel: a copy stored as `<productId>.webp`, and `imageUrl` pointing at it.
#
# Only ReSellCodes products (`rsc_p_` ids) whose brand is one of the brands that
# have cover art are touched. A product that already has a picture chosen or
# uploaded in the panel (`/api/catalog/products/...`) is skipped, so a second
# run changes nothing and a hand-picked image is never replaced. The venue's own
# image links, which are what these products have now, are replaced.
#
# Dry run, which changes nothing:
#
#   sudo bash /opt/baratpay/app/ops/fix-resellcodes-images.sh
#
# For real:
#
#   sudo bash /opt/baratpay/app/ops/fix-resellcodes-images.sh --commit
#
# Optional: SRC=<dir of the brand-art .webp files, whose names are the brand
# slugs>  DEST=<image dir> (default /var/lib/baratpay/product-images).
set -euo pipefail

COMMIT=0
[ "${1:-}" = "--commit" ] && COMMIT=1

SRC="${SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/web/public/brand-art}"
DEST="${DEST:-/var/lib/baratpay/product-images}"
PSQL=(docker exec -i barat-postgres psql -U barat -d barat -v ON_ERROR_STOP=1 -At)

[ -d "$SRC" ] || { echo "no brand-art directory: $SRC" >&2; exit 1; }
[ -d "$DEST" ] || { echo "no image directory: $DEST (PRODUCT_IMAGE_DIR)" >&2; exit 1; }

slugs=()
for file in "$SRC"/*.webp; do
  [ -e "$file" ] || { echo "no .webp files in $SRC" >&2; exit 1; }
  slugs+=("$(basename "$file" .webp)")
done
in_list="$(printf "'%s'," "${slugs[@]}")"
in_list="${in_list%,}"

rows="$("${PSQL[@]}" -F ' ' -c "
  SELECT p.id, b.slug
  FROM \"Product\" p JOIN \"Brand\" b ON b.id = p.\"brandId\"
  WHERE p.id LIKE 'rsc\\_p\\_%'
    AND b.slug IN ($in_list)
    AND (p.\"imageUrl\" IS NULL OR p.\"imageUrl\" NOT LIKE '/api/catalog/products/%')
  ORDER BY b.slug, p.id")"

if [ -z "$rows" ]; then
  echo "nothing to do: no ReSellCodes product with one of these brands lacks a chosen picture"
  exit 0
fi

# Check every source file before writing anything.
missing=0
while read -r slug; do
  hash="$(printf '%s' "$slug" | sha256sum | cut -c1-8)"
  [ -e "$DEST/gallery-$slug-$hash.webp" ] || { echo "not in the gallery: gallery-$slug-$hash.webp (brand $slug)" >&2; missing=1; }
done < <(printf '%s\n' "$rows" | cut -d' ' -f2 | sort -u)
[ "$missing" = 0 ] || { echo "run ops/import-brand-art-to-gallery.sh first; nothing was changed" >&2; exit 1; }

echo "== Products that would get their brand's gallery picture, by brand"
printf '%s\n' "$rows" | cut -d' ' -f2 | sort | uniq -c | sort -rn
echo "total: $(printf '%s\n' "$rows" | wc -l | tr -d ' ')"

if [ "$COMMIT" != 1 ]; then
  echo "DRY RUN - nothing written. Add --commit to apply."
  exit 0
fi

owner="$(stat -c '%u:%g' "$DEST")"
done_ids=()
while read -r id slug; do
  [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "skipping unexpected id: $id" >&2; continue; }
  hash="$(printf '%s' "$slug" | sha256sum | cut -c1-8)"
  install -m 0640 -o "${owner%%:*}" -g "${owner##*:}" "$DEST/gallery-$slug-$hash.webp" "$DEST/$id.webp"
  rm -f "$DEST/$id.jpg" "$DEST/$id.png" "$DEST/$id.gif"
  done_ids+=("$id")
done <<< "$rows"

id_list="$(printf "'%s'," "${done_ids[@]}")"
id_list="${id_list%,}"
updated="$("${PSQL[@]}" -c "
  WITH u AS (
    UPDATE \"Product\"
    SET \"imageUrl\" = '/api/catalog/products/' || id || '/image', \"updatedAt\" = now()
    WHERE id IN ($id_list)
    RETURNING id)
  SELECT count(*) FROM u")"
echo "pictures copied: ${#done_ids[@]}, products updated: $updated"
