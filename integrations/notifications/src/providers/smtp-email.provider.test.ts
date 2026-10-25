import { duplexPair, type Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';

import { describe, expect, it } from 'vitest';

import {
  SmtpEmailProvider,
  type SmtpEmailProviderConfig,
  type SmtpSocketFactory,
} from './smtp-email.provider';

/* A throwaway self-signed P-256 certificate for CN/SAN `localhost`, used only
 * by this in-memory test server. It protects nothing. */
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBOTCB36ADAgECAgkAiBv/2H4irYUwCgYIKoZIzj0EAwIwFDESMBAGA1UEAwwJ
bG9jYWxob3N0MCAXDTI2MTAyMTA1MDE0N1oYDzIxMjYwOTI3MDUwMTQ3WjAUMRIw
EAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATTfZa1
3lFcVx/IqYJ6XWLBO9LAEHPynWEL82xSIbliPA6HRlKE8v20alT28pgs5kfp2+ls
/BwsMZYvMIsRwbE8oxgwFjAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZIzj0E
AwIDSQAwRgIhAIcisiJkhoFATJIol45iReCedah6VQrdXUPF+cu5fEphAiEAqsjO
Vpk2f0U53PS6CJ2gYoij27EqTgQvNRnWo9GejBo=
-----END CERTIFICATE-----`;
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgu+kAGSZJumLV4KmM
lLZ0O854P+q0YT4Q8G4KBT7JUiehRANCAATTfZa13lFcVx/IqYJ6XWLBO9LAEHPy
nWEL82xSIbliPA6HRlKE8v20alT28pgs5kfp2+ls/BwsMZYvMIsRwbE8
-----END PRIVATE KEY-----`;

const USER = 'mailer@centohub.com';
const PASSWORD = 'correct horse battery staple';

interface ServerOptions {
  readonly implicitTls?: boolean;
  readonly offerStartTls?: boolean;
  readonly authMechanisms?: readonly string[];
  readonly rejectRecipient?: boolean;
  /** Lines a man in the middle appends, in the clear, after `220` to STARTTLS. */
  readonly injectAfterStartTls?: string;
}

/**
 * A scripted SMTP server on one end of an in-memory stream pair. It records
 * every command it saw in the clear and inside TLS separately, so a test can
 * prove a credential never crossed the wire unencrypted.
 */
class FakeSmtpServer implements SmtpSocketFactory {
  readonly clearCommands: string[] = [];
  readonly secureCommands: string[] = [];
  data = '';
  private socket: Duplex | null = null;
  private secure = false;
  private inData = false;
  private buffer = '';
  private loginStep: 'user' | 'password' | null = null;
  private loginUser = '';

  constructor(private readonly options: ServerOptions = {}) {}

  connect(): Promise<Duplex> {
    const [client, server] = duplexPair();
    if (this.options.implicitTls === true) {
      this.useSocket(new TLSSocket(server, { isServer: true, key: TEST_KEY, cert: TEST_CERT }), true);
    } else {
      this.useSocket(server, false);
    }
    this.reply('220 test.local ESMTP');
    return Promise.resolve(client);
  }

  private useSocket(socket: Duplex, secure: boolean): void {
    this.socket = socket;
    this.secure = secure;
    this.buffer = '';
    socket.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')));
    socket.on('error', () => undefined);
  }

  private reply(text: string): void {
    this.socket?.write(`${text}\r\n`);
  }

  private consume(text: string): void {
    this.buffer += text;
    let newline = this.buffer.indexOf('\r\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 2);
      this.handle(line);
      newline = this.buffer.indexOf('\r\n');
    }
  }

  private handle(line: string): void {
    if (this.inData) {
      if (line === '.') {
        this.inData = false;
        this.reply('250 2.0.0 Ok: queued');
      } else {
        this.data += `${line}\r\n`;
      }
      return;
    }
    (this.secure ? this.secureCommands : this.clearCommands).push(line);

    if (this.loginStep === 'user') {
      this.loginUser = Buffer.from(line, 'base64').toString('utf8');
      this.loginStep = 'password';
      this.reply('334 UGFzc3dvcmQ6');
      return;
    }
    if (this.loginStep === 'password') {
      this.loginStep = null;
      const ok = this.loginUser === USER && Buffer.from(line, 'base64').toString('utf8') === PASSWORD;
      this.reply(ok ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication failed');
      return;
    }

    const verb = line.split(' ')[0]?.toUpperCase();
    switch (verb) {
      case 'EHLO': {
        const extensions = [
          `AUTH ${(this.options.authMechanisms ?? ['PLAIN', 'LOGIN']).join(' ')}`,
          ...(!this.secure && this.options.offerStartTls !== false ? ['STARTTLS'] : []),
          'SIZE 10240000',
        ];
        this.socket?.write(
          ['250-test.local', ...extensions.slice(0, -1).map((e) => `250-${e}`), `250 ${extensions.at(-1)}`]
            .join('\r\n') + '\r\n',
        );
        return;
      }
      case 'STARTTLS': {
        const plain = this.socket as Duplex;
        plain.removeAllListeners('data');
        plain.write(`220 2.0.0 Ready to start TLS\r\n${this.options.injectAfterStartTls ?? ''}`);
        this.useSocket(new TLSSocket(plain, { isServer: true, key: TEST_KEY, cert: TEST_CERT }), true);
        return;
      }
      case 'AUTH': {
        const [, mechanism, token] = line.split(' ');
        if (mechanism === 'PLAIN') {
          const ok = Buffer.from(token ?? '', 'base64').toString('utf8') === `\u0000${USER}\u0000${PASSWORD}`;
          this.reply(ok ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication failed');
        } else {
          this.loginStep = 'user';
          this.reply('334 VXNlcm5hbWU6');
        }
        return;
      }
      case 'MAIL':
        this.reply('250 2.1.0 Ok');
        return;
      case 'RCPT':
        this.reply(this.options.rejectRecipient === true ? '550 5.1.1 No such user' : '250 2.1.5 Ok');
        return;
      case 'DATA':
        this.inData = true;
        this.reply('354 End data with <CR><LF>.<CR><LF>');
        return;
      case 'QUIT':
        this.reply('221 2.0.0 Bye');
        this.socket?.end();
        return;
      default:
        this.reply('502 5.5.2 Error: command not recognized');
    }
  }
}

function config(overrides: Partial<SmtpEmailProviderConfig> = {}): SmtpEmailProviderConfig {
  return {
    host: 'localhost',
    port: 587,
    security: 'STARTTLS',
    username: USER,
    password: PASSWORD,
    fromAddress: 'no-reply@centohub.com',
    fromName: 'سنتو',
    ca: TEST_CERT,
    timeoutMs: 5_000,
    ...overrides,
  };
}

const MESSAGE = {
  to: 'customer@example.com',
  subject: 'کد ورود سنتو',
  text: 'کد ورود شما: 482913',
  html: '<p>482913</p>',
};

function decodedBodies(data: string): string {
  return data
    .split('\r\n\r\n')
    .slice(1)
    .map((block) => Buffer.from(block.replace(/\r\n--.*$/su, '').replace(/\r\n/gu, ''), 'base64').toString('utf8'))
    .join('\n');
}

describe('SmtpEmailProvider', () => {
  it('upgrades with STARTTLS before AUTH PLAIN and delivers the message', async () => {
    const server = new FakeSmtpServer();
    const result = await new SmtpEmailProvider(config(), server).send(MESSAGE);

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/@centohub\.com$/u);
    expect(server.clearCommands).toEqual(['EHLO centohub.com', 'STARTTLS']);
    expect(server.secureCommands[0]).toBe('EHLO centohub.com');
    expect(server.secureCommands[1]).toMatch(/^AUTH PLAIN /u);
    expect(server.secureCommands.slice(2)).toEqual([
      'MAIL FROM:<no-reply@centohub.com>',
      'RCPT TO:<customer@example.com>',
      'DATA',
      'QUIT',
    ]);
    expect(server.data).toContain('Subject: =?UTF-8?B?');
    expect(server.data).toContain('To: customer@example.com');
    expect(server.data).toContain('From: =?UTF-8?B?');
    expect(decodedBodies(server.data)).toContain('482913');
  });

  it('speaks TLS from the first byte in SSL_TLS mode and falls back to AUTH LOGIN', async () => {
    const server = new FakeSmtpServer({ implicitTls: true, authMechanisms: ['LOGIN'] });
    const result = await new SmtpEmailProvider(config({ security: 'SSL_TLS', port: 465 }), server).send(
      MESSAGE,
    );

    expect(result.success).toBe(true);
    expect(server.clearCommands).toEqual([]);
    expect(server.secureCommands[1]).toBe('AUTH LOGIN');
  });

  it('reports a rejected password as AUTH_FAILED with the reply code only', async () => {
    const server = new FakeSmtpServer();
    const result = await new SmtpEmailProvider(config({ password: 'wrong password' }), server).send(MESSAGE);

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_AUTH_FAILED' });
    expect(result.failureMessage).toContain('535');
    expect(result.failureMessage).not.toContain('wrong password');
    expect(server.secureCommands.some((line) => line.startsWith('MAIL'))).toBe(false);
  });

  it('never sends credentials when the server does not offer STARTTLS', async () => {
    const server = new FakeSmtpServer({ offerStartTls: false });
    const result = await new SmtpEmailProvider(config(), server).send(MESSAGE);

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_STARTTLS_UNSUPPORTED' });
    expect(server.clearCommands).toEqual(['EHLO centohub.com']);
    expect(server.secureCommands).toEqual([]);
  });

  it('refuses a certificate it cannot verify and sends nothing secret', async () => {
    const server = new FakeSmtpServer();
    const { ca: _ignored, ...untrusted } = config();
    const result = await new SmtpEmailProvider(untrusted, server).send(MESSAGE);

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_TLS_FAILED' });
    expect(server.secureCommands).toEqual([]);
  });

  it('discards replies injected in the clear across the STARTTLS upgrade', async () => {
    /* Without the discard, the forged 250 would be read as the answer to the
     * encrypted EHLO, and the real one would then answer AUTH. */
    const server = new FakeSmtpServer({ injectAfterStartTls: '250 AUTH PLAIN\r\n' });
    const result = await new SmtpEmailProvider(config(), server).send(MESSAGE);

    expect(result.success).toBe(true);
  });

  it('maps a refused recipient to RECIPIENT_REJECTED', async () => {
    const server = new FakeSmtpServer({ rejectRecipient: true });
    const result = await new SmtpEmailProvider(config(), server).send(MESSAGE);

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_RECIPIENT_REJECTED' });
    expect(result.failureMessage).toContain('550');
    expect(server.secureCommands).not.toContain('DATA');
  });

  it('rejects a header injection before connecting', async () => {
    const server = new FakeSmtpServer();
    const result = await new SmtpEmailProvider(config(), server).send({
      ...MESSAGE,
      subject: 'hello\r\nBcc: victim@example.com',
    });

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_INVALID_MESSAGE' });
    expect(server.clearCommands).toEqual([]);
  });

  it('rejects a recipient that could smuggle an SMTP command', async () => {
    const server = new FakeSmtpServer();
    const result = await new SmtpEmailProvider(config(), server).send({
      ...MESSAGE,
      to: 'a@example.com>\r\nRCPT TO:<b@example.com',
    });

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_INVALID_MESSAGE' });
  });

  it('verifies a connection without sending a message', async () => {
    const server = new FakeSmtpServer();
    const result = await new SmtpEmailProvider(config(), server).verify();

    expect(result).toMatchObject({ success: true, authenticated: true });
    expect(server.secureCommands.some((line) => line.startsWith('MAIL'))).toBe(false);
    expect(server.secureCommands.at(-1)).toBe('QUIT');
  });

  it('refuses a username without a password at construction', () => {
    expect(() => new SmtpEmailProvider(config({ password: '' }))).toThrow(/password is required/u);
  });
});
