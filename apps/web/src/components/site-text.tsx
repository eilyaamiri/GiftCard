import ReactMarkdown from "react-markdown";
import type { SiteArticle } from "@/lib/kb";

/**
 * A page's descriptive text. Search engines read prose, and the storefront's
 * pages are mostly cards and links, so this is where the words people search
 * for live. The copy is a KB article in the `site-content` category, which
 * staff edit without a deploy.
 *
 * Every page already has its one `h1`, so the article's headings are pushed
 * down a level: a `#` in the Markdown becomes an `h2`, not a second `h1`.
 * Markdown is rendered without raw HTML, so nothing an editor types can inject
 * markup. `className` is the caller's layout: the home page's `<main>` has no
 * container of its own, the other pages are already inside one.
 */
export function SiteTextSection({
  article,
  id,
  className,
}: Readonly<{ article: SiteArticle | null; id: string; className: string }>) {
  if (article === null) return null;
  return (
    <section className={`${className} site-text`} aria-labelledby={id}>
      <h2 className="h2" id={id}>{article.title}</h2>
      <div className="kb-article-body site-text-body">
        <ReactMarkdown components={{ h1: "h2", h2: "h3", h3: "h4" }}>{article.content}</ReactMarkdown>
      </div>
    </section>
  );
}
