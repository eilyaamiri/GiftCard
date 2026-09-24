import { describe, expect, it } from 'vitest';

import { createFaqSchema, faqParamSchema, updateFaqSchema } from './faqs.schemas';

describe('createFaqSchema', () => {
  const base = { question: 'چطور سفارش را پیگیری کنم؟', answer: 'از صفحه سفارش‌های من پیگیری کنید.' };

  it('accepts a minimal entry and fills in the defaults', () => {
    const result = createFaqSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEnabled).toBe(true);
      expect(result.data.sortOrder).toBe(0);
    }
  });

  it('rejects a question or answer that is too short', () => {
    expect(createFaqSchema.safeParse({ ...base, question: 'کو؟' }).success).toBe(false);
    expect(createFaqSchema.safeParse({ ...base, answer: 'نه' }).success).toBe(false);
  });

  it('rejects a question or answer past the length ceiling', () => {
    expect(createFaqSchema.safeParse({ ...base, question: 'س'.repeat(201) }).success).toBe(false);
    expect(createFaqSchema.safeParse({ ...base, answer: 'ج'.repeat(2001) }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createFaqSchema.safeParse({ ...base, id: 'faq_1' }).success).toBe(false);
  });
});

describe('updateFaqSchema', () => {
  const base = {
    question: 'چطور سفارش را پیگیری کنم؟',
    answer: 'از صفحه سفارش‌های من پیگیری کنید.',
    isEnabled: false,
    sortOrder: 3,
  };

  it('requires every field, unlike create', () => {
    expect(updateFaqSchema.safeParse(base).success).toBe(true);
    const { isEnabled: _isEnabled, ...withoutIsEnabled } = base;
    expect(updateFaqSchema.safeParse(withoutIsEnabled).success).toBe(false);
  });

  it('rejects a negative or out-of-range sort order', () => {
    expect(updateFaqSchema.safeParse({ ...base, sortOrder: -1 }).success).toBe(false);
    expect(updateFaqSchema.safeParse({ ...base, sortOrder: 1000 }).success).toBe(false);
  });
});

describe('faqParamSchema', () => {
  it('requires a non-empty id', () => {
    expect(faqParamSchema.safeParse({ id: 'faq_1' }).success).toBe(true);
    expect(faqParamSchema.safeParse({ id: '' }).success).toBe(false);
  });
});
