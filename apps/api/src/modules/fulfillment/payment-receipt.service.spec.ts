import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppConfigService } from '../../common/config/app-config.service';
import {
  MAX_PAYMENT_RECEIPT_BYTES,
  PaymentReceiptService,
} from './payment-receipt.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe('PaymentReceiptService', () => {
  let root: string;
  let service: PaymentReceiptService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'barat-payment-receipt-'));
    service = new PaymentReceiptService({ productImageDir: root } as AppConfigService);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores a raster image under a generated name and reads back the same bytes', async () => {
    const saved = await service.save('order-1', {
      mimetype: 'image/png',
      buffer: PNG,
    });

    expect(saved).toMatchObject({ contentType: 'image/png', sizeBytes: PNG.length });
    await expect(service.read('order-1')).resolves.toMatchObject({
      contentType: 'image/png',
      sizeBytes: PNG.length,
      content: PNG,
      filename: 'payment-receipt.png',
    });

    const files = await fs.readdir(path.join(root, 'payment-receipts'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.receipt$/u);
    const mode = (await fs.stat(path.join(root, 'payment-receipts', files[0] as string))).mode & 0o777;
    expect(mode).toBe(0o640);
  });

  it('checks magic bytes instead of trusting the declared MIME type', async () => {
    await expect(
      service.save('order-1', {
        mimetype: 'image/png',
        buffer: Buffer.from('<svg onload="alert(1)"></svg>'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.info('order-1')).resolves.toBeNull();
  });

  it('rejects a declared type that disagrees with valid image bytes', async () => {
    await expect(
      service.save('order-1', { mimetype: 'image/jpeg', buffer: PNG }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects an image above the five-megabyte limit', async () => {
    const oversized = Buffer.alloc(MAX_PAYMENT_RECEIPT_BYTES + 1);
    PNG.copy(oversized);

    await expect(
      service.save('order-1', { mimetype: 'image/png', buffer: oversized }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('atomically replaces the one receipt for an order without stale temporary files', async () => {
    await service.save('order-1', { mimetype: 'image/png', buffer: PNG });
    await service.save('order-1', { mimetype: 'image/jpeg', buffer: JPEG });

    await expect(service.read('order-1')).resolves.toMatchObject({
      contentType: 'image/jpeg',
      content: JPEG,
      filename: 'payment-receipt.jpg',
    });
    await expect(fs.readdir(path.join(root, 'payment-receipts'))).resolves.toHaveLength(1);
  });

  it('returns no metadata for a missing receipt and refuses a missing read', async () => {
    await expect(service.info('missing-order')).resolves.toBeNull();
    await expect(service.readIfExists('missing-order')).resolves.toBeNull();
    await expect(service.read('missing-order')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
