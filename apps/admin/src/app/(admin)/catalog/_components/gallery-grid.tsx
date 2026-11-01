"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import { GALLERY_SOURCE_LABELS, type AdminGalleryItem } from "../_lib/catalog-contracts";
import { formatBytes, formatDateTime } from "../_lib/format";
import { GalleryUpload } from "./gallery-upload";

/** The upload control for the gallery page: the server-rendered list refreshes itself. */
export function GalleryPageUpload() {
  const router = useRouter();
  return <GalleryUpload onUploaded={() => router.refresh()} />;
}

/**
 * A grid of gallery images.
 *
 * `manage` is the gallery page: each card can be removed when it is allowed to
 * be. `pick` is the chooser inside the product form: each card is one button
 * that hands the image back, and nothing here can delete.
 */
export function GalleryGrid({
  items,
  emptyHint,
  mode,
  selectedName,
  onPick,
}: {
  items: readonly AdminGalleryItem[];
  emptyHint: string;
  mode: "manage" | "pick";
  selectedName?: string | null;
  onPick?: (item: AdminGalleryItem) => void;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(item: AdminGalleryItem) {
    if (!window.confirm("این تصویر از گالری حذف شود؟ محصولاتی که قبلاً آن را انتخاب کرده‌اند تغییری نمی‌کنند.")) return;
    setRemoving(item.name);
    setError(null);
    try {
      await api.del(`/api/admin/catalog/gallery/files/${encodeURIComponent(item.name)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setRemoving(null);
    }
  }

  if (items.length === 0) return <p className="empty-hint">{emptyHint}</p>;

  return (
    <>
      {error ? (
        <p className="settings-message error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="gallery-grid">
        {items.map((item) => {
          const title = item.label ?? item.name;
          const thumb = (
            <>
              <span className="gallery-thumb">
                {/* Same-origin and admin-authenticated: the browser sends the session cookie. */}
                <img src={item.url} alt={title} loading="lazy" />
              </span>
              <span className="gallery-meta">
                <strong title={item.name}>{title}</strong>
                <span className="muted">
                  <span className="badge badge-info">{GALLERY_SOURCE_LABELS[item.source]}</span>{" "}
                  {formatBytes(item.sizeBytes)}
                </span>
                {mode === "manage" ? <span className="muted">{formatDateTime(item.updatedAt)}</span> : null}
              </span>
            </>
          );
          return (
            <li key={item.name} className={`gallery-item${selectedName === item.name ? " selected" : ""}`}>
              {mode === "pick" ? (
                <button
                  type="button"
                  className="gallery-pick"
                  aria-pressed={selectedName === item.name}
                  onClick={() => onPick?.(item)}
                >
                  {thumb}
                </button>
              ) : (
                <>
                  {thumb}
                  {item.canDelete ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={removing === item.name}
                      onClick={() => void remove(item)}
                    >
                      {removing === item.name ? "در حال حذف…" : "حذف"}
                    </button>
                  ) : (
                    <small className="muted" title="این تصویر در حال استفاده است و از اینجا حذف نمی‌شود.">
                      در حال استفاده
                    </small>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
