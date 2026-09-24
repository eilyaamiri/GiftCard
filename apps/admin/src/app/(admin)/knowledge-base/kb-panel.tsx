"use client";

import { useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";
import { Icon } from "@/components/icon-map";
import {
  KB_ICON_KEYS,
  kbArticleMutationSchema,
  kbCategoryMutationSchema,
  kbDeleteSchema,
  type KbArticle,
  type KbCategory,
  type KbIconKey,
} from "./kb-schema";

const ICON_LABELS: Record<KbIconKey, string> = {
  "book-open": "کتاب باز",
  "credit-card": "کارت پرداخت",
  gift: "هدیه",
  "life-buoy": "نجات‌غریق",
};

/**
 * Admin control over the storefront's knowledge base ("راهنما").
 *
 * Two open-ended sets, same as the FAQ panel: an admin adds, reorders,
 * edits or removes any category or article. Only enabled rows reach
 * `/help`, in ascending `sortOrder`; picking a category on the left shows
 * its articles on the right.
 */
export function KbPanel({ initialCategories }: { initialCategories: readonly KbCategory[] }) {
  const [categories, setCategories] = useState([...initialCategories]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCategories[0]?.id ?? null);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [creatingArticle, setCreatingArticle] = useState(false);

  const sortedCategories = [...categories].sort((first, second) => first.sortOrder - second.sortOrder);
  const selected = categories.find((category) => category.id === selectedId) ?? null;
  const liveCategoryCount = categories.filter((category) => category.isEnabled).length;

  function replaceCategory(updated: KbCategory) {
    setCategories((current) => current.map((row) => (row.id === updated.id ? updated : row)));
  }

  function replaceArticleInCategory(categoryId: string, updated: KbArticle) {
    setCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? { ...category, articles: category.articles.map((row) => (row.id === updated.id ? updated : row)) }
          : category,
      ),
    );
  }

  function removeArticleFromCategory(categoryId: string, articleId: string) {
    setCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? { ...category, articles: category.articles.filter((row) => row.id !== articleId) }
          : category,
      ),
    );
  }

  return (
    <div className="kb-layout">
      <section className="settings-ledger" aria-labelledby="kb-categories-title">
        <header className="settings-ledger-head">
          <div>
            <h2 id="kb-categories-title">دسته‌ها</h2>
            <p>موضوع‌های اصلی پایگاه دانش که در صفحهٔ راهنما نمایش داده می‌شود.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="settings-count">{toPersianDigits(liveCategoryCount)} دستهٔ فعال</span>
            <button type="button" className="primary-btn" onClick={() => setCreatingCategory((open) => !open)}>
              {creatingCategory ? "بستن فرم" : "افزودن دسته"}
            </button>
          </div>
        </header>

        {creatingCategory ? (
          <CreateCategoryForm
            onCreated={(created) => {
              setCategories((current) => [...current, created]);
              setSelectedId(created.id);
              setCreatingCategory(false);
            }}
            onCancel={() => setCreatingCategory(false)}
          />
        ) : null}

        {sortedCategories.length === 0 ? (
          <p className="empty-hint">هنوز دسته‌ای ثبت نشده است.</p>
        ) : (
          <div className="kb-category-list">
            {sortedCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`kb-category-item${category.id === selectedId ? " is-selected" : ""}`}
                onClick={() => setSelectedId(category.id)}
              >
                <Icon name={category.icon} size={16} />
                <span>{category.name}</span>
                <span className={`badge ${category.isEnabled ? "badge-success" : "badge-danger"}`}>
                  {category.isEnabled ? "فعال" : "غیرفعال"}
                </span>
                <span className="kb-category-count">{toPersianDigits(category.articles.length)} مقاله</span>
              </button>
            ))}
          </div>
        )}

        {selected ? (
          <CategoryRow
            key={selected.id}
            category={selected}
            onSaved={replaceCategory}
            onDeleted={(id) => {
              setCategories((current) => current.filter((row) => row.id !== id));
              setSelectedId((current) => (current === id ? null : current));
            }}
          />
        ) : null}
      </section>

      <section className="settings-ledger" aria-labelledby="kb-articles-title">
        <header className="settings-ledger-head">
          <div>
            <h2 id="kb-articles-title">مقاله‌ها</h2>
            <p>{selected ? `مقاله‌های دستهٔ «${selected.name}»` : "برای دیدن مقاله‌ها یک دسته انتخاب کنید."}</p>
          </div>
          {selected ? (
            <button type="button" className="primary-btn" onClick={() => setCreatingArticle((open) => !open)}>
              {creatingArticle ? "بستن فرم" : "افزودن مقاله"}
            </button>
          ) : null}
        </header>

        {selected === null ? null : (
          <>
            {creatingArticle ? (
              <CreateArticleForm
                categoryId={selected.id}
                onCreated={(created) => {
                  setCategories((current) =>
                    current.map((category) =>
                      category.id === selected.id
                        ? { ...category, articles: [...category.articles, created] }
                        : category,
                    ),
                  );
                  setCreatingArticle(false);
                }}
                onCancel={() => setCreatingArticle(false)}
              />
            ) : null}

            {selected.articles.length === 0 ? (
              <p className="empty-hint">هنوز مقاله‌ای در این دسته ثبت نشده است.</p>
            ) : (
              <div className="settings-rows">
                {[...selected.articles]
                  .sort((first, second) => first.sortOrder - second.sortOrder)
                  .map((article) => (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      onSaved={(updated) => replaceArticleInCategory(selected.id, updated)}
                      onDeleted={(id) => removeArticleFromCategory(selected.id, id)}
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function CreateCategoryForm({
  onCreated,
  onCancel,
}: {
  onCreated: (category: KbCategory) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<KbIconKey>("book-open");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const validName = name.trim().length >= 2 && name.trim().length <= 80;
  const complete = validSlug && validName;

  function submit() {
    if (!complete) {
      setError("اسلاگ و نام دسته را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post(
          "/api/admin/knowledge-base/categories",
          { slug: slug.trim(), name: name.trim(), description: description.trim(), icon },
          kbCategoryMutationSchema,
        );
        onCreated(response.category);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="settings-create-card">
      <div className="form-grid">
        <label>
          اسلاگ (انگلیسی)
          <input dir="ltr" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={pending} />
        </label>
        <label>
          نام دسته
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={pending} />
        </label>
        <label className="settings-reason-field">
          توضیح
          <textarea
            value={description}
            maxLength={300}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          آیکون
          <select value={icon} onChange={(event) => setIcon(event.target.value as KbIconKey)} disabled={pending}>
            {KB_ICON_KEYS.map((key) => (
              <option key={key} value={key}>
                {ICON_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="settings-row-actions">
        <button type="button" className="secondary-btn" onClick={onCancel} disabled={pending}>
          انصراف
        </button>
        <button type="button" className="primary-btn" onClick={submit} disabled={!complete || pending}>
          {pending ? "در حال ساخت…" : "افزودن دسته"}
        </button>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
    </div>
  );
}

function CategoryRow({
  category,
  onSaved,
  onDeleted,
}: {
  category: KbCategory;
  onSaved: (category: KbCategory) => void;
  onDeleted: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(category.isEnabled);
  const [slug, setSlug] = useState(category.slug);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description);
  const [icon, setIcon] = useState<KbIconKey>(category.icon);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedOrder = Number(sortOrder);
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 999;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const validName = name.trim().length >= 2 && name.trim().length <= 80;
  const changed =
    enabled !== category.isEnabled ||
    slug !== category.slug ||
    name !== category.name ||
    description !== category.description ||
    icon !== category.icon ||
    parsedOrder !== category.sortOrder;

  function reset() {
    setEnabled(category.isEnabled);
    setSlug(category.slug);
    setName(category.name);
    setDescription(category.description);
    setIcon(category.icon);
    setSortOrder(String(category.sortOrder));
    setError(null);
    setNotice(null);
  }

  function save() {
    if (!changed || !validOrder || !validSlug || !validName) {
      setError("اسلاگ، نام و ترتیب را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/knowledge-base/categories/${encodeURIComponent(category.id)}`,
          { slug: slug.trim(), name: name.trim(), description: description.trim(), icon, isEnabled: enabled, sortOrder: parsedOrder },
          kbCategoryMutationSchema,
        );
        onSaved(response.category);
        setNotice("تغییرات دسته ثبت شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function remove() {
    if (!window.confirm("این دسته و همهٔ مقاله‌های آن برای همیشه حذف شود؟")) return;
    startTransition(async () => {
      setError(null);
      try {
        await api.del(`/api/admin/knowledge-base/categories/${encodeURIComponent(category.id)}`, kbDeleteSchema);
        onDeleted(category.id);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <article className={`settings-row${enabled ? " is-on" : " is-off"}`}>
      <div className="settings-row-main">
        <div className="settings-status-rail" aria-hidden="true" />
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>{name}</strong>
            <span className={`badge ${enabled ? "badge-success" : "badge-danger"}`}>
              {enabled ? "فعال" : "غیرفعال"}
            </span>
            {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
          </div>
          <code className="settings-key" dir="ltr">{slug}</code>
        </div>
        <label className="switch" aria-label={`وضعیت دستهٔ ${name}`}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={pending} />
          <span className="slider" />
        </label>
      </div>

      <div className="settings-row-editor kb-row-editor">
        <label>
          اسلاگ (انگلیسی)
          <input
            dir="ltr"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          نام دسته
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={pending} />
        </label>
        <label className="settings-reason-field settings-full">
          توضیح
          <textarea
            value={description}
            maxLength={300}
            rows={2}
            onChange={(event) => setDescription(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          آیکون
          <select value={icon} onChange={(event) => setIcon(event.target.value as KbIconKey)} disabled={pending}>
            {KB_ICON_KEYS.map((key) => (
              <option key={key} value={key}>
                {ICON_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          ترتیب نمایش
          <input
            type="number"
            min="0"
            max="999"
            step="1"
            inputMode="numeric"
            dir="ltr"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            disabled={pending}
          />
        </label>
        <div className="settings-row-actions settings-full">
          <button type="button" className="secondary-btn settings-danger" onClick={remove} disabled={pending}>
            حذف دسته
          </button>
          <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || pending}>
            بازنشانی
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={save}
            disabled={!changed || !validOrder || !validSlug || !validName || pending}
          >
            {pending ? "در حال ثبت…" : "ثبت تغییر دسته"}
          </button>
        </div>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function CreateArticleForm({
  categoryId,
  onCreated,
  onCancel,
}: {
  categoryId: string;
  onCreated: (article: KbArticle) => void;
  onCancel: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const validTitle = title.trim().length >= 2 && title.trim().length <= 200;
  const validContent = content.trim().length >= 4 && content.trim().length <= 20000;
  const complete = validSlug && validTitle && validContent;

  function submit() {
    if (!complete) {
      setError("اسلاگ، عنوان و متن مقاله را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post(
          "/api/admin/knowledge-base/articles",
          { categoryId, slug: slug.trim(), title: title.trim(), excerpt: excerpt.trim(), content: content.trim() },
          kbArticleMutationSchema,
        );
        onCreated(response.article);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="settings-create-card">
      <div className="form-grid">
        <label>
          اسلاگ (انگلیسی)
          <input dir="ltr" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={pending} />
        </label>
        <label>
          عنوان
          <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={pending} />
        </label>
        <label>
          چکیده
          <input value={excerpt} maxLength={300} onChange={(event) => setExcerpt(event.target.value)} disabled={pending} />
        </label>
        <label className="settings-reason-field">
          متن مقاله (Markdown)
          <textarea
            value={content}
            maxLength={20000}
            rows={8}
            dir="rtl"
            onChange={(event) => setContent(event.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <div className="settings-row-actions">
        <button type="button" className="secondary-btn" onClick={onCancel} disabled={pending}>
          انصراف
        </button>
        <button type="button" className="primary-btn" onClick={submit} disabled={!complete || pending}>
          {pending ? "در حال ساخت…" : "افزودن مقاله"}
        </button>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
    </div>
  );
}

function ArticleRow({
  article,
  onSaved,
  onDeleted,
}: {
  article: KbArticle;
  onSaved: (article: KbArticle) => void;
  onDeleted: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(article.isEnabled);
  const [promoted, setPromoted] = useState(article.isPromoted);
  const [slug, setSlug] = useState(article.slug);
  const [title, setTitle] = useState(article.title);
  const [excerpt, setExcerpt] = useState(article.excerpt);
  const [content, setContent] = useState(article.content);
  const [sortOrder, setSortOrder] = useState(String(article.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedOrder = Number(sortOrder);
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 999;
  const validSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.trim());
  const validTitle = title.trim().length >= 2 && title.trim().length <= 200;
  const validContent = content.trim().length >= 4 && content.trim().length <= 20000;
  const changed =
    enabled !== article.isEnabled ||
    promoted !== article.isPromoted ||
    slug !== article.slug ||
    title !== article.title ||
    excerpt !== article.excerpt ||
    content !== article.content ||
    parsedOrder !== article.sortOrder;

  function reset() {
    setEnabled(article.isEnabled);
    setPromoted(article.isPromoted);
    setSlug(article.slug);
    setTitle(article.title);
    setExcerpt(article.excerpt);
    setContent(article.content);
    setSortOrder(String(article.sortOrder));
    setError(null);
    setNotice(null);
  }

  function save() {
    if (!changed || !validOrder || !validSlug || !validTitle || !validContent) {
      setError("اسلاگ، عنوان، متن و ترتیب را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/knowledge-base/articles/${encodeURIComponent(article.id)}`,
          {
            categoryId: article.categoryId,
            slug: slug.trim(),
            title: title.trim(),
            excerpt: excerpt.trim(),
            content: content.trim(),
            isEnabled: enabled,
            isPromoted: promoted,
            sortOrder: parsedOrder,
          },
          kbArticleMutationSchema,
        );
        onSaved(response.article);
        setNotice("تغییرات مقاله ثبت شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function remove() {
    if (!window.confirm("این مقاله برای همیشه حذف شود؟")) return;
    startTransition(async () => {
      setError(null);
      try {
        await api.del(`/api/admin/knowledge-base/articles/${encodeURIComponent(article.id)}`, kbDeleteSchema);
        onDeleted(article.id);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <article className={`settings-row${enabled ? " is-on" : " is-off"}`}>
      <div className="settings-row-main">
        <div className="settings-status-rail" aria-hidden="true" />
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>{title}</strong>
            <span className={`badge ${enabled ? "badge-success" : "badge-danger"}`}>
              {enabled ? "فعال" : "غیرفعال"}
            </span>
            {promoted ? <span className="badge badge-success">ویژه</span> : null}
            {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
          </div>
          <p>{excerpt || article.content.slice(0, 120)}</p>
        </div>
        <label className="switch" aria-label={`وضعیت مقالهٔ ${title}`}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={pending} />
          <span className="slider" />
        </label>
      </div>

      <div className="settings-row-editor kb-row-editor">
        <label>
          اسلاگ (انگلیسی)
          <input dir="ltr" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={pending} />
        </label>
        <label>
          عنوان
          <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={pending} />
        </label>
        <label>
          چکیده
          <input value={excerpt} maxLength={300} onChange={(event) => setExcerpt(event.target.value)} disabled={pending} />
        </label>
        <label>
          ترتیب نمایش
          <input
            type="number"
            min="0"
            max="999"
            step="1"
            inputMode="numeric"
            dir="ltr"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="settings-reason-field settings-full">
          متن مقاله (Markdown)
          <textarea
            value={content}
            maxLength={20000}
            rows={8}
            dir="rtl"
            onChange={(event) => setContent(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="kb-checkbox settings-full">
          <input type="checkbox" checked={promoted} onChange={(event) => setPromoted(event.target.checked)} disabled={pending} />
          ویژه (نمایش در صفحهٔ اصلی راهنما)
        </label>
        <div className="settings-row-actions settings-full">
          <button type="button" className="secondary-btn settings-danger" onClick={remove} disabled={pending}>
            حذف
          </button>
          <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || pending}>
            بازنشانی
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={save}
            disabled={!changed || !validOrder || !validSlug || !validTitle || !validContent || pending}
          >
            {pending ? "در حال ثبت…" : "ثبت تغییر"}
          </button>
        </div>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "ثبت تغییر ممکن نشد. دوباره تلاش کنید.";
}
