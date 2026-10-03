import { describe, expect, it } from 'vitest';

import { bindVariableTopUpAmount } from './topup-provider-sku';

const TEMPLATE = 'steam:usd:custom';

describe('bindVariableTopUpAmount', () => {
  it('passes fixed offers through untouched', () => {
    expect(bindVariableTopUpAmount('telegram:stars:500', '12')).toEqual({ variable: false });
    expect(bindVariableTopUpAmount('telegram:stars:500', undefined)).toEqual({ variable: false });
  });

  it.each([
    ['5', 'steam:usd:5', '5'],
    ['5.00', 'steam:usd:5', '5'],
    ['12.5', 'steam:usd:12.5', '12.5'],
    ['12.50', 'steam:usd:12.5', '12.5'],
    ['0.15', 'steam:usd:0.15', '0.15'],
    ['1000', 'steam:usd:1000', '1000'],
    ['1000.00', 'steam:usd:1000', '1000'],
    ['7.05', 'steam:usd:7.05', '7.05'],
  ])('binds %s to a canonical SKU', (typed, sku, amount) => {
    expect(bindVariableTopUpAmount(TEMPLATE, typed)).toEqual({
      variable: true,
      ok: true,
      providerSku: sku,
      amount,
      currency: 'USD',
    });
  });

  it.each([undefined, '', '   '])('requires an amount (%j)', (typed) => {
    expect(bindVariableTopUpAmount(TEMPLATE, typed)).toEqual({ variable: true, ok: false, reason: 'REQUIRED' });
  });

  it.each(['5.999', '-5', '1e3', 'abc', '5,5', '5.', '.5', '0x10', '١٢'])(
    'refuses malformed amount %s',
    (typed) => {
      expect(bindVariableTopUpAmount(TEMPLATE, typed)).toEqual({ variable: true, ok: false, reason: 'FORMAT' });
    },
  );

  it.each(['0', '0.00', '0.14'])('refuses %s as below the minimum', (typed) => {
    expect(bindVariableTopUpAmount(TEMPLATE, typed)).toEqual({ variable: true, ok: false, reason: 'BELOW_MIN' });
  });

  it.each(['1000.01', '1001', '99999'])('refuses %s as above the maximum', (typed) => {
    expect(bindVariableTopUpAmount(TEMPLATE, typed)).toEqual({ variable: true, ok: false, reason: 'ABOVE_MAX' });
  });
});
