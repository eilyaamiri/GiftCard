import Image from "next/image";
import type { ReactNode } from "react";
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
      <nav className="service-information-nav" aria-label="بخش‌های معرفی خدمت">
        {article.blocks.map((block, i) => block.kind === "heading" ?
          <a key={i} href={`#service-section-${i}`}>{block.text}</a> : null)}
      </nav>
      {renderBlocks(article.blocks)}
    </article>
  );
}

function renderBlocks(blocks: readonly Block[]): ReactNode[] {
  const result: ReactNode[] = [];
  let heading = "مقایسه امکانات";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block) continue;
    if (block.kind === "image") {
      result.push(<figure key={i} className="service-information-image">
        <Image src={block.src} alt={block.alt} width={block.width} height={block.height}
          sizes="(max-width: 600px) 85vw, 360px" />
      </figure>);
      continue;
    }
    if (block.kind === "heading") {
      heading = block.text;
      result.push(<h3 key={i} id={`service-section-${i}`}>{block.text}</h3>);
      continue;
    }
    // The supplied document represents comparison tables as consecutive pipe rows.
    // Keep all cell text and column order, while providing semantic table markup.
    if (block.text.includes("|")) {
      const rows: string[][] = [];
      const columns = block.text.split("|").length;
      let end = i;
      while (end < blocks.length) {
        const row = blocks[end];
        if (!row || row.kind !== "paragraph" || row.text.split("|").length !== columns) break;
        rows.push(row.text.split("|").map((cell) => cell.trim()));
        end += 1;
      }
      if (rows.length > 1) {
        result.push(<div key={i} className="service-comparison-scroll" role="region" aria-label={heading} tabIndex={0}>
          <p className="service-comparison-hint">برای دیدن همه ستون‌ها، جدول را به چپ و راست بکشید.</p>
          <table className="service-comparison">
            <caption>{heading}</caption>
            <thead><tr>{rows[0]?.map((cell, column) => <th key={column} scope="col">{cell}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((row, n) => <tr key={n}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>);
        i = end - 1;
        continue;
      }
    }
    result.push(block.text.endsWith("؟") && block.text.length < 220
      ? <h4 key={i}>{block.text}</h4> : <p key={i}>{block.text}</p>);
  }
  return result;
}
