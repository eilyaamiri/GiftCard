#!/usr/bin/env bash
# One-off, safe to re-run: puts a copy of the storefront's brand cover art
# (apps/web/public/brand-art/*.webp) into the admin image gallery.
#
# The gallery is the contents of PRODUCT_IMAGE_DIR, and the cover art is not in
# it: it ships inside the web app, so nothing uploaded from the panel ever
# touched it. Each file becomes `gallery-<slug>-<8 hex>.webp`, which is how the
# gallery names its own uploads, so it lists as «گالری» and can be chosen for a
# product or deleted like any other. The 8 hex are derived from the slug, which
# is what makes a second run skip what is already there instead of adding a
# duplicate.
#
# These are copies. The storefront keeps reading its own files, so deleting one
# from the gallery changes nothing on the site.
#
#   sudo bash /opt/baratpay/app/ops/import-brand-art-to-gallery.sh
#
# Optional: SRC=<dir with the .webp files>  DEST=<image dir> (default
# /var/lib/baratpay/product-images, as in ops/README.md).
set -euo pipefail

SRC="${SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/web/public/brand-art}"
DEST="${DEST:-/var/lib/baratpay/product-images}"

[ -d "$SRC" ] || { echo "no source directory: $SRC" >&2; exit 1; }
[ -d "$DEST" ] || { echo "no image directory: $DEST (PRODUCT_IMAGE_DIR)" >&2; exit 1; }

# The API reads these files as its own user; new files take the directory's
# owner and group so the copy is readable by whoever already reads the others.
owner="$(stat -c '%u:%g' "$DEST")"

added=0
skipped=0
for file in "$SRC"/*.webp; do
  [ -e "$file" ] || { echo "no .webp files in $SRC" >&2; exit 1; }
  slug="$(basename "$file" .webp)"
  hash="$(printf '%s' "$slug" | sha256sum | cut -c1-8)"
  target="$DEST/gallery-$slug-$hash.webp"
  if [ -e "$target" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  install -m 0640 -o "${owner%%:*}" -g "${owner##*:}" "$file" "$target"
  added=$((added + 1))
done

echo "added $added, already present $skipped (in $DEST)"
