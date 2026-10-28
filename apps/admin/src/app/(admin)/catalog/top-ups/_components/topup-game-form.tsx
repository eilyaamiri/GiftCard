"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import { toSquareCover } from "@/lib/square-image";
import type { AdminGalleryItem, AdminTopUpGameDetail } from "../../_lib/catalog-contracts";
import { FormError } from "../../_components/form-error";
import { GalleryPicker } from "../../_components/gallery-picker";
import { DeliveryTimeSelect } from "../../_components/delivery-time-select";

/**
 * Curation for one top-up game.
 *
 * `slug`, `providerCategoryId` and `isListed` are absent on purpose. The first
 * two identify the game at the venue and renaming them would orphan it from the
 * next sync; `isListed` is the venue's answer and is written only by the sync.
 * A form that could set it would let an operator advertise a product the
 * supplier has withdrawn, and the customer would meet the failure at quote time.
 */
export function TopUpGameForm({ game }: { game: AdminTopUpGameDetail }) {
  const router = useRouter();
  const [nameFa, setNameFa] = useState(game.nameFa ?? "");
  const [brandName, setBrandName] = useState(game.brandName ?? "");
  const [descriptionFa, setDescriptionFa] = useState(game.descriptionFa ?? "");
  const [providerNote, setProviderNote] = useState(game.providerNote ?? "");
  const [deliveryMinutes, setDeliveryMinutes] = useState<number | null>(game.deliveryMinutes ?? null);
  const [isActive, setIsActive] = useState(game.isActive);
  const [sortOrder, setSortOrder] = useState(String(game.sortOrder));
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [galleryPick, setGalleryPick] = useState<AdminGalleryItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(game.imageUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coverFile) {
      setPreviewUrl(game.imageUrl);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile, game.imageUrl]);

  async function onPickCover(file: File | null) {
    setError(null);
    if (file === null) {
      setCoverFile(null);
      return;
    }
    try {
      setCoverFile(await toSquareCover(file));
    } catch {
      setCoverFile(null);
      setError("خواندن این تصویر ممکن نشد. یک فایل JPG، PNG یا WebP انتخاب کنید.");
    }
  }

  /*
   * A gallery image goes the same way a file from the computer does: read, cut
   * to the square the game's card frame needs, and uploaded when the form is
   * saved. A game's image is a square, a gallery image can be any shape, so
   * copying the file as it is would not fit the frame. The picture is read
   * from the admin route that serves it (same origin, so it carries the session).
   */
  async function onPickFromGallery(item: AdminGalleryItem) {
    setPickerOpen(false);
    setError(null);
    try {
      const response = await fetch(item.url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`gallery image ${String(response.status)}`);
      const blob = await response.blob();
      setCoverFile(await toSquareCover(new File([blob], item.name, { type: blob.type })));
      setGalleryPick(item);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setError("خواندن تصویر از گالری ممکن نشد. دوباره تلاش کنید یا از گالری تصویر دیگری انتخاب کنید.");
    }
  }

  function onFileChange(file: File | null) {
    setGalleryPick(null);
    void onPickCover(file);
  }

  function clearGalleryPick() {
    setGalleryPick(null);
    setCoverFile(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.put(`/api/admin/catalog/top-ups/${game.id}`, {
        nameFa: nameFa.trim(),
        brandName: brandName.trim() || null,
        descriptionFa: descriptionFa.trim() || null,
        providerNote: providerNote.trim() || null,
        deliveryMinutes,
        isActive,
        sortOrder: Number(sortOrder) || 0,
      });
      if (coverFile) {
        await api.uploadTopUpGameImage(game.id, coverFile);
        setCoverFile(null);
        setGalleryPick(null);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel">
      <FormError message={error} />
      <div className="form-grid">
        <label>
          نام نمایشی
          <input value={nameFa} onChange={(event) => setNameFa(event.target.value)} required maxLength={240} />
        </label>
        <label>
          برند
          <input value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={240} />
        </label>
        <label>
          ترتیب نمایش
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" min={0} className="bp-ltr" />
        </label>
        <label>
          وضعیت فروش
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
        <DeliveryTimeSelect value={deliveryMinutes} onChange={setDeliveryMinutes} />
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          تصویر بازی (اختیاری)
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
          <small>
            هر تصویری قابل قبول است؛ خودکار به مربع ۲۵۶×۲۵۶ بریده و کوچک می‌شود تا در کادر کارت بازی جا بگیرد.
          </small>
        </label>
        {/* Outside the label above: a button inside it would also activate the file input. */}
        <div className="gallery-field">
          <span className="gallery-field-title">یا انتخاب از گالری تصاویر</span>
          <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="secondary-btn" onClick={() => setPickerOpen(true)}>
              {galleryPick ? "تغییر تصویر گالری" : "انتخاب از گالری"}
            </button>
            {galleryPick ? (
              <>
                <span className="muted" title={galleryPick.name}>
                  {galleryPick.label ?? galleryPick.name}
                </span>
                <button type="button" className="filter" onClick={clearGalleryPick}>
                  لغو انتخاب
                </button>
              </>
            ) : null}
          </span>
          <small>تصویری که قبلاً بارگذاری شده را دوباره استفاده کنید. مثل فایل سیستم، به مربع بریده می‌شود و با «ذخیرهٔ تغییرات» ثبت می‌شود.</small>
          {previewUrl ? (
            <img src={previewUrl} alt={`پیش‌نمایش تصویر ${game.nameFa ?? game.name}`} className="product-image-preview" />
          ) : null}
        </div>
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          توضیح برای مشتری (اختیاری)
          <textarea value={descriptionFa} onChange={(event) => setDescriptionFa(event.target.value)} maxLength={4000} />
        </label>
        <label>
          راهنمای تأمین‌کننده (اختیاری)
          <textarea value={providerNote} onChange={(event) => setProviderNote(event.target.value)} maxLength={4000} className="bp-ltr" />
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}
        </button>
      </div>
      <GalleryPicker
        open={pickerOpen}
        selectedName={galleryPick?.name ?? null}
        onPick={(item) => void onPickFromGallery(item)}
        onClose={() => setPickerOpen(false)}
      />
    </form>
  );
}
