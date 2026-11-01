import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  GALLERY_SOURCE_LABELS,
  GALLERY_SOURCE_VALUES,
  adminGalleryListSchema,
  galleryHref,
  galleryListSearch,
  readGalleryQuery,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CatalogTabs } from "../_components/catalog-tabs";
import { GalleryGrid, GalleryPageUpload } from "../_components/gallery-grid";

export const metadata = { title: "گالری تصاویر | پنل ادمین سنتو" };

const BASE_PATH = "/catalog/gallery";

/**
 * Every image uploaded to the catalog — products', brands', games' and the ones
 * added here — in one place.
 *
 * What is uploaded here can be chosen for a product from its form, which is the
 * point: one upload, reused, instead of the same picture sent again for each
 * product that wants it. Images that belong to a product, brand or game are
 * shown so they can be reused, but only a gallery upload can be deleted.
 */
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CATALOG_WRITE_ROLES);

  const query = readGalleryQuery(await searchParams);

  let list;
  try {
    list = await api.get(`/api/admin/catalog/gallery${galleryListSearch(query)}`, adminGalleryListSchema);
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <PageHeading />
        <CatalogTabs active="gallery" />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items, meta } = list;
  // The API echoes whatever page was asked for; clamp so the caption and pager stay honest.
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));
  const hasFilter = Boolean(query.search) || query.source !== "ALL";

  return (
    <div>
      <PageHeading caption={`${formatCount(meta.total)} تصویر`} />
      <CatalogTabs active="gallery" />

      <div className="toolbar">
        {/* A plain GET form: the filters stay in the URL, so they survive a reload. */}
        <form action={BASE_PATH} method="get" className="filter-bar" style={{ marginBlockEnd: 0 }}>
          <div className="search">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="نام تصویر، محصول یا برند"
              maxLength={120}
              aria-label="جست‌وجو در گالری"
            />
          </div>
          <label className="filter" style={INLINE_FILTER}>
            منبع
            <select name="source" defaultValue={query.source} aria-label="فیلتر منبع تصویر">
              <option value="ALL">همه</option>
              {GALLERY_SOURCE_VALUES.map((source) => (
                <option key={source} value={source}>
                  {GALLERY_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {hasFilter ? (
            <Link href={BASE_PATH} className="filter" style={FILTER_LINK}>
              پاک کردن فیلترها
            </Link>
          ) : null}
        </form>
        <GalleryPageUpload />
      </div>

      <div className="card panel">
        <GalleryGrid
          mode="manage"
          items={items}
          emptyHint={hasFilter ? "تصویری با این فیلترها یافت نشد." : "هنوز تصویری بارگذاری نشده است."}
        />
      </div>

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={galleryHref(BASE_PATH, query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={galleryHref(BASE_PATH, query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PageHeading({ caption }: { caption?: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>گالری تصاویر</h1>
      </div>
      <p className="muted">{caption ?? ""}</p>
    </div>
  );
}

const INLINE_FILTER = { display: "inline-flex", alignItems: "center", gap: 7 } as const;

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
