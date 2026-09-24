"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import type { FlattenedKbArticle } from "@/lib/kb";

/**
 * As-you-type article search for the knowledge base, filtering the already-
 * fetched list locally — the same shape `account-topbar-actions.tsx` uses for
 * the account panel's own search, right down to the `:focus-within`-driven
 * dropdown and the `font-size:16px` input (mobile Safari zooms in on focus
 * below that size — see PR #84).
 */
export function KbSearch({ entries }: Readonly<{ entries: readonly FlattenedKbArticle[] }>) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("fa");
  const results =
    normalizedQuery.length === 0
      ? []
      : entries.filter(({ article }) =>
          [article.title, article.excerpt, article.content].some((field) =>
            field.toLocaleLowerCase("fa").includes(normalizedQuery),
          ),
        );

  return (
    <div className="kb-search">
      <label className="kb-search-field">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
          placeholder="در راهنما جست‌وجو کنید…"
          aria-label="جست‌وجو در راهنما"
          autoComplete="off"
        />
      </label>
      {normalizedQuery ? (
        <div className="kb-search-results" role="listbox" aria-label="نتایج جست‌وجوی راهنما">
          {results.length > 0 ? (
            results.slice(0, 8).map(({ article, category }) => (
              <Link
                key={article.id}
                href={`/help/${category.slug}/${article.slug}`}
                className="kb-search-result"
                onClick={() => setQuery("")}
              >
                <span className="kb-search-result-title">{article.title}</span>
                <span className="kb-search-result-category">{category.name}</span>
              </Link>
            ))
          ) : (
            <p>مقاله‌ای با این عنوان پیدا نشد.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
