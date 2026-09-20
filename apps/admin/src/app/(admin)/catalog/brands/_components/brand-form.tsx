"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminBrand } from "../../_lib/catalog-contracts";
import { FormError } from "../../_components/form-error";

export function BrandForm({ brand }: { brand?: AdminBrand }) {
  const router = useRouter();
  const [savedBrandId, setSavedBrandId] = useState(brand?.id ?? null);
  const isEdit = savedBrandId !== null;
  const [slug, setSlug] = useState(brand?.slug ?? "");
  const [name, setName] = useState(brand?.name ?? "");
  const [nameFa, setNameFa] = useState(brand?.nameFa ?? "");
  const [descriptionFa, setDescriptionFa] = useState(brand?.descriptionFa ?? "");
  const [logoUrl, setLogoUrl] = useState(brand?.logoUrl ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [sortOrder, setSortOrder] = useState(String(brand?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(brand?.isActive ?? true);
  const [isPopular, setIsPopular] = useState(brand?.isPopular ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(brand?.logoUrl ?? null);

  useEffect(() => {
    if (!logoFile) {
      setPreviewUrl(brand?.logoUrl ?? null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile, brand?.logoUrl]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      slug: slug.trim(),
      name: name.trim(),
      nameFa: nameFa.trim(),
      descriptionFa: descriptionFa.trim() || null,
      logoUrl: logoUrl.trim() || null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
      isPopular,
    };
    try {
      let saved: { id: string };
      if (savedBrandId) {
        saved = await api.put<{ id: string }>(`/api/admin/catalog/brands/${savedBrandId}`, payload);
      } else {
        saved = await api.post<{ id: string }>("/api/admin/catalog/brands", payload);
        /* Keep the new id if the logo upload then fails: a retry updates this
         * brand rather than creating a second one with the same name. */
        setSavedBrandId(saved.id);
      }
      if (logoFile) {
        await api.uploadBrandLogo(saved.id, logoFile);
      }
      router.push("/catalog/brands");
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
          نام فارسی
          <input value={nameFa} onChange={(event) => setNameFa(event.target.value)} required maxLength={120} />
        </label>
        <label>
          نام انگلیسی
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          نشانه (slug)
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            maxLength={90}
            dir="ltr"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <small>در نشانی صفحهٔ برند در سایت دیده می‌شود: حروف کوچک انگلیسی، عدد و خط تیره.</small>
        </label>
        <label>
          آدرس لوگو (اختیاری)
          <input
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            maxLength={2000}
            dir="ltr"
          />
        </label>
        <label>
          بارگذاری لوگو (اختیاری)
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
          />
          <small>JPG، PNG، WebP یا GIF — حداکثر ۵ مگابایت. لوگوی بارگذاری‌شده بر آدرس لوگو اولویت دارد.</small>
          {previewUrl ? (
            <img src={previewUrl} alt={`پیش‌نمایش لوگوی ${nameFa || name}`} className="product-image-preview" />
          ) : null}
        </label>
        <label>
          ترتیب نمایش
          <input
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            type="number"
            className="bp-ltr"
          />
        </label>
        <label>
          وضعیت
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
        <label>
          برند محبوب
          <select
            value={isPopular ? "true" : "false"}
            onChange={(event) => setIsPopular(event.target.value === "true")}
          >
            <option value="false">خیر</option>
            <option value="true">بله — در «برندهای محبوب» نمایش داده شود</option>
          </select>
          {/* No traffic or sales figures exist to rank by, so this is a choice
              an operator makes, not a number the system computes. */}
          <small>انتخاب محبوب‌ها دستی است و از روی آمار ساخته نمی‌شود.</small>
        </label>
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          توضیح کوتاه (اختیاری)
          <textarea
            value={descriptionFa}
            onChange={(event) => setDescriptionFa(event.target.value)}
            maxLength={1000}
          />
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "افزودن برند"}
        </button>
      </div>
    </form>
  );
}
