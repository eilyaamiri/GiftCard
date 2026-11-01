import { jsonForInlineScript } from "@barat/ui";

/**
 * One schema.org object as a `<script type="application/ld+json">`.
 *
 * `jsonForInlineScript` escapes `<`, `>` and `&`, so an admin-edited string
 * holding `</script>` cannot close the element. `null` renders nothing, which
 * lets a caller pass `faqJsonLd(entries)` without checking for an empty list.
 */
export function JsonLd({ data }: Readonly<{ data: Record<string, unknown> | null }>) {
  if (data === null) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForInlineScript(data) }} />;
}
