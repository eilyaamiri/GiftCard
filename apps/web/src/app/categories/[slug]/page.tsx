import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import { ErrorState } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";
import { visibleBrandsQuery } from "@/lib/brand-art";
import { categoryLinkHref, type Category } from "@/lib/catalog";
import { CategoryIcon } from "@/components/category-icon";
import { visibleCategoryLinks } from "@/lib/features";
import { categoryArticleSlug, getSiteArticle } from "@/lib/kb";
import { SiteTextSection } from "@/components/site-text";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

/* The page and `generateMetadata` both need the list; `cache` shares one request. */
const loadCategories = cache(async () => (await api.categories(visibleBrandsQuery())).items);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const category = (await loadCategories()).find((item) => item.slug === slug && item.kind === "SERVICES");
    if (category === undefined) return {};
    return pageMetadata({
      title: category.nameFa,
      description: category.descriptionFa ?? undefined,
      path: `/categories/${encodeURIComponent(category.slug)}`,
    });
  } catch {
    return {};
  }
}

/**
 * A service-list category: a hand-curated set of links, each one to the page
 * of a service that is sold elsewhere on the site. Nothing here is a copy of
 * that service — the label and destination are read from it.
 *
 * A category with nothing a customer can follow is a 404, the same rule that
 * keeps it out of the menu and the home strip.
 */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let categories: readonly Category[];
  try {
    categories = await loadCategories();
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="فهرست این دسته‌بندی در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href={`/categories/${encodeURIComponent(slug)}`}>تلاش دوباره</Link>}
        />
      </main>
    );
  }

  const category = categories.find((item) => item.slug === slug && item.kind === "SERVICES");
  const links = category === undefined ? [] : visibleCategoryLinks(category.links);
  if (category === undefined || links.length === 0) notFound();
  const siteText = await getSiteArticle(categoryArticleSlug(category.slug));

  return (
    <main className="page container">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "خانه", path: "/" },
          { name: category.nameFa, path: `/categories/${encodeURIComponent(category.slug)}` },
        ])}
      />
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/">خانه</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <span aria-current="page">{category.nameFa}</span>
      </nav>
      <h1 className="h2">{category.nameFa}</h1>
      {category.descriptionFa ? <p className="muted catalog-lead">{category.descriptionFa}</p> : null}

      <ul className="grid catalog-grid" style={{ marginTop: 22, padding: 0, listStyle: "none" }}>
        {links.map((link) => (
          <li key={link.id}>
            <Link href={categoryLinkHref(link)} className="card service-card">
              <div className="service-card-body">
                <span className="category-tile-icon" aria-hidden="true">
                  <CategoryIcon iconKey={category.iconKey} size={18} />
                </span>
                <h3>{link.title}</h3>
                <span className="service-card-action">
                  مشاهده <ArrowLeft size={14} aria-hidden="true" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <SiteTextSection article={siteText} id="category-text-title" className="section" />
    </main>
  );
}
