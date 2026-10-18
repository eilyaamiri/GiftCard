import type { ProductInfoTab } from "./product-info-tabs";

/*
 * No "use client" on purpose: server pages call `descriptionTabs` directly,
 * and Next refuses a server call into a function exported from a client file.
 */

/**
 * Description text as the catalogue stores it: plain text, where a blank line
 * starts a new paragraph. Never rendered as HTML — the copy is typed in the
 * admin panel and must not become markup on the storefront.
 */
export function DescriptionText({ text }: { readonly text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return (
    <div className="product-info-description">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

/** The tab set for a product, or none when it has nothing of its own to say. */
export function descriptionTabs(description: string | null | undefined): ProductInfoTab[] {
  const text = description?.trim() ?? "";
  return text === "" ? [] : [{ key: "description", label: "توضیحات محصول", content: <DescriptionText text={text} /> }];
}
