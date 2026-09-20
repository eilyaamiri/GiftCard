"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  CATEGORY_ICON_KEYS,
  CATEGORY_ICON_LABELS,
  type AdminCategory,
  type CategoryIconKey,
} from "../../_lib/catalog-contracts";
import { CategoryIcon } from "../../_components/category-icon";
import { FormError } from "../../_components/form-error";

/**
 * Create and edit in one form. The only difference is the verb and where it
 * navigates afterwards, so splitting them would mean keeping two icon pickers
 * and two slug rules in step.
 */
export function CategoryForm({
  category,
  parents,
}: {
  category?: AdminCategory;
  parents: readonly Pick<AdminCategory, "id" | "nameFa">[];
}) {
  const router = useRouter();
  const isEdit = category !== undefined;
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [nameFa, setNameFa] = useState(category?.nameFa ?? "");
  const [iconKey, setIconKey] = useState<CategoryIconKey>(
    (CATEGORY_ICON_KEYS as readonly string[]).includes(category?.iconKey ?? "")
      ? (category?.iconKey as CategoryIconKey)
      : "gift",
  );
  const [descriptionFa, setDescriptionFa] = useState(category?.descriptionFa ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      slug: slug.trim(),
      name: name.trim(),
      nameFa: nameFa.trim(),
      iconKey,
      descriptionFa: descriptionFa.trim() || null,
      parentId: parentId || null,
      sortOrder: Number(sortOrder) || 0,
      isActive,
    };
    try {
      if (category) {
        await api.put(`/api/admin/catalog/categories/${category.id}`, payload);
      } else {
        await api.post("/api/admin/catalog/categories", payload);
      }
      router.push("/catalog/categories");
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
          <small>در نشانی صفحهٔ دسته‌بندی در سایت دیده می‌شود: حروف کوچک انگلیسی، عدد و خط تیره.</small>
        </label>
        <label>
          آیکون
          <select value={iconKey} onChange={(event) => setIconKey(event.target.value as CategoryIconKey)}>
            {CATEGORY_ICON_KEYS.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_ICON_LABELS[key]}
              </option>
            ))}
          </select>
          {/* The list is names; this shows the operator what they picked. */}
          <span className="taxonomy-icon-preview">
            <CategoryIcon name={iconKey} size={22} />
            <span className="muted">پیش‌نمایش آیکون</span>
          </span>
        </label>
        <label>
          دستهٔ والد (اختیاری)
          <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
            <option value="">بدون والد</option>
            {parents
              .filter((option) => option.id !== category?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.nameFa}
                </option>
              ))}
          </select>
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
          <small>دستهٔ غیرفعال در سایت دیده نمی‌شود، اما محصولاتش دست‌نخورده می‌مانند.</small>
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
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "افزودن دسته‌بندی"}
        </button>
      </div>
    </form>
  );
}
