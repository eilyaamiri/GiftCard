"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  GALLERY_PAGE_SIZE,
  GALLERY_SOURCE_LABELS,
  GALLERY_SOURCE_VALUES,
  adminGalleryListSchema,
  galleryListSearch,
  type AdminGalleryItem,
  type GalleryQuery,
  type GallerySourceFilter,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { GalleryGrid } from "./gallery-grid";
import { GalleryUpload } from "./gallery-upload";

type Loaded = {
  readonly items: readonly AdminGalleryItem[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
};

/**
 * Chooses an image from the gallery, from inside the product form.
 *
 * A native `<dialog>` for the focus trap, the inert background and Escape, the
 * same choice the storefront's drawers make. It reads the list itself rather
 * than taking it as a prop: the gallery can hold every image ever uploaded, and
 * a form that carried all of them on every open would pay for a choice most
 * people never make.
 */
export function GalleryPicker({
  open,
  selectedName,
  onPick,
  onClose,
}: {
  open: boolean;
  selectedName: string | null;
  onPick: (item: AdminGalleryItem) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState<GalleryQuery>({ page: 1, pageSize: GALLERY_PAGE_SIZE, source: "ALL" });
  const [term, setTerm] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const load = useCallback(async (next: GalleryQuery) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get(`/api/admin/catalog/gallery${galleryListSearch(next)}`, adminGalleryListSchema);
      setData({
        items: result.items,
        page: result.meta.page,
        totalPages: result.meta.totalPages,
        total: result.meta.total,
      });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Read on open, not on mount: the page may have been open a while and the
  // gallery is shared with whoever else is uploading.
  useEffect(() => {
    if (open) void load(query);
  }, [open, query, load]);

  function search(event: FormEvent) {
    event.preventDefault();
    const trimmed = term.trim();
    setQuery((current) => {
      const { search: _previous, ...rest } = current;
      return { ...rest, ...(trimmed ? { search: trimmed } : {}), page: 1 };
    });
  }

  function setSource(source: GallerySourceFilter) {
    setQuery((current) => ({ ...current, source, page: 1 }));
  }

  return (
    <dialog ref={dialog} className="gallery-dialog" onClose={onClose} aria-label="انتخاب تصویر از گالری">
      <div className="gallery-dialog-head">
        <strong>انتخاب تصویر از گالری</strong>
        <button type="button" className="secondary-btn" onClick={onClose}>
          بستن
        </button>
      </div>

      <form onSubmit={search} className="filter-bar" style={{ marginBlockEnd: 12 }}>
        <div className="search">
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="نام تصویر، محصول یا برند"
            maxLength={120}
            aria-label="جست‌وجو در گالری"
          />
        </div>
        <label className="filter" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          منبع
          <select
            value={query.source}
            onChange={(event) => setSource(event.target.value as GallerySourceFilter)}
            aria-label="فیلتر منبع تصویر"
          >
            <option value="ALL">همه</option>
            {GALLERY_SOURCE_VALUES.map((source) => (
              <option key={source} value={source}>
                {GALLERY_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="filter">
          جست‌وجو
        </button>
      </form>

      <GalleryUpload label="بارگذاری تصویر جدید به گالری" onUploaded={() => void load({ ...query, page: 1 })} />

      {error ? (
        <p className="settings-message error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && data === null ? <p className="empty-hint">در حال بارگذاری…</p> : null}
      {data ? (
        <>
          <GalleryGrid
            mode="pick"
            items={data.items}
            selectedName={selectedName}
            onPick={onPick}
            emptyHint={query.search || query.source !== "ALL" ? "تصویری با این فیلترها یافت نشد." : "هنوز تصویری بارگذاری نشده است."}
          />
          {data.totalPages > 1 ? (
            <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 14 }}>
              <button
                type="button"
                className="filter"
                disabled={loading || data.page <= 1}
                onClick={() => setQuery((current) => ({ ...current, page: data.page - 1 }))}
              >
                صفحهٔ قبل
              </button>
              <span className="muted">
                صفحهٔ {formatCount(data.page)} از {formatCount(data.totalPages)} · {formatCount(data.total)} تصویر
              </span>
              <button
                type="button"
                className="filter"
                disabled={loading || data.page >= data.totalPages}
                onClick={() => setQuery((current) => ({ ...current, page: data.page + 1 }))}
              >
                صفحهٔ بعد
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
