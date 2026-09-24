import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { EmptyState } from "@barat/ui";
import { KbIcon } from "@/components/kb-icon";
import { KbSearch } from "@/components/kb-search";
import { flattenArticles, getKbContent } from "@/lib/kb";

export const metadata: Metadata = {
  title: "راهنما",
  description: "پایگاه دانش برات — راهنمای خرید گیفت‌کارت، پرداخت بین‌المللی، سفارش‌ها و پشتیبانی.",
};

export default async function HelpPage() {
  const categories = await getKbContent();
  const flattened = flattenArticles(categories);
  const promoted = flattened.filter(({ article }) => article.isPromoted);

  return (
    <main className="page container">
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div className="eyebrow">راهنما</div>
        <h1 className="h2">چطور می‌توانیم کمک کنیم؟</h1>
        <p className="muted" style={{ marginBottom: 22 }}>
          پاسخ پرسش‌های رایج دربارهٔ خرید گیفت‌کارت، پرداخت بین‌المللی، سفارش و پشتیبانی را اینجا پیدا کنید.
        </p>
        <KbSearch entries={flattened} />
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy />}
          title="راهنما هنوز خالی است"
          description="مقاله‌ای برای نمایش ثبت نشده. لطفاً بعداً دوباره سر بزنید."
        />
      ) : (
        <>
          <div className="grid catalog-grid" style={{ marginTop: 8 }}>
            {categories.map((category) => (
              <Link key={category.id} href={`/help/${category.slug}`} className="card kb-category-card">
                <span className="kb-category-icon">
                  <KbIcon iconKey={category.icon} size={22} />
                </span>
                <h3>{category.name}</h3>
                {category.description ? <p>{category.description}</p> : null}
                <span className="kb-category-card-count">{category.articles.length} مقاله</span>
              </Link>
            ))}
          </div>

          {promoted.length > 0 ? (
            <div style={{ marginTop: 44 }}>
              <h2 className="h3" style={{ marginBottom: 14 }}>مقاله‌های پرطرفدار</h2>
              <div className="kb-promoted-list">
                {promoted.map(({ article, category }) => (
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
            </div>
          ) : null}
        </>
      )}

      <div className="faq-help-link" style={{ textAlign: "center", marginTop: 44 }}>
        <Link className="btn btn-outline" href="/account/support">ثبت تیکت پشتیبانی</Link>
      </div>
    </main>
  );
}
