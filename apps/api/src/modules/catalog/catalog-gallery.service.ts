/* eslint-disable @typescript-eslint/consistent-type-imports -- AppConfigService is
 * constructor-injected; emitDecoratorMetadata needs the runtime class value. */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import {
  IMAGE_FILE_NAME_PATTERN,
  IMAGE_VARIANTS,
  imagePath,
  writeImage,
  type ImageFile,
} from './catalog-images';
import type { AdminGalleryListInput } from './catalog.schemas';
import { CATALOG_DATABASE, type CatalogDatabase } from './catalog.tokens';

/** Who a file in the image directory belongs to, read off its key. */
export type GallerySource = 'PRODUCT' | 'BRAND' | 'TOPUP' | 'GALLERY';

export interface GalleryItem {
  /** `<key>.<ext>`, the file's identity everywhere in the gallery. */
  readonly name: string;
  readonly source: GallerySource;
  /** The product, brand or game the file belongs to; null for a gallery upload. */
  readonly ownerId: string | null;
  /** The owner's Persian name, when it still exists. */
  readonly label: string | null;
  readonly sizeBytes: number;
  readonly updatedAt: Date;
  /** Admin-authenticated route that serves the bytes. */
  readonly url: string;
  /** Only an image uploaded to the gallery itself may be removed. */
  readonly canDelete: boolean;
}

interface FileEntry {
  readonly name: string;
  readonly source: GallerySource;
  readonly ownerId: string | null;
  readonly sizeBytes: number;
  readonly updatedAt: Date;
}

/** Keys the other uploads use, so the gallery can tell whose a file is. */
const BRAND_PREFIX = 'brand-';
const TOPUP_PREFIX = 'topup-';
const GALLERY_PREFIX = 'gallery-';

function classify(name: string): Pick<FileEntry, 'source' | 'ownerId'> {
  const key = name.slice(0, name.lastIndexOf('.'));
  if (key.startsWith(GALLERY_PREFIX)) return { source: 'GALLERY', ownerId: null };
  if (key.startsWith(BRAND_PREFIX)) return { source: 'BRAND', ownerId: key.slice(BRAND_PREFIX.length) };
  if (key.startsWith(TOPUP_PREFIX)) return { source: 'TOPUP', ownerId: key.slice(TOPUP_PREFIX.length) };
  return { source: 'PRODUCT', ownerId: key };
}

/**
 * A readable stem from the uploader's file name, so a gallery file is findable
 * by what it was called. ASCII only (it becomes part of a path); a Persian name
 * leaves nothing, and the random suffix keeps the key unique either way.
 */
function nameStem(original: string | undefined): string {
  const stem = (original ?? '')
    .replace(/\.[^.]*$/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)
    .replace(/-+$/u, '');
  return stem === '' ? 'image' : stem;
}

function itemUrl(name: string): string {
  return `/api/admin/catalog/gallery/files/${name}`;
}

function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/**
 * The image gallery.
 *
 * There is no table behind it: every upload in the catalog already lands as one
 * file in `PRODUCT_IMAGE_DIR`, so the gallery is a view of that directory,
 * which makes every image uploaded so far available without a migration. Files
 * the gallery adds itself are `gallery-*`, and are the only ones it will delete:
 * a product's, brand's or game's own file is what its page is serving.
 *
 * Choosing an image for a product copies it under the product's own key, the
 * same place a direct upload goes. The product then never shares a file with
 * anything else, so replacing or deleting a gallery image cannot change a
 * product that once used it.
 */
@Injectable()
export class CatalogGalleryService {
  constructor(
    @Inject(CATALOG_DATABASE) private readonly db: CatalogDatabase,
    private readonly config: AppConfigService,
  ) {}

  async list(query: AdminGalleryListInput) {
    let entries = await this.scan();
    if (query.source !== 'ALL') entries = entries.filter((entry) => entry.source === query.source);
    // Newest first: what an operator wants is the thing they just uploaded.
    entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.name.localeCompare(b.name));

    const term = query.search?.toLowerCase();
    let matched = entries;
    let labels: ReadonlyMap<string, string> | null = null;
    if (term) {
      // A search has to see the owner's name as well as the file name, and a
      // game's file is called `topup-<id>`, which nobody types.
      labels = await this.labelsFor(entries);
      matched = entries.filter((entry) =>
        `${entry.name} ${labels?.get(entry.name) ?? ''}`.toLowerCase().includes(term),
      );
    }

    const start = (query.page - 1) * query.pageSize;
    const page = matched.slice(start, start + query.pageSize);
    const pageLabels = labels ?? (await this.labelsFor(page));

    return {
      items: page.map((entry): GalleryItem => ({
        ...entry,
        label: pageLabels.get(entry.name) ?? null,
        url: itemUrl(entry.name),
        canDelete: entry.source === 'GALLERY',
      })),
      meta: pageMeta(query.page, query.pageSize, matched.length),
    };
  }

  /** Adds an image to the gallery on its own, not attached to anything yet. */
  async upload(file: ImageFile & { readonly originalname?: string }): Promise<GalleryItem> {
    const key = `${GALLERY_PREFIX}${nameStem(file.originalname)}-${randomBytes(4).toString('hex')}`;
    // Validated by the bytes, not the claimed type: see `imageExtension`.
    await writeImage(this.config.productImageDir, key, file);

    const entry = (await this.scan()).find((candidate) => candidate.name.startsWith(`${key}.`));
    if (!entry) throw DomainErrors.notFound('gallery image');
    return { ...entry, label: null, url: itemUrl(entry.name), canDelete: true };
  }

  /** The bytes behind one gallery entry, for the admin's own previews. */
  async read(name: string): Promise<{ buffer: Buffer; contentType: string }> {
    const extension = this.assertName(name);
    const contentType = IMAGE_VARIANTS.find((variant) => variant.extension === extension)?.contentType;
    try {
      const buffer = await fs.readFile(this.pathOf(name));
      return { buffer, contentType: contentType ?? 'application/octet-stream' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw DomainErrors.notFound('gallery image');
      throw error;
    }
  }

  async remove(name: string): Promise<{ removed: true }> {
    this.assertName(name);
    if (classify(name).source !== 'GALLERY') {
      // Anything else is a live product, brand or game image: removing it would
      // leave that page pointing at a file that is gone.
      throw DomainErrors.conflict(
        'فقط تصاویری که مستقیم به گالری بارگذاری شده‌اند قابل حذف هستند.',
        'gallery delete refused: file belongs to a catalog item',
      );
    }
    try {
      await fs.rm(this.pathOf(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw DomainErrors.notFound('gallery image');
      throw error;
    }
    return { removed: true };
  }

  /** Gives a product the image of a gallery entry, as its own copy. */
  async useForProduct(productId: string, name: string) {
    const count = await this.db.product.count({ where: { id: productId } });
    if (count === 0) throw DomainErrors.notFound('product');

    const image = await this.read(name);
    await writeImage(this.config.productImageDir, productId, {
      mimetype: image.contentType,
      buffer: image.buffer,
    });
    return this.db.product.update({
      where: { id: productId },
      data: { imageUrl: `/api/catalog/products/${productId}/image` },
    });
  }

  /* ----------------------------------------------------------------- internals */

  private assertName(name: string): string {
    const extension = IMAGE_FILE_NAME_PATTERN.test(name) ? name.slice(name.lastIndexOf('.') + 1) : null;
    if (extension === null) throw DomainErrors.notFound('gallery image');
    return extension;
  }

  private pathOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return imagePath(this.config.productImageDir, name.slice(0, dot), name.slice(dot + 1));
  }

  /** Every image file in the directory; anything else in there is ignored. */
  private async scan(): Promise<FileEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.config.productImageDir);
    } catch (error) {
      // No upload has ever happened on this host: an empty gallery, not an error.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const found = await Promise.all(
      names
        .filter((name) => IMAGE_FILE_NAME_PATTERN.test(name))
        .map(async (name): Promise<FileEntry | null> => {
          try {
            const stats = await fs.stat(this.pathOf(name));
            if (!stats.isFile()) return null;
            return { name, ...classify(name), sizeBytes: stats.size, updatedAt: stats.mtime };
          } catch (error) {
            // Removed between the listing and the stat.
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
        }),
    );
    return found.filter((entry): entry is FileEntry => entry !== null);
  }

  /** Persian names of the owners behind these files, keyed by file name. */
  private async labelsFor(entries: readonly FileEntry[]): Promise<ReadonlyMap<string, string>> {
    const idsOf = (source: GallerySource): string[] => [
      ...new Set(entries.filter((entry) => entry.source === source).map((entry) => entry.ownerId ?? '')),
    ];
    const productIds = idsOf('PRODUCT');
    const brandIds = idsOf('BRAND');
    const gameIds = idsOf('TOPUP');

    const [products, brands, games] = await Promise.all([
      productIds.length === 0
        ? []
        : this.db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, titleFa: true } }),
      brandIds.length === 0
        ? []
        : this.db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, nameFa: true } }),
      gameIds.length === 0
        ? []
        : this.db.topUpGame.findMany({
            where: { id: { in: gameIds } },
            select: { id: true, name: true, nameFa: true },
          }),
    ]);

    const owners = new Map<string, string>();
    for (const product of products) owners.set(`PRODUCT:${product.id}`, product.titleFa);
    for (const brand of brands) owners.set(`BRAND:${brand.id}`, brand.nameFa);
    for (const game of games) owners.set(`TOPUP:${game.id}`, game.nameFa ?? game.name);

    const labels = new Map<string, string>();
    for (const entry of entries) {
      const owner = owners.get(`${entry.source}:${entry.ownerId}`);
      if (owner !== undefined) labels.set(entry.name, owner);
    }
    return labels;
  }
}
