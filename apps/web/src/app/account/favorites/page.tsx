import { AccountNav } from "@/components/account-nav";
import { FavoritesGrid } from "@/components/favorites-grid";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AccountFavoritesPage() {
  const favorites = await api.accountFavorites();

  return (
    <main className="page container" style={{ maxWidth: 960 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">علاقه‌مندی‌ها</h1>
      <AccountNav />
      <FavoritesGrid initialFavorites={favorites} />
    </main>
  );
}
