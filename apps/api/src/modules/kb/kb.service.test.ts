import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { KbService, type KbDatabase } from './kb.service';

const ACTOR = {
  staff: { staffId: 'staff-1', role: 'ADMIN' },
  metadata: { ip: '127.0.0.1', userAgent: 'vitest' },
} as never;

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  isEnabled: boolean;
  sortOrder: number;
  updatedAt: Date;
  updatedByStaffId?: string | null;
}

interface ArticleRow {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  isEnabled: boolean;
  isPromoted: boolean;
  sortOrder: number;
  updatedAt: Date;
  updatedByStaffId?: string | null;
}

function categoryRow(overrides: Partial<CategoryRow> & Pick<CategoryRow, 'id'>): CategoryRow {
  return {
    slug: overrides.id,
    name: `دسته ${overrides.id}`,
    description: '',
    icon: 'book-open',
    isEnabled: false,
    sortOrder: 0,
    updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function articleRow(overrides: Partial<ArticleRow> & Pick<ArticleRow, 'id' | 'categoryId'>): ArticleRow {
  return {
    slug: overrides.id,
    title: `مقاله ${overrides.id}`,
    excerpt: '',
    content: `محتوای ${overrides.id}`,
    isEnabled: false,
    isPromoted: false,
    sortOrder: 0,
    updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(initialCategories: CategoryRow[], initialArticles: ArticleRow[] = []) {
  const categories = [...initialCategories];
  const articles = [...initialArticles];
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });

  function categoryWithArticles(row: CategoryRow, enabledOnly: boolean) {
    const matching = articles
      .filter((article) => article.categoryId === row.id)
      .filter((article) => !enabledOnly || article.isEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return { ...row, articles: matching };
  }

  const database = {
    kbCategory: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        const enabledOnly = args.where !== undefined;
        const filtered = enabledOnly ? categories.filter((entry) => entry.isEnabled) : categories;
        return [...filtered]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => categoryWithArticles(row, enabledOnly));
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return categories.find((entry) => entry.id === args.where.id) ?? null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const created = { id: `kb_cat_${categories.length + 1}`, updatedAt: new Date(), ...args.data } as CategoryRow;
        categories.push(created);
        return categoryWithArticles(created, false);
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = categories.findIndex((entry) => entry.id === args.where.id);
        categories[index] = { ...categories[index], ...args.data } as CategoryRow;
        return categoryWithArticles(categories[index], false);
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const index = categories.findIndex((entry) => entry.id === args.where.id);
        categories.splice(index, 1);
      }),
    },
    kbArticle: {
      findMany: vi.fn(async () => [...articles].sort((a, b) => a.sortOrder - b.sortOrder)),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return articles.find((entry) => entry.id === args.where.id) ?? null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const created = { id: `kb_art_${articles.length + 1}`, updatedAt: new Date(), ...args.data } as ArticleRow;
        articles.push(created);
        return created;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = articles.findIndex((entry) => entry.id === args.where.id);
        articles[index] = { ...articles[index], ...args.data } as ArticleRow;
        return articles[index];
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const index = articles.findIndex((entry) => entry.id === args.where.id);
        articles.splice(index, 1);
      }),
    },
  } as unknown as KbDatabase;

  return {
    categories,
    articles,
    record,
    service: new KbService(database, { record } as never),
  };
}

describe('KbService.listPublicContent', () => {
  it('only returns enabled categories with their enabled articles, in display order', async () => {
    const { service } = harness(
      [
        categoryRow({ id: 'kb_cat_b', isEnabled: true, sortOrder: 1 }),
        categoryRow({ id: 'kb_cat_a', isEnabled: true, sortOrder: 0 }),
        categoryRow({ id: 'kb_cat_hidden', isEnabled: false, sortOrder: -1 }),
      ],
      [
        articleRow({ id: 'kb_art_1', categoryId: 'kb_cat_a', isEnabled: true, sortOrder: 0 }),
        articleRow({ id: 'kb_art_hidden', categoryId: 'kb_cat_a', isEnabled: false, sortOrder: 1 }),
      ],
    );

    const { categories } = await service.listPublicContent();

    expect(categories.map((entry) => entry.id)).toEqual(['kb_cat_a', 'kb_cat_b']);
    expect(categories[0]?.articles.map((entry) => entry.id)).toEqual(['kb_art_1']);
  });
});

describe('KbService.createCategory', () => {
  it('creates a row and records who added it', async () => {
    const { service, record } = harness([]);

    const { category } = await service.createCategory(
      { slug: 'getting-started', name: 'شروع کار', description: '', icon: 'book-open', isEnabled: true, sortOrder: 0 },
      ACTOR,
    );

    expect(category.name).toBe('شروع کار');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string; before: unknown };
    expect(entry.action).toBe('KB_CATEGORY_CREATED');
    expect(entry.before).toBeNull();
  });
});

describe('KbService.updateCategory', () => {
  it('fails cleanly when the row is missing', async () => {
    const { service } = harness([]);

    await expect(
      service.updateCategory(
        'kb_cat_missing',
        { slug: 'getting-started', name: 'شروع کار', description: '', icon: 'book-open', isEnabled: true, sortOrder: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
  });
});

describe('KbService.removeCategory', () => {
  it('deletes the row and records the deletion', async () => {
    const { service, record, categories } = harness([categoryRow({ id: 'kb_cat_1' })]);

    const { id } = await service.removeCategory('kb_cat_1', ACTOR);

    expect(id).toBe('kb_cat_1');
    expect(categories).toHaveLength(0);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string; after: unknown };
    expect(entry.action).toBe('KB_CATEGORY_DELETED');
    expect(entry.after).toBeNull();
  });

  it('fails cleanly when the row is missing', async () => {
    const { service } = harness([]);

    await expect(service.removeCategory('kb_cat_missing', ACTOR)).rejects.toThrow(BaratDomainException);
  });
});

describe('KbService.createArticle', () => {
  it('fails cleanly when the category is missing', async () => {
    const { service } = harness([]);

    await expect(
      service.createArticle(
        {
          categoryId: 'kb_cat_missing',
          slug: 'what-is-barat',
          title: 'برات چیست؟',
          excerpt: '',
          content: 'محتوای مقاله',
          isEnabled: true,
          isPromoted: false,
          sortOrder: 0,
        },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
  });

  it('creates a row and records who added it', async () => {
    const { service, record } = harness([categoryRow({ id: 'kb_cat_1' })]);

    const { article } = await service.createArticle(
      {
        categoryId: 'kb_cat_1',
        slug: 'what-is-barat',
        title: 'برات چیست؟',
        excerpt: '',
        content: 'محتوای مقاله',
        isEnabled: true,
        isPromoted: false,
        sortOrder: 0,
      },
      ACTOR,
    );

    expect(article.title).toBe('برات چیست؟');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string };
    expect(entry.action).toBe('KB_ARTICLE_CREATED');
  });
});

describe('KbService.removeArticle', () => {
  it('deletes the row and records the deletion', async () => {
    const { service, record, articles } = harness(
      [categoryRow({ id: 'kb_cat_1' })],
      [articleRow({ id: 'kb_art_1', categoryId: 'kb_cat_1' })],
    );

    const { id } = await service.removeArticle('kb_art_1', ACTOR);

    expect(id).toBe('kb_art_1');
    expect(articles).toHaveLength(0);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string; after: unknown };
    expect(entry.action).toBe('KB_ARTICLE_DELETED');
    expect(entry.after).toBeNull();
  });

  it('fails cleanly when the row is missing', async () => {
    const { service } = harness([]);

    await expect(service.removeArticle('kb_art_missing', ACTOR)).rejects.toThrow(BaratDomainException);
  });
});
