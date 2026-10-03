"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * One horizontally scrolling line, with an arrow at whichever end still has
 * chips beyond the edge. The scrollbar is hidden, so without the arrow there
 * is no hint the row continues.
 *
 * The page is RTL: the row starts at the right and `scrollLeft` runs from 0
 * to a negative number, so every comparison uses its absolute value.
 */
export function CategoryScroller({ children }: Readonly<{ children: ReactNode }>) {
  const track = useRef<HTMLDivElement>(null);
  const [canStart, setCanStart] = useState(false);
  const [canEnd, setCanEnd] = useState(false);

  const measure = useCallback(() => {
    const el = track.current;
    if (el === null) return;
    const max = el.scrollWidth - el.clientWidth;
    const offset = Math.abs(el.scrollLeft);
    setCanStart(offset > 2);
    setCanEnd(offset < max - 2);
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (el === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scroll = (toward: "start" | "end") => {
    const el = track.current;
    if (el === null) return;
    /* In RTL the end of the row is to the left, which is a negative delta. */
    const step = Math.max(200, el.clientWidth * 0.7);
    el.scrollBy({ left: toward === "end" ? -step : step, behavior: "smooth" });
  };

  return (
    <div className="category-scroller">
      {canStart ? (
        <button
          type="button"
          className="category-scroll-btn category-scroll-start"
          onClick={() => scroll("start")}
          aria-label="دسته‌بندی‌های قبلی"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      ) : null}
      <div className="category-tiles" ref={track} onScroll={measure}>
        {children}
      </div>
      {canEnd ? (
        <button
          type="button"
          className="category-scroll-btn category-scroll-end"
          onClick={() => scroll("end")}
          aria-label="دسته‌بندی‌های بعدی"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
