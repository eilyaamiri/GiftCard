import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminCategoryListSchema } from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CategoryIcon } from "../_components/category-icon";
import { ToggleActiveButton } from "../_components/toggle-active-button";
import { CatalogTabs } from "../_components/catalog-tabs";

export const metadata = { title: "دسته‌بندی‌ها | پنل ادمین برات پی" };

export default async function CategoriesPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  let list;
  try {
    list = await api.get("/api/admin/catalog/categories", adminCategoryListSchema);
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <Heading />
        <CatalogTabs active="categories" />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items } = list;
  const activeCount = items.filter((category) => category.isActive).length;

  return (
    <div>
      <Heading caption={`${formatCount(activeCount)} دستهٔ فعال از ${formatCount(items.length)}`} />
      <CatalogTabs active="categories" />

      <div className="toolbar">
        <p className="muted" style={{ margin: 0 }}>
          دسته‌ای که هیچ محصول فعالی ندارد در سایت دیده نمی‌شود؛ اینجا همیشه دیده می‌شود.
        </p>
        <Link href="/catalog/categories/new" className="primary-btn taxonomy-cta">
          + افزودن دسته‌بندی
        </Link>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>دسته‌بندی</th>
                <th>نشانه</th>
                <th>والد</th>
                <th>محصول فعال</th>
                <th>کل محصول</th>
                <th>ترتیب</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((category) => (
                <tr key={category.id}>
                  <td>
                    <span className="taxonomy-name">
                      <CategoryIcon name={category.iconKey} />
                      <Link href={`/catalog/categories/${category.id}`} className="order-id">
                        {category.nameFa}
                      </Link>
                    </span>
                    <span className="table-subline" dir="ltr">
                      {category.name}
                    </span>
                  </td>
                  <td dir="ltr">{category.slug}</td>
                  <td>{category.parent?.nameFa ?? "—"}</td>
                  <td>{formatCount(category.activeProductCount ?? 0)}</td>
                  <td>{formatCount(category.productCount ?? 0)}</td>
                  <td>{formatCount(category.sortOrder)}</td>
                  <td>
                    <span className={`badge ${category.isActive ? "badge-success" : "badge-danger"}`}>
                      {category.isActive ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <Link
                        href={`/catalog?categoryId=${category.id}`}
                        className="secondary-btn taxonomy-cta"
                      >
                        محصول‌ها
                      </Link>
                      {category.isActive ? (
                        <ToggleActiveButton
                          path={`/api/admin/catalog/categories/${category.id}`}
                          confirmMessage={`دستهٔ «${category.nameFa}» غیرفعال شود؟ محصولاتش حذف نمی‌شوند.`}
                        />
                      ) : (
                        <ToggleActiveButton
                          activate
                          path={`/api/admin/catalog/categories/${category.id}`}
                          confirmMessage={`دستهٔ «${category.nameFa}» دوباره فعال شود؟`}
                        />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? <p className="empty-hint">هنوز دسته‌بندی‌ای ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}

function Heading({ caption }: { caption?: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>دسته‌بندی‌ها</h1>
      </div>
      <p className="muted">{caption ?? ""}</p>
    </div>
  );
}
