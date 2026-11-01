import { describe, expect, it, vi } from 'vitest';

/* The identity barrel the controller imports reaches the Prisma singleton. */
vi.mock('@barat/database', () => ({ prisma: {}, Prisma: { JsonNull: null, Decimal: class {} } }));

import type { AppConfigService } from '../../common/config/app-config.service';
import { PaymentsController } from './payments.controller';
import type { PaymentsService } from './payments.service';

function controllerWith(result: { paymentId: string | null; orderNumber: string | null }) {
  const service = {
    handleZarinPalReturn: vi.fn(async () => result),
    handleReturn: vi.fn(async () => result),
  };
  const config = { webPublicUrl: 'https://shop.example.test' } as AppConfigService;
  const controller = new PaymentsController(service as unknown as PaymentsService, config);
  const response = { redirect: vi.fn() };
  const request = { ip: '203.0.113.7', get: () => 'browser' };
  return { controller, service, response, request };
}

describe('PaymentsController — gateway returns (PAY-8)', () => {
  it('sends the ZarinPal return to the result page with our ids, never JSON payment details', async () => {
    const { controller, response, request } = controllerWith({ paymentId: 'pay_1', orderNumber: 'BP-1001' });

    await controller.zarinpalCallback({ Authority: 'A0000123', Status: 'OK' }, request, response);

    expect(response.redirect).toHaveBeenCalledWith(
      303,
      'https://shop.example.test/payment/result?order=BP-1001&payment=pay_1',
    );
    // Nothing the gateway sent is reflected into the redirect.
    expect(String(response.redirect.mock.calls[0]?.[1])).not.toContain('A0000123');
  });

  it('lands an unknown authority on the bare result page', async () => {
    const { controller, response, request } = controllerWith({ paymentId: null, orderNumber: null });

    await controller.zarinpalCallback({ Authority: 'forged', Status: 'OK' }, request, response);

    expect(response.redirect).toHaveBeenCalledWith(303, 'https://shop.example.test/payment/result');
  });

  it('treats the BazaarPay return the same way', async () => {
    const { controller, response, request } = controllerWith({ paymentId: 'pay_2', orderNumber: 'BP-1002' });

    await controller.bazaarpayReturn('tok123', request, response);

    expect(response.redirect).toHaveBeenCalledWith(
      303,
      'https://shop.example.test/payment/result?order=BP-1002&payment=pay_2',
    );
  });
});
