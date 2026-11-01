import ReactMarkdown from "react-markdown";
import type { HomeIntro } from "@/lib/kb";

/**
 * The home page's descriptive text. Search engines read prose, and the rest of
 * the page is cards and links, so this is where the words people search for
 * live. The copy is a KB article, which staff edit without a deploy.
 *
 * The page already has its one `h1`, so the article's headings are pushed down
 * a level: a `#` in the Markdown becomes an `h2`, not a second `h1`. Markdown is
 * rendered without raw HTML, so nothing an editor types can inject markup.
 */
export function HomeIntroSection({ intro }: Readonly<{ intro: HomeIntro | null }>) {
  if (intro === null) return null;
  return (
    <section className="container section home-intro" aria-labelledby="home-intro-title">
      <h2 className="h2" id="home-intro-title">{intro.title}</h2>
      <div className="kb-article-body home-intro-body">
        <ReactMarkdown components={{ h1: "h2", h2: "h3", h3: "h4" }}>{intro.content}</ReactMarkdown>
      </div>
    </section>
  );
}
