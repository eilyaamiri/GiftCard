import Image from "next/image";
import articles from "../content/international-services.json";

type Block =
  | { kind: "paragraph" | "heading"; text: string }
  | { kind: "image"; src: string; alt: string; width: number; height: number };
type Article = { title: string; category: string; blocks: Block[] };

/** Server-rendered content; no catalogue article enters the form's client bundle. */
export function ServiceInformation({ slug }: { readonly slug: string }) {
  const article = (articles as Record<string, Article>)[slug];
  if (!article) return null;

  return (
    <article className="service-information" aria-labelledby="service-information-title" dir="rtl">
      <header>
        <div className="eyebrow">{article.category}</div>
        <h2 id="service-information-title">درباره {article.title}</h2>
        <p className="muted service-information-note">
          امکانات، طرح‌ها و مبالغ ذکرشده در معرفی خدمات ممکن است تغییر کنند.
          موجودبودن طرح و شرایط انجام درخواست پیش از تکمیل سفارش بررسی می‌شود؛
          مبلغ قابل پرداخت همان قیمت نهایی نمایش‌داده‌شده در فرایند سفارش است.
        </p>
      </header>
      {article.blocks.map((block, i) => {
        if (block.kind === "image") {
          return (
            <figure key={i} className="service-information-image">
              <Image src={block.src} alt={block.alt} width={block.width} height={block.height}
                sizes="(max-width: 720px) 92vw, 680px" />
            </figure>
          );
        }
        if (block.kind === "heading") return <h3 key={i}>{block.text}</h3>;
        if (block.text.endsWith("؟") && block.text.length < 220) return <h4 key={i}>{block.text}</h4>;
        return <p key={i}>{block.text}</p>;
      })}
    </article>
  );
}
