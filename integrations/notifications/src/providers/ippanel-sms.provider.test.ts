import { describe, expect, it } from 'vitest';

import {
  FetchIppanelHttpClient,
  IppanelSmsProvider,
  type IppanelHttpClient,
  type IppanelHttpResponse,
  type IppanelSmsProviderConfig,
} from './ippanel-sms.provider';

/* ============================================================================
 * Test doubles. Nothing in this file may reach the network.
 * ==========================================================================*/

const API_KEY = 'merchant-key-do-not-leak';
const CODE = '483920';

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;
}

class ScriptedHttpClient implements IppanelHttpClient {
  readonly requests: Captured[] = [];

  constructor(private readonly responses: readonly (IppanelHttpResponse | Error)[]) {}

  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    _signal: AbortSignal,
  ): Promise<IppanelHttpResponse> {
    this.requests.push({ url, body: { ...body }, headers: { ...headers } });
    const next = this.responses[this.requests.length - 1];
    if (next === undefined) throw new Error('ScriptedHttpClient ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }
}

class HangingHttpClient implements IppanelHttpClient {
  async postJson(
    _url: string,
    _body: Readonly<Record<string, unknown>>,
    _headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<IppanelHttpResponse> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
}

function json(payload: unknown, status = 200): IppanelHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function noBody(status: number): IppanelHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

const CONFIG: IppanelSmsProviderConfig = {
  apiKey: API_KEY,
  patternCode: 'abc123xyz',
  fromNumber: '+983000505',
};

function provider(client: IppanelHttpClient, overrides: Partial<IppanelSmsProviderConfig> = {}) {
  return new IppanelSmsProvider({ ...CONFIG, ...overrides }, client);
}

const SEND_OK = { data: { message_outbox_ids: [1123544244] }, meta: { status: true } };

const MESSAGE = {
  to: '+989120000000',
  body: `کد ورود شما به سنتو: ${CODE}`,
  templateId: 'AUTH_OTP',
  templateParams: { code: CODE },
};

/* ============================================================================
 * Construction
 * ==========================================================================*/

describe('IppanelSmsProvider construction', () => {
  const client = new ScriptedHttpClient([]);

  it.each([
    ['empty key', { apiKey: '' }, /API key/u],
    ['key with whitespace', { apiKey: 'a b' }, /API key/u],
    ['bad pattern code', { patternCode: 'has space' }, /pattern code/u],
    ['bare sender number', { fromNumber: '3000505' }, /sender number/u],
    ['bad param name', { patternCodeParam: '1bad' }, /code-parameter/u],
    ['non-https base URL', { baseUrl: 'http://edge.ippanel.com/v1' }, /base URL/u],
    ['zero timeout', { timeoutMs: 0 }, /timeout/u],
  ])('refuses %s at boot', (_name, overrides, message) => {
    expect(() => provider(client, overrides)).toThrow(message);
  });

  it('never puts the API key into a construction error', () => {
    try {
      provider(client, { patternCode: 'bad code', apiKey: API_KEY });
    } catch (error) {
      expect(String(error)).not.toContain(API_KEY);
    }
  });

  it('defaults to the documented endpoint and a real fetch client', () => {
    expect(() => new IppanelSmsProvider(CONFIG)).not.toThrow();
    expect(new FetchIppanelHttpClient()).toBeInstanceOf(FetchIppanelHttpClient);
  });
});

/* ============================================================================
 * send
 * ==========================================================================*/

describe('send', () => {
  it('posts exactly the documented pattern body with the key in Authorization', async () => {
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    const result = await provider(http).send(MESSAGE);

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url).toBe('https://edge.ippanel.com/v1/api/send');
    expect(http.requests[0]?.body).toEqual({
      sending_type: 'pattern',
      from_number: '+983000505',
      code: 'abc123xyz',
      recipients: ['+989120000000'],
      params: { code: CODE },
    });
    expect(http.requests[0]?.headers['authorization']).toBe(API_KEY);
    expect(http.requests[0]?.headers['content-type']).toBe('application/json');

    expect(result).toMatchObject({ success: true, providerMessageId: '1123544244' });
    expect(result.sentAt).toBeInstanceOf(Date);
  });

  it('never sends the rendered body: the vendor pattern renders the text', async () => {
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    await provider(http).send(MESSAGE);

    const wire = JSON.stringify(http.requests[0]?.body);
    expect(wire).not.toContain('کد ورود');
    /* The code itself must travel — it is the pattern's one variable. */
    expect(http.requests[0]?.body['params']).toEqual({ code: CODE });
  });

  it('normalises a bare 09xxxxxxxxx mobile to E.164', async () => {
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    await provider(http).send({ ...MESSAGE, to: '09120000000' });

    expect(http.requests[0]?.body['recipients']).toEqual(['+989120000000']);
  });

  it('sends one recipient only, as the vendor requires for patterns', async () => {
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    await provider(http).send(MESSAGE);

    expect(http.requests[0]?.body['recipients']).toHaveLength(1);
  });

  it('renames the code onto the merchant template variable, case included', async () => {
    /* The domain always hands the code over as `code`; the vendor template may
     * call it anything, e.g. a pattern written `%CODE%`. The two namespaces are
     * separate, so the adapter translates rather than demanding they match. */
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    const result = await provider(http, { patternCodeParam: 'CODE' }).send(MESSAGE);

    expect(http.requests[0]?.body['params']).toEqual({ CODE });
    expect(result).toMatchObject({ success: true });
  });

  it('accepts any merchant variable name without the domain knowing it', async () => {
    const http = new ScriptedHttpClient([json(SEND_OK)]);
    await provider(http, { patternCodeParam: 'otp_value' }).send(MESSAGE);

    expect(http.requests[0]?.body['params']).toEqual({ otp_value: CODE });
  });

  it.each([
    ['no template params', undefined],
    ['wrong variable name', { otp: CODE }],
    ['empty code', { code: '' }],
  ])('refuses to call the gateway with %s', async (_name, templateParams) => {
    const http = new ScriptedHttpClient([]);
    const result = await provider(http).send(
      templateParams === undefined
        ? { to: MESSAGE.to, body: MESSAGE.body }
        : { ...MESSAGE, templateParams },
    );

    expect(result).toMatchObject({ success: false, failureCode: 'MISSING_TEMPLATE_PARAM' });
    expect(http.requests).toHaveLength(0);
  });

  it.each([['not-a-number'], ['+1'], ['12120000000'], ['']])(
    'refuses an unusable recipient (%s) without calling the gateway',
    async (to) => {
      const http = new ScriptedHttpClient([]);
      const result = await provider(http).send({ ...MESSAGE, to });

      expect(result).toMatchObject({ success: false, failureCode: 'INVALID_RECIPIENT' });
      expect(http.requests).toHaveLength(0);
    },
  );

  it('reports a rejection with the vendor message, not the code', async () => {
    const http = new ScriptedHttpClient([
      json({ data: null, meta: { status: false, message: 'الگو یافت نشد' } }, 404),
    ]);
    const result = await provider(http).send(MESSAGE);

    expect(result).toMatchObject({
      success: false,
      failureCode: 'HTTP_404',
      failureMessage: 'الگو یافت نشد',
    });
    expect(result.failureMessage).not.toContain(CODE);
  });

  it('reports a bodyless 5xx as a failure rather than a silent success', async () => {
    const result = await provider(new ScriptedHttpClient([noBody(503)])).send(MESSAGE);
    expect(result).toMatchObject({ success: false, failureCode: 'HTTP_503' });
  });

  it('reports a network error and a timeout distinctly', async () => {
    expect(
      await provider(new ScriptedHttpClient([new Error('ECONNRESET')])).send(MESSAGE),
    ).toMatchObject({ success: false, failureCode: 'NETWORK_ERROR' });
    expect(
      await provider(new HangingHttpClient(), { timeoutMs: 20 }).send(MESSAGE),
    ).toMatchObject({ success: false, failureCode: 'TIMEOUT' });
  });

  it('never resends on its own after a failure', async () => {
    const http = new ScriptedHttpClient([new Error('socket hang up')]);
    await provider(http).send(MESSAGE);
    expect(http.requests).toHaveLength(1);
  });

  it('succeeds without an id when the vendor omits the outbox list', async () => {
    const result = await provider(new ScriptedHttpClient([json({ meta: { status: true } })])).send(
      MESSAGE,
    );
    expect(result).toMatchObject({ success: true });
    expect(result.providerMessageId).toBeUndefined();
  });

  it('never puts the code into any failure field', async () => {
    for (const response of [
      json({ meta: { status: false, message: `rejected ${CODE}` } }, 400),
      noBody(500),
    ]) {
      const result = await provider(new ScriptedHttpClient([response])).send(MESSAGE);
      expect(result.success).toBe(false);
      /* The vendor echoing the code back must not be forwarded onward. */
      if (result.failureMessage !== undefined && result.failureMessage.includes(CODE)) {
        throw new Error('failure message leaked the OTP');
      }
    }
  });
});
