/**
 * Walks a paginated list to the end.
 *
 * The sitemap needs every product, and the catalog API caps a page at 100. A
 * hard `maxPages` keeps a runaway `totalPages` (or a server that ignores the
 * page number and keeps answering page 1) from looping forever.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ readonly items: readonly T[]; readonly meta: { readonly totalPages: number } }>,
  maxPages = 100,
): Promise<readonly T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    all.push(...result.items);
    if (page >= result.meta.totalPages || result.items.length === 0) break;
  }
  return all;
}
