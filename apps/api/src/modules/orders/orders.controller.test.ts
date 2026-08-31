import { describe, expect, it, vi } from 'vitest';
import type { IrrString } from '@barat/contracts';

vi.mock('@barat/database', () => ({ prisma: {} }));

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
  const controller = new OrdersController({ createOrder } as unknown as OrdersService);
  return { controller, createOrder };
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
