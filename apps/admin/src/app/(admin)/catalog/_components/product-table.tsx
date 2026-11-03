"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  assignBrandResultSchema,
  assignCategoryResultSchema,
  bulkSetProductActiveResultSchema,
  type AdminBrandOption,
  type AdminCategory,
  type AdminProduct,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CategoryIcon } from "./category-icon";
import { ToggleActiveButton } from "./toggle-active-button";
import { ToggleQuickPickButton } from "./toggle-quick-pick-button";

/**
 * The product list, with a checkbox per row.
 *
 * A client component because the selection is state, and re-categorising or
 * re-branding a page of a hundred products one form at a time is the job the
 * bulk bar exists to remove. The rows themselves are the server's data, passed
 * straight through.
 */
export function ProductTable({
  items,
  categories,
  brands,
  emptyHint,
}: {
  items: readonly AdminProduct[];
  categories: readonly AdminCategory[];
  brands: readonly AdminBrandOption[];
  emptyHint: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
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

  async function assignBrand() {
    if (selected.length === 0 || !brandId) return;
    const brand = brands.find((option) => option.id === brandId);
    /* A bulk change to something customers see by name: say what will happen
     * before it does, with the count and the brand, as the single toggle does. */
    if (
      !window.confirm(
        `برند ${formatCount(selected.length)} محصول انتخاب‌شده به «${brand?.nameFa ?? brandId}» تغییر کند؟`,
      )
    ) {
      return;
    }
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/brands/assign",
        { productIds: [...selected], brandId },
        assignBrandResultSchema,
      );
      setSelected([]);
      setDone(`برند ${formatCount(result.updated)} محصول تغییر کرد.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  async function bulkSetActive(isActive: boolean) {
    if (selected.length === 0) return;
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/products/bulk-active",
        { productIds: [...selected], isActive },
        bulkSetProductActiveResultSchema,
      );
      setSelected([]);
      setDone(
        `${formatCount(result.updated)} محصول ${isActive ? "فعال" : "غیرفعال"} شد.`,
      );
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
          <label className="filter" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            تغییر برند به
            <select value={brandId} onChange={(event) => setBrandId(event.target.value)} aria-label="برند مقصد">
              <option value="">انتخاب برند…</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.nameFa}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary-btn" onClick={assignBrand} disabled={pending || !brandId}>
            {pending ? "در حال اعمال…" : "اعمال برند"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => bulkSetActive(true)}
            disabled={pending}
          >
            {pending ? "در حال اعمال…" : "فعال‌سازی گروهی"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => bulkSetActive(false)}
            disabled={pending}
          >
            {pending ? "در حال اعمال…" : "غیرفعال‌سازی گروهی"}
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
              <th>تأمین‌کننده</th>
              <th>تعداد SKU</th>
              <th>وضعیت</th>
              <th>صفحهٔ اول</th>
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
                <td>
                  {/* Active offers only — the same rule as the supplier filter.
                      Empty means nobody can currently serve it, which is worth
                      seeing: it cannot be bought until an offer is added. */}
                  {product.suppliers === undefined || product.suppliers.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
                      {product.suppliers.map((supplier) => (
                        <Link
                          key={supplier.id}
                          href={`/catalog?supplierId=${encodeURIComponent(supplier.id)}`}
                          className={`badge ${supplier.isActive ? "badge-success" : "badge-danger"}`}
                          title={supplier.isActive ? `فقط محصولات ${supplier.name}` : `${supplier.name} (غیرفعال)`}
                          style={{ textDecoration: "none" }}
                        >
                          {supplier.name}
                        </Link>
                      ))}
                    </span>
                  )}
                </td>
                <td>{formatCount(product._count?.skus ?? 0)}</td>
                <td>
                  <span className={`badge ${product.isActive ? "badge-success" : "badge-danger"}`}>
                    {product.isActive ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className={`badge ${product.isQuickPick ? "badge-success" : "badge-danger"}`}>
                      {product.isQuickPick ? "نمایش داده می‌شود" : "نمایش داده نمی‌شود"}
                    </span>
                    <ToggleQuickPickButton productId={product.id} isQuickPick={product.isQuickPick} />
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
