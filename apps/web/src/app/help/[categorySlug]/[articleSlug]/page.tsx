import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { JsonLd } from "@/components/json-ld";
import { getKbContent } from "@/lib/kb";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

/* Shared by the page and `generateMetadata`: one KB request per view, not two. */
const loadArticle = cache(async (categorySlug: string, articleSlug: string) => {
  const categories = await getKbContent();
  const category = categories.find((item) => item.slug === categorySlug);
  const article = category?.articles.find((item) => item.slug === articleSlug);
  if (category === undefined || article === undefined) return null;
  return { category, article };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categorySlug: string; articleSlug: string }>;
}): Promise<Metadata> {
  const { categorySlug, articleSlug } = await params;
  const found = await loadArticle(categorySlug, articleSlug);
  if (found === null) return {};
  return pageMetadata({
    title: `${found.article.title} — راهنما`,
    description: found.article.excerpt || undefined,
    path: `/help/${found.category.slug}/${found.article.slug}`,
  });
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ categorySlug: string; articleSlug: string }>;
}) {
  const { categorySlug, articleSlug } = await params;
  const found = await loadArticle(categorySlug, articleSlug);
  if (found === null) notFound();
  const { category, article } = found;

  return (
    <main className="page container">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "خانه", path: "/" },
          { name: "راهنما", path: "/help" },
          { name: category.name, path: `/help/${category.slug}` },
          { name: article.title, path: `/help/${category.slug}/${article.slug}` },
        ])}
      />
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/help">راهنما</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <Link href={`/help/${category.slug}`}>{category.name}</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <span aria-current="page">{article.title}</span>
      </nav>

      <h1 className="h2">{article.title}</h1>
      {article.excerpt ? <p className="muted">{article.excerpt}</p> : null}

      <div className="kb-article-body" style={{ marginTop: 22 }}>
        <ReactMarkdown>{article.content}</ReactMarkdown>
      </div>

      <div className="faq-help-link" style={{ marginTop: 44 }}>
        <p className="muted" style={{ marginBottom: 10 }}>پاسخ سؤالتان را پیدا نکردید؟</p>
        <Link className="btn btn-outline" href="/account/support">ثبت تیکت پشتیبانی</Link>
      </div>
    </main>
  );
}
