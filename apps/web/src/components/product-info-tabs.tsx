"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ProductInfoTab {
  readonly key: string;
  readonly label: string;
  readonly content: ReactNode;
}

/**
 * The reading material under a product's order form: description, and later
 * FAQ and reviews.
 *
 * Follows the WAI-ARIA tabs pattern — arrow keys move between tabs, Home/End
 * jump to the ends, and only the active tab is in the Tab order — because a
 * strip of plain buttons reads to a screen reader as unrelated controls.
 * Arrow direction follows the page's RTL reading order.
 */
export function ProductInfoTabs({ tabs, title }: { readonly tabs: readonly ProductInfoTab[]; readonly title: string }) {
  const baseId = useId();
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  /* A `#reviews` link — the rating under the title, or the return from login —
   * opens that tab. The scrolling itself is the browser's: each tab key has a
   * server-rendered anchor at the top of this section, so the fragment always
   * has a real target (a hidden panel would not be one, and a scroll started
   * from JS gets cancelled by the browser's own fragment navigation). Keyed on
   * the tab keys, not the array: pages build `tabs` inline, and a new array
   * every render would re-run this. */
  const tabKeys = tabs.map((tab) => tab.key).join(" ");
  useEffect(() => {
    const keys = tabKeys.split(" ");
    function openFromHash() {
      const key = window.location.hash.slice(1);
      if (key !== "" && keys.includes(key)) setActive(key);
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [tabKeys]);

  if (tabs.length === 0) return null;

  function focusTab(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab === undefined) return;
    setActive(tab.key);
    buttons.current[(index + tabs.length) % tabs.length]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    /* In RTL the next tab sits to the LEFT, so ArrowLeft moves forward. */
    const keyMoves: Record<string, number> = { ArrowLeft: index + 1, ArrowRight: index - 1, Home: 0, End: tabs.length - 1 };
    const target = keyMoves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  }

  return (
    <section id="product-info" className="product-info" aria-label={title}>
      {tabs.map((tab) => (
        <span key={tab.key} id={tab.key} className="product-info-anchor" aria-hidden="true" />
      ))}
      <div role="tablist" className="product-info-tablist" aria-label={title}>
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-controls={`${baseId}-panel-${tab.key}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className="product-info-tab"
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${baseId}-panel-${tab.key}`}
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          hidden={tab.key !== active}
          tabIndex={0}
          className="product-info-panel"
        >
          {tab.content}
        </div>
      ))}
    </section>
  );
}
