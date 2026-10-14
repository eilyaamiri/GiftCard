import { describe, expect, it } from 'vitest';

import { readIppanelEnv } from './ippanel.env';
import { createSmsProvider } from './sms-provider.factory';

const COMPLETE = {
  IPPANEL_ENABLED: 'true',
  IPPANEL_API_KEY: 'key-do-not-leak',
  IPPANEL_PATTERN_CODE: 'abc123',
  IPPANEL_FROM_NUMBER: '+983000505',
};

describe('readIppanelEnv', () => {
  it('is disabled, and demands nothing, when the flag is absent', () => {
    expect(readIppanelEnv({})).toMatchObject({ enabled: false });
  });

  it('stays disabled when a key is present but the flag is not set', () => {
    /* Credentials sitting in the environment must never switch a live OTP
     * transport on by themselves (AGENTS.md section 4). */
    expect(readIppanelEnv({ IPPANEL_API_KEY: 'key' })).toMatchObject({ enabled: false });
  });

  it.each([['yes'], ['1'], ['TRUE ']])('refuses an ambiguous flag (%s)', (value) => {
    expect(() => readIppanelEnv({ IPPANEL_ENABLED: value })).toThrow(/IPPANEL_ENABLED/u);
  });

  it('accepts an explicit false', () => {
    expect(readIppanelEnv({ IPPANEL_ENABLED: 'false' })).toMatchObject({ enabled: false });
  });

  it.each([
    ['IPPANEL_API_KEY', { ...COMPLETE, IPPANEL_API_KEY: '' }],
    ['IPPANEL_PATTERN_CODE', { ...COMPLETE, IPPANEL_PATTERN_CODE: '' }],
    ['IPPANEL_FROM_NUMBER', { ...COMPLETE, IPPANEL_FROM_NUMBER: '' }],
  ])('requires %s once enabled', (name, env) => {
    expect(() => readIppanelEnv(env)).toThrow(new RegExp(name, 'u'));
  });

  it('defaults the pattern variable name and the timeout', () => {
    expect(readIppanelEnv(COMPLETE)).toMatchObject({
      enabled: true,
      patternCodeParam: 'code',
      timeoutMs: 10_000,
      baseUrl: undefined,
    });
  });

  it.each([['0'], ['60001'], ['1.5'], ['abc']])('refuses a timeout of %s', (value) => {
    expect(() => readIppanelEnv({ ...COMPLETE, IPPANEL_TIMEOUT_MS: value })).toThrow(
      /IPPANEL_TIMEOUT_MS/u,
    );
  });
});

describe('createSmsProvider', () => {
  it('falls back to the mock transport when IPPanel is off', () => {
    expect(createSmsProvider(readIppanelEnv({})).name).toBe('mock-sms');
  });

  it('selects IPPanel when it is explicitly enabled and configured', () => {
    expect(createSmsProvider(readIppanelEnv(COMPLETE)).name).toBe('ippanel');
  });

  it('fails at boot on a malformed setting rather than at the first login', () => {
    expect(() =>
      createSmsProvider(readIppanelEnv({ ...COMPLETE, IPPANEL_FROM_NUMBER: '3000505' })),
    ).toThrow(/sender number/u);
  });
});
