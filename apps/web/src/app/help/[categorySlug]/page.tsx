import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import { EmptyState } from "@barat/ui";
import { KbIcon } from "@/components/kb-icon";
import { getKbContent } from "@/lib/kb";

async function loadCategory(categorySlug: string) {
  const categories = await getKbContent();
  return categories.find((category) => category.slug === categorySlug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}): Promise<Metadata> {
  const category = await loadCategory((await params).categorySlug);
  if (category === null) return {};
  return { title: `${category.name} — راهنما`, description: category.description || undefined };
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ categorySlug: string }>;
}) {
  const category = await loadCategory((await params).categorySlug);
  if (category === null) notFound();

  return (
    <main className="page container">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/help">راهنما</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <span aria-current="page">{category.name}</span>
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <span className="kb-category-icon">
          <KbIcon iconKey={category.icon} size={22} />
        </span>
        <h1 className="h2" style={{ margin: 0 }}>{category.name}</h1>
      </div>
      {category.description ? <p className="muted">{category.description}</p> : null}

      {category.articles.length === 0 ? (
        <EmptyState
          title="این دسته هنوز مقاله‌ای ندارد"
          description="به‌زودی مقاله‌های این بخش اضافه می‌شود."
        />
      ) : (
        <div className="kb-promoted-list" style={{ marginTop: 22 }}>
          {category.articles.map((article) => (
            <Link
              key={article.id}
              href={`/help/${category.slug}/${article.slug}`}
              className="card kb-article-row"
            >
              <span>
                <h3>{article.title}</h3>
                {article.excerpt ? <p>{article.excerpt}</p> : null}
              </span>
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
