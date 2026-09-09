/* eslint-disable @typescript-eslint/consistent-type-imports -- AppConfigService is
 * constructor-injected; emitDecoratorMetadata needs the runtime class value. */
import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';

export const MAX_PAYMENT_RECEIPT_BYTES = 5 * 1024 * 1024;

const PAYMENT_RECEIPT_TYPES = [
  { contentType: 'image/jpeg', extension: 'jpg' },
  { contentType: 'image/png', extension: 'png' },
  { contentType: 'image/webp', extension: 'webp' },
] as const;

type PaymentReceiptContentType = (typeof PAYMENT_RECEIPT_TYPES)[number]['contentType'];

export interface PaymentReceiptInfo {
  readonly contentType: PaymentReceiptContentType;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export interface StoredPaymentReceipt extends PaymentReceiptInfo {
  readonly content: Buffer;
  /** Stable, customer-safe name; the operator's local filename is never retained. */
  readonly filename: string;
}

function detectContentType(prefix: Buffer): PaymentReceiptContentType | null {
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    prefix.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => prefix[index] === byte,
    )
  ) {
    return 'image/png';
  }
  if (
    prefix.length >= 12 &&
    prefix.toString('ascii', 0, 4) === 'RIFF' &&
    prefix.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Filesystem-backed evidence for an international-payment order.
 *
 * The database schema is intentionally not stretched into blob storage. The file
 * lives beside the existing persistent product-image directory and is addressed by
 * a one-way digest of the server-derived order id. Original filenames are dropped,
 * so neither a supplier name nor an operator workstation path can reach a customer.
 */
@Injectable()
export class PaymentReceiptService {
  constructor(private readonly config: AppConfigService) {}

  async save(
    orderId: string,
    file: { readonly mimetype: string; readonly buffer: Buffer },
  ): Promise<PaymentReceiptInfo> {
    if (file.buffer.length === 0 || file.buffer.length > MAX_PAYMENT_RECEIPT_BYTES) {
      throw DomainErrors.validation([
        { path: 'receipt', message: 'حجم تصویر رسید باید حداکثر ۵ مگابایت باشد.' },
      ]);
    }

    const detected = detectContentType(file.buffer.subarray(0, 12));
    if (detected === null || detected !== file.mimetype) {
      throw DomainErrors.validation([
        { path: 'receipt', message: 'رسید باید یک تصویر معتبر JPG، PNG یا WebP باشد.' },
      ]);
    }

    const root = this.root();
    const destination = this.receiptPath(orderId);
    const temporary = path.join(root, `.${path.basename(destination)}.${randomUUID()}.tmp`);
    await fs.mkdir(root, { recursive: true });

    try {
      // Rename makes replacement atomic: a customer or e-mail dispatch sees either
      // the complete old receipt or the complete new one, never a partial image.
      await fs.writeFile(temporary, file.buffer, { mode: 0o640, flag: 'wx' });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }

    const stat = await fs.stat(destination);
    return { contentType: detected, sizeBytes: stat.size, uploadedAt: stat.mtime };
  }

  async info(orderId: string): Promise<PaymentReceiptInfo | null> {
    const inspected = await this.inspect(orderId);
    if (inspected === null) return null;
    return {
      contentType: inspected.contentType,
      sizeBytes: inspected.sizeBytes,
      uploadedAt: inspected.uploadedAt,
    };
  }

  async read(orderId: string): Promise<StoredPaymentReceipt> {
    const inspected = await this.inspect(orderId);
    if (inspected === null) {
      throw DomainErrors.notFound('payment receipt');
    }

    const content = await fs.readFile(this.receiptPath(orderId));
    // The size was checked before reading and the file is only replaced atomically.
    // A second check catches unexpected filesystem changes without handing them to
    // an image decoder or an e-mail provider.
    if (content.length !== inspected.sizeBytes || detectContentType(content.subarray(0, 12)) !== inspected.contentType) {
      throw DomainErrors.notFound('valid payment receipt');
    }

    const extension = PAYMENT_RECEIPT_TYPES.find(
      (candidate) => candidate.contentType === inspected.contentType,
    )?.extension;
    return {
      ...inspected,
      content,
      filename: `payment-receipt.${extension ?? 'jpg'}`,
    };
  }

  async readIfExists(orderId: string): Promise<StoredPaymentReceipt | null> {
    const info = await this.info(orderId);
    return info === null ? null : this.read(orderId);
  }

  private async inspect(orderId: string): Promise<PaymentReceiptInfo | null> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(this.receiptPath(orderId), 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PAYMENT_RECEIPT_BYTES) {
        throw DomainErrors.notFound('valid payment receipt');
      }
      const prefix = Buffer.alloc(12);
      const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
      const contentType = detectContentType(prefix.subarray(0, bytesRead));
      if (contentType === null) {
        throw DomainErrors.notFound('valid payment receipt');
      }
      return { contentType, sizeBytes: stat.size, uploadedAt: stat.mtime };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private root(): string {
    // Reuse the one configured persistent filesystem root instead of introducing a
    // second deployment setting in the frozen platform configuration.
    return path.join(this.config.productImageDir, 'payment-receipts');
  }

  private receiptPath(orderId: string): string {
    const key = createHash('sha256').update(`payment-receipt:${orderId}`).digest('hex');
    return path.join(this.root(), `${key}.receipt`);
  }
}
