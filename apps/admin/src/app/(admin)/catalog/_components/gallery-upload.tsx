"use client";

import { useRef, useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import { adminGalleryItemSchema, type AdminGalleryItem } from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
/** The API refuses more than this; checking here saves the round trip for a photo straight off a camera. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Uploads one or more images to the gallery, one request each.
 *
 * Sequential on purpose: the API takes a single file per call, and a failure
 * should name the file that failed rather than abort the ones after it.
 */
export function GalleryUpload({
  onUploaded,
  label = "بارگذاری تصویر",
}: {
  onUploaded: (items: readonly AdminGalleryItem[]) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function onChange(files: readonly File[]) {
    // Cleared so choosing the same file again still fires a change event.
    if (input.current) input.current.value = "";
    if (files.length === 0) return;

    setPending(true);
    setMessage(null);
    const uploaded: AdminGalleryItem[] = [];
    const failed: string[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        failed.push(`${file.name}: بزرگ‌تر از ۵ مگابایت است`);
        continue;
      }
      try {
        uploaded.push(await api.uploadGalleryImage(file, adminGalleryItemSchema));
      } catch (caught) {
        failed.push(`${file.name}: ${caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست."}`);
      }
    }
    setPending(false);
    if (uploaded.length > 0) onUploaded(uploaded);
    setMessage(
      failed.length > 0
        ? { tone: "error", text: failed.join(" — ") }
        : { tone: "success", text: `${formatCount(uploaded.length)} تصویر بارگذاری شد.` },
    );
  }

  return (
    <div className="gallery-upload">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => void onChange(Array.from(event.target.files ?? []))}
      />
      <button type="button" className="primary-btn" disabled={pending} onClick={() => input.current?.click()}>
        {pending ? "در حال بارگذاری…" : `+ ${label}`}
      </button>
      <small className="muted">JPG، PNG، WebP یا GIF — حداکثر ۵ مگابایت برای هر تصویر.</small>
      {message ? (
        <p className={`settings-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
