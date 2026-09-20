"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  assignCategoryResultSchema,
  type AdminCategory,
  type AdminProduct,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CategoryIcon } from "./category-icon";
import { ToggleActiveButton } from "./toggle-active-button";

/**
 * The product list, with a checkbox per row.
 *
 * A client component because the selection is state, and re-categorising a page
 * of twenty products one form at a time is the job the bulk bar exists to
 * remove. The rows themselves are the server's data, passed straight through.
 */
export function ProductTable({
  items,
  categories,
  emptyHint,
}: {
  items: readonly AdminProduct[];
  categories: readonly AdminCategory[];
  emptyHint: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.length === items.length;

  function toggle(id: string) {
    setDone(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setDone(null);
    setSelected(allSelected ? [] : items.map((product) => product.id));
  }

  async function assign() {
    if (selected.length === 0 || !categoryId) return;
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/categories/assign",
        { productIds: [...selected], categoryId },
        assignCategoryResultSchema,
      );
      setSelected([]);
      setDone(`${formatCount(result.updated)} محصول جابه‌جا شد.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card list-card">
      {selected.length > 0 ? (
        <div className="filter-bar" style={{ marginBlock: "14px 4px" }}>
          <strong style={{ fontSize: 11 }}>{formatCount(selected.length)} محصول انتخاب شده</strong>
          <label className="filter" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            انتقال به دستهٔ
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              aria-label="دستهٔ مقصد"
            >
              <option value="">انتخاب دسته…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nameFa}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary-btn" onClick={assign} disabled={pending || !categoryId}>
            {pending ? "در حال انتقال…" : "اعمال"}
          </button>
          <button type="button" className="filter" onClick={() => setSelected([])} disabled={pending}>
            لغو انتخاب
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="settings-message error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="settings-message success">{done}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="انتخاب همهٔ محصولات این صفحه"
                />
              </th>
              <th>محصول</th>
              <th>برند</th>
              <th>دسته‌بندی</th>
              <th>تعداد SKU</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((product) => (
              <tr key={product.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(product.id)}
                    onChange={() => toggle(product.id)}
                    aria-label={`انتخاب ${product.titleFa}`}
                  />
                </td>
                <td>
                  <Link href={`/catalog/${product.id}`} className="order-id">
                    {product.titleFa}
                  </Link>
                  {product.needsReview ? (
                    <span className="badge badge-wait" style={{ marginInlineStart: 8 }}>
                      نیازمند تکمیل اطلاعات
                    </span>
                  ) : null}
                </td>
                <td>{product.brandRef?.nameFa ?? product.brand}</td>
                <td>
                  {product.categoryRef ? (
                    <span className="taxonomy-name">
                      <CategoryIcon name={product.categoryRef.iconKey} size={15} />
                      {product.categoryRef.nameFa}
                    </span>
                  ) : (
                    product.category
                  )}
                </td>
                <td>{formatCount(product._count?.skus ?? 0)}</td>
                <td>
                  <span className={`badge ${product.isActive ? "badge-success" : "badge-danger"}`}>
                    {product.isActive ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <Link href={`/catalog/${product.id}`} className="secondary-btn taxonomy-cta">
                      مدیریت
                    </Link>
                    {product.isActive ? (
                      <ToggleActiveButton
                        path={`/api/admin/catalog/products/${product.id}`}
                        confirmMessage={`محصول «${product.titleFa}» غیرفعال شود؟`}
                      />
                    ) : (
                      <ToggleActiveButton
                        activate
                        path={`/api/admin/catalog/products/${product.id}`}
                        confirmMessage={`محصول «${product.titleFa}» دوباره فعال شود؟`}
                      />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 ? <p className="empty-hint">{emptyHint}</p> : null}
    </div>
  );
}
