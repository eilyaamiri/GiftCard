import { describe, expect, it } from 'vitest';

import { parseInternalApiUrl } from './internal-api-url';

describe('parseInternalApiUrl', () => {
  it.each([
    ['http://127.0.0.1:4000/api', 'http://127.0.0.1:4000/api'],
    ['http://localhost:4000/api/', 'http://localhost:4000/api'],
    ['http://api:4000/api', 'http://api:4000/api'],
    ['http://10.0.0.5:4000/api', 'http://10.0.0.5:4000/api'],
    ['http://172.20.1.2:4000/api', 'http://172.20.1.2:4000/api'],
    ['https://192.168.1.10/api', 'https://192.168.1.10/api'],
    ['http://[::1]:4000/api', 'http://[::1]:4000/api'],
    ['http://api.internal:4000/api', 'http://api.internal:4000/api'],
  ])('accepts the internal address %s', (raw, expected) => {
    expect(parseInternalApiUrl(raw)).toBe(expected);
  });

  it.each([
    ['a public domain', 'https://www.centohub.com/api'],
    ['a public address', 'http://185.236.37.201:4000/api'],
    ['an address just outside 172.16/12', 'http://172.32.0.1/api'],
    ['credentials in the URL', 'http://user:pass@127.0.0.1:4000/api'],
    ['a query string', 'http://127.0.0.1:4000/api?x=1'],
    ['a fragment', 'http://127.0.0.1:4000/api#x'],
    ['another scheme', 'ftp://127.0.0.1/api'],
    ['garbage', 'not a url'],
    ['an empty value', ''],
  ])('refuses %s, so the internal token never leaves the network', (_label, raw) => {
    expect(parseInternalApiUrl(raw)).toBeNull();
  });
});
