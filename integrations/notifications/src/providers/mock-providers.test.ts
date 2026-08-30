import { describe, expect, it, vi } from 'vitest';

import { MockEmailProvider } from './mock-email.provider';
import { MockSmsProvider } from './mock-sms.provider';

const OTP = '482915';

describe('MockSmsProvider', () => {
  it('never retains or logs the message body, which is where an OTP lives', async () => {
    const info = vi.fn();
    const provider = new MockSmsProvider({ info });

    await provider.send({
      to: '+989121234567',
      body: `کد ورود شما: ${OTP}`,
      templateId: 'otp-login',
      templateParams: { code: OTP },
    });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(OTP);
    expect(JSON.stringify(provider.dispatches)).not.toContain(OTP);
  });

  it('keeps only masked recipient metadata', async () => {
    const provider = new MockSmsProvider();

    const result = await provider.send({ to: '+989121234567', body: OTP });

    expect(result.success).toBe(true);
    expect(provider.dispatches[0]!.recipientMasked).toBe('+989***4567');
    expect(JSON.stringify(provider.dispatches)).not.toContain('+989121234567');
  });
});

describe('MockEmailProvider', () => {
  it('never retains or logs the subject, body or template parameters', async () => {
    const info = vi.fn();
    const provider = new MockEmailProvider({ info });

    await provider.send({
      to: 'ali@example.com',
      subject: `Your code is ${OTP}`,
      html: `<p>${OTP}</p>`,
      text: OTP,
      templateId: 'otp-login',
      templateParams: { code: OTP },
    });

    expect(JSON.stringify(info.mock.calls)).not.toContain(OTP);
    expect(JSON.stringify(provider.dispatches)).not.toContain(OTP);
    expect(provider.dispatches[0]!.recipientMasked).toBe('a***@example.com');
  });
});
