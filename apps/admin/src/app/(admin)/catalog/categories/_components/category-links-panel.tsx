"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  CATEGORY_LINK_TYPE_LABELS,
  adminProductListSchema,
  adminServiceListSchema,
  adminTopUpGameListSchema,
  type AdminCategoryLink,
  type CategoryLinkType,
} from "../../_lib/catalog-contracts";
import { FormError } from "../../_components/form-error";

type Option = { id: string; label: string; hint: string };

const LINK_TARGET_FIELD = {
  TOP_UP_GAME: "topUpGameId",
  PRODUCT: "productId",
  SERVICE: "serviceId",
} as const satisfies Record<CategoryLinkType, string>;

/** Candidates for the picker. Inactive ones are included: a link to one stays hidden until it is switched on. */
async function loadOptions(type: CategoryLinkType, search: string): Promise<Option[]> {
  const term = search.trim();
  const query = new URLSearchParams({ pageSize: "100", includeInactive: "true" });
  if (term !== "" && type !== "SERVICE") query.set("search", term);

  if (type === "TOP_UP_GAME") {
    const { items } = await api.get(`/api/admin/catalog/top-ups?${query}`, adminTopUpGameListSchema);
    return items.map((game) => ({ id: game.id, label: game.nameFa ?? game.name, hint: game.slug }));
  }
  if (type === "PRODUCT") {
    const { items } = await api.get(`/api/admin/catalog/products?${query}`, adminProductListSchema);
    return items.map((product) => ({ id: product.id, label: product.titleFa, hint: product.slug }));
  }
  const { items } = await api.get(`/api/admin/catalog/services?${query}`, adminServiceListSchema);
  return items
    .filter((service) => term === "" || `${service.nameFa} ${service.slug}`.toLowerCase().includes(term.toLowerCase()))
    .map((service) => ({ id: service.id, label: service.nameFa, hint: service.slug }));
}

function messageOf(caught: unknown): string {
  return caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.";
}

/**
 * The services a service-list category links to. A link names one existing
 * game, product or service and nothing is copied from it: the label, the
 * destination and whether it is shown at all are read from the target. «مخفی»
 * therefore means the target itself is off or unlisted, not that the link is.
 */
export function CategoryLinksPanel({
  categoryId,
  links,
}: {
  categoryId: string;
  links: readonly AdminCategoryLink[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<CategoryLinkType>("TOP_UP_GAME");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [titleFa, setTitleFa] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTargetId("");
    const timer = setTimeout(() => {
      loadOptions(type, search)
        .then((loaded) => {
          if (!cancelled) setOptions(loaded);
        })
        .catch((caught: unknown) => {
          if (!cancelled) {
            setOptions([]);
            setError(messageOf(caught));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [type, search]);

  const alreadyLinked = new Set(links.map((link) => link.target?.targetId));

  async function add() {
    if (targetId === "") return;
    setError(null);
    setPending(true);
    try {
      await api.post(`/api/admin/catalog/categories/${categoryId}/links`, {
        [LINK_TARGET_FIELD[type]]: targetId,
        titleFa: titleFa.trim() || null,
        sortOrder: Number(sortOrder) || 0,
      });
      setTargetId("");
      setTitleFa("");
      setSortOrder("0");
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card panel" style={{ marginTop: 18 }}>
      <h2 className="h3">خدمات این دسته</h2>
      <p className="muted">
        هر ردیف به صفحهٔ خودِ آن خدمت پیوند دارد و چیزی از آن کپی نمی‌شود. دسته‌ای که هیچ خدمت قابل‌نمایشی نداشته باشد
        در منو و نوار دسته‌بندی‌های سایت دیده نمی‌شود.
      </p>
      <FormError message={error} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>خدمت</th>
              <th>نوع</th>
              <th>عنوان در فهرست</th>
              <th>ترتیب</th>
              <th>در سایت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <LinkRow key={link.id} link={link} onError={setError} />
            ))}
          </tbody>
        </table>
        {links.length === 0 ? <p className="empty-hint">هنوز خدمتی به این دسته اضافه نشده است.</p> : null}
      </div>

      <h3 className="h3" style={{ marginTop: 22 }}>افزودن خدمت</h3>
      <div className="form-grid">
        <label>
          نوع خدمت
          <select value={type} onChange={(event) => setType(event.target.value as CategoryLinkType)}>
            {(Object.keys(CATEGORY_LINK_TYPE_LABELS) as CategoryLinkType[]).map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LINK_TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          جستجو
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام یا نشانه" />
        </label>
        <label>
          خدمت
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={loading}>
            <option value="">{loading ? "در حال بارگذاری…" : options.length === 0 ? "موردی پیدا نشد" : "انتخاب کنید"}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id} disabled={alreadyLinked.has(option.id)}>
                {option.label} ({option.hint}){alreadyLinked.has(option.id) ? " — قبلاً اضافه شده" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          عنوان در فهرست (اختیاری)
          <input value={titleFa} onChange={(event) => setTitleFa(event.target.value)} maxLength={120} />
          <small>خالی بماند، نام خودِ خدمت نمایش داده می‌شود.</small>
        </label>
        <label>
          ترتیب
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" className="bp-ltr" />
        </label>
      </div>
      <div className="save-row">
        <button type="button" className="primary-btn" disabled={pending || targetId === ""} onClick={add}>
          {pending ? "در حال افزودن…" : "افزودن به دسته"}
        </button>
      </div>
    </section>
  );
}

function LinkRow({ link, onError }: { link: AdminCategoryLink; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [titleFa, setTitleFa] = useState(link.titleFa ?? "");
  const [sortOrder, setSortOrder] = useState(String(link.sortOrder));
  const [pending, setPending] = useState(false);

  const changed = titleFa.trim() !== (link.titleFa ?? "") || Number(sortOrder) !== link.sortOrder;

  async function run(action: () => Promise<unknown>) {
    onError(null);
    setPending(true);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      onError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <tr>
      <td>
        {link.target?.name ?? "خدمت حذف‌شده"}
        {link.target ? (
          <span className="table-subline" dir="ltr">
            {link.target.slug}
          </span>
        ) : null}
      </td>
      <td>{link.target ? CATEGORY_LINK_TYPE_LABELS[link.target.type] : "—"}</td>
      <td>
        <input
          value={titleFa}
          onChange={(event) => setTitleFa(event.target.value)}
          maxLength={120}
          placeholder={link.target?.name ?? ""}
          aria-label="عنوان در فهرست"
        />
      </td>
      <td>
        <input
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          type="number"
          className="bp-ltr"
          style={{ width: 80 }}
          aria-label="ترتیب"
        />
      </td>
      <td>
        <span className={`badge ${link.isVisible ? "badge-success" : "badge-danger"}`}>
          {link.isVisible ? "نمایش داده می‌شود" : "مخفی"}
        </span>
      </td>
      <td>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button
            type="button"
            className="secondary-btn taxonomy-cta"
            disabled={pending || !changed}
            onClick={() =>
              run(() =>
                api.put(`/api/admin/catalog/category-links/${link.id}`, {
                  titleFa: titleFa.trim() || null,
                  sortOrder: Number(sortOrder) || 0,
                }),
              )
            }
          >
            ذخیره
          </button>
          <button
            type="button"
            className="secondary-btn taxonomy-cta"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("این خدمت از فهرست دسته برداشته شود؟ خودِ خدمت حذف نمی‌شود.")) return;
              void run(() => api.del(`/api/admin/catalog/category-links/${link.id}`));
            }}
          >
            حذف از دسته
          </button>
        </span>
      </td>
    </tr>
  );
}
