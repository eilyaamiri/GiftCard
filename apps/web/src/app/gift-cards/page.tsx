import Link from "next/link";
import { EmptyState, ErrorState } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { GiftCardsCatalog } from "./gift-cards-catalog";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  let items;
  try {
    ({ items } = await api.products("pageSize=100"));
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="فهرست گیفت‌کارت‌ها در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href="/gift-cards">تلاش دوباره</Link>}
        />
      </main>
    );
  }

  return (
    <main className="page container">
      <div className="eyebrow">کاتالوگ</div>
      <h1 className="h2">گیفت‌کارت‌های محبوب</h1>
      <p className="muted">پرتکرارترین کارت‌های دیجیتال جهان، با قیمت شفاف و تحویل مطمئن.</p>
      {items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="در حال حاضر گیفت‌کارتی موجود نیست"
          description="کاتالوگ به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید."
        />
      ) : (
        <GiftCardsCatalog products={items} />
      )}
    </main>
  );
}
