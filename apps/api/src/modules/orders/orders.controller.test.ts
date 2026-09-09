import { describe, expect, it, vi } from 'vitest';
import type { IrrString } from '@barat/contracts';

vi.mock('@barat/database', () => ({ prisma: {} }));

import type { PaymentReceiptService } from '../fulfillment/payment-receipt.service';
import type { FulfillmentStore } from '../fulfillment/fulfillment.types';
import { OrdersController } from './orders.controller';
import type { CreateOrderBody } from './orders.schemas';
import type { OrdersService } from './orders.service';

const IDEMPOTENCY_KEY = 'order-key-12345678';
const BODY: CreateOrderBody = {
  quoteId: 'quote-1',
  acknowledgedAmountIrr: '1234500' as IrrString,
};
const METADATA = { ip: '127.0.0.1', userAgent: 'vitest' };

function harness() {
  const createOrder = vi.fn().mockResolvedValue({ created: true });
  const getOrderForCustomer = vi.fn();
  const info = vi.fn();
  const read = vi.fn();
  const loadContextByOrder = vi.fn();
  const controller = new OrdersController(
    { createOrder, getOrderForCustomer } as unknown as OrdersService,
    { info, read } as unknown as PaymentReceiptService,
    { loadContextByOrder } as unknown as FulfillmentStore,
  );
  return {
    controller,
    createOrder,
    getOrderForCustomer,
    info,
    read,
    loadContextByOrder,
  };
}

describe('OrdersController.createOrder idempotency header', () => {
  it('uses a valid Idempotency-Key header when the compatibility body key is absent', async () => {
    const { controller, createOrder } = harness();

    await controller.createOrder(BODY, 'customer-1', METADATA, {
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
    });

    expect(createOrder).toHaveBeenCalledWith(
      { ...BODY, idempotencyKey: IDEMPOTENCY_KEY },
      { customerId: 'customer-1', ip: '127.0.0.1', userAgent: 'vitest' },
    );
  });

  it('requires the Idempotency-Key header even when the legacy body key is present', () => {
    const { controller, createOrder } = harness();

    expect(() =>
      controller.createOrder({ ...BODY, idempotencyKey: IDEMPOTENCY_KEY }, 'customer-1', METADATA, {
        headers: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects a body key that disagrees with the authoritative header', () => {
    const { controller, createOrder } = harness();

    expect(() =>
      controller.createOrder(
        { ...BODY, idempotencyKey: 'different-key-1234' },
        'customer-1',
        METADATA,
        { headers: { 'idempotency-key': IDEMPOTENCY_KEY } },
      ),
    ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('OrdersController payment receipt', () => {
  it('reports a receipt only after the customer-owned delivery is sent', async () => {
    const h = harness();
    h.getOrderForCustomer.mockResolvedValue({
      order: { id: 'order-1', delivery: { status: 'SENT' } },
    });
    h.loadContextByOrder.mockResolvedValue({ workItemType: 'INTERNATIONAL_PAYMENT' });
    h.info.mockResolvedValue({
      contentType: 'image/png',
      sizeBytes: 8,
      uploadedAt: new Date(),
    });

    await expect(
      h.controller.paymentReceiptStatus({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).resolves.toEqual({ available: true, purpose: 'INTERNATIONAL_PAYMENT' });
    expect(h.getOrderForCustomer).toHaveBeenCalledWith('BP-1001', 'customer-1');
    expect(h.loadContextByOrder).toHaveBeenCalledWith('order-1');
    expect(h.info).toHaveBeenCalledWith('order-1');
  });

  it('keeps the payment purpose when the optional receipt is absent', async () => {
    const h = harness();
    h.getOrderForCustomer.mockResolvedValue({
      order: { id: 'order-1', delivery: { status: 'SENT' } },
    });
    h.loadContextByOrder.mockResolvedValue({ workItemType: 'INTERNATIONAL_PAYMENT' });
    h.info.mockResolvedValue(null);

    await expect(
      h.controller.paymentReceiptStatus({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).resolves.toEqual({ available: false, purpose: 'INTERNATIONAL_PAYMENT' });
  });

  it('does not treat a gift-card order as a payment even if a stray file exists', async () => {
    const h = harness();
    h.getOrderForCustomer.mockResolvedValue({
      order: { id: 'order-1', delivery: { status: 'SENT' } },
    });
    h.loadContextByOrder.mockResolvedValue({ workItemType: 'GIFT_CARD_PURCHASE' });

    await expect(
      h.controller.paymentReceiptStatus({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).resolves.toEqual({ available: false, purpose: 'GIFT_CARD' });
    await expect(
      h.controller.paymentReceipt({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.info).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
  });

  it('does not inspect or expose a stored file before delivery reaches SENT', async () => {
    const h = harness();
    h.getOrderForCustomer.mockResolvedValue({
      order: { id: 'order-1', delivery: { status: 'READY' } },
    });
    h.loadContextByOrder.mockResolvedValue({ workItemType: 'INTERNATIONAL_PAYMENT' });

    await expect(
      h.controller.paymentReceiptStatus({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).resolves.toEqual({ available: false, purpose: 'INTERNATIONAL_PAYMENT' });
    await expect(
      h.controller.paymentReceipt({ orderNumber: 'BP-1001' }, 'customer-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.info).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
  });

  it('serves the sent receipt with a generated filename after customer scoping', async () => {
    const h = harness();
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    h.getOrderForCustomer.mockResolvedValue({
      order: { id: 'order-1', delivery: { status: 'SENT' } },
    });
    h.loadContextByOrder.mockResolvedValue({ workItemType: 'INTERNATIONAL_PAYMENT' });
    h.read.mockResolvedValue({
      contentType: 'image/png',
      sizeBytes: content.length,
      uploadedAt: new Date(),
      content,
      filename: 'payment-receipt.png',
    });

    const response = await h.controller.paymentReceipt(
      { orderNumber: 'BP-1001' },
      'customer-1',
    );

    expect(h.getOrderForCustomer).toHaveBeenCalledWith('BP-1001', 'customer-1');
    expect(h.read).toHaveBeenCalledWith('order-1');
    expect(response.getHeaders()).toEqual({
      type: 'image/png',
      disposition: 'inline; filename="payment-receipt.png"',
      length: content.length,
    });
  });

  it('never reads a receipt when the customer-scoped order lookup fails', async () => {
    const h = harness();
    h.getOrderForCustomer.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'NOT_FOUND' }),
    );

    await expect(
      h.controller.paymentReceipt({ orderNumber: 'BP-OTHER' }, 'customer-1'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.loadContextByOrder).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
  });
});
