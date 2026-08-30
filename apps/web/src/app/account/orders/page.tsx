import { AccountNav } from "@/components/account-nav";
import { OrdersList } from "@/components/orders-list";

export default function AccountOrdersPage() {
  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">سفارش‌های من</h1>
      <AccountNav />
      <OrdersList />
    </main>
  );
}
