import { describe, expect, it } from 'vitest';

import type { FormattedAlert } from '../alert-logger';
import { TelegramChannel } from './telegram.channel';

const ENV = {
  ALERT_TELEGRAM_ENABLED: 'true',
  ALERT_TELEGRAM_BOT_TOKEN: '123456:SECRET-BOT-TOKEN',
  ALERT_TELEGRAM_CHAT_ID: '-100200300',
  ALERT_TELEGRAM_RATE_LIMIT_SECONDS: '30',
};

function alert(overrides: Partial<FormattedAlert> = {}): FormattedAlert {
  return {
    severity: 'ERROR',
    source: 'SUPPLIER',
    message: 'Supplier tillo connection lost',
    context: null,
    at: new Date('2026-10-20T10:00:00Z'),
    formatted: '',
    dedupKey: 'SUPPLIER:Supplier tillo connection lost',
    ...overrides,
  };
}

function channel(response: () => Promise<Response> = async () => new Response('{}', { status: 200 })) {
  const bodies: string[] = [];
  const transport = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return response();
  }) as typeof fetch;
  return { channel: new TelegramChannel(ENV, transport, async () => undefined), bodies };
}

describe('TelegramChannel', () => {
  it('sends two different incidents from the same source', async () => {
    const { channel: telegram, bodies } = channel();

    await telegram.send(alert());
    await telegram.send(
      alert({ message: 'Supplier runa connection lost', dedupKey: 'SUPPLIER:Supplier runa connection lost' }),
    );

    expect(bodies).toHaveLength(2);
  });

  it('suppresses the same incident inside the window', async () => {
    const { channel: telegram, bodies } = channel();

    await telegram.send(alert());
    await telegram.send(alert());

    expect(bodies).toHaveLength(1);
  });

  it('suppresses a duplicate raised while the first is still in flight', async () => {
    const { channel: telegram, bodies } = channel();

    await Promise.all([telegram.send(alert()), telegram.send(alert())]);

    expect(bodies).toHaveLength(1);
  });

  it('does not send below ERROR', async () => {
    const { channel: telegram, bodies } = channel();

    await telegram.send(alert({ severity: 'WARNING' }));

    expect(bodies).toHaveLength(0);
  });

  it('sends nothing when disabled', async () => {
    const bodies: string[] = [];
    const telegram = new TelegramChannel(
      { ...ENV, ALERT_TELEGRAM_ENABLED: 'false' },
      (async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response('{}');
      }) as typeof fetch,
    );

    await telegram.send(alert());

    expect(bodies).toHaveLength(0);
  });

  it('retries three times and never throws when Telegram keeps failing', async () => {
    const { channel: telegram, bodies } = channel(async () => new Response('nope', { status: 502 }));

    await expect(telegram.send(alert())).resolves.toBeUndefined();

    expect(bodies).toHaveLength(3);
  });

  it('HTML-escapes the message and never puts the bot token in the body', async () => {
    const { channel: telegram, bodies } = channel();

    await telegram.send(alert({ message: 'a <b>bold</b> & claim', dedupKey: 'x' }));

    expect(bodies[0]).toContain('a &lt;b&gt;bold&lt;/b&gt; &amp; claim');
    expect(bodies[0]).not.toContain('SECRET-BOT-TOKEN');
  });
});
