"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminProduct } from "../_lib/catalog-contracts";
import { FormError } from "./form-error";

export function ProductForm({ product }: { product?: AdminProduct }) {
  const router = useRouter();
  const [savedProductId, setSavedProductId] = useState(product?.id ?? null);
  const isEdit = savedProductId !== null;
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [title, setTitle] = useState(product?.title ?? "");
  const [titleFa, setTitleFa] = useState(product?.titleFa ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [descriptionFa, setDescriptionFa] = useState(product?.descriptionFa ?? "");
  const [redemptionNotesFa, setRedemptionNotesFa] = useState(product?.redemptionNotesFa ?? "");
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(product?.imageUrl ?? null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(product?.imageUrl ?? null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile, product?.imageUrl]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      slug: slug.trim(),
      brand: brand.trim(),
      title: title.trim(),
      titleFa: titleFa.trim(),
      category: category.trim(),
      imageUrl: imageUrl.trim() || null,
      descriptionFa: descriptionFa.trim() || null,
      redemptionNotesFa: redemptionNotesFa.trim() || null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
    };
    try {
      let savedProduct: { id: string };
      if (savedProductId) {
        savedProduct = await api.put<{ id: string }>(`/api/admin/catalog/products/${savedProductId}`, payload);
      } else {
        savedProduct = await api.post<{ id: string }>("/api/admin/catalog/products", payload);
        /* If the subsequent image upload fails, keep the newly-created id. A
         * retry then updates that row rather than creating a duplicate product. */
        setSavedProductId(savedProduct.id);
      }
      if (imageFile) {
        await api.uploadProductImage(savedProduct.id, imageFile);
      }
      router.push("/catalog");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel">
      <FormError message={error} />
      <div className="form-grid">
        <label>
          اسلاگ (slug)
          <input value={slug} onChange={(event) => setSlug(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          برند
          <input value={brand} onChange={(event) => setBrand(event.target.value)} required maxLength={120} />
        </label>
        <label>
          عنوان (انگلیسی)
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={240} dir="ltr" />
        </label>
        <label>
          عنوان فارسی
          <input value={titleFa} onChange={(event) => setTitleFa(event.target.value)} required maxLength={240} />
        </label>
        <label>
          دسته‌بندی
          <input value={category} onChange={(event) => setCategory(event.target.value)} required maxLength={120} />
        </label>
        <label>
          آدرس تصویر (اختیاری)
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} maxLength={2000} dir="ltr" type="url" />
        </label>
        <label>
          بارگذاری تصویر محصول (اختیاری)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
          />
          <small>JPG، PNG، WebP یا GIF — حداکثر ۵ مگابایت. تصویر بارگذاری‌شده بر آدرس تصویر اولویت دارد.</small>
          {previewUrl ? (
            <img src={previewUrl} alt="پیش‌نمایش تصویر محصول" className="product-image-preview" />
          ) : null}
        </label>
        <label>
          ترتیب نمایش
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" className="bp-ltr" />
        </label>
        <label>
          وضعیت
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          توضیح فارسی (اختیاری)
          <textarea value={descriptionFa} onChange={(event) => setDescriptionFa(event.target.value)} maxLength={4000} />
        </label>
        <label>
          توضیحات نحوهٔ استفاده (اختیاری)
          <textarea value={redemptionNotesFa} onChange={(event) => setRedemptionNotesFa(event.target.value)} maxLength={4000} />
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "افزودن محصول"}
        </button>
      </div>
    </form>
  );
}
