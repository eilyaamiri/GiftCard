import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DomainErrors } from '../../common/errors/domain.exception';

/**
 * Raster images the catalog accepts, and how they are kept on disk.
 *
 * Everything lives as `<key>.<ext>` in one directory (`PRODUCT_IMAGE_DIR`), with
 * no table behind it: the key is the owner's id (a product), `brand-<id>`,
 * `topup-<id>`, or `gallery-<random>` for an image uploaded to the gallery on
 * its own. SVG is deliberately absent — served inline it is executable content,
 * and an image upload must never become an XSS primitive.
 */
export const IMAGE_VARIANTS = [
  { extension: 'jpg', contentType: 'image/jpeg' },
  { extension: 'png', contentType: 'image/png' },
  { extension: 'webp', contentType: 'image/webp' },
  { extension: 'gif', contentType: 'image/gif' },
] as const;

export type ImageExtension = (typeof IMAGE_VARIANTS)[number]['extension'];

/**
 * A stored file's name: `<key>.<ext>`. The only shape the gallery will ever
 * turn into a path, so a name taken from a URL cannot reach outside the image
 * directory.
 */
export const IMAGE_FILE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,120}\.(?:jpg|png|webp|gif)$/u;

export interface ImageFile {
  readonly mimetype: string;
  readonly buffer: Buffer;
}

export function imagePath(root: string, key: string, extension: string): string {
  return path.join(root, `${key}.${extension}`);
}

/** The extension for a file whose bytes really are the type it claims, else null. */
export function imageExtension(file: ImageFile): ImageExtension | null {
  const signatures: Record<string, readonly number[]> = {
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/gif': [0x47, 0x49, 0x46, 0x38],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
  };
  const signature = signatures[file.mimetype];
  if (!signature || signature.some((byte, index) => file.buffer[index] !== byte)) return null;
  if (file.mimetype === 'image/webp' && file.buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  return IMAGE_VARIANTS.find((variant) => variant.contentType === file.mimetype)?.extension ?? null;
}

/**
 * Writes one variant and removes the others, so a re-upload cannot leave the
 * previous format behind for a reader that tries the extensions in order.
 */
export async function writeImage(root: string, key: string, file: ImageFile): Promise<void> {
  const extension = imageExtension(file);
  if (!extension) {
    throw DomainErrors.validation([
      { path: 'file', message: 'تصویر باید یک فایل معتبر JPG، PNG، WebP یا GIF باشد.' },
    ]);
  }

  await fs.mkdir(root, { recursive: true });
  await Promise.all(
    IMAGE_VARIANTS.filter((variant) => variant.extension !== extension).map((variant) =>
      fs.rm(imagePath(root, key, variant.extension), { force: true }),
    ),
  );
  await fs.writeFile(imagePath(root, key, extension), file.buffer, { mode: 0o640 });
}
