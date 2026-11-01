import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@barat/database', () => ({ Prisma: { JsonNull: null } }));

import type { AppConfigService } from '../../common/config/app-config.service';
import { CatalogGalleryService } from './catalog-gallery.service';
import { adminGalleryListSchema, updateProductSchema, updateTopUpGameSchema } from './catalog.schemas';
import type { CatalogDatabase } from './catalog.tokens';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

const LIST = { page: 1, pageSize: 40, source: 'ALL' as const };

describe('CatalogGalleryService', () => {
  let root: string;
  let productUpdate: ReturnType<typeof vi.fn>;
  let productCount: ReturnType<typeof vi.fn>;
  let service: CatalogGalleryService;

  /** Writes a file straight into the image directory, as the other uploads do. */
  async function put(name: string, bytes: Buffer = PNG, ageSeconds = 0) {
    const file = path.join(root, name);
    await fs.writeFile(file, bytes);
    const when = new Date(Date.now() - ageSeconds * 1000);
    await fs.utimes(file, when, when);
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'barat-gallery-'));
    productUpdate = vi.fn().mockResolvedValue({ id: 'p1' });
    productCount = vi.fn().mockResolvedValue(1);
    const db = {
      product: {
        count: productCount,
        update: productUpdate,
        findMany: vi.fn().mockResolvedValue([{ id: 'rlx_p_14971', titleFa: 'گیفت کارت استیم' }]),
      },
      brand: { findMany: vi.fn().mockResolvedValue([{ id: 'b1', nameFa: 'اپل' }]) },
      topUpGame: { findMany: vi.fn().mockResolvedValue([{ id: 'g1', name: 'PUBG', nameFa: null }]) },
    } as unknown as CatalogDatabase;
    service = new CatalogGalleryService(db, { productImageDir: root } as AppConfigService);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists every image already uploaded, whoever it belongs to, newest first', async () => {
    await put('rlx_p_14971.png', PNG, 300);
    await put('brand-b1.jpg', JPEG, 200);
    await put('topup-g1.webp', Buffer.from('RIFF\0\0\0\0WEBP'), 100);
    await put('gallery-banner-ab12cd34.png', PNG, 10);

    const { items, meta } = await service.list(LIST);

    expect(items.map((item) => [item.name, item.source])).toEqual([
      ['gallery-banner-ab12cd34.png', 'GALLERY'],
      ['topup-g1.webp', 'TOPUP'],
      ['brand-b1.jpg', 'BRAND'],
      ['rlx_p_14971.png', 'PRODUCT'],
    ]);
    expect(meta).toEqual({ page: 1, pageSize: 40, total: 4, totalPages: 1 });
    // Named after what they belong to, so an operator is not choosing between ids.
    expect(Object.fromEntries(items.map((item) => [item.name, item.label]))).toEqual({
      'gallery-banner-ab12cd34.png': null,
      'topup-g1.webp': 'PUBG',
      'brand-b1.jpg': 'اپل',
      'rlx_p_14971.png': 'گیفت کارت استیم',
    });
  });

  it('is empty, not an error, on a host that has never had an upload', async () => {
    await fs.rm(root, { recursive: true, force: true });

    await expect(service.list(LIST)).resolves.toMatchObject({ items: [], meta: { total: 0, totalPages: 0 } });
  });

  it('ignores anything in the directory that is not a stored image', async () => {
    await put('notes.txt', Buffer.from('x'));
    await put('..hidden.png', PNG);
    await put('vector.svg', Buffer.from('<svg/>'));
    await fs.mkdir(path.join(root, 'folder.png'));
    await put('ok.png');

    const { items } = await service.list(LIST);

    expect(items.map((item) => item.name)).toEqual(['ok.png']);
  });

  it('filters by source and pages the result', async () => {
    for (let index = 0; index < 5; index += 1) await put(`gallery-img${index}-aaaaaaaa.png`, PNG, index);
    await put('brand-b1.png');

    const onlyGallery = await service.list({ ...LIST, source: 'GALLERY', pageSize: 2, page: 3 });

    expect(onlyGallery.items.map((item) => item.name)).toEqual(['gallery-img4-aaaaaaaa.png']);
    expect(onlyGallery.meta).toEqual({ page: 3, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('searches the file name and the owner name', async () => {
    await put('rlx_p_14971.png');
    await put('brand-b1.png');
    await put('gallery-steam-banner-11223344.png');

    const byOwner = await service.list({ ...LIST, search: 'اپل' });
    const byFile = await service.list({ ...LIST, search: 'STEAM' });
    const byProductName = await service.list({ ...LIST, search: 'استیم' });

    expect(byOwner.items.map((item) => item.name)).toEqual(['brand-b1.png']);
    // Case-insensitive on the file name.
    expect(byFile.items.map((item) => item.name)).toEqual(['gallery-steam-banner-11223344.png']);
    // The owner's name finds the product's file, whose own name `rlx_p_14971` is not what anyone types.
    expect(byProductName.items.map((item) => item.name)).toEqual(['rlx_p_14971.png']);
  });

  describe('upload', () => {
    it('stores a validated image under a readable, unique key', async () => {
      const first = await service.upload({ mimetype: 'image/png', buffer: PNG, originalname: 'Steam Banner (final).PNG' });
      const second = await service.upload({ mimetype: 'image/png', buffer: PNG, originalname: 'Steam Banner (final).PNG' });

      expect(first.name).toMatch(/^gallery-steam-banner-final-[0-9a-f]{8}\.png$/u);
      expect(first.source).toBe('GALLERY');
      expect(first.canDelete).toBe(true);
      // The same file twice is two entries, not one overwriting the other.
      expect(second.name).not.toBe(first.name);
      await expect(fs.readFile(path.join(root, first.name))).resolves.toEqual(PNG);
    });

    it('falls back to a plain stem when the name has nothing a path can carry', async () => {
      const item = await service.upload({ mimetype: 'image/png', buffer: PNG, originalname: 'تصویر.png' });

      expect(item.name).toMatch(/^gallery-image-[0-9a-f]{8}\.png$/u);
    });

    it('checks the bytes instead of trusting a forged Content-Type', async () => {
      await expect(
        service.upload({ mimetype: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"></svg>'), originalname: 'x.png' }),
      ).rejects.toThrow();

      await expect(fs.readdir(root)).resolves.toEqual([]);
    });
  });

  describe('read', () => {
    it('returns the bytes with the type the extension says', async () => {
      await put('brand-b1.jpg', JPEG);

      await expect(service.read('brand-b1.jpg')).resolves.toEqual({ buffer: JPEG, contentType: 'image/jpeg' });
    });

    it.each(['../secret.png', '..%2Fsecret.png', 'a/b.png', 'x.svg', 'x.png/../../etc', '', '.png'])(
      'refuses %j rather than turning it into a path',
      async (name) => {
        await expect(service.read(name)).rejects.toThrow();
      },
    );

    it('says not found for a well-formed name with no file', async () => {
      await expect(service.read('missing.png')).rejects.toThrow();
    });
  });

  describe('remove', () => {
    it('deletes an image that was uploaded to the gallery', async () => {
      await put('gallery-a-11111111.png');

      await expect(service.remove('gallery-a-11111111.png')).resolves.toEqual({ removed: true });
      await expect(fs.readdir(root)).resolves.toEqual([]);
    });

    it.each(['rlx_p_14971.png', 'brand-b1.png', 'topup-g1.png'])(
      'refuses to delete %s, which a live page is serving',
      async (name) => {
        await put(name);

        await expect(service.remove(name)).rejects.toThrow();
        await expect(fs.readdir(root)).resolves.toEqual([name]);
      },
    );
  });

  describe('useForProduct', () => {
    it('gives the product its own copy and points it at that copy', async () => {
      await put('gallery-banner-11111111.png');

      await service.useForProduct('p1', 'gallery-banner-11111111.png');

      expect(productUpdate).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { imageUrl: '/api/catalog/products/p1/image' },
      });
      await expect(fs.readFile(path.join(root, 'p1.png'))).resolves.toEqual(PNG);
      // A copy, so deleting the gallery entry later cannot take the product's image with it.
      await expect(fs.readFile(path.join(root, 'gallery-banner-11111111.png'))).resolves.toEqual(PNG);
    });

    it('replaces the product\'s previous image even when its format differs', async () => {
      await put('p1.jpg', JPEG);
      await put('gallery-banner-11111111.png');

      await service.useForProduct('p1', 'gallery-banner-11111111.png');

      // One file per product key, or the reader would find the old format first.
      expect((await fs.readdir(root)).filter((name) => name.startsWith('p1.'))).toEqual(['p1.png']);
    });

    it('can reuse another product\'s image', async () => {
      await put('rlx_p_14971.png');

      await service.useForProduct('p1', 'rlx_p_14971.png');

      await expect(fs.readFile(path.join(root, 'p1.png'))).resolves.toEqual(PNG);
      await expect(fs.readFile(path.join(root, 'rlx_p_14971.png'))).resolves.toEqual(PNG);
    });

    it('refuses a product that does not exist, and writes nothing', async () => {
      productCount.mockResolvedValue(0);
      await put('gallery-banner-11111111.png');

      await expect(service.useForProduct('nope', 'gallery-banner-11111111.png')).rejects.toThrow();

      expect(productUpdate).not.toHaveBeenCalled();
      await expect(fs.readdir(root)).resolves.toEqual(['gallery-banner-11111111.png']);
    });

    it('refuses a gallery name that is not there, and leaves the product alone', async () => {
      await expect(service.useForProduct('p1', 'gone.png')).rejects.toThrow();

      expect(productUpdate).not.toHaveBeenCalled();
    });
  });
});

describe('gallery list query', () => {
  it('defaults to forty per page across every source', () => {
    expect(adminGalleryListSchema.parse({})).toEqual({ page: 1, pageSize: 40, source: 'ALL' });
  });

  it('rejects an unknown source and an oversized page', () => {
    expect(adminGalleryListSchema.safeParse({ source: 'EVERYTHING' }).success).toBe(false);
    expect(adminGalleryListSchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

/**
 * An uploaded image is stored as a path on this site, not an absolute URL, and
 * the edit form sends the stored value straight back. Before this was accepted,
 * saving any product that already had an uploaded image was rejected.
 */
describe('imageUrl on a product and a top-up game', () => {
  it.each([
    'https://cdn.example.com/steam.png',
    '/api/catalog/products/rlx_p_14971/image',
    '/api/catalog/brands/b1/logo',
    '/api/catalog/top-ups/g1/image',
  ])('accepts %s', (imageUrl) => {
    expect(updateProductSchema.safeParse({ imageUrl }).success).toBe(true);
    expect(updateTopUpGameSchema.safeParse({ imageUrl }).success).toBe(true);
  });

  it.each([
    '/api/admin/catalog/gallery/files/x.png',
    '/api/catalog/products/../../secret/image',
    '/etc/passwd',
    'not a url',
    '/api/catalog/products//image',
  ])('still refuses %s', (imageUrl) => {
    expect(updateProductSchema.safeParse({ imageUrl }).success).toBe(false);
  });

  it('still allows clearing the image', () => {
    expect(updateProductSchema.safeParse({ imageUrl: null }).success).toBe(true);
  });
});
