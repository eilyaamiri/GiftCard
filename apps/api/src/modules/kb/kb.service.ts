import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import type {
  CreateKbArticleInput,
  CreateKbCategoryInput,
  UpdateKbArticleInput,
  UpdateKbCategoryInput,
} from './kb.schemas';

export const KB_DATABASE = Symbol('KB_DATABASE');

export type KbDatabase = Pick<PrismaClient, 'kbCategory' | 'kbArticle'>;

export const KB_CATEGORY_CREATED_AUDIT_ACTION = 'KB_CATEGORY_CREATED';
export const KB_CATEGORY_UPDATED_AUDIT_ACTION = 'KB_CATEGORY_UPDATED';
export const KB_CATEGORY_DELETED_AUDIT_ACTION = 'KB_CATEGORY_DELETED';
export const KB_ARTICLE_CREATED_AUDIT_ACTION = 'KB_ARTICLE_CREATED';
export const KB_ARTICLE_UPDATED_AUDIT_ACTION = 'KB_ARTICLE_UPDATED';
export const KB_ARTICLE_DELETED_AUDIT_ACTION = 'KB_ARTICLE_DELETED';

/** What a customer sees: only published articles, in display order. */
export interface PublicKbArticleDto {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly isPromoted: boolean;
}

/** A published category with its published articles nested, in display order. */
export interface PublicKbCategoryDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly articles: readonly PublicKbArticleDto[];
}

/** What an admin edits: every row, published or not. */
export interface AdminKbArticleDto {
  readonly id: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly isEnabled: boolean;
  readonly isPromoted: boolean;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface AdminKbCategoryDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
  readonly updatedAt: string;
  readonly articles: readonly AdminKbArticleDto[];
}

interface KbActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  icon: true,
  isEnabled: true,
  sortOrder: true,
  updatedAt: true,
} as const;

const ARTICLE_SELECT = {
  id: true,
  categoryId: true,
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  isEnabled: true,
  isPromoted: true,
  sortOrder: true,
  updatedAt: true,
} as const;

/**
 * The storefront's knowledge base (`/help`) and the admin controls for it.
 *
 * Both categories and articles are open-ended sets, same as `FaqsService` —
 * an admin creates and removes rows freely rather than editing a fixed list.
 */
@Injectable()
export class KbService {
  constructor(
    @Inject(KB_DATABASE) private readonly database: KbDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listPublicContent(): Promise<{ categories: readonly PublicKbCategoryDto[] }> {
    const rows = await this.database.kbCategory.findMany({
      where: { isEnabled: true },
      select: {
        ...CATEGORY_SELECT,
        articles: {
          where: { isEnabled: true },
          select: ARTICLE_SELECT,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      categories: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        icon: row.icon,
        articles: row.articles.map((article) => ({
          id: article.id,
          slug: article.slug,
          title: article.title,
          excerpt: article.excerpt,
          content: article.content,
          isPromoted: article.isPromoted,
        })),
      })),
    };
  }

  async listForAdmin(): Promise<{ categories: readonly AdminKbCategoryDto[] }> {
    const rows = await this.database.kbCategory.findMany({
      select: {
        ...CATEGORY_SELECT,
        articles: { select: ARTICLE_SELECT, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return { categories: rows.map(toAdminCategoryView) };
  }

  async createCategory(input: CreateKbCategoryInput, actor: KbActor): Promise<{ category: AdminKbCategoryDto }> {
    const created = await this.database.kbCategory.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        icon: input.icon,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: { ...CATEGORY_SELECT, articles: { select: ARTICLE_SELECT } },
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_CATEGORY_CREATED_AUDIT_ACTION,
      entity: 'KbCategory',
      entityId: created.id,
      before: null,
      after: { slug: created.slug, name: created.name, isEnabled: created.isEnabled, sortOrder: created.sortOrder },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { category: toAdminCategoryView(created) };
  }

  async updateCategory(
    id: string,
    input: UpdateKbCategoryInput,
    actor: KbActor,
  ): Promise<{ category: AdminKbCategoryDto }> {
    const current = await this.database.kbCategory.findUnique({ where: { id }, select: CATEGORY_SELECT });
    if (current === null) {
      throw DomainErrors.notFound('kb category');
    }

    const updated = await this.database.kbCategory.update({
      where: { id },
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        icon: input.icon,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: { ...CATEGORY_SELECT, articles: { select: ARTICLE_SELECT } },
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_CATEGORY_UPDATED_AUDIT_ACTION,
      entity: 'KbCategory',
      entityId: current.id,
      before: { slug: current.slug, name: current.name, isEnabled: current.isEnabled, sortOrder: current.sortOrder },
      after: { slug: updated.slug, name: updated.name, isEnabled: updated.isEnabled, sortOrder: updated.sortOrder },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { category: toAdminCategoryView(updated) };
  }

  async removeCategory(id: string, actor: KbActor): Promise<{ id: string }> {
    const current = await this.database.kbCategory.findUnique({ where: { id }, select: CATEGORY_SELECT });
    if (current === null) {
      throw DomainErrors.notFound('kb category');
    }

    await this.database.kbCategory.delete({ where: { id } });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_CATEGORY_DELETED_AUDIT_ACTION,
      entity: 'KbCategory',
      entityId: current.id,
      before: { slug: current.slug, name: current.name, isEnabled: current.isEnabled, sortOrder: current.sortOrder },
      after: null,
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { id };
  }

  async createArticle(input: CreateKbArticleInput, actor: KbActor): Promise<{ article: AdminKbArticleDto }> {
    const category = await this.database.kbCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (category === null) {
      throw DomainErrors.notFound('kb category');
    }

    const created = await this.database.kbArticle.create({
      data: {
        categoryId: input.categoryId,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        content: input.content,
        isEnabled: input.isEnabled,
        isPromoted: input.isPromoted,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: ARTICLE_SELECT,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_ARTICLE_CREATED_AUDIT_ACTION,
      entity: 'KbArticle',
      entityId: created.id,
      before: null,
      after: { slug: created.slug, title: created.title, isEnabled: created.isEnabled, isPromoted: created.isPromoted },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { article: toAdminArticleView(created) };
  }

  async updateArticle(
    id: string,
    input: UpdateKbArticleInput,
    actor: KbActor,
  ): Promise<{ article: AdminKbArticleDto }> {
    const current = await this.database.kbArticle.findUnique({ where: { id }, select: ARTICLE_SELECT });
    if (current === null) {
      throw DomainErrors.notFound('kb article');
    }

    if (input.categoryId !== current.categoryId) {
      const category = await this.database.kbCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
      if (category === null) {
        throw DomainErrors.notFound('kb category');
      }
    }

    const updated = await this.database.kbArticle.update({
      where: { id },
      data: {
        categoryId: input.categoryId,
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        content: input.content,
        isEnabled: input.isEnabled,
        isPromoted: input.isPromoted,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: ARTICLE_SELECT,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_ARTICLE_UPDATED_AUDIT_ACTION,
      entity: 'KbArticle',
      entityId: current.id,
      before: { slug: current.slug, title: current.title, isEnabled: current.isEnabled, isPromoted: current.isPromoted },
      after: { slug: updated.slug, title: updated.title, isEnabled: updated.isEnabled, isPromoted: updated.isPromoted },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { article: toAdminArticleView(updated) };
  }

  async removeArticle(id: string, actor: KbActor): Promise<{ id: string }> {
    const current = await this.database.kbArticle.findUnique({ where: { id }, select: ARTICLE_SELECT });
    if (current === null) {
      throw DomainErrors.notFound('kb article');
    }

    await this.database.kbArticle.delete({ where: { id } });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: KB_ARTICLE_DELETED_AUDIT_ACTION,
      entity: 'KbArticle',
      entityId: current.id,
      before: { slug: current.slug, title: current.title, isEnabled: current.isEnabled, isPromoted: current.isPromoted },
      after: null,
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { id };
  }
}

function toAdminArticleView(row: {
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
}): AdminKbArticleDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    isEnabled: row.isEnabled,
    isPromoted: row.isPromoted,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAdminCategoryView(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  isEnabled: boolean;
  sortOrder: number;
  updatedAt: Date;
  articles: readonly {
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
  }[];
}): AdminKbCategoryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    isEnabled: row.isEnabled,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
    articles: row.articles.map(toAdminArticleView),
  };
}
