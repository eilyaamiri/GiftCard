import Link from "next/link";
import { ChevronDown, MessageCircleQuestion } from "lucide-react";
import { FAQ_ENTRIES, type FaqEntry } from "@/lib/faq";

/**
 * The closing section of a page: the questions someone is still holding when
 * they have finished scrolling.
 *
 * Built on `<details>` rather than on the shared `Accordion`. That component
 * unmounts a collapsed answer, which is the right call inside the panel but the
 * wrong one here — these answers are the page's most searchable text, and text
 * that is not in the HTML cannot be indexed, found by the browser's own
 * find-in-page, or read before JavaScript arrives. `<details>` also brings the
 * expand/collapse semantics, the keyboard handling and the screen-reader state
 * with it instead of us re-declaring them.
 *
 * `name` makes the group exclusive: opening one answer closes the last. Browsers
 * that do not know the attribute simply let several stand open, which is a
 * perfectly good FAQ too.
 */
function FaqItem({ entry, group }: Readonly<{ entry: FaqEntry; group: string }>) {
  return (
    <details className="faq-item" name={group}>
      <summary className="faq-question">
        <span>{entry.question}</span>
        <ChevronDown className="faq-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="faq-answer">
        <p>{entry.answer}</p>
      </div>
    </details>
  );
}

/**
 * `group` only has to be unique per page, but it is a prop because two of these
 * on one page would otherwise close each other's answers.
 *
 * `action` is where someone goes when the list did not answer them. It differs
 * by page: from the landing page that is the help page itself, and on the help
 * page — where a link back to the help page would be a link to nowhere — it is
 * the support desk.
 */
export function FaqSection({
  entries = FAQ_ENTRIES,
  group = "barat-faq",
  eyebrow = "پیش از خرید",
  action = { href: "/help", label: "هنوز سؤالی دارید؟" },
}: Readonly<{
  entries?: readonly FaqEntry[];
  group?: string;
  eyebrow?: string;
  action?: { readonly href: string; readonly label: string };
}>) {
  if (entries.length === 0) return null;

  /* The same questions again, in the shape a search engine reads. It is emitted
   * from here rather than from the page so the two can never fall out of step. */
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };

  return (
    <section className="container section faq-section" aria-labelledby="faq-heading">
      <div className="faq-layout">
        <div className="faq-intro">
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="h2" id="faq-heading">سؤال‌های متداول</h2>
          <p className="muted">
            کوتاه‌ترین پاسخ‌ها به چیزهایی که بیشتر از ما می‌پرسند — دربارهٔ زمان تحویل، قیمت و پیگیری سفارش.
          </p>
          <Link className="btn btn-outline faq-help-link" href={action.href}>
            <MessageCircleQuestion size={16} aria-hidden="true" />
            {action.label}
          </Link>
        </div>

        <div className="faq-list">
          {entries.map((entry) => <FaqItem key={entry.id} entry={entry} group={group} />)}
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </section>
  );
}
