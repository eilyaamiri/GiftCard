"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminBrandOption, AdminCategory, AdminProduct } from "../_lib/catalog-contracts";
import { CategoryIcon } from "./category-icon";
import { FormError } from "./form-error";

/** The API refuses more than five related categories. */
const MAX_EXTRA_CATEGORIES = 5;

export function ProductForm({
  product,
  brands,
  categories,
}: {
  product?: AdminProduct;
  brands: readonly AdminBrandOption[];
  categories: readonly AdminCategory[];
}) {
  const router = useRouter();
  const [savedProductId, setSavedProductId] = useState(product?.id ?? null);
  const isEdit = savedProductId !== null;
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [title, setTitle] = useState(product?.title ?? "");
  const [titleFa, setTitleFa] = useState(product?.titleFa ?? "");
  const [brandId, setBrandId] = useState(product?.brandId ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [extraCategoryIds, setExtraCategoryIds] = useState<string[]>(
    product?.extraCategories?.map((tag) => tag.category.id) ?? [],
  );
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [descriptionFa, setDescriptionFa] = useState(product?.descriptionFa ?? "");
  const [redemptionNotesFa, setRedemptionNotesFa] = useState(product?.redemptionNotesFa ?? "");
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [needsReview, setNeedsReview] = useState(product?.needsReview ?? false);
  const [isQuickPick, setIsQuickPick] = useState(product?.isQuickPick ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(product?.imageUrl ?? null);

  const selectedCategory = categories.find((item) => item.id === categoryId);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(product?.imageUrl ?? null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile, product?.imageUrl]);

  /* The primary category may not also be a related one — the API refuses it,
   * and it would double-count the product in the category totals. */
  function toggleExtraCategory(id: string) {
    setExtraCategoryIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      slug: slug.trim(),
      title: title.trim(),
      titleFa: titleFa.trim(),
      brandId,
      categoryId,
      extraCategoryIds: extraCategoryIds.filter((id) => id !== categoryId),
      imageUrl: imageUrl.trim() || null,
      descriptionFa: descriptionFa.trim() || null,
      redemptionNotesFa: redemptionNotesFa.trim() || null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      needsReview,
      isQuickPick,
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
          {/* Required, and chosen from the brand table rather than typed: a
              product whose brand is a free-text spelling cannot be found by
              anyone browsing the storefront by brand. */}
          <select value={brandId} onChange={(event) => setBrandId(event.target.value)} required>
            <option value="">یک برند انتخاب کنید…</option>
            {brands.map((option) => (
              <option key={option.id} value={option.id}>
                {option.nameFa} — {option.name}
                {option.isActive ? "" : " (غیرفعال)"}
              </option>
            ))}
          </select>
          <small>
            برند تازه را از <a href="/catalog/brands/new">صفحهٔ برندها</a> بسازید.
          </small>
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
          دسته‌بندی اصلی
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            <option value="">یک دسته انتخاب کنید…</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.nameFa}
                {option.isActive ? "" : " (غیرفعال)"}
              </option>
            ))}
          </select>
          {selectedCategory ? (
            <span className="taxonomy-icon-preview">
              <CategoryIcon name={selectedCategory.iconKey} />
              {selectedCategory.nameFa}
            </span>
          ) : null}
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
        <label>
          نیازمند تکمیل اطلاعات
          <select
            value={needsReview ? "true" : "false"}
            onChange={(event) => setNeedsReview(event.target.value === "true")}
          >
            <option value="false">خیر — قابل سفارش</option>
            <option value="true">بله — نمایش داده می‌شود ولی قابل سفارش نیست</option>
          </select>
        </label>
        <label>
          نمایش در انتخاب سریع
          <select
            value={isQuickPick ? "true" : "false"}
            onChange={(event) => setIsQuickPick(event.target.value === "true")}
          >
            <option value="false">خیر</option>
            <option value="true">بله</option>
          </select>
        </label>
      </div>

      <fieldset className="settings-member-picker" style={{ marginTop: 16 }}>
        <legend>دسته‌بندی‌های مرتبط (حداکثر {MAX_EXTRA_CATEGORIES} مورد)</legend>
        <div className="settings-member-grid">
          {categories
            .filter((option) => option.id !== categoryId)
            .map((option) => {
              const checked = extraCategoryIds.includes(option.id);
              return (
                <label key={option.id} className="settings-member">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && extraCategoryIds.length >= MAX_EXTRA_CATEGORIES}
                    onChange={() => toggleExtraCategory(option.id)}
                  />
                  <span className="taxonomy-name">
                    <CategoryIcon name={option.iconKey} size={15} />
                    <strong>{option.nameFa}</strong>
                  </span>
                </label>
              );
            })}
        </div>
      </fieldset>

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
