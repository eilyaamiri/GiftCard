import Link from "next/link";
import { EmptyState, ErrorState } from "@barat/ui";
import { ChevronLeft, PackageSearch } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import type { Brand } from "@/lib/catalog";
import { BrandDirectory } from "./brand-directory";

export const metadata = {
  title: "برندها | برات پی",
  description: "همهٔ برندهای گیفت‌کارت موجود در برات پی، با تعداد کارت‌های فعال هر برند.",
};

/** A brand switched off in the panel has to disappear on the next request. */
export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  let brands: readonly Brand[];
  try {
    ({ items: brands } = await api.brands());
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="فهرست برندها در دسترس نیست"
          description={
            error instanceof ApiClientError
              ? error.message
              : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."
          }
          action={
            <Link className="btn btn-primary" href="/brands">
              تلاش دوباره
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="page container catalog-page">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/">خانه</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <Link href="/gift-cards">گیفت‌کارت‌ها</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <span aria-current="page">برندها</span>
      </nav>

      <div className="eyebrow">کاتالوگ</div>
      <h1 className="h2">برندها</h1>
      <p className="muted catalog-lead">
        هر برند را انتخاب کنید تا کارت‌های فعال آن را ببینید. تعداد کنار هر برند، همان چیزی است که
        بعد از انتخاب می‌بینید.
      </p>

      {brands.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="هنوز برندی فعال نیست"
          description="به‌زودی برندهای بیشتری به کاتالوگ اضافه می‌شوند."
        />
      ) : (
        <BrandDirectory brands={brands} />
      )}
    </main>
  );
}
