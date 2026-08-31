import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@barat/database', () => ({ Prisma: { JsonNull: null } }));

import type { AppConfigService } from '../../common/config/app-config.service';
import type { CatalogDatabase } from './catalog.tokens';
import { CatalogService } from './catalog.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('CatalogService product images', () => {
  let root: string;
  let update: ReturnType<typeof vi.fn>;
  let service: CatalogService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'barat-product-image-'));
    update = vi.fn().mockResolvedValue({ id: 'product-1', imageUrl: '/api/catalog/products/product-1/image' });
    const db = {
      product: {
        count: vi.fn().mockResolvedValue(1),
        update,
      },
    } as unknown as CatalogDatabase;
    const config = { productImageDir: root } as AppConfigService;
    service = new CatalogService(db, config);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores a validated raster image and serves back the same bytes', async () => {
    await service.adminUploadProductImage('product-1', { mimetype: 'image/png', buffer: PNG });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { imageUrl: '/api/catalog/products/product-1/image' },
    });
    await expect(fs.readFile(path.join(root, 'product-1.png'))).resolves.toEqual(PNG);
    await expect(service.productImage('product-1')).resolves.toEqual({
      buffer: PNG,
      contentType: 'image/png',
    });
  });

  it('checks the bytes instead of trusting a forged Content-Type', async () => {
    const executable = Buffer.from('<svg onload="alert(1)"></svg>');

    await expect(
      service.adminUploadProductImage('product-1', {
        mimetype: 'image/png',
        buffer: executable,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(update).not.toHaveBeenCalled();
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it('replaces the old format rather than leaving ambiguous stale files', async () => {
    await fs.writeFile(path.join(root, 'product-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0x00]));

    await service.adminUploadProductImage('product-1', { mimetype: 'image/png', buffer: PNG });

    await expect(fs.stat(path.join(root, 'product-1.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(root, 'product-1.png'))).resolves.toEqual(PNG);
  });
});
