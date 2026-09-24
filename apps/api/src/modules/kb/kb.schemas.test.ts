import { describe, expect, it } from 'vitest';

import {
  articleParamSchema,
  categoryParamSchema,
  createKbArticleSchema,
  createKbCategorySchema,
  updateKbArticleSchema,
  updateKbCategorySchema,
} from './kb.schemas';

describe('createKbCategorySchema', () => {
  const base = { slug: 'getting-started', name: 'شروع کار' };

  it('accepts a minimal entry and fills in the defaults', () => {
    const result = createKbCategorySchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icon).toBe('book-open');
      expect(result.data.isEnabled).toBe(true);
      expect(result.data.sortOrder).toBe(0);
    }
  });

  it('rejects a slug with uppercase letters or spaces', () => {
    expect(createKbCategorySchema.safeParse({ ...base, slug: 'Getting Started' }).success).toBe(false);
  });

  it('rejects an unknown icon key', () => {
    expect(createKbCategorySchema.safeParse({ ...base, icon: 'rocket' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createKbCategorySchema.safeParse({ ...base, id: 'kb_cat_1' }).success).toBe(false);
  });
});

describe('updateKbCategorySchema', () => {
  const base = {
    slug: 'getting-started',
    name: 'شروع کار',
    description: '',
    icon: 'book-open' as const,
    isEnabled: false,
    sortOrder: 3,
  };

  it('requires every field, unlike create', () => {
    expect(updateKbCategorySchema.safeParse(base).success).toBe(true);
    const { isEnabled: _isEnabled, ...withoutIsEnabled } = base;
    expect(updateKbCategorySchema.safeParse(withoutIsEnabled).success).toBe(false);
  });

  it('rejects a negative or out-of-range sort order', () => {
    expect(updateKbCategorySchema.safeParse({ ...base, sortOrder: -1 }).success).toBe(false);
    expect(updateKbCategorySchema.safeParse({ ...base, sortOrder: 1000 }).success).toBe(false);
  });
});

describe('createKbArticleSchema', () => {
  const base = {
    categoryId: 'kb_cat_getting_started',
    slug: 'what-is-barat',
    title: 'برات چیست و چطور کار می‌کند؟',
    content: '## توضیح\n\nبرات یک فروشگاه آنلاین است.',
  };

  it('accepts a minimal entry and fills in the defaults', () => {
    const result = createKbArticleSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEnabled).toBe(true);
      expect(result.data.isPromoted).toBe(false);
      expect(result.data.sortOrder).toBe(0);
    }
  });

  it('rejects a title or content that is too short', () => {
    expect(createKbArticleSchema.safeParse({ ...base, title: 'ک' }).success).toBe(false);
    expect(createKbArticleSchema.safeParse({ ...base, content: 'کم' }).success).toBe(false);
  });

  it('rejects a missing categoryId', () => {
    const { categoryId: _categoryId, ...withoutCategory } = base;
    expect(createKbArticleSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createKbArticleSchema.safeParse({ ...base, id: 'kb_art_1' }).success).toBe(false);
  });
});

describe('updateKbArticleSchema', () => {
  const base = {
    categoryId: 'kb_cat_getting_started',
    slug: 'what-is-barat',
    title: 'برات چیست و چطور کار می‌کند؟',
    excerpt: '',
    content: '## توضیح\n\nبرات یک فروشگاه آنلاین است.',
    isEnabled: false,
    isPromoted: true,
    sortOrder: 2,
  };

  it('requires every field, unlike create', () => {
    expect(updateKbArticleSchema.safeParse(base).success).toBe(true);
    const { isPromoted: _isPromoted, ...withoutIsPromoted } = base;
    expect(updateKbArticleSchema.safeParse(withoutIsPromoted).success).toBe(false);
  });
});

describe('categoryParamSchema', () => {
  it('requires a non-empty id', () => {
    expect(categoryParamSchema.safeParse({ id: 'kb_cat_1' }).success).toBe(true);
    expect(categoryParamSchema.safeParse({ id: '' }).success).toBe(false);
  });
});

describe('articleParamSchema', () => {
  it('requires a non-empty id', () => {
    expect(articleParamSchema.safeParse({ id: 'kb_art_1' }).success).toBe(true);
    expect(articleParamSchema.safeParse({ id: '' }).success).toBe(false);
  });
});
